# database.py
import os
import logging
import sqlite3
from sqlalchemy import create_engine, text, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, Session
from app.models import Base
from app.config import SQLALCHEMY_DATABASE_URL, DATA_DIR, DB_PATH, UPLOAD_DIR

# 使用 SQLite，check_same_thread=False 允许在 FastAPI 的多线程环境中使用同一个连接对象
# 虽然 SQLAlchemy 的 Session 不是线程安全的，但每个请求会创建新的 Session

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    # echo=False,  # 生产环境关闭 SQL 日志
    # pool_pre_ping=True,  # 连接前检查连接是否有效
    # SQLite 不需要连接池，但如果换成 PostgreSQL/MySQL 需要配置:
    # pool_size=5,
    # max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

logger = logging.getLogger(__name__)


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
    """SQLite disables foreign keys by default; enable cascades for app connections."""
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SQLITE_ADDITIVE_MIGRATIONS: dict[str, dict[str, str]] = {
    "books": {
        "pdf_progress_stage": "ALTER TABLE books ADD COLUMN pdf_progress_stage VARCHAR(50) DEFAULT ''",
        "pdf_progress_current": "ALTER TABLE books ADD COLUMN pdf_progress_current INTEGER DEFAULT 0",
        "pdf_progress_total": "ALTER TABLE books ADD COLUMN pdf_progress_total INTEGER DEFAULT 0",
        "source_rebuild_status": "ALTER TABLE books ADD COLUMN source_rebuild_status VARCHAR(32) NOT NULL DEFAULT 'legacy_unavailable'",
    },
    "user_progress": {
        "progress_percentage": "ALTER TABLE user_progress ADD COLUMN progress_percentage FLOAT DEFAULT 0.0",
    },
    "run_lexemes": {
        "excluded_from_learning_target": (
            "ALTER TABLE run_lexemes ADD COLUMN "
            "excluded_from_learning_target BOOLEAN NOT NULL DEFAULT 0"
        ),
    },
    "user_lexeme_knowledge": {
        "note": "ALTER TABLE user_lexeme_knowledge ADD COLUMN note TEXT",
    },
    "lexeme_occurrences": {
        "reader_token_index": (
            "ALTER TABLE lexeme_occurrences ADD COLUMN "
            "reader_token_index INTEGER"
        ),
    },
}


SQLITE_ADDITIVE_TABLE_MIGRATIONS: dict[str, tuple[str, ...]] = {
    "chapter_progress": (
        """
        CREATE TABLE IF NOT EXISTS chapter_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id VARCHAR(32) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
            chapter_index INTEGER NOT NULL,
            current_segment_index INTEGER NOT NULL DEFAULT 0,
            progress_percentage FLOAT NOT NULL DEFAULT 0.0,
            state VARCHAR(16) NOT NULL DEFAULT 'in_progress',
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT ck_chapter_progress_segment_nonnegative
                CHECK (current_segment_index >= 0),
            CONSTRAINT ck_chapter_progress_percentage_range
                CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
            CONSTRAINT ck_chapter_progress_state
                CHECK (state IN ('in_progress', 'completed')),
            CONSTRAINT uq_chapter_progress_book_chapter
                UNIQUE (book_id, chapter_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_chapter_progress_book_id ON chapter_progress(book_id)",
        "CREATE INDEX IF NOT EXISTS ix_chapter_progress_chapter_id ON chapter_progress(chapter_id)",
        "CREATE INDEX IF NOT EXISTS ix_chapter_progress_chapter_index ON chapter_progress(chapter_index)",
    ),
    # Base.metadata.create_all handles new databases. This explicit CREATE is
    # also needed by upgrade tests and by existing SQLite files initialized
    # before the Phase 5 model was present.
    "reader_lookup_events": (
        """
        CREATE TABLE IF NOT EXISTS reader_lookup_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id VARCHAR(32) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
            chapter_index INTEGER NOT NULL,
            analysis_run_id INTEGER REFERENCES analysis_runs(id) ON DELETE SET NULL,
            lexeme_id INTEGER REFERENCES lexemes(id) ON DELETE SET NULL,
            run_lexeme_id INTEGER REFERENCES run_lexemes(id) ON DELETE SET NULL,
            surface TEXT NOT NULL,
            query_text TEXT NOT NULL,
            reader_segment_index INTEGER NOT NULL,
            reader_token_index INTEGER NOT NULL,
            source_document_id VARCHAR(255),
            source_start INTEGER,
            source_end INTEGER,
            source_token_index INTEGER,
            event_type VARCHAR(64) NOT NULL DEFAULT 'reader_dictionary_lookup',
            client_event_id VARCHAR(128) NOT NULL UNIQUE,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT ck_reader_lookup_event_reader_coordinates
                CHECK (chapter_index >= 0 AND reader_segment_index >= 0 AND reader_token_index >= 0),
            CONSTRAINT ck_reader_lookup_event_source_coordinates
                CHECK (
                    (source_start IS NULL AND source_end IS NULL)
                    OR (source_start >= 0 AND source_end > source_start)
                ),
            CONSTRAINT ck_reader_lookup_event_type
                CHECK (event_type = 'reader_dictionary_lookup')
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_reader_lookup_events_book_id ON reader_lookup_events(book_id)",
        "CREATE INDEX IF NOT EXISTS ix_reader_lookup_events_lexeme_id ON reader_lookup_events(lexeme_id)",
        "CREATE INDEX IF NOT EXISTS ix_reader_lookup_events_analysis_run_id ON reader_lookup_events(analysis_run_id)",
        "CREATE INDEX IF NOT EXISTS ix_reader_lookup_events_client_event_id ON reader_lookup_events(client_event_id)",
    ),
}


