"""Persistence and Anki text export for contextual card drafts."""
import hashlib
from typing import Any, Callable, Mapping, Optional

import requests
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import LLMConfig
from app.models import Book, Chapter, ContextCardAnkiLedger, ContextCardDraft, LexemeOccurrence, Vocabulary
from app.schemas import ContextCardDraftCreate, ContextCardDraftUpdate
from app.services.llm_service import analyze_japanese_content


def stable_card_guid(draft_id: int) -> str:
    """Derive a deterministic, opaque GUID that remains stable across retries/edits."""
    return hashlib.sha256(f"easier-light-novel:context-card:v1:{draft_id}".encode()).hexdigest()[:32]


class ContextCardService:
    def __init__(self, db: Session):
        self.db = db

    def _get_draft(self, draft_id: int) -> ContextCardDraft:
        draft = self.db.query(ContextCardDraft).filter(ContextCardDraft.id == draft_id).first()
        if not draft:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Context card draft not found")
        return draft

    def create(self, data: ContextCardDraftCreate) -> ContextCardDraft:
        vocabulary = self.db.query(Vocabulary).filter(Vocabulary.id == data.vocabulary_id).first()
        if not vocabulary:
            raise HTTPException(status_code=404, detail="Vocabulary not found")
        chapter_id = data.chapter_id
        if data.lexeme_occurrence_id is not None:
            occurrence = self.db.query(LexemeOccurrence).filter(LexemeOccurrence.id == data.lexeme_occurrence_id).first()
            if not occurrence:
                raise HTTPException(status_code=404, detail="Lexeme occurrence not found")
            chapter = self.db.query(Chapter).filter(
                Chapter.id == occurrence.chapter_id,
                Chapter.book_id == vocabulary.book_id,
            ).first()
            if not chapter:
                raise HTTPException(status_code=404, detail="Lexeme occurrence not found for vocabulary book")
            if chapter_id is not None and chapter_id != occurrence.chapter_id:
                raise HTTPException(status_code=422, detail="Occurrence does not belong to chapter")
            chapter_id = occurrence.chapter_id
        elif chapter_id is not None:
            chapter = self.db.query(Chapter).filter(
                Chapter.id == chapter_id,
                Chapter.book_id == vocabulary.book_id,
            ).first()
            if not chapter:
                raise HTTPException(status_code=404, detail="Chapter not found for vocabulary book")
        draft = ContextCardDraft(
            vocabulary_id=vocabulary.id,
            book_id=vocabulary.book_id,
            chapter_id=chapter_id,
            lexeme_occurrence_id=data.lexeme_occurrence_id,
            source_document_id=data.source_document_id,
            source_start=data.source_start,
            source_end=data.source_end,
            quote_text=data.quote_text,
            quote_locked=data.quote_locked,
        )
        self.db.add(draft)
        self.db.commit()
        self.db.refresh(draft)
        return draft

    def list_for_book(self, book_id: str) -> list[ContextCardDraft]:
        return self.db.query(ContextCardDraft).filter(ContextCardDraft.book_id == book_id).order_by(ContextCardDraft.id.desc()).all()

    def get(self, draft_id: int) -> ContextCardDraft:
        return self._get_draft(draft_id)

    def update(self, draft_id: int, data: ContextCardDraftUpdate) -> ContextCardDraft:
        draft = self._get_draft(draft_id)
        values = data.model_dump(exclude_unset=True)
        if "quote_text" in values and draft.quote_locked:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This quote is locked; unlock the draft before changing its source sentence",
            )
        quote_changed = "quote_text" in values and values["quote_text"] != draft.quote_text
        if quote_changed and draft.anki_ledger and draft.anki_ledger.status == "written":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This quote was already written to Anki; create a new draft to change its source sentence",
            )
        for key, value in values.items():
            setattr(draft, key, value)
        if quote_changed:
            draft.meaning_in_context = None
            draft.sentence_translation = None
            draft.usage_note = None
            draft.llm_model = None
            draft.generation_error = None
            draft.status = "draft"
        elif any(key in values for key in ("meaning_in_context", "sentence_translation", "usage_note")):
            if draft.status != "written":
                draft.status = "generated" if any((draft.meaning_in_context, draft.sentence_translation)) else "draft"
        self.db.commit()
        self.db.refresh(draft)
        return draft

    async def generate(self, draft_id: int, model_preference: Optional[str] = None) -> ContextCardDraft:
        draft = self._get_draft(draft_id)
        vocabulary = self.db.query(Vocabulary).filter(Vocabulary.id == draft.vocabulary_id).one()
        draft.generation_attempts += 1
        draft.generation_error = None
        self.db.commit()
        try:
            result = await analyze_japanese_content(
                target_text=vocabulary.base_form,
                context_text=draft.quote_text,
                user_prompt=(
                    "Return an explanation for a contextual vocabulary flashcard. "
                    "Focus on the target word's meaning in this sentence and its translation."
                ),
                model_preference=model_preference,
            )
            nuance = next((item for item in result.vocabulary_nuance if item.base_form == vocabulary.base_form), None)
            grammar = "; ".join(item.explanation for item in result.grammar_analysis) or None
            draft.meaning_in_context = nuance.nuance if nuance else result.translation
            draft.sentence_translation = result.translation
            draft.usage_note = grammar or result.cultural_notes
            draft.llm_model = model_preference or LLMConfig.MODEL
            draft.status = "generated"
        except Exception as exc:
            draft.status = "failed"
            draft.generation_error = str(exc)[:2000]
        self.db.commit()
        self.db.refresh(draft)
        if draft.status == "failed":
            raise ValueError(draft.generation_error or "Context card generation failed")
        return draft

    def write_to_anki(
        self,
        draft_id: int,
        deck_name: str,
        model_name: str,
        field_mapping: Optional[Mapping[str, str]] = None,
        timeout_seconds: float = 10.0,
        post: Optional[Callable[..., Any]] = None,
    ) -> ContextCardDraft:
        draft = self._get_draft(draft_id)
        vocabulary = self.db.query(Vocabulary).filter(Vocabulary.id == draft.vocabulary_id).one()
        mapping = self._resolve_field_mapping(
            model_name=model_name,
            field_mapping=field_mapping,
            post=post or requests.post,
            timeout_seconds=timeout_seconds,
        )
        local_values = {
            "word": vocabulary.word,
            "reading": vocabulary.reading,
            "meaning_in_context": draft.meaning_in_context,
            "quote_text": draft.quote_text,
            "sentence_translation": draft.sentence_translation,
            "usage_note": draft.usage_note,
            # The built-in Basic note type has only Front/Back. Keep all
            # contextual text in Back so the default path is valid Anki data.
            "basic_back": "\n".join(
                value
                for value in (
                    vocabulary.reading,
                    draft.meaning_in_context,
                    draft.quote_text,
                    draft.sentence_translation,
                    draft.usage_note,
                )
                if value
            ),
        }
        fields = {
            field: str(local_values.get(attr) or "")
            for field, attr in mapping.items()
        }
        guid = stable_card_guid(draft.id)
        ledger = self.db.query(ContextCardAnkiLedger).filter(ContextCardAnkiLedger.draft_id == draft.id).first()
        if ledger and ledger.status == "written" and ledger.anki_note_id:
            return draft
        if not ledger:
            ledger = ContextCardAnkiLedger(
                draft_id=draft.id,
                guid=guid,
                deck_name=deck_name,
                model_name=model_name,
                fields_json=fields,
                attempts=0,
                status="pending",
            )
            self.db.add(ledger)
        else:
            ledger.deck_name, ledger.model_name, ledger.fields_json = deck_name, model_name, fields
        ledger.attempts += 1
        ledger.status = "pending"
        self.db.commit()
        post = post or requests.post
        tag = f"eln-context-guid-{guid}"
        try:
            # Recover a successful addNote when the response was lost in transit.
            found = self._anki_call(post, "findNotes", {"query": f"tag:{tag}"}, timeout_seconds)
            note_ids = found or []
            if note_ids:
                ledger.anki_note_id = str(note_ids[0])
            else:
                result = self._anki_call(post, "addNote", {"note": {"deckName": deck_name, "modelName": model_name, "fields": fields, "tags": [tag]}}, timeout_seconds)
                if result is None:
                    raise ValueError("AnkiConnect addNote returned no note id")
                ledger.anki_note_id = str(result)
            ledger.status, ledger.last_error = "written", None
            draft.status = "written"
            self.db.commit()
            self.db.refresh(draft)
            return draft
        except Exception as exc:
            ledger.status, ledger.last_error = "failed", str(exc)[:2000]
            self.db.commit()
            raise ValueError(f"Anki write failed: {exc}") from exc

    def _resolve_field_mapping(
        self,
        *,
        model_name: str,
        field_mapping: Optional[Mapping[str, str]],
        post: Callable[..., Any],
        timeout_seconds: float,
    ) -> dict[str, str]:
        if field_mapping:
            return dict(field_mapping)

        if model_name.strip().lower() == "basic":
            return {"Front": "word", "Back": "basic_back"}

        model_fields = self._anki_call(
            post,
            "modelFieldNames",
            {"modelName": model_name},
            timeout_seconds,
        )
        if not isinstance(model_fields, list) or not all(isinstance(item, str) for item in model_fields):
            raise ValueError(f"Anki model {model_name!r} returned invalid field metadata")
        field_set = set(model_fields)
        if {"Front", "Back"}.issubset(field_set):
            return {"Front": "word", "Back": "basic_back"}
        default_mapping = {
            "Word": "word",
            "Reading": "reading",
            "Meaning": "meaning_in_context",
            "Sentence": "quote_text",
            "Translation": "sentence_translation",
            "Usage": "usage_note",
        }
        if set(default_mapping).issubset(field_set):
            return default_mapping
        raise ValueError(
            f"Anki model {model_name!r} has fields {', '.join(model_fields)}; "
            "provide an explicit field_mapping"
        )

    @staticmethod
    def _anki_call(post: Callable[..., Any], action: str, params: Mapping[str, Any], timeout: float) -> Any:
        response = post("http://127.0.0.1:8765", json={"action": action, "version": 6, "params": dict(params)}, timeout=timeout)
        payload = response.json()
        if payload.get("error"):
            raise ValueError(payload["error"])
        return payload.get("result")
