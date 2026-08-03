# database.py
import os
import logging
from sqlalchemy import create_engine, text
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
