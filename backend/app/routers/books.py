# routers/books.py
from typing import List
from datetime import datetime
import os
from fastapi import APIRouter, Depends, UploadFile, File, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from schemas import BookListItem, BookDetail, ChapterListItem, ChapterResponse, BookUpdate
from services.book_service import BookService
from models import Chapter, Book, UserProgress # 仅用于查询

router = APIRouter(prefix="/api/books", tags=["Books"])

# ================= 依赖注入 =================
def get_book_service(db: Session = Depends(get_db)) -> BookService:
    """
    依赖注入：将 DB Session 注入 Service，
    并把 Service 实例注入 Router。
    """
    return BookService(db)

@router.post("/upload", response_model=BookDetail) 
async def upload_book( # TODO: 解析过程中前端页面显示加载在解析结束后不会自动结束，需手动刷新, 在前端需要写一个 Hooks 或者逻辑来处理这个“等待”的过程。
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    book_service: BookService = Depends(get_book_service)
):
    """上传并开始解析书籍"""
    if not file.filename or not file.filename.lower().endswith('.epub'):
        raise HTTPException(status_code=400, detail="Only .epub files are supported")
    
    return await book_service.create_book_from_file(file, background_tasks)

@router.get("/", response_model=List[BookListItem])
def list_books(skip: int = 0, limit: int = 100, book_service: BookService = Depends(get_book_service)):
    """获取书架列表"""
    return book_service.get_books(skip, limit)

@router.get("/{book_id}", response_model=BookDetail)
def get_book_detail(book_id: str, book_service: BookService = Depends(get_book_service)):
    """获取单本书详情"""
    book = book_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return book