"""Internal Phase 3-facing contracts for disposable lexical analysis."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    ActiveLexemeIndexResponse,
    ActiveLexemeOccurrencesResponse,
    AnalysisRebuildRequest,
    AnalysisRunResponse,
    LearningMapResponse,
    UserLexemeKnowledgeIndexResponse,
    UserLexemeKnowledgeMigrationResponse,
    UserLexemeKnowledgeResponse,
    UserLexemeKnowledgeSummaryResponse,
    UserLexemeKnowledgeUpdate,
)
from app.services.analysis_service import (
    AnalysisBookNotFound,
    AnalysisService,
    AnalysisSourceUnavailable,
)
from app.services.user_lexeme_knowledge_service import (
    UserLexemeKnowledgeConflict,
    UserLexemeKnowledgeNotFound,
    UserLexemeKnowledgeService,
)


router = APIRouter(prefix="/api/internal/books", tags=["Internal Analysis"])
learning_map_router = APIRouter(prefix="/api/books", tags=["Learning Map"])


def get_analysis_service(db: Session = Depends(get_db)) -> AnalysisService:
    return AnalysisService(db)


def get_user_lexeme_knowledge_service(
    db: Session = Depends(get_db),
) -> UserLexemeKnowledgeService:
    return UserLexemeKnowledgeService(db)


@learning_map_router.get("/{book_id}/learning-map", response_model=LearningMapResponse)
def get_learning_map(
    book_id: str,
    chapter_index: Optional[int] = Query(default=None, ge=0),
    recommendation_limit: int = Query(default=20, ge=1, le=100),
    service: AnalysisService = Depends(get_analysis_service),
):
    try:
        return service.get_learning_map(
            book_id,
            chapter_index=chapter_index,
            recommendation_limit=recommendation_limit,
        )
    except AnalysisBookNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{book_id}/analysis-runs", response_model=AnalysisRunResponse)
def rebuild_analysis(
    book_id: str,
    request: AnalysisRebuildRequest,
    service: AnalysisService = Depends(get_analysis_service),
):
    """Build synchronously; HTTP 200 means processed, so callers must inspect status."""
    try:
        return service.rebuild_book_analysis(
            book_id,
            source_content_version_id=request.source_content_version_id,
            split_mode=request.split_mode,
        )
    except AnalysisSourceUnavailable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{book_id}/analysis/lexemes", response_model=ActiveLexemeIndexResponse)
def get_active_lexemes(
    book_id: str,
    chapter_index: Optional[int] = Query(default=None, ge=0),
    service: AnalysisService = Depends(get_analysis_service),
):
    run, lexemes = service.get_active_lexeme_stats(
        book_id,
        chapter_index=chapter_index,
    )
    return {"run": run, "lexemes": lexemes}


@router.get(
    "/{book_id}/analysis/lexemes/knowledge",
    response_model=UserLexemeKnowledgeIndexResponse,
)
def get_user_lexeme_knowledge(
    book_id: str,
    lexeme_ids: list[int] = Query(default=[]),
    service: UserLexemeKnowledgeService = Depends(get_user_lexeme_knowledge_service),
):
    del book_id
    try:
        return {"items": service.get_index(lexeme_ids)}
    except UserLexemeKnowledgeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserLexemeKnowledgeConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.put(
    "/{book_id}/analysis/lexemes/{lexeme_id}/knowledge",
    response_model=UserLexemeKnowledgeResponse,
)
def set_user_lexeme_knowledge(
    book_id: str,
    lexeme_id: int,
    request: UserLexemeKnowledgeUpdate,
    service: UserLexemeKnowledgeService = Depends(get_user_lexeme_knowledge_service),
):
    del book_id
    try:
        return service.set_manual_state(
            lexeme_id,
            request.state,
            note=request.note,
        )
    except UserLexemeKnowledgeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserLexemeKnowledgeConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{book_id}/analysis/lexemes/{lexeme_id}/knowledge")
def delete_user_lexeme_manual_knowledge(
    book_id: str,
    lexeme_id: int,
    service: UserLexemeKnowledgeService = Depends(get_user_lexeme_knowledge_service),
):
    del book_id
    try:
        return {"deleted": service.delete_manual_state(lexeme_id)}
    except UserLexemeKnowledgeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserLexemeKnowledgeConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get(
    "/{book_id}/analysis/knowledge-baseline",
    response_model=UserLexemeKnowledgeSummaryResponse,
)
def get_user_lexeme_knowledge_summary(
    book_id: str,
    service: UserLexemeKnowledgeService = Depends(get_user_lexeme_knowledge_service),
):
    return service.summarize_book_baseline(book_id)


@router.post(
    "/{book_id}/analysis/knowledge-baseline/migrate-legacy",
    response_model=UserLexemeKnowledgeMigrationResponse,
)
def migrate_legacy_user_lexeme_knowledge(
    book_id: str,
    service: UserLexemeKnowledgeService = Depends(get_user_lexeme_knowledge_service),
):
    return service.summarize_book_baseline(book_id, migrate_legacy=True)


@router.get(
    "/{book_id}/analysis/lexemes/{lexeme_id}/occurrences",
    response_model=ActiveLexemeOccurrencesResponse,
)
def get_active_lexeme_occurrences(
    book_id: str,
    lexeme_id: int,
    service: AnalysisService = Depends(get_analysis_service),
):
    run, occurrences = service.get_active_lexeme_occurrences(book_id, lexeme_id)
    return {"run": run, "lexeme_id": lexeme_id, "occurrences": occurrences}
