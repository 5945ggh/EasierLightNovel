# app/core/config.py
# 可选配置env:
# "DATA_DIR" - 资源文件(解析后书籍的图片, 上传的封面, ...)
# "PORT" - 服务器端口
import os
from pathlib import Path

# 项目根目录
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# 数据目录
DATA_DIR = os.getenv("DATA_DIR", str(BASE_DIR / "static_data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "books")  # 书籍文件存储目录
STATIC_URL_PREFIX = "/static"  # 静态文件 URL 前缀

# 数据库路径
DB_PATH = os.path.join(DATA_DIR, "library.db")

# 数据库 URL
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DB_PATH}"
)

# 服务器配置
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8010))


# ==================== LLM 配置 ====================
class LLMConfig:
    """LLM 相关配置统一管理"""
    MODEL = os.getenv("MAIN_MODEL_NAME", "deepseek/deepseek-chat")
    API_KEY = os.getenv("LLM_API_KEY")
    BASE_URL = os.getenv("LLM_BASE_URL")
    TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))

    @classmethod
    def supports_json_mode(cls) -> bool:
        """判断模型是否支持 OpenAI 风格的 JSON Mode"""
        return cls.MODEL.startswith(("gpt-", "o1-", "o3-"))

    @classmethod
    def supports_thinking(cls) -> bool:
        """判断模型是否支持 Thinking/Reasoning"""
        return "claude-3-7" in cls.MODEL or "reasoner" in cls.MODEL