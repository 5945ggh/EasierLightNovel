from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from app.enums import AnalysisRunStatus, ProcessingStatus
from app.models import (
    AnalysisRun,
    Base,
    Book,
    Chapter,
    Lexeme,
    LexemeOccurrence,
    ReaderLookupEvent,
    RunLexeme,
    SourceContentVersion,
    UserLexemeKnowledge,
)
from app.routers.dictionary import router as dictionary_router
from app.routers.lookup_events import get_lookup_event_service, router as lookup_router
from app.services.analysis_service import AnalysisService, _reader_token_for
from app.services.lookup_event_service import LookupEventConflict, LookupEventService


BOOK_ID = "lookup-event-fixture"


def _session_factory(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'lookup-events.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _new_run(session, *, active: bool = True) -> AnalysisRun:
    source_version = SourceContentVersion(
        book_id=BOOK_ID,
        source_file_sha256="a" * 64,
        parser_version="fixture-parser",
        source_schema_version=4,
        source_content_sha256="b" * 64,
        source_content_json={"schema_version": 4, "documents": []},
    )
    session.add(source_version)
    session.flush()
    run = AnalysisRun(
        book_id=BOOK_ID,
        source_content_version_id=source_version.id,
        status=AnalysisRunStatus.COMPLETED,
        is_active=active,
        tokenizer_name="fixture",
        tokenizer_version="1",
        tokenizer_contract_version="fixture-v1",
        dictionary_name="fixture",
        dictionary_version="1",
        split_mode="B",
        analysis_schema_version=1,
        source_content_sha256="b" * 64,
        filter_spec={
            "pos_allowlist": ["名詞"],
            "exclude_oov": False,
            "exclude_proper_nouns": False,
            "identity": "fixture",
        },
    )
    session.add(run)
    session.flush()
    return run


def _seed_book(tmp_path: Path, *, with_run: bool = True):
    Session = _session_factory(tmp_path)
    session = Session()
    session.add(Book(
        id=BOOK_ID,
        title="Lookup event fixture",
        status=ProcessingStatus.COMPLETED,
        source_rebuild_status="rebuildable",
        total_chapters=1,
    ))
    session.add(Chapter(
        book_id=BOOK_ID,
        index=0,
        title="Opening",
        content_json=[{
            "type": "text",
            "tokens": [
                {"s": "猫", "b": "猫", "p": "名詞"},
                {"s": "猫", "b": "猫", "p": "名詞"},
                {"s": "猫", "b": "猫", "p": "名詞"},
                {"s": "犬", "b": "犬", "p": "名詞"},
            ],
        }],
    ))
    session.flush()
    run = _new_run(session) if with_run else None
    session.commit()
    session.close()
    return Session, run


def _add_occurrence(
    session,
    run: AnalysisRun,
    lexeme: Lexeme,
    *,
    token_index: int,
    start: int | None = None,
    surface: str = "猫",
    run_lexeme: RunLexeme | None = None,
):
    chapter = session.query(Chapter).filter_by(book_id=BOOK_ID, index=0).one()
    if run_lexeme is None:
        run_lexeme = RunLexeme(
            analysis_run_id=run.id,
            lexeme_id=lexeme.id,
            observation_key=f"{lexeme.identity_key}-{token_index}-{start}",
            dictionary_form=surface,
            normalized_form=lexeme.normalized_form,
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
        session.add(run_lexeme)
        session.flush()
    source_start = token_index * 2 if start is None else start
    occurrence = LexemeOccurrence(
        analysis_run_id=run.id,
        chapter_id=chapter.id,
        chapter_index=0,
        run_lexeme_id=run_lexeme.id,
        surface=surface,
        source_document_id="chapter-0.xhtml",
        source_start=source_start,
        source_end=source_start + 1,
        source_token_index=token_index,
        reader_segment_index=0,
        reader_token_index=token_index,
    )
    session.add(occurrence)
    return occurrence


def _seed_lexeme_occurrences(session, run: AnalysisRun):
    cat = Lexeme(
        normalized_form="猫",
        canonical_reading_kana="ねこ",
        identity_key="cat",
    )
    dog = Lexeme(
        normalized_form="犬",
        canonical_reading_kana="いぬ",
        identity_key="dog",
    )
    session.add_all([cat, dog])
    session.flush()
    for token_index in range(3):
        _add_occurrence(session, run, cat, token_index=token_index)
    _add_occurrence(session, run, dog, token_index=3, surface="犬")
    run.occurrence_count = 4
    run.lexeme_count = 2
    session.commit()
    return cat, dog


def _event_request(client_event_id: str, token_index: int, *, surface: str = "猫"):
    return {
        "client_event_id": client_event_id,
        "chapter_index": 0,
        "reader_segment_index": 0,
        "reader_token_index": token_index,
        "surface": surface,
        "query_text": surface,
    }


def test_valid_reader_lookup_persists_and_is_idempotent(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    cat, _ = _seed_lexeme_occurrences(session, run)

    service = LookupEventService(session)
    first = service.record_reader_lookup(
        BOOK_ID,
        **_event_request("client-1", 0),
    )
    retry = service.record_reader_lookup(
        BOOK_ID,
        **_event_request("client-1", 0),
    )

    assert first["id"] == retry["id"]
    assert first["mapping_status"] == "resolved"
    assert first["lexeme_id"] == cat.id
    assert first["analysis_run_id"] == run.id
    assert session.query(ReaderLookupEvent).count() == 1
    session.close()


def test_two_real_follow_up_queries_create_two_events(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    _seed_lexeme_occurrences(session, run)
    service = LookupEventService(session)

    service.record_reader_lookup(BOOK_ID, **_event_request("client-1", 0))
    service.record_reader_lookup(BOOK_ID, **_event_request("client-2", 1))
    service.record_reader_lookup(BOOK_ID, **_event_request("client-3", 2))

    assert session.query(ReaderLookupEvent).count() == 3
    assert {
        event.client_event_id
        for event in session.query(ReaderLookupEvent).all()
    } == {"client-1", "client-2", "client-3"}
    session.close()


def test_reusing_client_event_id_with_different_payload_is_a_conflict(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    _seed_lexeme_occurrences(session, run)
    service = LookupEventService(session)
    service.record_reader_lookup(BOOK_ID, **_event_request("conflict-1", 0))

    try:
        service.record_reader_lookup(BOOK_ID, **_event_request("conflict-1", 1))
    except LookupEventConflict:
        pass
    else:
        raise AssertionError("reusing an event id with a different payload must conflict")

    assert session.query(ReaderLookupEvent).count() == 1
    session.close()


def test_source_offsets_map_to_reader_tokens_only_from_rendered_text():
    chapter = Chapter(content_json=[{
        "type": "text",
        "tokens": [
            {"s": "猫"},
            {"s": " ", "gap": True},
            {"s": "犬"},
        ],
    }])
    spans = [{
        "start_offset": 0,
        "end_offset": 3,
        "reader_segment_index": 0,
    }]

    assert _reader_token_for(chapter, "猫 犬", 0, 1, spans) == 0
    assert _reader_token_for(chapter, "猫 犬", 2, 3, spans) == 2
    assert _reader_token_for(chapter, "猫犬", 0, 1, spans) is None


def test_reader_mapping_matches_rendered_index_after_leading_break():
    chapter = Chapter(content_json=[{
        "type": "text",
        "tokens": [
            {"s": "\n\n　"},
            {"s": "猫"},
            {"s": "犬"},
        ],
    }])
    spans = [{
        "start_offset": 0,
        "end_offset": 5,
        "reader_segment_index": 0,
    }]

    assert _reader_token_for(chapter, "\n\n　猫犬", 3, 4, spans) == 0
    assert _reader_token_for(chapter, "\n\n　猫犬", 4, 5, spans) == 1


def test_unresolved_event_is_retained_without_active_analysis(tmp_path):
    Session, _ = _seed_book(tmp_path, with_run=False)
    session = Session()
    event = LookupEventService(session).record_reader_lookup(
        BOOK_ID,
        **_event_request("unresolved-1", 0),
    )

    assert event["analysis_run_id"] is None
    assert event["lexeme_id"] is None
    assert event["mapping_status"] == "unresolved"
    assert session.query(ReaderLookupEvent).one().surface == "猫"
    session.close()


def test_multiple_occurrence_candidates_are_not_guessed(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    cat = Lexeme(
        normalized_form="猫",
        canonical_reading_kana="ねこ",
        identity_key="cat",
    )
    dog = Lexeme(
        normalized_form="犬",
        canonical_reading_kana="いぬ",
        identity_key="dog",
    )
    session.add_all([cat, dog])
    session.flush()
    _add_occurrence(session, run, cat, token_index=0, start=0)
    _add_occurrence(session, run, dog, token_index=0, start=2)
    session.commit()

    event = LookupEventService(session).record_reader_lookup(
        BOOK_ID,
        **_event_request("ambiguous-1", 0),
    )

    assert event["mapping_status"] == "unresolved"
    assert event["lexeme_id"] is None
    session.close()


def test_source_mapping_rejects_contradictory_reader_coordinates(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    cat, _ = _seed_lexeme_occurrences(session, run)

    event = LookupEventService(session).record_reader_lookup(
        BOOK_ID,
        **_event_request("contradictory-1", 2),
        source_document_id="chapter-0.xhtml",
        source_start=0,
        source_end=1,
        source_token_index=0,
    )

    assert event["mapping_status"] == "unresolved"
    assert event["lexeme_id"] is None
    assert session.query(ReaderLookupEvent).one().surface == cat.normalized_form
    session.close()


def test_merge_is_resolved_at_query_time_without_rewriting_history(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    child = Lexeme(
        normalized_form="猫",
        canonical_reading_kana="ねこ",
        identity_key="child-cat",
    )
    canonical = Lexeme(
        normalized_form="猫",
        canonical_reading_kana="ネコ",
        identity_key="canonical-cat",
    )
    session.add_all([child, canonical])
    session.flush()
    _add_occurrence(session, run, child, token_index=0)
    _add_occurrence(session, run, child, token_index=1)
    session.commit()

    event = LookupEventService(session).record_reader_lookup(
        BOOK_ID,
        **_event_request("merge-1", 0),
    )
    assert event["lexeme_id"] == child.id

    child.merged_into_id = canonical.id
    session.commit()
    observation = LookupEventService(session).get_learning_map_observations(
        BOOK_ID,
        run,
        {canonical.id},
    )

    assert session.query(ReaderLookupEvent).one().lexeme_id == child.id
    assert observation[canonical.id]["lookup_count"] == 1
    assert observation[canonical.id]["occurrences_after_first_lookup"] == 1
    session.close()


def test_lookup_observation_counts_follow_up_occurrences_and_queries(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    cat, _ = _seed_lexeme_occurrences(session, run)
    service = LookupEventService(session)
    service.record_reader_lookup(BOOK_ID, **_event_request("observe-1", 0))
    service.record_reader_lookup(BOOK_ID, **_event_request("observe-2", 1))

    observation = service.get_learning_map_observations(BOOK_ID, run, {cat.id})[cat.id]

    assert observation["lookup_count"] == 2
    assert observation["first_lookup"]["reader_token_index"] == 0
    assert observation["last_lookup"]["reader_token_index"] == 1
    assert observation["occurrences_after_first_lookup"] == 2
    assert observation["occurrences_after_last_lookup"] == 1
    assert observation["later_lookup_count_after_first"] == 1
    session.close()


def test_lookup_observation_counts_relevant_occurrences_in_sql(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    cat, _ = _seed_lexeme_occurrences(session, run)
    service = LookupEventService(session)
    service.record_reader_lookup(BOOK_ID, **_event_request("sql-observe-1", 0))
    for index in range(25):
        service.record_reader_lookup(
            BOOK_ID,
            **_event_request(f"sql-unrelated-{index}", 3, surface="犬"),
        )

    statements: list[str] = []
    engine = session.get_bind()

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        observation = service.get_learning_map_observations(BOOK_ID, run, {cat.id})
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    occurrence_statements = [
        statement.upper()
        for statement in statements
        if "LEXEME_OCCURRENCES" in statement.upper()
    ]
    event_statements = [
        statement.upper()
        for statement in statements
        if "READER_LOOKUP_EVENTS" in statement.upper()
        and "SELECT" in statement.upper()
    ]
    assert observation[cat.id]["occurrences_after_first_lookup"] == 2
    assert len(occurrence_statements) == 1
    assert any("SUM(CASE" in statement for statement in occurrence_statements)
    assert not any("SELECT LEXEME_OCCURRENCES.ID" in statement
                   and "COUNT(" not in statement
                   for statement in occurrence_statements)
    assert any("LEXEME_ID IN" in statement and "WITH" in statement
               for statement in event_statements)
    session.close()


def test_lookup_observation_excludes_events_from_another_source_version(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    cat, _ = _seed_lexeme_occurrences(session, run)

    historical_run = _new_run(session, active=False)
    historical_occurrence = _add_occurrence(
        session,
        historical_run,
        cat,
        token_index=0,
    )
    chapter = session.query(Chapter).filter_by(book_id=BOOK_ID, index=0).one()
    session.add(ReaderLookupEvent(
        book_id=BOOK_ID,
        chapter_id=chapter.id,
        chapter_index=0,
        analysis_run_id=historical_run.id,
        lexeme_id=cat.id,
        run_lexeme_id=historical_occurrence.run_lexeme_id,
        surface="猫",
        query_text="猫",
        reader_segment_index=0,
        reader_token_index=0,
        source_document_id="chapter-0.xhtml",
        source_start=0,
        source_end=1,
        source_token_index=0,
        client_event_id="historical-source-version-event",
    ))
    session.commit()

    current_event = LookupEventService(session).record_reader_lookup(
        BOOK_ID,
        **_event_request("current-source-version-event", 0),
    )

    observation = LookupEventService(session).get_learning_map_observations(
        BOOK_ID,
        run,
        {cat.id},
    )[cat.id]

    assert observation["lookup_count"] == 1
    assert observation["first_lookup"]["reader_token_index"] == 0
    assert observation["first_lookup"]["created_at"] == current_event["created_at"]
    assert observation["occurrences_after_first_lookup"] == 2
    session.close()


def test_lookup_does_not_change_knowledge_or_explicit_known_coverage(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    cat, dog = _seed_lexeme_occurrences(session, run)
    session.add(UserLexemeKnowledge(
        lexeme_id=cat.id,
        state="known",
        source="manual",
    ))
    session.commit()

    before = AnalysisService(session).get_learning_map(BOOK_ID)
    LookupEventService(session).record_reader_lookup(
        BOOK_ID,
        **_event_request("coverage-1", 0),
    )
    after = AnalysisService(session).get_learning_map(BOOK_ID)

    assert before["coverage"] == after["coverage"]
    assert before["coverage"]["explicit_known_coverage"] == 3 / 4
    knowledge = session.query(UserLexemeKnowledge).filter_by(lexeme_id=cat.id).one()
    assert knowledge.state == "known"
    assert knowledge.source == "manual"
    assert dog.id != cat.id
    session.close()


def test_dictionary_get_is_not_a_lookup_event_write(tmp_path):
    Session, _ = _seed_book(tmp_path, with_run=False)
    session = Session()

    class FakeDictionaryService:
        def search_word(self, query):
            return {"query": query, "found": False, "entries": [], "error": None}

    app = FastAPI()
    app.include_router(dictionary_router)
    from app.routers.dictionary import get_dictionary_service

    app.dependency_overrides[get_dictionary_service] = lambda: FakeDictionaryService()
    response = TestClient(app).get("/api/dictionary/search?query=猫")

    assert response.status_code == 200
    assert session.query(ReaderLookupEvent).count() == 0
    session.close()


def test_lookup_router_accepts_idempotent_retry(tmp_path):
    Session, run = _seed_book(tmp_path, with_run=True)
    session = Session()
    _seed_lexeme_occurrences(session, run)
    session.close()

    app = FastAPI()
    app.include_router(lookup_router)

    def override_service():
        request_session = Session()
        try:
            yield LookupEventService(request_session)
        finally:
            request_session.close()

    app.dependency_overrides[get_lookup_event_service] = override_service
    client = TestClient(app)
    body = _event_request("router-1", 0)
    first = client.post(f"/api/books/{BOOK_ID}/reader/lookup-events", json=body)
    retry = client.post(f"/api/books/{BOOK_ID}/reader/lookup-events", json=body)

    assert first.status_code == 200
    assert retry.status_code == 200
    assert first.json()["id"] == retry.json()["id"]
    check_session = Session()
    assert check_session.query(ReaderLookupEvent).count() == 1
    check_session.close()


def test_additive_lookup_table_migration_is_idempotent(tmp_path):
    db_path = tmp_path / "migration.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE books (id VARCHAR(32) PRIMARY KEY, title VARCHAR(255) NOT NULL)"))
        conn.execute(text("CREATE TABLE chapters (id INTEGER PRIMARY KEY, book_id VARCHAR(32) NOT NULL, `index` INTEGER NOT NULL, content_json JSON NOT NULL)"))

    from app.database import apply_sqlite_additive_migrations

    first = apply_sqlite_additive_migrations(engine)
    second = apply_sqlite_additive_migrations(engine)

    # The legacy books table also receives its four existing additive columns.
    assert first == 6
    assert second == 0
    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('reader_lookup_events')")).fetchall()
        }
    assert {"client_event_id", "reader_token_index", "chapter_id"}.issubset(columns)
