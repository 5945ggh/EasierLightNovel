# app/routers/vocabularies.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import VocabularyCreate, VocabularyResponse, VocabularyBaseFormsResponse
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

