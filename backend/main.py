# main.py
import uvicorn
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, check_db_connection
from app.config import (
    DATA_DIR, UPLOAD_DIR, STATIC_URL_PREFIX, HOST, PORT,
    CORS_ALLOWED_ORIGINS, CORS_ALLOW_CREDENTIALS, TEMP_UPLOAD_DIR,
    LOG_LEVEL, LLMConfig
)
import os


def _setup_logging():
    """配置日志级别"""
    logging.basicConfig(
        level=LOG_LEVEL,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时
    print("=" * 50)
    print("EbookToTextbook API 启动中...")
    print("=" * 50)

    # 配置日志
    _setup_logging()
    init_db()
    check_db_connection()

    # 确保必要的目录存在
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)

    # 打印配置信息
    print(f"后端地址: http://{HOST}:{PORT}")
    print(f"数据目录: {DATA_DIR}")
    print(f"CORS 允许源: {', '.join(CORS_ALLOWED_ORIGINS)}")
    print(f"LLM 模型: {LLMConfig.MODEL}")
    print(f"LLM API: {'已配置' if LLMConfig.API_KEY else '未配置'}")
    print("-" * 50)

    # 预热词典服务（可选，首次请求会自动初始化）
    print("预热词典服务...")
    from app.services.dictionary_service import DictionaryService
    DictionaryService()._jmd  # 触发线程局部实例创建
    print("词典服务就绪")
    print("=" * 50)

    yield

    # 关闭时
    print("Shutting down...")


# 创建 FastAPI 应用
app = FastAPI(
    title="EbookToTextbook API",
    description="LLM-empowered Japanese light novel reader and learning platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS 配置（从配置读取）
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件服务
app.mount(
    STATIC_URL_PREFIX,
    StaticFiles(directory=DATA_DIR),
    name="static"
)

# 注册路由
from app.routers import books, vocabularies, highlights, dictionary, ai, config
app.include_router(books.router)
app.include_router(vocabularies.router)
app.include_router(highlights.router)
app.include_router(dictionary.router)
app.include_router(ai.router)
app.include_router(config.router)

# 健康检查
@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "ok"}


@app.get("/")
async def root():
    """根路径"""
    return {
        "message": "EbookToTextbook API",
        "docs": "/docs",
        "health": "/health",
        "config": "/api/config"
    }


def main():
    """开发服务器启动入口"""
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=True,  # 开发模式自动重载
        log_level=LOG_LEVEL.lower(),
    )


if __name__ == "__main__":
    main()
