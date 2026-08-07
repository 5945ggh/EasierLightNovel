import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from fastapi import HTTPException

from app.enums import AnalysisRunStatus
from app.models import (
    AnalysisRun,
    Base,
    Book,
    Chapter,
    Lexeme,
    LexemeOccurrence,
    RunLexeme,
    SourceContentVersion,
    Vocabulary,
)
from app.schemas import ContextCardDraftCreate, ContextCardDraftUpdate, GrammarPoint, VocabularyNuance, AIAnalysisResult
from app.services.context_card_service import ContextCardService, stable_card_guid


@pytest.fixture()
def service():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    book = Book(id="book-1", title="Book")
    vocabulary = Vocabulary(book=book, word="食べた", reading="たべた", base_form="食べる", definition="eat")
    chapter = Chapter(book=book, index=0, title="Opening", content_json=[])
    version = SourceContentVersion(
        book=book,
        source_file_sha256="s" * 64,
        parser_version="fixture",
        source_schema_version=1,
        source_content_sha256="c" * 64,
        source_content_json={"schema_version": 1, "documents": []},
    )
    lexeme = Lexeme(normalized_form="食べる", canonical_reading_kana="たべる", identity_key="context-card-lexeme")
    run = AnalysisRun(
        book=book,
        source_content_version=version,
        status=AnalysisRunStatus.COMPLETED,
        is_active=True,
        tokenizer_name="fixture",
        tokenizer_version="1",
        tokenizer_contract_version="1",
        dictionary_name="fixture",
        dictionary_version="1",
        split_mode="B",
        analysis_schema_version=1,
        source_content_sha256="c" * 64,
        filter_spec={},
    )
    run_lexeme = RunLexeme(
        analysis_run=run,
        lexeme=lexeme,
        observation_key="context-card-observation",
        dictionary_form="食べる",
        normalized_form="食べる",
        observed_reading="たべる",
        observed_reading_kana="たべる",
        reading_source="fixture",
        reading_is_trusted=True,
        is_oov=False,
        part_of_speech=["動詞"],
        inflection_type="*",
        inflection_form="*",
        word_id=1,
        dictionary_id=1,
    )
    db.add_all([book, vocabulary, chapter, version, lexeme, run, run_lexeme])
    db.flush()
    db.add(LexemeOccurrence(
        analysis_run=run,
        chapter=chapter,
        chapter_index=0,
        run_lexeme=run_lexeme,
        surface="食べた",
        source_document_id="doc-1",
        source_start=0,
        source_end=3,
        source_token_index=0,
    ))
    db.commit()
    yield ContextCardService(db)
    db.close()


def create_draft(service):
    return service.create(ContextCardDraftCreate(vocabulary_id=1, quote_text="彼は急いで食べた。"))


def test_create_and_update_preserves_quote_snapshot(service):
    draft = create_draft(service)
    assert draft.book_id == "book-1"
    updated = service.update(draft.id, ContextCardDraftUpdate(meaning_in_context="eat quickly"))
    assert updated.quote_text == "彼は急いで食べた。"
    assert updated.meaning_in_context == "eat quickly"


def test_locked_quote_rejects_direct_quote_replacement(service):
    draft = create_draft(service)

    with pytest.raises(HTTPException) as exc_info:
        service.update(draft.id, ContextCardDraftUpdate(quote_text="替换后的句子"))

    assert exc_info.value.status_code == 409
    assert service.get(draft.id).quote_text == "彼は急いで食べた。"


def test_occurrence_only_creation_infers_chapter(service):
    draft = service.create(ContextCardDraftCreate(
        vocabulary_id=1,
        lexeme_occurrence_id=1,
        quote_text="彼は急いで食べた。",
    ))

    assert draft.chapter_id == 1
    assert draft.lexeme_occurrence_id == 1


