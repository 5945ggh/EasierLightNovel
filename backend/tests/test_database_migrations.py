from sqlalchemy import create_engine, text

from app.database import apply_sqlite_additive_migrations
from app.models import Base


def test_apply_sqlite_additive_migrations_adds_missing_columns(tmp_path):
    db_path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE books (id VARCHAR(32) PRIMARY KEY, title VARCHAR(255) NOT NULL)"))
        conn.execute(
            text(
                "CREATE TABLE user_progress ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "book_id VARCHAR(32) UNIQUE, "
                "current_chapter_index INTEGER DEFAULT 0, "
                "current_segment_index INTEGER DEFAULT 0)"
            )
        )

    applied_count = apply_sqlite_additive_migrations(engine)

    # Two additive tables plus the five legacy columns.
    assert applied_count == 7

    with engine.begin() as conn:
        book_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('books')")).fetchall()
        }
        progress_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('user_progress')")).fetchall()
        }

    assert "pdf_progress_stage" in book_columns
    assert "pdf_progress_current" in book_columns
    assert "pdf_progress_total" in book_columns
    assert "source_rebuild_status" in book_columns
    assert "progress_percentage" in progress_columns


def test_anki_evidence_columns_are_added_to_existing_import_items(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy-anki-import.db'}")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE external_knowledge_import_items ("
            "id INTEGER PRIMARY KEY, import_id INTEGER NOT NULL, lexeme_id INTEGER NOT NULL, "
            "source_entry_id VARCHAR(255) NOT NULL, normalized_form VARCHAR(255) NOT NULL, "
            "canonical_reading_kana VARCHAR(255) NOT NULL, metadata_json JSON NOT NULL, "
            "status VARCHAR(32) NOT NULL)"
        ))

    apply_sqlite_additive_migrations(engine)

    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('external_knowledge_import_items')")).fetchall()
        }

    assert {
        "card_id",
        "note_id",
        "deck_name",
        "model_name",
        "template_ord",
        "anki_state",
        "anki_underlying_state",
        "anki_queue",
        "anki_type",
        "interval",
        "reps",
        "lapses",
        "buried",
        "suspended",
        "snapshot_at",
    }.issubset(columns)


def test_legacy_database_gets_source_tables_and_explicit_legacy_status(tmp_path):
    db_path = tmp_path / "legacy-with-content.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE books (id VARCHAR(32) PRIMARY KEY, title VARCHAR(255) NOT NULL)"))
        conn.execute(text("INSERT INTO books (id, title) VALUES ('old-book', 'Old')"))

    # init_db performs these two operations in this order for an existing DB.
    Base.metadata.create_all(engine)
    apply_sqlite_additive_migrations(engine)

    with engine.begin() as conn:
        status = conn.execute(text("SELECT source_rebuild_status FROM books WHERE id = 'old-book'"))\
            .scalar_one()
        tables = {row[0] for row in conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table'")
        )}

    assert status == "legacy_unavailable"
    assert {
        "book_source_files",
        "source_content_versions",
        "source_ruby_hints",
        "analysis_runs",
        "lexemes",
        "run_lexemes",
        "lexeme_occurrences",
        "chapter_lexeme_stats",
        "reader_lookup_events",
        "chapter_progress",
    }.issubset(tables)


def test_legacy_phase_two_run_lexemes_get_learning_target_column(tmp_path):
    db_path = tmp_path / "legacy-phase-two.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE run_lexemes (id INTEGER PRIMARY KEY, is_oov BOOLEAN NOT NULL DEFAULT 0)"))

    from app.database import SQLITE_ADDITIVE_MIGRATIONS

    # The additive migration is intentionally idempotent and can run against
    # a database that already contains Phase 2 tables.
    applied_count = apply_sqlite_additive_migrations(engine)

    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('run_lexemes')")).fetchall()
        }

    assert "excluded_from_learning_target" in columns
    assert SQLITE_ADDITIVE_MIGRATIONS["run_lexemes"]["excluded_from_learning_target"]
    # The lookup-event table is created alongside the legacy column.
    assert applied_count == 3


