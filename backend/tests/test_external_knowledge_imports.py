import json

import pytest
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.enums import AnalysisRunStatus, ProcessingStatus
from app.models import (
    AnalysisRun,
    Base,
    Book,
    Chapter,
    ExternalKnowledgeImport,
    ExternalKnowledgeImportItem,
    LexemeOccurrence,
    Lexeme,
    RunLexeme,
    SourceContentVersion,
    UserLexemeKnowledge,
)

from app.services.external_knowledge_import_service import (
    AnkiConnectKnowledgeSource,
    ExternalKnowledgeImportError,
    ExternalKnowledgeImportService,
    ExternalKnowledgeProtocolError,
    ImportCandidate,
    JLPTJsonKnowledgeSource,
    LexemeResolution,
    ResolvedLexeme,
    SQLAlchemyKnowledgeImportRepository,
    SQLAlchemyLexemeResolver,
    UserLexemeKnowledgeRecord,
    _anki_card_state,
    _digest_candidates,
    stable_identity_key,
)


class MemoryKnowledgeRepository:
    def __init__(self):
        self.records = {}
        self.batches = {}

    def add_manual(self, normalized_form: str, reading: str):
        identity_key = stable_identity_key(normalized_form, reading)
        self.records[identity_key] = UserLexemeKnowledgeRecord(
            identity_key=identity_key,
            normalized_form=normalized_form,
            canonical_reading_kana=reading,
            source_kind="manual",
            source_entry_id="manual",
        )

    def get_by_identity(self, identity_key: str):
        return self.records.get(identity_key)

    def find_existing_batch(self, source_kind: str, import_digest: str):
        return self.batches.get((source_kind, import_digest))

    def save_external_batch(
        self,
        batch_id: str,
        source_kind: str,
        import_digest: str,
        candidates: list[ImportCandidate],
    ):
        assert import_digest
        self.batches[(source_kind, import_digest)] = batch_id
        created = []
        for candidate in candidates:
            record = UserLexemeKnowledgeRecord(
                identity_key=candidate.identity_key,
                normalized_form=candidate.normalized_form,
                canonical_reading_kana=candidate.canonical_reading_kana,
                source_kind=candidate.source_kind,
                source_entry_id=candidate.source_entry_id,
                source_batch_id=batch_id,
                lexeme_id=candidate.lexeme_id,
                metadata=candidate.metadata,
            )
            self.records[candidate.identity_key] = record
            created.append(record)
        return created

    def delete_external_batch(self, batch_id: str):
        deleted = 0
        for identity_key, record in list(self.records.items()):
            if record.source_batch_id == batch_id and not record.is_manual:
                del self.records[identity_key]
                deleted += 1
        return deleted


class MappingLexemeResolver:
    def __init__(self, rows):
        self.rows = rows

    def resolve_unique(self, normalized_form: str, canonical_reading_kana: str):
        return self.rows.get((normalized_form, canonical_reading_kana))


class JsonResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


