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
)
from app.services.analysis_service import (
    AnalysisBookNotFound,
    AnalysisService,
    AnalysisSourceUnavailable,
)


router = APIRouter(prefix="/api/internal/books", tags=["Internal Analysis"])
learning_map_router = APIRouter(prefix="/api/books", tags=["Learning Map"])


def get_analysis_service(db: Session = Depends(get_db)) -> AnalysisService:
    return AnalysisService(db)


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
