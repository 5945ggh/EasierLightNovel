from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    ContextCardAnkiWriteRequest,
    ContextCardDraftCreate,
    ContextCardDraftResponse,
    ContextCardDraftUpdate,
    ContextCardGenerateRequest,
)
from app.services.context_card_service import ContextCardService

router = APIRouter(prefix="/api/context-cards", tags=["Context Cards"])


def get_service(db: Session = Depends(get_db)) -> ContextCardService:
    return ContextCardService(db)


@router.post("", response_model=ContextCardDraftResponse, status_code=201)
def create_draft(data: ContextCardDraftCreate, service: ContextCardService = Depends(get_service)):
    return service.create(data)


@router.get("/book/{book_id}", response_model=List[ContextCardDraftResponse])
def list_drafts(book_id: str, service: ContextCardService = Depends(get_service)):
    return service.list_for_book(book_id)


@router.get("/{draft_id}", response_model=ContextCardDraftResponse)
def get_draft(draft_id: int, service: ContextCardService = Depends(get_service)):
    return service.get(draft_id)


@router.patch("/{draft_id}", response_model=ContextCardDraftResponse)
def update_draft(draft_id: int, data: ContextCardDraftUpdate, service: ContextCardService = Depends(get_service)):
    return service.update(draft_id, data)


@router.post("/{draft_id}/generate", response_model=ContextCardDraftResponse)
async def generate_draft(draft_id: int, data: ContextCardGenerateRequest = ContextCardGenerateRequest(), service: ContextCardService = Depends(get_service)):
    try:
        return await service.generate(draft_id, data.model_preference)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{draft_id}/anki", response_model=ContextCardDraftResponse)
def write_draft_to_anki(draft_id: int, data: ContextCardAnkiWriteRequest, service: ContextCardService = Depends(get_service)):
    try:
        return service.write_to_anki(draft_id, data.deck_name, data.model_name, data.field_mapping, data.timeout_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
