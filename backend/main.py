# main.py
import uvicorn
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, check_db_connection
from app.config import (
    BASE_DIR, DATA_DIR, UPLOAD_DIR, STATIC_URL_PREFIX, HOST, PORT,
    CORS_ALLOWED_ORIGINS, CORS_ALLOW_CREDENTIALS, TEMP_UPLOAD_DIR,
    LOG_LEVEL, LLMConfig
)
import os

# 确保必要的目录存在
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)

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

# 挂载数据文件服务（/static）
app.mount(
    STATIC_URL_PREFIX,
    StaticFiles(directory=DATA_DIR),
    name="static"
)

# 挂载前端构建文件（生产环境）
frontend_dist = BASE_DIR / "web" / "dist"
frontend_built = frontend_dist.exists()

if frontend_built:
    print(f"[Frontend] 检测到前端构建文件: {frontend_dist}")

    # 1. 挂载 /assets (Vite 构建的默认静态资源目录)
    assets_dir = frontend_dist / "assets"
    if assets_dir.exists():
        app.mount(
            "/assets",
            StaticFiles(directory=assets_dir),
            name="frontend-assets"
        )
        print(f"[Frontend] 已挂载 /assets -> {assets_dir}")

    # 2. 自动挂载 dist 根目录下的其他静态文件和目录
    # 避免运行时进行 file.exists() 的阻塞调用
    for item in frontend_dist.iterdir():
        if item.name in ("assets", "index.html"):
            continue

        if item.is_dir():
            # 如果是目录（例如 /locales），挂载它
            app.mount(
                f"/{item.name}",
                StaticFiles(directory=item),
                name=f"frontend-{item.name}"
            )
            print(f"[Frontend] 已挂载 /{item.name}/ -> {item}")
        elif item.is_file():
            # 如果是根目录文件（例如 favicon.ico），创建一个直接的路由
            file_path = item
            file_name = item.name

            @app.get(f"/{file_name}", include_in_schema=False)
            async def serve_static_file(file_path=file_path):
                return FileResponse(file_path)

            print(f"[Frontend] 已注册 /{file_name} -> {file_path}")

# 注册 API 路由（必须在 SPA fallback 之前）
from app.routers import books, vocabularies, highlights, dictionary, ai, config
from fastapi.responses import FileResponse
from fastapi import APIRouter
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


if frontend_built:
    # SPA 入口和 catch-all
    # 注意：必须在所有路由之后定义，确保 API 路由优先匹配
    @app.get("/", include_in_schema=False)
    async def serve_spa_root():
        """SPA 入口"""
        return FileResponse(frontend_dist / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa_catchall(full_path: str):
        """SPA catch-all: 处理前端路由"""
        # 关键：这个路由只会匹配未被其他路由处理的请求
        # 因为 FastAPI 按路由定义顺序匹配，更具体的路由（如 /api/books）会优先匹配
        return FileResponse(frontend_dist / "index.html")

    print("[Frontend] SPA 路由已注册（含 catch-all）")
else:
    # 前端未构建：根路径返回 API 信息
    @app.get("/")
    async def serve_root():
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
        # reload=True,  # 开发模式自动重载
        log_level=LOG_LEVEL.lower(),
    )


if __name__ == "__main__":
    main()
