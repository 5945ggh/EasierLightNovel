# app/config.py
# 统一配置管理
# 配置优先级: 环境变量 > config/user.json > 代码默认值
import os
import json
from pathlib import Path
from typing import Set, Dict, Any

# ==================== 基础路径 ====================
BASE_DIR = Path(__file__).resolve().parent.parent.parent


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

    # 2. 检查 user.json（每次重新读取，避免热重载时丢失）
    user_config = _load_user_config()
    if user_config:
        keys = key.split(".")
        value = user_config
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


def _get_cors_origins() -> list[str]:
    """获取 CORS 允许的 origins 列表"""
    # 1. 从环境变量获取（最高优先级）
    env_origins = os.getenv("CORS_ORIGINS")
    if env_origins:
        return env_origins.split(",")

    # 2. 从 user.json 读取 cors.allowed_origins
    user_origins = _get_config("cors.allowed_origins", None)
    if user_origins and isinstance(user_origins, list):
        return user_origins

    # 3. 默认值
    return ["http://localhost:5173", "http://127.0.0.1:5173"]


# ==================== 路径配置 ====================
def _resolve_path(path: str) -> str:
    """解析路径: 相对路径基于 BASE_DIR, 绝对路径直接返回"""
    if os.path.isabs(path):
        return path
    return str(BASE_DIR / path)


def _get_data_dir() -> str:
    """获取数据目录"""
    # 优先级: 环境变量 > user.json > 默认值
    if "DATA_DIR" in os.environ:
        return _resolve_path(os.environ["DATA_DIR"])
    user_path = _get_config("paths.data_dir", "static_data")
    return _resolve_path(user_path)


def _get_temp_upload_dir() -> str:
    """获取临时上传目录"""
    if "TEMP_UPLOAD_DIR" in os.environ:
        return _resolve_path(os.environ["TEMP_UPLOAD_DIR"])
    user_path = _get_config("paths.temp_upload_dir", "backend/temp_uploads")
    return _resolve_path(user_path)


DATA_DIR = _get_data_dir()
UPLOAD_DIR = os.path.join(DATA_DIR, "books")
TEMP_UPLOAD_DIR = _get_temp_upload_dir()
STATIC_URL_PREFIX = "/static"

# ==================== 数据库 ====================
DB_PATH = os.path.join(DATA_DIR, "library.db")
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DB_PATH}"
)

# ==================== 服务器 ====================
HOST = _get_config("backend.host", "0.0.0.0", "HOST")
PORT = int(_get_config("backend.port", 8010, "PORT"))

# ==================== CORS ====================
CORS_ALLOWED_ORIGINS = _get_cors_origins()
CORS_ALLOW_CREDENTIALS = True

# ==================== 文件上传 ====================
UPLOAD_MAX_FILE_SIZE = int(_get_config("upload.max_file_size", 50 * 1024 * 1024, "MAX_UPLOAD_SIZE"))
UPLOAD_ALLOWED_COVER_TYPES: Set[str] = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
UPLOAD_ALLOWED_BOOK_TYPES: Set[str] = {'.epub'}

# ==================== EPUB 解析 ====================
EPUB_MAX_TITLE_LENGTH = int(_get_config("epub.max_title_length", 32, "EPUB_MAX_TITLE_LENGTH"))
EPUB_MAX_CHUNK_SIZE = int(_get_config("epub.max_chunk_size", 1024, "EPUB_MAX_CHUNK_SIZE"))

# ==================== 分词 ====================
TOKENIZER_DEFAULT_MODE: str = _get_config("tokenizer.mode", "B", "TOKENIZER_MODE")

# ==================== 词典 ====================
DICTIONARY_CACHE_SIZE = int(_get_config("dictionary.cache_size", 4096, "DICT_CACHE_SIZE"))
DICTIONARY_MEMORY_MODE = bool(_get_config("dictionary.memory_mode", False))
DICTIONARY_LOAD_KANJI_DICT = bool(_get_config("dictionary.load_kanji_dict", False))

# 词典数据库路径（可选，为空则使用 jamdict 默认路径）
DICTIONARY_DB_PATH = _get_config("dictionary.db_path", None)

# 首选语言列表（按优先级排序）: "eng"=英语, "chn"=中文, "fre"=法语, "ger"=德语, "rus"=俄语, "slv"=斯洛文尼亚语
DICTIONARY_PREFERRED_LANGUAGES: list[str] = _get_config("dictionary.preferred_languages", ["chn", "eng"])

# 是否显示所有语言（false 则只显示 preferred_languages 中的语言）
DICTIONARY_SHOW_ALL_LANGUAGES = bool(_get_config("dictionary.show_all_languages", True))

# ==================== AI 分析 ====================
class LLMConfig:
    """LLM 相关配置统一管理"""
    MODEL = _get_config("llm.model", "deepseek/deepseek-chat", "MAIN_MODEL_NAME")
    API_KEY = _get_config("llm.api_key", None, "LLM_API_KEY")
    BASE_URL = _get_config("llm.base_url", "https://api.deepseek.com", "LLM_BASE_URL")
    TEMPERATURE = float(_get_config("llm.temperature", 0.2, "LLM_TEMPERATURE"))

    # AI 分析长度限制
    AI_MAX_TARGET_LENGTH = int(_get_config("llm.max_target_length", 512, "AI_MAX_TARGET_LENGTH"))
    AI_MAX_CONTEXT_LENGTH = int(_get_config("llm.max_context_length", 2048, "AI_MAX_CONTEXT_LENGTH"))

    @classmethod
    def supports_json_mode(cls) -> bool:
        """判断模型是否支持 OpenAI 风格的 JSON Mode"""
        return cls.MODEL.startswith(("gpt-", "o1-", "o3-"))

    @classmethod
    def supports_thinking(cls) -> bool:
        """判断模型是否支持 Thinking/Reasoning"""
        return "claude-3-7" in cls.MODEL or "reasoner" in cls.MODEL

# ==================== 数据查询 ====================
QUERY_DEFAULT_LIMIT = int(_get_config("query.default_limit", 100, "QUERY_DEFAULT_LIMIT"))
QUERY_MAX_LIMIT = int(_get_config("query.max_limit", 500, "QUERY_MAX_LIMIT"))

# ==================== 划线样式 ====================
HIGHLIGHT_STYLE_CATEGORIES: Dict[str, Dict[str, str]] = {
    "blue": {"color": "#3b82f6", "name": "Adachi"},
    "yellow": {"color": "#efbe2b", "name": "Shimamura"},
    "red": {"color": "#de5454", "name": "Kita"},
    "pink": {"color": "#e8559f", "name": "Bocchi"},
    "deep": {"color": "#9d2626", "name": "书签"},
}

# ==================== 日志 ====================
LOG_LEVEL = _get_config("logging.level", "INFO", "LOG_LEVEL")