def test_full_phase_two_run_lexeme_schema_remains_orm_readable_after_migration(tmp_path):
    db_path = tmp_path / "legacy-phase-two-full.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text(
            """
            CREATE TABLE run_lexemes (
                id INTEGER PRIMARY KEY,
                analysis_run_id INTEGER NOT NULL,
                lexeme_id INTEGER NOT NULL,
                observation_key VARCHAR(64) NOT NULL,
                dictionary_form VARCHAR(255) NOT NULL,
                normalized_form VARCHAR(255) NOT NULL,
                observed_reading VARCHAR(255),
                observed_reading_kana VARCHAR(255),
                reading_source VARCHAR(32) NOT NULL,
                reading_is_trusted BOOLEAN NOT NULL,
                is_oov BOOLEAN NOT NULL,
                part_of_speech JSON NOT NULL,
                inflection_type VARCHAR(255) NOT NULL,
                inflection_form VARCHAR(255) NOT NULL,
                word_id INTEGER NOT NULL,
                dictionary_id INTEGER NOT NULL
            )
            """
        ))

    Base.metadata.create_all(engine)
    applied_count = apply_sqlite_additive_migrations(engine)

    with engine.begin() as conn:
        columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info('run_lexemes')")).fetchall()
        }
        conn.execute(text(
            """
            INSERT INTO run_lexemes (
                id, analysis_run_id, lexeme_id, observation_key,
                dictionary_form, normalized_form, reading_source,
                reading_is_trusted, is_oov, part_of_speech,
                inflection_type, inflection_form, word_id, dictionary_id
            ) VALUES (
                1, 1, 1, 'observation', '猫', '猫', 'sudachi_registered',
                1, 0, '["名詞"]', '*', '*', 1, 1
            )
            """
        ))

    from sqlalchemy.orm import sessionmaker
    from app.models import RunLexeme

    Session = sessionmaker(bind=engine)
    session = Session()
    row = session.get(RunLexeme, 1)

    assert applied_count == 1
    assert "excluded_from_learning_target" in columns
    assert row is not None
    assert row.excluded_from_learning_target is False
    session.close()


def test_chapter_progress_migration_is_repeatable_and_preserves_rows(tmp_path):
    db_path = tmp_path / "legacy-chapter-progress.db"
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE books (id VARCHAR(32) PRIMARY KEY, title VARCHAR(255) NOT NULL)"))
        conn.execute(text(
            "CREATE TABLE chapters ("
            "id INTEGER PRIMARY KEY, book_id VARCHAR(32) NOT NULL, "
            '"index" INTEGER NOT NULL, title VARCHAR(255), content_json JSON NOT NULL)'
        ))
        conn.execute(text("INSERT INTO books (id, title) VALUES ('migration-book', 'Migration')"))
        conn.execute(text(
            'INSERT INTO chapters (id, book_id, "index", title, content_json) '
            "VALUES (10, 'migration-book', 0, 'First', '[]')"
        ))

    first_count = apply_sqlite_additive_migrations(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO chapter_progress "
            "(book_id, chapter_id, chapter_index, current_segment_index, progress_percentage, state) "
            "VALUES ('migration-book', 10, 0, 4, 12.5, 'in_progress')"
        ))

    second_count = apply_sqlite_additive_migrations(engine)
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT chapter_index, current_segment_index, progress_percentage "
            "FROM chapter_progress WHERE book_id = 'migration-book'"
        )).one()

    assert first_count == 6
    assert second_count == 0
    assert tuple(row) == (0, 4, 12.5)