def test_anki_preview_reads_card_protocol_and_keeps_unique_trusted_canonical_only():
    requests_seen = []

    def fake_post(_url, *, json, timeout):
        requests_seen.append((json["action"], json["params"], timeout))
        if json["action"] == "version":
            return JsonResponse({"result": 6, "error": None})
        if json["action"] == "deckNames":
            return JsonResponse({"result": ["Kaishi 1.5k  zh-CH"], "error": None})
        if json["action"] == "modelNames":
            return JsonResponse({"result": ["Kaishi 1.5k zh-CH"], "error": None})
        if json["action"] == "modelTemplates":
            return JsonResponse({
                "result": {"Recognition": {"Front": "", "Back": ""}},
                "error": None,
            })
        if json["action"] == "findCards":
            query = json["params"]["query"]
            if "is:suspended" in query:
                return JsonResponse({"result": [106], "error": None})
            if "is:buried" in query:
                return JsonResponse({"result": [105], "error": None})
            if "is:new" in query:
                return JsonResponse({"result": [103], "error": None})
            if "is:learn is:review" in query:
                return JsonResponse({"result": [], "error": None})
            if "is:learn" in query:
                return JsonResponse({"result": [104], "error": None})
            if "is:review" in query:
                return JsonResponse({"result": [101, 102, 105, 106], "error": None})
            return JsonResponse({"result": [101, 102, 103, 104, 105, 106], "error": None})
        if json["action"] == "cardsInfo":
            cards = {
                101: {"cardId": 101, "note": 10, "deckName": "Kaishi 1.5k  zh-CH", "modelName": "Kaishi 1.5k zh-CH", "ord": 0, "type": 2, "queue": 2, "interval": 30, "reps": 10, "lapses": 0},
                102: {"cardId": 102, "note": 10, "deckName": "Kaishi 1.5k  zh-CH", "modelName": "Kaishi 1.5k zh-CH", "ord": 1, "type": 2, "queue": 2, "interval": 5, "reps": 2, "lapses": 0},
                103: {"cardId": 103, "note": 11, "deckName": "Kaishi 1.5k  zh-CH", "modelName": "Kaishi 1.5k zh-CH", "ord": 0, "type": 0, "queue": 0, "interval": 0, "reps": 0, "lapses": 0},
                104: {"cardId": 104, "note": 12, "deckName": "Kaishi 1.5k  zh-CH", "modelName": "Kaishi 1.5k zh-CH", "ord": 0, "type": 1, "queue": 1, "interval": 0, "reps": 1, "lapses": 0},
                105: {"cardId": 105, "note": 13, "deckName": "Kaishi 1.5k  zh-CH", "modelName": "Kaishi 1.5k zh-CH", "ord": 0, "type": 2, "queue": -3, "interval": 40, "reps": 12, "lapses": 1},
                106: {"cardId": 106, "note": 14, "deckName": "Kaishi 1.5k  zh-CH", "modelName": "Kaishi 1.5k zh-CH", "ord": 0, "type": 2, "queue": -1, "interval": 40, "reps": 12, "lapses": 1},
            }
            return JsonResponse({"result": [cards[item] for item in json["params"]["cards"]], "error": None})
        if json["action"] == "cardsToNotes":
            return JsonResponse({"result": {str(card_id): note_id for card_id, note_id in {
                101: 10, 102: 10, 103: 11, 104: 12, 105: 13, 106: 14,
            }.items() if card_id in json["params"]["cards"]}, "error": None})
        if json["action"] == "notesInfo":
            return JsonResponse({
                "result": [
                    {
                        "noteId": 10,
                        "fields": {
                            "Expression": {"value": "猫"},
                            "Reading": {"value": "ねこ"},
                        },
                        "modelName": "Kaishi 1.5k zh-CH",
                        "cards": [{"ord": 0, "name": "Recognition"}, {"ord": 1, "name": "Production"}],
                    },
                    {
                        "noteId": 11,
                        "fields": {
                            "Expression": {"value": "犬"},
                            "Reading": {"value": "いぬ"},
                        },
                        "modelName": "Kaishi 1.5k zh-CH",
                        "cards": [{"ord": 0, "name": "Recognition"}],
                    },
                    {
                        "noteId": 12,
                        "fields": {"Expression": {"value": "走る"}, "Reading": {"value": "はしる"}},
                        "modelName": "Kaishi 1.5k zh-CH",
                        "cards": [{"ord": 0, "name": "Recognition"}],
                    },
                    {
                        "noteId": 13,
                        "fields": {
                            "Expression": {"value": "鳥"},
                            "Reading": {"value": "とり"},
                        },
                        "modelName": "Kaishi 1.5k zh-CH",
                        "cards": [{"ord": 0, "name": "Recognition"}],
                    },
                    {
                        "noteId": 14,
                        "fields": {
                            "Expression": {"value": "本"},
                            "Reading": {"value": "ほん"},
                        },
                        "modelName": "Kaishi 1.5k zh-CH",
                        "cards": [{"ord": 0, "name": "Recognition"}],
                    },
                ],
                "error": None,
            })
        raise AssertionError(f"unexpected action: {json['action']}")

    resolver = MappingLexemeResolver({
        ("猫", "ねこ"): ResolvedLexeme(lexeme_id=1, normalized_form="猫", canonical_reading_kana="ねこ"),
        ("犬", "いぬ"): ResolvedLexeme(lexeme_id=2, normalized_form="犬", canonical_reading_kana="いぬ"),
        ("鳥", "とり"): ResolvedLexeme(lexeme_id=4, normalized_form="鳥", canonical_reading_kana="とり"),
        ("本", "ほん"): ResolvedLexeme(lexeme_id=5, normalized_form="本", canonical_reading_kana="ほん"),
    })
    source = AnkiConnectKnowledgeSource(timeout_seconds=0.5, post=fake_post)
    service = ExternalKnowledgeImportService(
        MemoryKnowledgeRepository(),
        lexeme_resolver=resolver,
    )

    preview = service.preview_candidates(
        "anki",
        source.fetch_candidates(
            query="deck:\"Kaishi 1.5k  zh-CH\"",
            deck_name="Kaishi 1.5k  zh-CH",
            model_name="Kaishi 1.5k zh-CH",
            template_ord=0,
        ),
    )
    repeated_preview = service.preview_candidates(
        "anki",
        source.fetch_candidates(
            query="deck:\"Kaishi 1.5k  zh-CH\"",
            deck_name="Kaishi 1.5k  zh-CH",
            model_name="Kaishi 1.5k zh-CH",
            template_ord=0,
        ),
    )

    actions = [action for action, _params, _timeout in requests_seen]
    assert actions[:4] == ["version", "deckNames", "modelNames", "modelTemplates"]
    assert "findNotes" not in actions
    assert "cardsInfo" in actions
    assert "cardsToNotes" in actions
    assert "notesInfo" in actions
    notes_requests = [params for action, params, _timeout in requests_seen if action == "notesInfo"]
    assert notes_requests == [
        {"notes": [10, 11, 12, 13, 14]},
        {"notes": [10, 11, 12, 13, 14]},
    ]
    assert repeated_preview.import_digest == preview.import_digest
    assert preview.accepted_count == 4
    assert preview.stats.card_count == 6
    assert preview.stats.note_count == 5
    assert preview.stats.unique_lexeme_count == 4
    assert preview.stats.anki_state_counts == {
        "new": 1,
        "learning": 1,
        "relearning": 0,
        "young": 1,
        "mature": 2,
        "suspended": 1,
        "buried": 1,
    }
    assert preview.accepted[0].lexeme_id == 1
    assert preview.accepted[0].metadata["anki_cards"][0]["state"] == "mature"
    assert preview.accepted[0].metadata["anki_cards"][0]["note_id"] == "10"
    assert {skip.reason for skip in preview.skipped} == {"unmatched_canonical_lexeme"}


