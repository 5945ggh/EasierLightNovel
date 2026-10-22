"""Explicit, read-only external-known-baseline import endpoints."""

import hashlib
import os
from dataclasses import asdict, replace
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
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
    AnkiKnowledgeImportApplyRequest,
    AnkiCatalogResponse,
    ExternalKnowledgeImportApplyResponse,
    ExternalKnowledgeImportPreviewResponse,
    ExternalKnowledgeImportRevokeResponse,
    JLPTKnowledgeImportApplyRequest,
    JLPTKnowledgeImportRequest,
)
from app.config import KNOWLEDGE_IMPORT_DIR
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


@router.get("/anki/catalog", response_model=AnkiCatalogResponse)
def inspect_anki_catalog(
    model_name: str | None = Query(default=None, max_length=255),
    timeout_seconds: float = Query(default=2.0, gt=0, le=10),
):
    """Read connection, deck, model, field, and template metadata only."""
    try:
        source = AnkiConnectKnowledgeSource(timeout_seconds=timeout_seconds)
        return source.inspect_catalog(model_name=model_name)
    except ExternalKnowledgeImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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
                "target_state": item.target_state,
            }
            for item in preview.accepted
        ],
        "skipped": [_skip_payload(item) for item in preview.skipped],
        "known_before_count": preview.known_before_count,
        "known_after_count": preview.known_after_count,
        "known_delta": preview.known_after_count - preview.known_before_count,
        "learning_map_impact": preview.learning_map_impact,
    }


def _skip_payload(item) -> dict:
    # ImportSkip.metadata contains internal, card-level evidence needed for
    # aggregation. It deliberately never crosses the API boundary.
    return {
        "source_entry_id": item.source_entry_id,
        "reason": item.reason,
        "normalized_form": item.normalized_form,
        "canonical_reading_kana": item.canonical_reading_kana,
    }


def _anki_preview(db: Session, request: AnkiKnowledgeImportRequest):
    source = AnkiConnectKnowledgeSource(timeout_seconds=request.timeout_seconds)
    return _service(db).preview_candidates(
        "anki",
        source.fetch_candidates(
            query=request.query,
            deck_name=request.deck_name,
            model_name=request.model_name,
            template_ord=request.template_ord,
            expression_fields=request.expression_fields,
            reading_fields=request.reading_fields,
        ),
    )


def _safe_jlpt_path(path: str) -> Path:
    """Resolve a client path without allowing reads outside the import root."""
    import_root = Path(KNOWLEDGE_IMPORT_DIR)
    raw_path = Path(path)
    raw_candidate = raw_path if raw_path.is_absolute() else import_root / raw_path

    # Reject symlink components before resolving.  This keeps the accepted
    # source contract stable even when a link later gets retargeted.
    if raw_candidate.anchor:
        probe = Path(raw_candidate.anchor)
        parts = raw_candidate.parts[1:]
    else:
        probe = import_root
        parts = raw_candidate.parts
    for part in parts:
        probe /= part
        if probe.is_symlink():
            raise ValueError("JLPT 文件不得通过符号链接访问")

    resolved_root = import_root.resolve(strict=False)
    resolved_candidate = raw_candidate.resolve(strict=False)
    try:
        common = Path(os.path.commonpath((str(resolved_root), str(resolved_candidate))))
    except ValueError as exc:
        raise ValueError("JLPT 文件路径无效") from exc
    if common != resolved_root:
        raise ValueError("JLPT 文件必须位于受控导入目录内")
    if resolved_candidate.suffix.lower() != ".json":
        raise ValueError("JLPT 导入文件必须使用 .json 扩展名")
    if not resolved_candidate.is_file():
        raise ValueError("JLPT 导入文件不存在或不可读")
    return resolved_candidate


def _jlpt_preview(db: Session, request: JLPTKnowledgeImportRequest):
    safe_path = _safe_jlpt_path(request.path)
    try:
        source_bytes = safe_path.read_bytes()
    except OSError as exc:
        raise ValueError("JLPT 导入文件不存在或不可读") from exc
    preview = _service(db).preview_candidates(
        "jlpt",
        JLPTJsonKnowledgeSource(safe_path, json_bytes=source_bytes).fetch_candidates(levels=request.levels),
    )
    # Bind the confirmation digest to the same source bytes that produced the
    # parsed candidates. This detects edits to skipped entries, metadata, or
    # formatting between preview and apply without mixing file snapshots.
    source_digest = hashlib.sha256(source_bytes).hexdigest()
    import_digest = hashlib.sha256(
        f"{preview.import_digest}:{source_digest}".encode("ascii")
    ).hexdigest()
    return replace(preview, import_digest=import_digest)


@router.post("/anki/preview", response_model=ExternalKnowledgeImportPreviewResponse)
def preview_anki(request: AnkiKnowledgeImportRequest, db: Session = Depends(get_db)):
    try:
        return _preview_payload(_anki_preview(db, request))
    except ExternalKnowledgeImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/anki/apply", response_model=ExternalKnowledgeImportApplyResponse)
def apply_anki(request: AnkiKnowledgeImportApplyRequest, db: Session = Depends(get_db)):
    try:
        service = _service(db)
        preview = _anki_preview(db, request)
        if preview.import_digest != request.preview_digest:
            raise HTTPException(
                status_code=409,
                detail="Anki 内容已变化，请重新生成预览后再应用。",
            )
        result = service.apply_preview(preview)
        return {
            "batch_id": result.batch_id,
            "source_kind": result.source_kind,
            "import_digest": result.import_digest,
            "created_count": result.created_count,
            "skipped": [_skip_payload(item) for item in result.skipped],
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
def apply_jlpt(request: JLPTKnowledgeImportApplyRequest, db: Session = Depends(get_db)):
    try:
        service = _service(db)
        preview = _jlpt_preview(db, request)
        if preview.import_digest != request.preview_digest:
            raise HTTPException(
                status_code=409,
                detail="JLPT 内容已变化，请重新生成预览后再应用。",
            )
        result = service.apply_preview(preview)
        return {
            "batch_id": result.batch_id,
            "source_kind": result.source_kind,
            "import_digest": result.import_digest,
            "created_count": result.created_count,
            "skipped": [_skip_payload(item) for item in result.skipped],
        }
    except (ExternalKnowledgeImportError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{batch_id}", response_model=ExternalKnowledgeImportRevokeResponse)
def revoke_import(batch_id: str, db: Session = Depends(get_db)):
    result = _service(db).rollback_batch(batch_id)
    return asdict(result)
