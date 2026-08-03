import json

import pytest
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import (
    Base,
    ExternalKnowledgeImport,
    ExternalKnowledgeImportItem,
    Lexeme,
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


def test_anki_preview_is_read_only_and_keeps_unique_trusted_canonical_only():
    requests_seen = []

    def fake_post(_url, *, json, timeout):
        requests_seen.append((json["action"], json["params"], timeout))
        if json["action"] == "version":
            return JsonResponse({"result": 6, "error": None})
        if json["action"] == "findNotes":
            return JsonResponse({"result": [10, 11, 12, 13], "error": None})
        if json["action"] == "notesInfo":
            return JsonResponse({
                "result": [
                    {
                        "noteId": 10,
                        "fields": {
                            "Expression": {"value": "猫"},
                            "Reading": {"value": "ネコ"},
                        },
                    },
                    {
                        "noteId": 11,
                        "fields": {
                            "Expression": {"value": "猫"},
                            "Reading": {"value": "ねこ"},
                        },
                    },
                    {
                        "noteId": 12,
                        "fields": {"Expression": {"value": "犬"}},
                    },
                    {
                        "noteId": 13,
                        "fields": {
                            "Expression": {"value": "走る"},
                            "Reading": {"value": "ハシル"},
                        },
                    },
                ],
                "error": None,
            })
        raise AssertionError(f"unexpected action: {json['action']}")

    resolver = MappingLexemeResolver({
        ("猫", "ねこ"): ResolvedLexeme(lexeme_id=1, normalized_form="猫", canonical_reading_kana="ねこ"),
    })
    source = AnkiConnectKnowledgeSource(timeout_seconds=0.5, post=fake_post)
    service = ExternalKnowledgeImportService(
        MemoryKnowledgeRepository(),
        lexeme_resolver=resolver,
    )

    preview = service.preview_candidates(
        "anki",
        source.fetch_candidates(query="deck:読書"),
    )

    assert requests_seen == [
        ("version", {}, 0.5),
        ("findNotes", {"query": "deck:読書"}, 0.5),
        ("notesInfo", {"notes": [10, 11, 12, 13]}, 0.5),
    ]
    assert preview.accepted_count == 1
    assert preview.stats.total == 4
    assert preview.stats.parsable == 3
    assert preview.stats.unique == 1
    assert preview.stats.unmatched == 1
    assert preview.accepted[0].lexeme_id == 1
    assert preview.accepted[0].canonical_reading_kana == "ねこ"
    assert {skip.reason for skip in preview.skipped} == {
        "duplicate_in_preview",
        "missing_trusted_canonical_reading",
        "unmatched_canonical_lexeme",
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
        ImportCandidate("猫", "ねこ", "anki", "anki-cat-one"),
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

    # Revoke the later same-source batch first: cat remains known through the
    # earlier Anki item, while bird is removed with its only evidence.
    assert service.rollback_batch(anki_two.batch_id).deleted_count == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").count() == 1

    assert service.rollback_batch(jlpt_one.batch_id).deleted_count == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").count() == 1
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="jlpt").count() == 0

    assert service.rollback_batch(anki_one.batch_id).deleted_count == 2
    assert session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id, source="anki").count() == 0
    assert session.query(ExternalKnowledgeImportItem).filter_by(lexeme_id=cat.id, status="applied").count() == 0
    session.close()