def test_anki_relearning_membership_is_kept_distinct_from_initial_learning():
    state, underlying, suspended, buried = _anki_card_state(
        "relearning-card",
        {"interval": 0},
        {
            "new": set(),
            "learning": set(),
            "relearning": {"relearning-card"},
            "young_or_mature": set(),
            "suspended": set(),
            "buried": set(),
        },
    )

    assert state == "relearning"
    assert underlying == "relearning"
    assert suspended is False
    assert buried is False


def test_anki_buried_card_keeps_mature_underlying_state_without_review_membership():
    state, underlying, suspended, buried = _anki_card_state(
        "buried-mature-card",
        {"interval": 40},
        {
            "new": set(),
            "learning": set(),
            "relearning": set(),
            "young_or_mature": set(),
            "suspended": set(),
            "buried": {"buried-mature-card"},
        },
    )

    assert state == "mature"
    assert underlying == "mature"
    assert suspended is False
    assert buried is True


def test_anki_nonstandard_fields_and_templates_are_skipped_individually():
    def fake_post(_url, *, json, timeout):
        del timeout
        action = json["action"]
        if action == "version":
            return JsonResponse({"result": 6, "error": None})
        if action == "deckNames":
            return JsonResponse({"result": ["Deck"], "error": None})
        if action == "modelNames":
            return JsonResponse({"result": ["Model"], "error": None})
        if action == "modelTemplates":
            return JsonResponse({"result": {"Recognition": {"Front": "", "Back": ""}}, "error": None})
        if action == "findCards":
            query = json["params"]["query"]
            if any(marker in query for marker in ("is:suspended", "is:buried", "is:new", "is:learn", "is:review")):
                return JsonResponse({"result": [], "error": None})
            return JsonResponse({"result": [201, 202], "error": None})
        if action == "cardsInfo":
            return JsonResponse({"result": [
                {"cardId": 201, "note": 20, "deckName": "Deck", "modelName": "Model", "ord": 0, "interval": 30, "reps": 3, "lapses": 0},
                {"cardId": 202, "note": 21, "deckName": "Deck", "modelName": "Model", "ord": 0, "interval": 30, "reps": 3, "lapses": 0},
            ], "error": None})
        if action == "cardsToNotes":
            return JsonResponse({"result": {"201": 20, "202": 21}, "error": None})
        if action == "notesInfo":
            return JsonResponse({"result": [
                {"noteId": 20, "modelName": "Model", "fields": {"Expression": {"value": "猫"}}, "cards": [{"ord": 0, "name": "Recognition"}]},
                {"noteId": 21, "modelName": "Model", "fields": {"Expression": {"value": "犬"}, "Reading": {"value": "いぬ"}}, "cards": [{"ord": 9, "name": "Unknown"}]},
            ], "error": None})
        raise AssertionError(action)

    preview = ExternalKnowledgeImportService(
        MemoryKnowledgeRepository(),
        lexeme_resolver=MappingLexemeResolver({}),
    ).preview_candidates(
        "anki",
        AnkiConnectKnowledgeSource(post=fake_post).fetch_candidates(
            query="deck:Deck", deck_name="Deck", model_name="Model", template_ord=0,
        ),
    )

    assert preview.accepted == []
    assert {skip.reason for skip in preview.skipped} == {
        "missing_trusted_canonical_reading",
        "template_not_found",
    }