def apply_sqlite_additive_migrations(target_engine: Engine) -> int:
    """
    对现有 SQLite 库执行轻量级补列迁移。

    仅处理本地工具场景下的向后兼容补列，避免老库升级后因缺列直接崩溃。
    """
    if target_engine.url.get_backend_name() != "sqlite":
        return 0

    applied_count = 0
    with target_engine.begin() as conn:
        for table_name, statements in SQLITE_ADDITIVE_TABLE_MIGRATIONS.items():
            existing_table = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name = :table_name"),
                {"table_name": table_name},
            ).fetchone()
            if existing_table:
                continue

            logger.warning("Applying SQLite compatibility migration: table=%s", table_name)
            conn.execute(text(statements[0]))
            for statement in statements[1:]:
                conn.execute(text(statement))
            applied_count += 1

        for table_name, column_statements in SQLITE_ADDITIVE_MIGRATIONS.items():
            existing_tables = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name = :table_name"),
                {"table_name": table_name}
            ).fetchone()
            if not existing_tables:
                continue

            existing_columns = {
                row[1]
                for row in conn.execute(text(f"PRAGMA table_info('{table_name}')")).fetchall()
            }

            for column_name, statement in column_statements.items():
                if column_name in existing_columns:
                    continue

                logger.warning(
                    "Applying SQLite compatibility migration: table=%s column=%s",
                    table_name,
                    column_name,
                )
                conn.execute(text(statement))
                applied_count += 1

        # Legacy versions stored only one book-level resume cursor. Preserve
        # that cursor in the new chapter view when it contains an actual
        # reading position. This is intentionally idempotent and excludes
        # untouched 0% cursors, so migration does not manufacture checkpoints
        # for every historical chapter.
        if all(
            conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name = :table_name"),
                {"table_name": table_name},
            ).fetchone()
            for table_name in ("user_progress", "chapters", "chapter_progress")
        ):
            backfilled = conn.execute(
                text(
                    """
                    INSERT INTO chapter_progress (
                        book_id,
                        chapter_id,
                        chapter_index,
                        current_segment_index,
                        progress_percentage,
                        state,
                        updated_at
                    )
                    SELECT
                        progress.book_id,
                        chapter.id,
                        chapter."index",
                        COALESCE(progress.current_segment_index, 0),
                        COALESCE(progress.progress_percentage, 0.0),
                        'in_progress',
                        COALESCE(progress.updated_at, CURRENT_TIMESTAMP)
                    FROM user_progress AS progress
                    JOIN chapters AS chapter
                      ON chapter.book_id = progress.book_id
                     AND chapter."index" = progress.current_chapter_index
                    WHERE (
                        COALESCE(progress.current_segment_index, 0) > 0
                        OR COALESCE(progress.progress_percentage, 0.0) > 0
                    )
                      AND NOT EXISTS (
                        SELECT 1
                        FROM chapter_progress AS checkpoint
                        WHERE checkpoint.book_id = progress.book_id
                          AND checkpoint.chapter_id = chapter.id
                    )
                    """
                )
            )
            applied_count += max(backfilled.rowcount or 0, 0)

    return applied_count

def init_db():
    """初始化数据库表结构"""
    Base.metadata.create_all(bind=engine)
    applied_migrations = apply_sqlite_additive_migrations(engine)
    print(f"Database initialized at {DB_PATH}")
    if applied_migrations:
        print(f"Applied SQLite compatibility migrations: {applied_migrations}")

def get_db():
    """FastAPI 依赖项：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def check_db_connection() -> bool:
    """检查数据库连接是否正常"""
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        print("Database connection OK")
        return True
    except Exception as e:
        print(f"Database connection failed: {e}")
        return False
    finally:
        db.close()
