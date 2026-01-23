# app/core/config.py
# 可选配置env: 
# "DATA_DIR" - 资源文件(解析后书籍的图片, 上传的封面, ...) 
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