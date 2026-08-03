"""Dedicated write API for deliberate Reader dictionary lookup facts."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ReaderLookupEventCreate, ReaderLookupEventResponse
from app.services.lookup_event_service import (
    LookupEventBookNotFound,
    LookupEventChapterNotFound,
    LookupEventConflict,
    LookupEventService,
)


router = APIRouter(prefix="/api/books", tags=["Reader Lookup Events"])


def get_lookup_event_service(db: Session = Depends(get_db)) -> LookupEventService:
    return LookupEventService(db)


@router.post(
    "/{book_id}/reader/lookup-events",
    response_model=ReaderLookupEventResponse,
)
def record_reader_lookup_event(
    book_id: str,
    request: ReaderLookupEventCreate,
    service: LookupEventService = Depends(get_lookup_event_service),
):
    try:
        return service.record_reader_lookup(
            book_id,
            client_event_id=request.client_event_id,
            chapter_index=request.chapter_index,
            reader_segment_index=request.reader_segment_index,
            reader_token_index=request.reader_token_index,
            surface=request.surface,
            query_text=request.query_text,
            event_type=request.event_type,
            source_document_id=request.source_document_id,
            source_start=request.source_start,
            source_end=request.source_end,
            source_token_index=request.source_token_index,
        )
    except (LookupEventBookNotFound, LookupEventChapterNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except LookupEventConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
