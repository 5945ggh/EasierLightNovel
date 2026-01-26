# app/routers/highlights.py
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import HighlightCreate, HighlightResponse, AIAnalysisUpdate, ArchiveItemResponse
from app.services.highlight_service import HighlightService

router = APIRouter(prefix="/api/highlights", tags=["Highlights"])


# ================= 依赖注入 =================
def get_highlight_service(db: Session = Depends(get_db)) -> HighlightService:
    """
    依赖注入：将 DB Session 注入 Service
    """
    return HighlightService(db)


# ================= 划线管理接口 =================
@router.post("", response_model=HighlightResponse, status_code=status.HTTP_201_CREATED)
def create_highlight(
    data: HighlightCreate,
    highlight_service: HighlightService = Depends(get_highlight_service)
):
    """
    创建划线

    **请求体示例**:
    ```json
    {
      "book_id": "abc123",
      "chapter_index": 5,
      "start_segment_index": 10,
      "start_token_idx": 3,
      "end_segment_index": 10,
      "end_token_idx": 8,
      "style_category": "vocab",
      "selected_text": "食べる"
    }
    ```

    **样式分类**:
    - `default`: 默认（蓝色）
    - `vocab`: 生词（黄色）
    - `grammar`: 语法点（红色）
    - `favorite`: 收藏（粉色）
    """
    return highlight_service.create_highlight(data)


@router.delete("/{highlight_id}")
def delete_highlight(
    highlight_id: int,
    highlight_service: HighlightService = Depends(get_highlight_service)
):
    """
    删除划线

    **路径参数**:
    - highlight_id: 划线记录 ID

    **响应**: `{"ok": true}`
    """
    highlight_service.delete_highlight(highlight_id)
    return {"ok": True}


@router.get("/{highlight_id}", response_model=HighlightResponse)
def get_highlight(
    highlight_id: int,
    highlight_service: HighlightService = Depends(get_highlight_service)
):
    """
    获取单个划线记录

    **路径参数**:
    - highlight_id: 划线记录 ID
    """
    highlight = highlight_service.get_highlight(highlight_id)
    if not highlight:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Highlight not found"
        )
    return highlight


# ================= 积累本接口 =================
@router.put("/{highlight_id}/ai-analysis", response_model=ArchiveItemResponse, status_code=status.HTTP_200_OK)
def save_ai_analysis(
    highlight_id: int,
    data: AIAnalysisUpdate,
    highlight_service: HighlightService = Depends(get_highlight_service)
):
    """
    保存或更新划线的 AI 分析到积累本

    **请求体示例**:
    ```json
    {
      "translation": "中文翻译",
      "grammar_analysis": [
        {
          "target_text": "原文片段",
          "pattern": "～てしまう",
          "level": "N4",
          "explanation": "表示动作完成的遗憾"
        }
      ],
      "vocabulary_nuance": [
        {
          "target_text": "食べた",
          "base_form": "食べる",
          "conjugation": "タ形",
          "nuance": "表示已经吃过的状态"
        }
      ],
      "cultural_notes": "这里有一个双关语..."
    }
    ```
    """
    return highlight_service.save_ai_analysis(highlight_id, data)


@router.get("/{highlight_id}/archive", response_model=ArchiveItemResponse)
def get_archive_item(
    highlight_id: int,
    highlight_service: HighlightService = Depends(get_highlight_service)
):
    """
    获取划线对应的积累本条目

    **路径参数**:
    - highlight_id: 划线记录 ID

    **响应**:
    - 如果存在积累本条目，返回详情
    - 如果不存在，返回 404
    """
    archive = highlight_service.get_archive_item(highlight_id)
    if not archive:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Archive item not found"
        )
    return archive
