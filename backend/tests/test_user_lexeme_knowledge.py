from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import apply_sqlite_additive_migrations
from app.enums import AnalysisRunStatus, ProcessingStatus
from app.models import (
    AnalysisRun,
    Base,
    Book,
    Lexeme,
    RunLexeme,
    SourceContentVersion,
    UserLexemeKnowledge,
    Vocabulary,
)
from app.routers.analysis import (
    get_user_lexeme_knowledge_service,
    router as analysis_router,
)
from app.services.user_lexeme_knowledge_service import (
    LEGACY_SOURCE,
    UserLexemeKnowledgeService,
)


BOOK_ID = "knowledge-fixture"


def _session_factory(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'knowledge.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _lexeme(form: str, reading: str | None = None, *, provisional: bool = False) -> Lexeme:
    return Lexeme(
        normalized_form=form,
        canonical_reading_kana=reading,
        is_provisional=provisional,
        identity_key=f"{form}:{reading or 'provisional'}",
    )


def _run_lexeme(run: AnalysisRun, lexeme: Lexeme, form: str, reading: str) -> RunLexeme:
    return RunLexeme(
        analysis_run=run,
        lexeme=lexeme,
        observation_key=f"{run.id or 'new'}:{form}:{lexeme.identity_key}",
        dictionary_form=form,
        normalized_form=form,
        observed_reading=reading,
        observed_reading_kana=reading,
        reading_source="sudachi_registered",
        reading_is_trusted=True,
        is_oov=False,
        part_of_speech=["名詞", "普通名詞", "一般", "*", "*", "*"],
        inflection_type="*",
        inflection_form="*",
        word_id=1,
        dictionary_id=0,
    )


def _seed_run(Session):
    session = Session()
    session.add(Book(
        id=BOOK_ID,
        title="Knowledge fixture",
        status=ProcessingStatus.COMPLETED,
        source_rebuild_status="rebuildable",
        total_chapters=1,
    ))
    version = SourceContentVersion(
        book_id=BOOK_ID,
        source_file_sha256="d" * 64,
        parser_version="fixture-parser",
        source_schema_version=1,
        source_content_sha256="e" * 64,
        source_content_json={
            "schema_version": 1,
            "offset_unit": "unicode_codepoint",
            "documents": [],
        },
    )
    session.add(version)
    cat = _lexeme("猫", "ねこ")
    book = _lexeme("本", "ほん")
    mountain = _lexeme("山", "やま")
    provisional = _lexeme("QX", provisional=True)
    merged_source = _lexeme("舊", "きゅう")
    merged_target = _lexeme("旧", "きゅう")
    session.add_all([cat, book, mountain, provisional, merged_source, merged_target])
    session.flush()
    merged_source.merged_into_id = merged_target.id
    run = AnalysisRun(
        book_id=BOOK_ID,
        source_content_version_id=version.id,
        status=AnalysisRunStatus.COMPLETED,
        is_active=True,
        tokenizer_name="fixture",
        tokenizer_version="1",
        tokenizer_contract_version="1",
        dictionary_name="fixture",
        dictionary_version="1",
        split_mode="B",
        analysis_schema_version=1,
        source_content_sha256=version.source_content_sha256,
        filter_spec={},
    )
    session.add(run)
    session.flush()
    session.add_all([
        _run_lexeme(run, cat, "猫", "ねこ"),
        _run_lexeme(run, book, "本", "ほん"),
        _run_lexeme(run, mountain, "山", "やま"),
        _run_lexeme(run, provisional, "QX", "きゅー"),
        _run_lexeme(run, merged_source, "舊", "きゅう"),
    ])
    session.commit()
    ids = {
        "cat": cat.id,
        "book": book.id,
        "mountain": mountain.id,
        "provisional": provisional.id,
        "merged_source": merged_source.id,
        "merged_target": merged_target.id,
        "run": run.id,
    }
    session.close()
    return ids


def test_manual_state_resolves_merged_lexeme_and_rejects_provisional_known(tmp_path):
    Session = _session_factory(tmp_path)
    ids = _seed_run(Session)
    session = Session()
    service = UserLexemeKnowledgeService(session)

    response = service.set_manual_state(ids["merged_source"], "known", note="already know")

    assert response["lexeme_id"] == ids["merged_target"]
    assert response["requested_lexeme_id"] == ids["merged_source"]
    assert response["source"] == "manual"
    assert response["state"] == "known"

    try:
        service.set_manual_state(ids["provisional"], "known")
    except Exception as exc:
        assert "Provisional lexemes" in str(exc)
    else:
        raise AssertionError("Expected provisional manual known to be rejected")
    session.close()


def test_state_written_before_merge_remains_effective_at_merge_target(tmp_path):
    Session = _session_factory(tmp_path)
    ids = _seed_run(Session)
    session = Session()
    source = session.get(Lexeme, ids["merged_source"])
    source.merged_into_id = None
    session.commit()

    service = UserLexemeKnowledgeService(session)
    service.set_manual_state(ids["merged_source"], "known")

    source.merged_into_id = ids["merged_target"]
    session.commit()

    assert service.effective_states({ids["merged_target"]}) == {
        ids["merged_target"]: "known",
    }
    index = service.get_index([ids["merged_target"]])
    assert index[0]["lexeme_id"] == ids["merged_target"]
    assert index[0]["state"] == "known"
    known_ids, summary = service.effective_known_lexeme_ids(BOOK_ID)
    assert ids["merged_target"] in known_ids
    assert summary["known_lexeme_count"] == 1

    assert service.delete_manual_state(ids["merged_target"]) is True
    assert service.effective_states({ids["merged_target"]}) == {}
    session.close()


def test_legacy_migration_is_idempotent_and_manual_state_wins(tmp_path):
    Session = _session_factory(tmp_path)
    ids = _seed_run(Session)
    session = Session()
    session.add_all([
        Vocabulary(book_id=BOOK_ID, word="猫", reading="ねこ", base_form="猫", status=3),
        Vocabulary(book_id=BOOK_ID, word="本", reading="ほん", base_form="本", status=3),
        Vocabulary(book_id=BOOK_ID, word="QX", reading="きゅー", base_form="QX", status=3),
    ])
    session.add(UserLexemeKnowledge(
        lexeme_id=ids["cat"],
        state="ignored",
        source="manual",
    ))
    session.commit()

    service = UserLexemeKnowledgeService(session)
    known_ids, summary = service.effective_known_lexeme_ids(
        BOOK_ID,
        migrate_legacy=True,
    )

    assert ids["cat"] not in known_ids
    assert ids["book"] in known_ids
    assert summary["legacy_mastered_count"] == 3
    assert summary["legacy_mapped_count"] == 2
    assert summary["legacy_unmapped_count"] == 1
    assert summary["created_count"] == 2
    assert summary["preserved_manual_count"] == 1
    assert summary["source_distribution"] == {
        "legacy_vocabulary": 1,
        "manual": 1,
    }
    assert summary["latest_updated_at"] is not None
    assert session.query(UserLexemeKnowledge).filter(
        UserLexemeKnowledge.lexeme_id == ids["cat"],
    ).count() == 2

    _, second_summary = service.effective_known_lexeme_ids(
        BOOK_ID,
        migrate_legacy=True,
    )
    assert second_summary["created_count"] == 0
    assert second_summary["updated_count"] == 0
    assert second_summary["preserved_manual_count"] == 1
    session.close()


def test_external_known_beats_migrated_legacy_until_manual_override(tmp_path):
    Session = _session_factory(tmp_path)
    ids = _seed_run(Session)
    session = Session()
    session.add_all([
        UserLexemeKnowledge(lexeme_id=ids["mountain"], state="known", source="anki"),
        UserLexemeKnowledge(lexeme_id=ids["mountain"], state="learning", source=LEGACY_SOURCE),
    ])
    session.commit()
    service = UserLexemeKnowledgeService(session)

    known_ids, summary = service.effective_known_lexeme_ids(BOOK_ID)

    assert ids["mountain"] in known_ids
    assert summary["known_lexeme_count"] == 1
    assert summary["source_distribution"] == {"anki": 1}
    assert summary["latest_updated_at"] is not None

    service.set_manual_state(ids["mountain"], "ignored")
    known_ids, summary = service.effective_known_lexeme_ids(BOOK_ID)

    assert ids["mountain"] not in known_ids
    assert summary["ignored_lexeme_count"] == 1
    assert summary["manual_count"] == 1
    assert summary["source_distribution"] == {"manual": 1}
    session.close()


def test_router_exposes_summary_migration_update_and_index(tmp_path):
    Session = _session_factory(tmp_path)
    ids = _seed_run(Session)
    session = Session()
    session.add(Vocabulary(book_id=BOOK_ID, word="本", reading="ほん", base_form="本", status=3))
    session.commit()
    session.close()

    app = FastAPI()
    app.include_router(analysis_router)

    def override_service():
        request_session = Session()
        try:
            yield UserLexemeKnowledgeService(request_session)
        finally:
            request_session.close()

    app.dependency_overrides[get_user_lexeme_knowledge_service] = override_service
    client = TestClient(app)

    migration = client.post(
        f"/api/internal/books/{BOOK_ID}/analysis/knowledge-baseline/migrate-legacy"
    )
    assert migration.status_code == 200
    assert migration.json()["created_count"] == 1

    update = client.put(
        f"/api/internal/books/{BOOK_ID}/analysis/lexemes/{ids['cat']}/knowledge",
        json={"state": "known", "note": "manual"},
    )
    assert update.status_code == 200
    assert update.json()["source"] == "manual"

    index = client.get(
        f"/api/internal/books/{BOOK_ID}/analysis/lexemes/knowledge",
        params=[("lexeme_ids", ids["cat"]), ("lexeme_ids", ids["book"])],
    )
    assert index.status_code == 200
    assert {item["lexeme_id"] for item in index.json()["items"]} == {
        ids["cat"],
        ids["book"],
    }

    summary = client.get(f"/api/internal/books/{BOOK_ID}/analysis/knowledge-baseline")
    assert summary.status_code == 200
    assert summary.json()["known_lexeme_count"] == 2
    assert summary.json()["source_distribution"] == {
        "legacy_vocabulary": 1,
        "manual": 1,
    }
    assert summary.json()["latest_updated_at"] is not None

    deleted = client.delete(
        f"/api/internal/books/{BOOK_ID}/analysis/lexemes/{ids['cat']}/knowledge"
    )
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}

    after_delete = client.get(f"/api/internal/books/{BOOK_ID}/analysis/knowledge-baseline")
    assert after_delete.status_code == 200
    assert after_delete.json()["known_lexeme_count"] == 1


def test_additive_migration_keeps_older_source_scoped_table_readable(tmp_path):
    db_path = tmp_path / "legacy-knowledge.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text(
            """
            CREATE TABLE user_lexeme_knowledge (
                id INTEGER PRIMARY KEY,
                lexeme_id INTEGER NOT NULL,
                state VARCHAR(32) NOT NULL,
                source VARCHAR(32) NOT NULL
            )
            """
        ))

    applied_count = apply_sqlite_additive_migrations(engine)

    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('user_lexeme_knowledge')")).fetchall()
        }

    # The new append-only Reader lookup table is also created for a legacy DB.
    assert applied_count == 3
    assert "note" in columns
