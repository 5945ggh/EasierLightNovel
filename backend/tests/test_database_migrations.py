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

    # One new additive table plus the five legacy columns.
    assert applied_count == 6

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
    assert applied_count == 2


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
