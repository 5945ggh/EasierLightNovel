# database.py
import os
from sqlalchemy import create_engine, text
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

def init_db():
    """初始化数据库表结构"""
    Base.metadata.create_all(bind=engine)
    print(f"Database initialized at {DB_PATH}")

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