def test_anki_timeout_and_protocol_errors_are_reported_without_writes():
    def timeout_post(*_args, **_kwargs):
        raise requests.Timeout("slow")

    source = AnkiConnectKnowledgeSource(post=timeout_post)
    with pytest.raises(ExternalKnowledgeImportError, match="timed out"):
        source.fetch_candidates(query="deck:test")

    def bad_post(*_args, **_kwargs):
        return JsonResponse({"error": None})

    source = AnkiConnectKnowledgeSource(post=bad_post)
    with pytest.raises(ExternalKnowledgeProtocolError, match="missing result"):
        source.fetch_candidates(query="deck:test")


def test_apply_is_idempotent_preserves_manual_precedence_and_rolls_back_external_batch():
    repository = MemoryKnowledgeRepository()
    repository.add_manual("猫", "ねこ")
    service = ExternalKnowledgeImportService(
        repository,
        batch_id_factory=lambda: "batch-1",
    )
    preview = service.preview_candidates(
        "jlpt",
        [
            ImportCandidate("猫", "ねこ", "jlpt", "n5-1", level="N5"),
            ImportCandidate("犬", "いぬ", "jlpt", "n5-2", level="N5"),
        ],
    )

    first = service.apply_preview(preview)
    second = service.apply_preview(preview)
    rollback = service.rollback_batch(first.batch_id)

    assert first.created_count == 1
    assert first.created[0].normalized_form == "犬"
    assert {skip.reason for skip in first.skipped} == {"manual_precedence"}
    assert second.created_count == 0
    assert {skip.reason for skip in second.skipped} == {"already_imported"}
    assert rollback.deleted_count == 1
    assert [record.normalized_form for record in repository.records.values()] == ["猫"]


def test_preview_counts_ambiguous_and_provisional_canonical_lexemes():
    resolver = MappingLexemeResolver({
        ("上", "うえ"): LexemeResolution((
            ResolvedLexeme(1, "上", "うえ"),
            ResolvedLexeme(2, "上", "うえ"),
        )),
        ("仮", "かり"): ResolvedLexeme(3, "仮", "かり", is_provisional=True),
    })
    service = ExternalKnowledgeImportService(
        MemoryKnowledgeRepository(),
        lexeme_resolver=resolver,
    )

    preview = service.preview_candidates(
        "jlpt",
        [
            ImportCandidate("上", "うえ", "jlpt", "ambiguous"),
            ImportCandidate("仮", "かり", "jlpt", "provisional"),
        ],
    )

    assert preview.accepted == []
    assert preview.stats.ambiguous == 1
    assert preview.stats.provisional == 1
    assert {skip.reason for skip in preview.skipped} == {
        "ambiguous_canonical_lexeme",
        "provisional_or_merged_lexeme",
    }