def test_legacy_book_progress_backfills_current_chapter_checkpoint(tmp_path):
    db_path = tmp_path / "legacy-progress-backfill.db"
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE books (id VARCHAR(32) PRIMARY KEY, title VARCHAR(255) NOT NULL)"))
        conn.execute(text(
            "CREATE TABLE chapters ("
            "id INTEGER PRIMARY KEY, book_id VARCHAR(32) NOT NULL, "
            '"index" INTEGER NOT NULL, title VARCHAR(255), content_json JSON NOT NULL)'
        ))
        conn.execute(text(
            "CREATE TABLE user_progress ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, book_id VARCHAR(32) UNIQUE, "
            "current_chapter_index INTEGER DEFAULT 0, current_segment_index INTEGER DEFAULT 0, "
            "progress_percentage FLOAT DEFAULT 0.0, updated_at DATETIME)"
        ))
        conn.execute(text("INSERT INTO books (id, title) VALUES ('legacy-book', 'Legacy')"))
        conn.execute(text(
            'INSERT INTO chapters (id, book_id, "index", title, content_json) '
            "VALUES (21, 'legacy-book', 0, 'First', '[]'), "
            "(22, 'legacy-book', 1, 'Second', '[]')"
        ))
        conn.execute(text(
            "INSERT INTO user_progress "
            "(book_id, current_chapter_index, current_segment_index, progress_percentage, updated_at) "
            "VALUES ('legacy-book', 1, 7, 42.5, '2026-01-01 12:00:00')"
        ))

    first_count = apply_sqlite_additive_migrations(engine)
    with engine.begin() as conn:
        row = conn.execute(text(
            "SELECT book_id, chapter_id, chapter_index, current_segment_index, "
            "progress_percentage, state FROM chapter_progress"
        )).one()

    assert tuple(row) == ('legacy-book', 22, 1, 7, 42.5, 'in_progress')

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM chapter_progress WHERE book_id = 'legacy-book'"))

    # The table already exists at this point; the data backfill must still run
    # on a later application startup.
    second_count = apply_sqlite_additive_migrations(engine)
    with engine.begin() as conn:
        count = conn.execute(text(
            "SELECT COUNT(*) FROM chapter_progress WHERE book_id = 'legacy-book'"
        )).scalar_one()

    assert first_count == 7
    assert second_count == 1
    assert count == 1

    third_count = apply_sqlite_additive_migrations(engine)
    assert third_count == 0


def test_legacy_zero_progress_does_not_create_checkpoint(tmp_path):
    db_path = tmp_path / "legacy-zero-progress.db"
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE books (id VARCHAR(32) PRIMARY KEY, title VARCHAR(255) NOT NULL)"))
        conn.execute(text(
            "CREATE TABLE chapters ("
            "id INTEGER PRIMARY KEY, book_id VARCHAR(32) NOT NULL, "
            '"index" INTEGER NOT NULL, title VARCHAR(255), content_json JSON NOT NULL)'
        ))
        conn.execute(text(
            "CREATE TABLE user_progress ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, book_id VARCHAR(32) UNIQUE, "
            "current_chapter_index INTEGER DEFAULT 0, current_segment_index INTEGER DEFAULT 0, "
            "progress_percentage FLOAT DEFAULT 0.0, updated_at DATETIME)"
        ))
        conn.execute(text("INSERT INTO books (id, title) VALUES ('zero-book', 'Zero')"))
        conn.execute(text(
            'INSERT INTO chapters (id, book_id, "index", title, content_json) '
            "VALUES (31, 'zero-book', 0, 'First', '[]')"
        ))
        conn.execute(text(
            "INSERT INTO user_progress "
            "(book_id, current_chapter_index, current_segment_index, progress_percentage) "
            "VALUES ('zero-book', 0, 0, 0.0)"
        ))

    apply_sqlite_additive_migrations(engine)
    with engine.begin() as conn:
        count = conn.execute(text(
            "SELECT COUNT(*) FROM chapter_progress WHERE book_id = 'zero-book'"
        )).scalar_one()

    assert count == 0
