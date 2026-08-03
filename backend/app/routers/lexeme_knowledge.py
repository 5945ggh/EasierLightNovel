"""Public single-user controls for explicit canonical Lexeme state."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import UserLexemeKnowledgeResponse, UserLexemeKnowledgeUpdate
from app.services.user_lexeme_knowledge_service import (
    UserLexemeKnowledgeConflict,
    UserLexemeKnowledgeNotFound,
    UserLexemeKnowledgeService,
)


router = APIRouter(prefix="/api/lexeme-knowledge", tags=["Lexeme Knowledge"])


def get_service(db: Session = Depends(get_db)) -> UserLexemeKnowledgeService:
    return UserLexemeKnowledgeService(db)


@router.put("/{lexeme_id}", response_model=UserLexemeKnowledgeResponse)
def put_lexeme_knowledge(
    lexeme_id: int,
    request: UserLexemeKnowledgeUpdate,
    service: UserLexemeKnowledgeService = Depends(get_service),
):
    try:
        return service.set_manual_state(lexeme_id, request.state, note=request.note)
    except UserLexemeKnowledgeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserLexemeKnowledgeConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{lexeme_id}")
def delete_lexeme_knowledge(
    lexeme_id: int,
    service: UserLexemeKnowledgeService = Depends(get_service),
):
    try:
        deleted = service.delete_manual_state(lexeme_id)
        return {
            "lexeme_id": lexeme_id,
            "knowledge_status": None,
            "message": "已清除手动标记。" if deleted else "该词元没有手动标记。",
        }
    except UserLexemeKnowledgeNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserLexemeKnowledgeConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
