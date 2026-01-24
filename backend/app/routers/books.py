# routers/books.py
from typing import List
import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import BookListItem, BookDetail, BookUpdate
from app.services.book_service import BookService
from app.config import UPLOAD_DIR

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

@router.patch("/{book_id}", response_model=BookDetail)
def update_book_metadata(
    book_id: str,
    book_update: BookUpdate,
    book_service: BookService = Depends(get_book_service)
):
    """
    修改书籍元信息 (标题, 作者, 封面URL)
    使用 PATCH 方法进行部分更新
    注意：如果要上传封面图片，请使用 POST /api/books/{book_id}/cover
    """
    book = book_service.update_book(book_id=book_id, update_data=book_update)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return book

@router.post("/{book_id}/cover", response_model=BookDetail)
async def upload_book_cover(
    book_id: str,
    file: UploadFile = File(...),
    book_service: BookService = Depends(get_book_service)
):
    """
    上传书籍封面图片
    文件会被保存到 static_data/books/{book_id}/images/ 目录
    数据库中的 cover_url 会被更新为相对URL(/static/books/{book_id}/images/xxx.png)
    """
    # 1. 检查书籍是否存在
    book = book_service.get_book(book_id=book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # 2. 验证文件类型
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # 检查文件扩展名
    allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    # 3. 构建保存路径
    images_dir = os.path.join(UPLOAD_DIR, book_id, "images")
    os.makedirs(images_dir, exist_ok=True)

    # 4. 生成唯一文件名（防止冲突）
    unique_filename = f"cover_{uuid.uuid4().hex[:8]}{file_ext}"
    save_path = os.path.join(images_dir, unique_filename)

    # 5. 保存文件
    try:
        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # 6. 更新数据库（通过 Service 层）
    # 存储相对路径: /static/books/{book_id}/images/{filename}
    cover_url = f"/static/books/{book_id}/images/{unique_filename}"
    book = book_service.update_book(
        book_id=book_id,
        update_data=BookUpdate(cover_url=cover_url)
    )

    return book