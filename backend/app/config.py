# app/config.py
# 统一配置管理
# 环境变量配置见项目根目录 .env 文件
import os
from pathlib import Path
from typing import Set, Dict

# ==================== 基础路径 ====================
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = os.getenv("DATA_DIR", str(BASE_DIR / "static_data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "books")
TEMP_UPLOAD_DIR = os.getenv("TEMP_UPLOAD_DIR", str(BASE_DIR / "backend" / "temp_uploads"))
STATIC_URL_PREFIX = "/static"

# ==================== 数据库 ====================
DB_PATH = os.path.join(DATA_DIR, "library.db")
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DB_PATH}"
)

# ==================== 服务器 ====================
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8010))

# ==================== CORS ====================
CORS_ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000"
).split(",")
CORS_ALLOW_CREDENTIALS = True

# ==================== 文件上传 ====================
UPLOAD_MAX_FILE_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", str(50 * 1024 * 1024)))  # 50MB
UPLOAD_ALLOWED_COVER_TYPES: Set[str] = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
UPLOAD_ALLOWED_BOOK_TYPES: Set[str] = {'.epub'}

# ==================== EPUB 解析 ====================
EPUB_MAX_TITLE_LENGTH = int(os.getenv("EPUB_MAX_TITLE_LENGTH", "32"))
EPUB_MAX_CHUNK_SIZE = int(os.getenv("EPUB_MAX_CHUNK_SIZE", "2048"))

# ==================== 分词 ====================
TOKENIZER_DEFAULT_MODE = os.getenv("TOKENIZER_MODE", "B")  # A=短, B=中(推荐), C=长

# ==================== 词典 ====================
DICTIONARY_CACHE_SIZE = int(os.getenv("DICT_CACHE_SIZE", "4096"))
DICTIONARY_MEMORY_MODE = False
DICTIONARY_LOAD_KANJI_DICT = False

# ==================== AI 分析 ====================
class LLMConfig:
    """LLM 相关配置统一管理"""
    MODEL = os.getenv("MAIN_MODEL_NAME", "deepseek/deepseek-chat")
    API_KEY = os.getenv("LLM_API_KEY")
    BASE_URL = os.getenv("LLM_BASE_URL")
    TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))

    # AI 分析长度限制
    AI_MAX_TARGET_LENGTH = int(os.getenv("AI_MAX_TARGET_LENGTH", "512"))
    AI_MAX_CONTEXT_LENGTH = int(os.getenv("AI_MAX_CONTEXT_LENGTH", "2048"))

    @classmethod
    def supports_json_mode(cls) -> bool:
        """判断模型是否支持 OpenAI 风格的 JSON Mode"""
        return cls.MODEL.startswith(("gpt-", "o1-", "o3-"))

    @classmethod
    def supports_thinking(cls) -> bool:
        """判断模型是否支持 Thinking/Reasoning"""
        return "claude-3-7" in cls.MODEL or "reasoner" in cls.MODEL

# ==================== 数据查询 ====================
QUERY_DEFAULT_LIMIT = int(os.getenv("QUERY_DEFAULT_LIMIT", "100"))
QUERY_MAX_LIMIT = int(os.getenv("QUERY_MAX_LIMIT", "500"))

# ==================== 划线样式 ====================
HIGHLIGHT_STYLE_CATEGORIES: Dict[str, Dict[str, str]] = {
    "default": {"color": "#3b82f6", "name": "默认"},
    "vocab":   {"color": "#eab308", "name": "生词"},
    "grammar": {"color": "#ef4444", "name": "语法"},
    "favorite":{"color": "#ec4899", "name": "收藏"},
}

# ==================== 日志 ====================
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
