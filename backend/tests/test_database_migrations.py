from sqlalchemy import create_engine, text

from app.database import apply_sqlite_additive_migrations


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

    assert applied_count == 4

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
    assert "progress_percentage" in progress_columns