def test_jlpt_json_contract_filters_levels_and_requires_trusted_reading(tmp_path):
    jlpt_path = tmp_path / "jlpt.json"
    jlpt_path.write_text(
        json.dumps({
            "schema_version": 1,
            "entries": [
                {"id": "n5-cat", "level": "N5", "word": "猫", "reading": "ネコ"},
                {"id": "n4-dog", "level": "N4", "word": "犬", "reading": "いぬ"},
                {"id": "n5-missing", "level": "N5", "word": "本"},
            ],
        }),
        encoding="utf-8",
    )

    service = ExternalKnowledgeImportService(MemoryKnowledgeRepository())
    preview = service.preview_candidates(
        "jlpt",
        JLPTJsonKnowledgeSource(jlpt_path).fetch_candidates(levels=["N5"]),
    )

    assert [(item.normalized_form, item.canonical_reading_kana, item.level) for item in preview.accepted] == [
        ("猫", "ねこ", "N5"),
    ]
    assert [(skip.source_entry_id, skip.reason) for skip in preview.skipped] == [
        ("n5-missing", "missing_trusted_canonical_reading"),
    ]


def test_jlpt_json_rejects_implicit_or_invalid_contract(tmp_path):
    jlpt_path = tmp_path / "bad-jlpt.json"
    jlpt_path.write_text(json.dumps({"entries": []}), encoding="utf-8")

    with pytest.raises(ExternalKnowledgeProtocolError, match="schema_version=1"):
        JLPTJsonKnowledgeSource(jlpt_path).fetch_candidates()

    with pytest.raises(ValueError, match="Unsupported JLPT levels"):
        JLPTJsonKnowledgeSource(jlpt_path).fetch_candidates(levels=["N0"])


def test_sqlalchemy_import_is_idempotent_reversible_and_never_overwrites_manual(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'imports.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    cat = Lexeme(
        normalized_form="猫",
        canonical_reading_kana="ねこ",
        is_provisional=False,
        identity_key="cat",
    )
    dog = Lexeme(
        normalized_form="犬",
        canonical_reading_kana="いぬ",
        is_provisional=False,
        identity_key="dog",
    )
    session.add_all([cat, dog])
    session.flush()
    session.add(UserLexemeKnowledge(lexeme_id=cat.id, state="ignored", source="manual"))
    session.commit()

    repository = SQLAlchemyKnowledgeImportRepository(
        session,
        user_lexeme_knowledge_model=UserLexemeKnowledge,
        external_knowledge_import_model=ExternalKnowledgeImport,
        external_knowledge_import_item_model=ExternalKnowledgeImportItem,
        lexeme_model=Lexeme,
    )
    batch_ids = iter(["anki-batch-1", "anki-batch-2"])
    service = ExternalKnowledgeImportService(
        repository,
        lexeme_resolver=SQLAlchemyLexemeResolver(session, Lexeme),
        batch_id_factory=lambda: next(batch_ids),
    )
    preview = service.preview_candidates("anki", [
        ImportCandidate("猫", "ねこ", "anki", "note-cat"),
        ImportCandidate("犬", "いぬ", "anki", "note-dog"),
    ])

    first = service.apply_preview(preview)
    second = service.apply_preview(preview)

    assert first.created_count == 1
    assert {skip.reason for skip in first.skipped} == {"manual_precedence"}
    assert second.batch_id == first.batch_id
    assert second.created_count == 0
    assert session.query(ExternalKnowledgeImport).count() == 1
    assert session.query(ExternalKnowledgeImportItem).count() == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="manual").one().state == "ignored"
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=dog.id, source="anki").one().state == "known"

    rollback = service.rollback_batch(first.batch_id)

    assert rollback.deleted_count == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=dog.id, source="anki").count() == 0
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="manual").one().state == "ignored"
    assert session.query(ExternalKnowledgeImport).one().status == "rolled_back"

    restored = service.apply_preview(preview)

    assert restored.batch_id == "anki-batch-2"
    assert restored.created_count == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=dog.id, source="anki").one().state == "known"
    session.close()