def test_changing_quote_invalidates_generated_content(service):
    draft = create_draft(service)
    draft.quote_locked = False
    draft.status = "generated"
    draft.meaning_in_context = "old meaning"
    draft.sentence_translation = "old translation"
    draft.usage_note = "old note"
    draft.llm_model = "old-model"
    draft.generation_error = "stale error"
    service.db.commit()

    updated = service.update(draft.id, ContextCardDraftUpdate(quote_text="新しい原句。"))

    assert updated.status == "draft"
    assert updated.meaning_in_context is None
    assert updated.sentence_translation is None
    assert updated.usage_note is None
    assert updated.llm_model is None
    assert updated.generation_error is None


@pytest.mark.asyncio
async def test_generate_persists_structured_content(service, monkeypatch):
    draft = create_draft(service)

    async def fake_generate(**_kwargs):
        return AIAnalysisResult(
            translation="He ate in a hurry.",
            grammar_analysis=[GrammarPoint(target_text="急いで", pattern="て-form", explanation="adverbial connection")],
            vocabulary_nuance=[VocabularyNuance(target_text="食べた", base_form="食べる", nuance="completed eating")],
        )

    monkeypatch.setattr("app.services.context_card_service.analyze_japanese_content", fake_generate)
    result = await service.generate(draft.id)
    assert result.status == "generated"
    assert result.meaning_in_context == "completed eating"
    assert result.sentence_translation == "He ate in a hurry."
    assert result.generation_attempts == 1


@pytest.mark.asyncio
async def test_generate_failure_can_be_retried(service, monkeypatch):
    draft = create_draft(service)

    async def failing(**_kwargs):
        raise RuntimeError("offline")

    monkeypatch.setattr("app.services.context_card_service.analyze_japanese_content", failing)
    with pytest.raises(ValueError, match="offline"):
        await service.generate(draft.id)
    assert service.get(draft.id).generation_attempts == 1
    assert service.get(draft.id).status == "failed"

    async def succeeding(**_kwargs):
        return AIAnalysisResult(translation="He ate.")

    monkeypatch.setattr("app.services.context_card_service.analyze_japanese_content", succeeding)
    result = await service.generate(draft.id)
    assert result.status == "generated"
    assert result.generation_attempts == 2


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


def test_anki_add_note_is_idempotent(service):
    draft = create_draft(service)
    calls = []
    add_note_payload = {}

    def fake_post(_url, *, json, timeout):
        calls.append(json["action"])
        if json["action"] == "addNote":
            add_note_payload.update(json["params"])
        return FakeResponse({"result": [] if json["action"] == "findNotes" else 12345, "error": None})

    first = service.write_to_anki(draft.id, "Learning", "Basic", post=fake_post)
    second = service.write_to_anki(draft.id, "Learning", "Basic", post=fake_post)
    assert first.anki_note_id == second.anki_note_id == "12345"
    assert stable_card_guid(draft.id) == first.anki_guid
    assert calls == ["findNotes", "addNote"]
    assert set(add_note_payload["note"]["fields"]) == {"Front", "Back"}
    assert "彼は急いで食べた。" in add_note_payload["note"]["fields"]["Back"]


def test_custom_model_without_mapping_returns_field_diagnostic(service):
    draft = create_draft(service)

    def fake_post(_url, *, json, timeout):
        assert json["action"] == "modelFieldNames"
        return FakeResponse({"result": ["Term", "Definition"], "error": None})

    with pytest.raises(ValueError, match="provide an explicit field_mapping"):
        service.write_to_anki(draft.id, "Learning", "Custom", post=fake_post)


def test_anki_failed_write_retries_without_duplicate_ledger(service):
    draft = create_draft(service)
    calls = []

    def flaky_post(_url, *, json, timeout):
        calls.append(json["action"])
        if len(calls) == 1:
            raise TimeoutError("timeout")
        return FakeResponse({"result": [] if json["action"] == "findNotes" else 987, "error": None})

    with pytest.raises(ValueError, match="timeout"):
        service.write_to_anki(draft.id, "Learning", "Basic", post=flaky_post)
    result = service.write_to_anki(draft.id, "Learning", "Basic", post=flaky_post)
    assert result.anki_note_id == "987"
    assert result.anki_guid == stable_card_guid(draft.id)
    assert calls == ["findNotes", "findNotes", "addNote"]
