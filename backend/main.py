# main.py
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, check_db_connection
from app.config import DATA_DIR, UPLOAD_DIR, STATIC_URL_PREFIX, HOST, PORT
import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时
    print("Starting up...")
    init_db()
    check_db_connection()

    # 确保必要的目录存在
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs("./temp_uploads", exist_ok=True)

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

# CORS 配置（允许前端访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Vite/React 默认端口
    allow_credentials=True,
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
from app.routers import books, vocabularies, highlights, dictionary
app.include_router(books.router)
app.include_router(vocabularies.router)
app.include_router(highlights.router)
app.include_router(dictionary.router)

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
        "health": "/health"
    }


def main():
    """开发服务器启动入口"""
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=True,  # 开发模式自动重载
    )


if __name__ == "__main__":
    main()