def test_anki_catalog_is_redacted_and_reads_selected_model_metadata():
    actions = []

    def fake_post(_url, *, json, timeout):
        actions.append(json["action"])
        payloads = {
            "version": 6,
            "deckNames": ["Kaishi 1.5k  zh-CH"],
            "modelNames": ["Kaishi 1.5k zh-CH"],
            "modelFieldNames": ["Expression", "Reading", "Meaning"],
            "modelTemplates": {"Recognition": {}, "Production": {}},
        }
        return JsonResponse({"result": payloads[json["action"]], "error": None})

    catalog = AnkiConnectKnowledgeSource(post=fake_post).inspect_catalog(
        model_name="Kaishi 1.5k zh-CH"
    )

    assert catalog == {
        "version": 6,
        "deck_names": ["Kaishi 1.5k  zh-CH"],
        "model_names": ["Kaishi 1.5k zh-CH"],
        "selected_model": "Kaishi 1.5k zh-CH",
        "fields": ["Expression", "Reading", "Meaning"],
        "templates": [
            {"ord": 0, "name": "Recognition"},
            {"ord": 1, "name": "Production"},
        ],
    }
    assert actions == ["version", "deckNames", "modelNames", "modelFieldNames", "modelTemplates"]


def test_overlapping_external_batches_keep_provenance_until_the_last_source_item_is_revoked(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'overlapping-imports.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    cat = Lexeme(normalized_form="猫", canonical_reading_kana="ねこ", is_provisional=False, identity_key="cat")
    dog = Lexeme(normalized_form="犬", canonical_reading_kana="いぬ", is_provisional=False, identity_key="dog")
    bird = Lexeme(normalized_form="鳥", canonical_reading_kana="とり", is_provisional=False, identity_key="bird")
    session.add_all([cat, dog, bird])
    session.commit()

    repository = SQLAlchemyKnowledgeImportRepository(
        session,
        user_lexeme_knowledge_model=UserLexemeKnowledge,
        external_knowledge_import_model=ExternalKnowledgeImport,
        external_knowledge_import_item_model=ExternalKnowledgeImportItem,
        lexeme_model=Lexeme,
    )
    batch_ids = iter(["anki-one", "anki-two", "jlpt-one"])
    service = ExternalKnowledgeImportService(
        repository,
        lexeme_resolver=SQLAlchemyLexemeResolver(session, Lexeme),
        batch_id_factory=lambda: next(batch_ids),
    )

    anki_one = service.apply_preview(service.preview_candidates("anki", [
        ImportCandidate("猫", "ねこ", "anki", "anki-cat-one", target_state="learning"),
        ImportCandidate("犬", "いぬ", "anki", "anki-dog"),
    ]))
    anki_two = service.apply_preview(service.preview_candidates("anki", [
        ImportCandidate("猫", "ねこ", "anki", "anki-cat-two"),
        ImportCandidate("鳥", "とり", "anki", "anki-bird"),
    ]))
    jlpt_one = service.apply_preview(service.preview_candidates("jlpt", [
        ImportCandidate("猫", "ねこ", "jlpt", "jlpt-cat", level="N5"),
    ]))

    assert anki_one.created_count == 2
    assert anki_two.created_count == 2
    assert jlpt_one.created_count == 1
    assert session.query(ExternalKnowledgeImportItem).filter_by(lexeme_id=cat.id, status="applied").count() == 3
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").count() == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="jlpt").count() == 1

    # Revoke the later mature batch first: the earlier learning evidence must
    # downgrade the source row instead of leaving it incorrectly known.
    assert service.rollback_batch(anki_two.batch_id).deleted_count == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").one().state == "learning"

    assert service.rollback_batch(jlpt_one.batch_id).deleted_count == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").count() == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="jlpt").count() == 0

    assert service.rollback_batch(anki_one.batch_id).deleted_count == 2
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").count() == 0
    assert session.query(ExternalKnowledgeImportItem).filter_by(lexeme_id=cat.id, status="applied").count() == 0
    session.close()


def test_anki_digest_is_stable_when_selected_cards_are_reordered():
    cards = [
        {"card_id": "20", "note_id": "2", "state": "mature"},
        {"card_id": "10", "note_id": "1", "state": "young"},
    ]
    candidate = ImportCandidate(
        "猫", "ねこ", "anki", "note-cat", target_state="known",
        metadata={"selected_anki_cards": cards},
    )
    reordered = ImportCandidate(
        "猫", "ねこ", "anki", "note-cat", target_state="known",
        metadata={"selected_anki_cards": list(reversed(cards))},
    )

    assert _digest_candidates([candidate]) == _digest_candidates([reordered])


def test_anki_batch_persists_card_evidence_and_does_not_turn_suspended_into_known(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'anki-evidence.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    cat = Lexeme(normalized_form="猫", canonical_reading_kana="ねこ", is_provisional=False, identity_key="cat")
    dog = Lexeme(normalized_form="犬", canonical_reading_kana="いぬ", is_provisional=False, identity_key="dog")
    bird = Lexeme(normalized_form="鳥", canonical_reading_kana="とり", is_provisional=False, identity_key="bird")
    session.add_all([cat, dog, bird])
    session.flush()
    session.commit()

    repository = SQLAlchemyKnowledgeImportRepository(
        session,
        user_lexeme_knowledge_model=UserLexemeKnowledge,
        external_knowledge_import_model=ExternalKnowledgeImport,
        external_knowledge_import_item_model=ExternalKnowledgeImportItem,
        lexeme_model=Lexeme,
    )
    service = ExternalKnowledgeImportService(
        repository,
        lexeme_resolver=SQLAlchemyLexemeResolver(session, Lexeme),
        batch_id_factory=lambda: "anki-evidence-batch",
    )
    preview = service.preview_candidates("anki", [
        ImportCandidate(
            "猫", "ねこ", "anki", "note-cat", target_state="known",
            metadata={
                "anki_cards": [{
                    "card_id": "card-cat",
                    "note_id": "note-cat",
                    "deck_name": "Kaishi 1.5k  zh-CH",
                    "model_name": "Kaishi 1.5k zh-CH",
                    "template_ord": 0,
                    "state": "mature",
                    "underlying_state": "mature",
                    "queue": 2,
                    "type": 2,
                    "interval": 30,
                    "reps": 8,
                    "lapses": 1,
                    "buried": True,
                    "suspended": False,
                    "snapshot_at": "2026-08-06T00:00:00+00:00",
                }],
                "selected_anki_cards": [{
                    "card_id": "card-cat",
                    "note_id": "note-cat",
                    "deck_name": "Kaishi 1.5k  zh-CH",
                    "model_name": "Kaishi 1.5k zh-CH",
                    "template_ord": 0,
                    "state": "mature",
                    "underlying_state": "mature",
                    "queue": 2,
                    "type": 2,
                    "interval": 30,
                    "reps": 8,
                    "lapses": 1,
                    "buried": True,
                    "suspended": False,
                    "snapshot_at": "2026-08-06T00:00:00+00:00",
                }],
            },
        ),
        ImportCandidate(
            "犬", "いぬ", "anki", "note-dog", target_state="learning",
            lexeme_id=dog.id,
            metadata={
                "selected_anki_cards": [{
                    "card_id": "card-dog",
                    "note_id": "note-dog",
                    "deck_name": "Kaishi 1.5k  zh-CH",
                    "model_name": "Kaishi 1.5k zh-CH",
                    "template_ord": 0,
                    "state": "young",
                    "underlying_state": "young",
                    "interval": 5,
                    "reps": 2,
                    "lapses": 0,
                    "suspended": False,
                    "buried": False,
                    "snapshot_at": "2026-08-06T00:00:00+00:00",
                }],
            },
        ),
        ImportCandidate(
            "鳥", "とり", "anki", "note-bird", target_state=None,
            lexeme_id=bird.id,
            metadata={
                "selected_anki_cards": [{
                    "card_id": "card-bird",
                    "note_id": "note-bird",
                    "deck_name": "Kaishi 1.5k  zh-CH",
                    "model_name": "Kaishi 1.5k zh-CH",
                    "template_ord": 0,
                    "state": "suspended",
                    "underlying_state": "mature",
                    "interval": 40,
                    "reps": 10,
                    "lapses": 1,
                    "suspended": True,
                    "buried": False,
                    "snapshot_at": "2026-08-06T00:00:00+00:00",
                }],
            },
        ),
    ])

    result = service.apply_preview(preview)
    items = session.query(ExternalKnowledgeImportItem).order_by(ExternalKnowledgeImportItem.card_id).all()

    assert result.created_count == 2
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").one().state == "known"
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=dog.id, source="anki").one().state == "learning"
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=bird.id, source="anki").count() == 0
    assert [(item.card_id, item.note_id, item.anki_state, item.interval, item.buried, item.suspended) for item in items] == [
        ("card-bird", "note-bird", "suspended", 40, False, True),
        ("card-cat", "note-cat", "mature", 30, True, False),
        ("card-dog", "note-dog", "young", 5, False, False),
    ]
    assert service.rollback_batch(result.batch_id).deleted_count == 2
    assert session.query(UserLexemeKnowledge).filter_by(source="anki").count() == 0
    session.close()


