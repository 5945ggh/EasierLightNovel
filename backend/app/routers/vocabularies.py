# app/routers/vocabularies.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import VocabularyCreate, VocabularyResponse
from app.services.vocabulary_service import VocabularyService

router = APIRouter(prefix="/api/vocabularies", tags=["Vocabularies"])


# ================= 依赖注入 =================
def get_vocabulary_service(db: Session = Depends(get_db)) -> VocabularyService:
    """
    依赖注入：将 DB Session 注入 Service
    """
    return VocabularyService(db)


# ================= 生词管理接口 =================
@router.post("", response_model=VocabularyResponse, status_code=status.HTTP_201_CREATED)
def add_vocabulary(
    data: VocabularyCreate,
    vocabulary_service: VocabularyService = Depends(get_vocabulary_service)
):
    """
    添加生词到生词本

    **约束**：同一本书 + 同一个 base_form 只记录一次
    - 如果已存在，返回已存在的记录（不重复创建）
    - 如果不存在，创建新记录

    **请求体示例**:
    ```json
    {
      "book_id": "abc123",
      "word": "食べる",
      "reading": "たべる",
      "base_form": "食べる",
      "part_of_speech": "動詞"
    }
    ```
    """
    return vocabulary_service.add_vocabulary(
        book_id=data.book_id,
        data=data
    )


# ================= 查询接口 =================
# 注意：更具体的路由（如 /book/{book_id}）必须放在通配路由（如 /{vocabulary_id}）之前

@router.get("/book/{book_id}", response_model=List[VocabularyResponse])
def get_book_vocabularies(
    book_id: str,
    vocabulary_service: VocabularyService = Depends(get_vocabulary_service)
):
    """
    获取书籍的生词列表（完整数据）

    **路径参数**:
    - book_id: 书籍 ID

    **性能注意**:
    此接口返回完整的生词记录（包含 word, reading, definition, status 等所有字段）。
    如果前端仅需要渲染"是否为生词"的高亮样式，应优先使用更轻量的接口：
    - GET /api/books/{book_id}/vocabularies/base_forms

    仅在需要显示生词本详情（如释义、学习状态等）时使用此接口。
    """
    return vocabulary_service.get_book_vocabularies(book_id)


@router.get("/{vocabulary_id}", response_model=VocabularyResponse)
def get_vocabulary(
    vocabulary_id: int,
    vocabulary_service: VocabularyService = Depends(get_vocabulary_service)
):
    """
    获取单个生词记录

    **路径参数**:
    - vocabulary_id: 生词记录 ID
    """
    vocabulary = vocabulary_service.get_vocabulary(vocabulary_id)
    if not vocabulary:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vocabulary not found"
        )
    return vocabulary


# ================= 删除接口 =================
@router.delete("/{vocabulary_id}")
def delete_vocabulary(
    vocabulary_id: int,
    vocabulary_service: VocabularyService = Depends(get_vocabulary_service)
):
    """
    删除生词

    **路径参数**:
    - vocabulary_id: 生词记录 ID

    **响应**: `{"ok": true}`
    """
    vocabulary_service.delete_vocabulary(vocabulary_id)
    return {"ok": True}
