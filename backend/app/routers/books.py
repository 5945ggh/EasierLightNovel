# routers/books.py
from typing import List, Optional
import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, BackgroundTasks, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import (
    UPLOAD_DIR, TEMP_UPLOAD_DIR,
    UPLOAD_ALLOWED_BOOK_TYPES, UPLOAD_ALLOWED_COVER_TYPES,
    QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT
)
from app.schemas import (
    BookListItem, BookDetail, BookUpdate,
    ChapterListItem, ChapterResponse, ChapterHighlightData,
    VocabularyBaseFormsResponse,
    UserProgressResponse, UserProgressUpdate,
    HighlightResponse
)
from app.services.book_service import BookService
from app.services.progress_service import ProgressService
from app.services.highlight_service import HighlightService
from app.models import Chapter

router = APIRouter(prefix="/api/books", tags=["Books"])

# ================= 依赖注入 =================
def get_book_service(db: Session = Depends(get_db)) -> BookService:
    """
    依赖注入：将 DB Session 注入 Service，
    并把 Service 实例注入 Router。
    """
    return BookService(db)

def get_progress_service(db: Session = Depends(get_db)) -> ProgressService:
    """
    依赖注入：将 DB Session 注入 ProgressService
    """
    return ProgressService(db)

def get_highlight_service(db: Session = Depends(get_db)) -> HighlightService:
    """
    依赖注入：将 DB Session 注入 HighlightService
    """
    return HighlightService(db)


@router.post("/upload", response_model=BookDetail)
async def upload_book( 
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    book_service: BookService = Depends(get_book_service)
):
    """上传并开始解析书籍"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in UPLOAD_ALLOWED_BOOK_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Only {UPLOAD_ALLOWED_BOOK_TYPES} files are supported"
        )

    return await book_service.create_book_from_file(file, background_tasks)

@router.get("", response_model=List[BookListItem])
def list_books(
    skip: int = 0,
    limit: int = Query(default=QUERY_DEFAULT_LIMIT, le=QUERY_MAX_LIMIT),
    book_service: BookService = Depends(get_book_service)
):
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
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in UPLOAD_ALLOWED_COVER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(UPLOAD_ALLOWED_COVER_TYPES)}"
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

@router.delete("/{book_id}")
def delete_book(book_id: str, book_service: BookService = Depends(get_book_service)):
    """删除书籍"""
    success = book_service.delete_book(book_id)
    if not success:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"ok": True}

@router.get("/{book_id}/toc", response_model=List[ChapterListItem])
def get_table_of_contents(book_id: str, book_service: BookService = Depends(get_book_service)):
    """获取书籍目录（章节列表，不含正文）"""
    # 检查书籍是否存在
    book = book_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # 获取章节列表
    chapters = book_service.get_chapters(book_id)

    # 转换为 ChapterListItem（只包含 index 和 title）
    return [
        ChapterListItem(index=ch.index, title=ch.title) #type: ignore
        for ch in chapters
    ]

@router.get("/{book_id}/chapters/{chapter_index}", response_model=ChapterResponse)
def get_chapter_content(
    book_id: str,
    chapter_index: int,
    book_service: BookService = Depends(get_book_service),
    highlight_service: HighlightService = Depends(get_highlight_service)
):
    """
    获取特定章节的完整内容（含分词数据）

    同时返回本章节的高亮数据，前端可以根据坐标渲染高亮样式
    """
    # 1. 获取章节内容
    chapter = book_service.get_chapter_content(book_id, chapter_index)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # 2. 获取本章节高亮
    highlights = highlight_service.get_chapter_highlights(book_id, chapter_index)

    # 3. 构造响应
    return ChapterResponse(
        index=chapter.index,  # type: ignore
        title=chapter.title,  # type: ignore
        segments=chapter.content_json,  # type: ignore
        highlights=highlights, # type: ignore  已经设置ChapterHighlightData.Config.from_attributes = True
    )

@router.get("/{book_id}/vocabularies/base_forms", response_model=VocabularyBaseFormsResponse)
def get_vocabularies_base_forms(
    book_id: str,
    book_service: BookService = Depends(get_book_service)
):
    """
    获取书籍的生词原型集合（全书范围）

    用途：进入阅读器时调用一次，前端存入全局状态
    渲染时根据 token.base_form 是否在集合中来判断是否为生词
    """
    # 检查书籍是否存在
    book = book_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    base_forms = book_service.get_vocabularies_base_forms(book_id)

    return VocabularyBaseFormsResponse(base_forms=base_forms)


# ================= 阅读进度接口 =================
@router.get("/{book_id}/progress", response_model=UserProgressResponse)
def get_reading_progress(
    book_id: str,
    progress_service: ProgressService = Depends(get_progress_service)
):
    """
    获取书籍的阅读进度

    如果没有进度记录，返回默认值（全为 0）

    **响应字段**:
    - book_id: 书籍 ID
    - current_chapter_index: 当前章节索引
    - current_segment_index: 当前章节内的段落索引
    - progress_percentage: 当前章节内的滚动百分比 (0-100)
    - updated_at: 更新时间
    """
    return progress_service.get_progress(book_id)

@router.put("/{book_id}/progress", response_model=UserProgressResponse)
def update_reading_progress(
    book_id: str,
    data: UserProgressUpdate,
    progress_service: ProgressService = Depends(get_progress_service)
):
    """
    更新书籍的阅读进度

    **请求体示例**:
    ```json
    {
      "current_chapter_index": 5,
      "current_segment_index": 12,
      "progress_percentage": 45.67
    }
    ```

    **字段说明**:
    - `current_chapter_index`: 当前章节索引
    - `current_segment_index`: 当前章节内的段落索引（用于快速定位）
    - `progress_percentage`: 当前章节内的滚动百分比 (0-100)，用于精确恢复滚动位置

    **位置恢复逻辑**:
    1. 跳转到 `current_chapter_index` 指定的章节
    2. 滚动到 `progress_percentage` 位置
    3. `current_segment_index` 作为备用/验证

    如果没有进度记录，会自动创建新记录
    """
    return progress_service.update_progress(book_id, data)


# ================= 划线接口 =================


@router.get("/{book_id}/highlights", response_model=List[HighlightResponse])
def get_book_highlights(
    book_id: str,
    chapter_index: Optional[int] = Query(None, description="筛选指定章节的划线"),
    highlight_service: HighlightService = Depends(get_highlight_service),
    book_service: BookService = Depends(get_book_service)
):
    """
    获取书籍的划线列表

    **路径参数**:
    - book_id: 书籍 ID

    **查询参数**:
    - chapter_index: 可选，筛选指定章节的划线

    **响应**: 划线记录列表，包含坐标和样式信息
    """
    # 验证书籍存在
    book = book_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    return highlight_service.get_book_highlights(book_id, chapter_index)
