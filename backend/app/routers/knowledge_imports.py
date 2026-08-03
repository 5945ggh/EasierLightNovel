"""Explicit, read-only external-known-baseline import endpoints."""

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    ExternalKnowledgeImport,
    ExternalKnowledgeImportItem,
    Lexeme,
    UserLexemeKnowledge,
)
from app.schemas import (
    AnkiKnowledgeImportRequest,
    ExternalKnowledgeImportApplyResponse,
    ExternalKnowledgeImportPreviewResponse,
    ExternalKnowledgeImportRevokeResponse,
    JLPTKnowledgeImportRequest,
)
from app.services.external_knowledge_import_service import (
    AnkiConnectKnowledgeSource,
    ExternalKnowledgeImportError,
    ExternalKnowledgeImportService,
    JLPTJsonKnowledgeSource,
    SQLAlchemyKnowledgeImportRepository,
    SQLAlchemyLexemeResolver,
)


router = APIRouter(prefix="/api/knowledge-imports", tags=["Knowledge Imports"])


def _service(db: Session) -> ExternalKnowledgeImportService:
    return ExternalKnowledgeImportService(
        SQLAlchemyKnowledgeImportRepository(
            db,
            user_lexeme_knowledge_model=UserLexemeKnowledge,
            external_knowledge_import_model=ExternalKnowledgeImport,
            external_knowledge_import_item_model=ExternalKnowledgeImportItem,
            lexeme_model=Lexeme,
        ),
        lexeme_resolver=SQLAlchemyLexemeResolver(db, Lexeme),
    )


def _preview_payload(preview) -> dict:
    return {
        "source_kind": preview.source_kind,
        "import_digest": preview.import_digest,
        "stats": asdict(preview.stats),
        "accepted": [
            {
                "lexeme_id": item.lexeme_id,
                "normalized_form": item.normalized_form,
                "canonical_reading_kana": item.canonical_reading_kana,
                "source_entry_id": item.source_entry_id,
                "level": item.level,
            }
            for item in preview.accepted
        ],
        "skipped": [asdict(item) for item in preview.skipped],
    }


def _anki_preview(db: Session, request: AnkiKnowledgeImportRequest):
    source = AnkiConnectKnowledgeSource(timeout_seconds=request.timeout_seconds)
    return _service(db).preview_candidates(
        "anki",
        source.fetch_candidates(
            query=request.query,
            expression_fields=request.expression_fields,
            reading_fields=request.reading_fields,
        ),
    )


def _jlpt_preview(db: Session, request: JLPTKnowledgeImportRequest):
    return _service(db).preview_candidates(
        "jlpt",
        JLPTJsonKnowledgeSource(request.path).fetch_candidates(levels=request.levels),
    )


@router.post("/anki/preview", response_model=ExternalKnowledgeImportPreviewResponse)
def preview_anki(request: AnkiKnowledgeImportRequest, db: Session = Depends(get_db)):
    try:
        return _preview_payload(_anki_preview(db, request))
    except ExternalKnowledgeImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/anki/apply", response_model=ExternalKnowledgeImportApplyResponse)
def apply_anki(request: AnkiKnowledgeImportRequest, db: Session = Depends(get_db)):
    try:
        service = _service(db)
        result = service.apply_preview(_anki_preview(db, request))
        return {
            "batch_id": result.batch_id,
            "source_kind": result.source_kind,
            "import_digest": result.import_digest,
            "created_count": result.created_count,
            "skipped": [asdict(item) for item in result.skipped],
        }
    except ExternalKnowledgeImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/jlpt/preview", response_model=ExternalKnowledgeImportPreviewResponse)
def preview_jlpt(request: JLPTKnowledgeImportRequest, db: Session = Depends(get_db)):
    try:
        return _preview_payload(_jlpt_preview(db, request))
    except (ExternalKnowledgeImportError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/jlpt/apply", response_model=ExternalKnowledgeImportApplyResponse)
def apply_jlpt(request: JLPTKnowledgeImportRequest, db: Session = Depends(get_db)):
    try:
        service = _service(db)
        result = service.apply_preview(_jlpt_preview(db, request))
        return {
            "batch_id": result.batch_id,
            "source_kind": result.source_kind,
            "import_digest": result.import_digest,
            "created_count": result.created_count,
            "skipped": [asdict(item) for item in result.skipped],
        }
    except (ExternalKnowledgeImportError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{batch_id}", response_model=ExternalKnowledgeImportRevokeResponse)
def revoke_import(batch_id: str, db: Session = Depends(get_db)):
    result = _service(db).rollback_batch(batch_id)
    return asdict(result)