def test_anki_preview_reports_learning_map_coverage_delta_for_affected_books(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'anki-coverage.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    book = Book(
        id="coverage-book",
        title="Coverage fixture",
        status=ProcessingStatus.COMPLETED,
        source_rebuild_status="rebuildable",
        total_chapters=1,
    )
    chapter = Chapter(book=book, index=0, title="Opening", content_json=[])
    version = SourceContentVersion(
        book=book,
        source_file_sha256="s" * 64,
        parser_version="fixture",
        source_schema_version=1,
        source_content_sha256="c" * 64,
        source_content_json={"schema_version": 1, "documents": []},
    )
    cat = Lexeme(normalized_form="猫", canonical_reading_kana="ねこ", is_provisional=False, identity_key="coverage-cat")
    dog = Lexeme(normalized_form="犬", canonical_reading_kana="いぬ", is_provisional=False, identity_key="coverage-dog")
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
    cat_run = RunLexeme(
        analysis_run=run,
        lexeme=cat,
        observation_key="cat-observation",
        dictionary_form="猫",
        normalized_form="猫",
        observed_reading="ねこ",
        observed_reading_kana="ねこ",
        reading_source="fixture",
        reading_is_trusted=True,
        is_oov=False,
        part_of_speech=["名詞"],
        inflection_type="*",
        inflection_form="*",
        word_id=1,
        dictionary_id=1,
    )
    dog_run = RunLexeme(
        analysis_run=run,
        lexeme=dog,
        observation_key="dog-observation",
        dictionary_form="犬",
        normalized_form="犬",
        observed_reading="いぬ",
        observed_reading_kana="いぬ",
        reading_source="fixture",
        reading_is_trusted=True,
        is_oov=False,
        part_of_speech=["名詞"],
        inflection_type="*",
        inflection_form="*",
        word_id=2,
        dictionary_id=1,
    )
    session.add_all([
        book,
        chapter,
        version,
        cat,
        dog,
        run,
        LexemeOccurrence(
            analysis_run=run,
            chapter=chapter,
            chapter_index=0,
            run_lexeme=cat_run,
            surface="猫",
            source_document_id="chapter-0",
            source_start=0,
            source_end=1,
            source_token_index=0,
        ),
        LexemeOccurrence(
            analysis_run=run,
            chapter=chapter,
            chapter_index=0,
            run_lexeme=dog_run,
            surface="犬",
            source_document_id="chapter-0",
            source_start=2,
            source_end=3,
            source_token_index=1,
        ),
    ])
    session.commit()

    repository = SQLAlchemyKnowledgeImportRepository(
        session,
        user_lexeme_knowledge_model=UserLexemeKnowledge,
        external_knowledge_import_model=ExternalKnowledgeImport,
        external_knowledge_import_item_model=ExternalKnowledgeImportItem,
        lexeme_model=Lexeme,
    )
    preview = ExternalKnowledgeImportService(
        repository,
        lexeme_resolver=SQLAlchemyLexemeResolver(session, Lexeme),
    ).preview_candidates("anki", [ImportCandidate("猫", "ねこ", "anki", "coverage-cat")])

    assert len(preview.learning_map_impact) == 1
    impact = preview.learning_map_impact[0]
    assert impact["book_id"] == "coverage-book"
    assert impact["known_occurrences_before"] == 0
    assert impact["known_occurrences_after"] == 1
    assert impact["coverage_before"] == 0.0
    assert impact["coverage_after"] == 0.5
    assert impact["coverage_delta"] == 0.5
    session.close()
