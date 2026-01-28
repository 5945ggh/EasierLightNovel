# app/config.py
# 统一配置管理
# 配置优先级: 环境变量 > config/user.json > 代码默认值
import os
import json
from pathlib import Path
from typing import Set, Dict, Any

# ==================== 基础路径 ====================
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = os.getenv("DATA_DIR", str(BASE_DIR / "static_data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "books")
TEMP_UPLOAD_DIR = os.getenv("TEMP_UPLOAD_DIR", str(BASE_DIR / "backend" / "temp_uploads"))
STATIC_URL_PREFIX = "/static"


# ==================== 用户配置文件 ====================
def _load_user_config() -> Dict[str, Any]:
    """加载用户配置文件 config/user.json（如果存在）"""
    config_path = BASE_DIR / "config" / "user.json"
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Failed to load user config from {config_path}: {e}")
    return {}


_USER_CONFIG = _load_user_config()


def _get_config(key: str, default: Any = None, env_var: str = "") -> Any:
    """
    获取配置值，优先级：环境变量 > user.json > 默认值

    Args:
        key: user.json 中的键路径（点分隔，如 "backend.port"）
        default: 默认值
        env_var: 环境变量名
    """
    # 1. 优先检查环境变量
    if env_var and env_var in os.environ:
        return os.environ[env_var]

    # 2. 检查 user.json
    if _USER_CONFIG:
        keys = key.split(".")
        value = _USER_CONFIG
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                value = None
                break
        if value is not None:
            return value

    # 3. 返回默认值
    return default


# ==================== 数据库 ====================
DB_PATH = os.path.join(DATA_DIR, "library.db")
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DB_PATH}"
)

# ==================== 服务器 ====================
# 优先级: 环境变量 > user.json > 默认值
HOST = _get_config("backend.host", "0.0.0.0", "HOST")
PORT = int(_get_config("backend.port", 8010, "PORT"))

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
