# app/services/highlight_service.py
import logging
from typing import List, Optional
from sqlalchemy.orm import Session, selectinload
from fastapi import HTTPException, status

from app.models import UserHighlight, Book, Chapter, ArchiveItem
from app.schemas import HighlightCreate, AIAnalysisUpdate

logger = logging.getLogger(__name__)


class HighlightService:
    def __init__(self, db: Session):
        self.db = db

    def create_highlight(self, data: HighlightCreate) -> UserHighlight:
        """
        创建划线

        Args:
            data: 划线创建数据

        Returns:
            UserHighlight: 创建的划线记录

        Raises:
            HTTPException(404): 书籍或章节不存在
        """
        # 1. 验证书籍存在
        book = self.db.query(Book).filter(Book.id == data.book_id).first()
        if not book:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Book not found"
            )

        # 2. 验证章节存在
        chapter = self.db.query(Chapter).filter(
            Chapter.book_id == data.book_id,
            Chapter.index == data.chapter_index
        ).first()
        if not chapter:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chapter not found"
            )

        # 3. 创建划线记录
        highlight = UserHighlight(
            book_id=data.book_id,
            chapter_index=data.chapter_index,
            start_segment_index=data.start_segment_index,
            start_token_idx=data.start_token_idx,
            end_segment_index=data.end_segment_index,
            end_token_idx=data.end_token_idx,
            style_category=data.style_category,
            selected_text=data.selected_text
        )

        self.db.add(highlight)
        self.db.commit()
        self.db.refresh(highlight)

        logger.info(
            f"Created highlight: id={highlight.id}, "
            f"book_id={data.book_id}, chapter={data.chapter_index}"
        )

        return highlight

    def delete_highlight(self, highlight_id: int) -> bool:
        """
        删除划线

        Args:
            highlight_id: 划线记录 ID

        Returns:
            bool: 删除成功返回 True

        Raises:
            HTTPException(404): 划线不存在
        """
        highlight = self.db.query(UserHighlight).filter(
            UserHighlight.id == highlight_id
        ).first()

        if not highlight:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Highlight not found"
            )

        self.db.delete(highlight)
        self.db.commit()

        logger.info(f"Deleted highlight: id={highlight_id}")
        return True

    def get_highlight(self, highlight_id: int) -> Optional[UserHighlight]:
        """
        获取单个划线记录

        Args:
            highlight_id: 划线记录 ID

        Returns:
            UserHighlight | None
        """
        return self.db.query(UserHighlight)\
            .options(selectinload(UserHighlight.archive))\
            .filter(UserHighlight.id == highlight_id)\
            .first()

    def get_book_highlights(
        self,
        book_id: str,
        chapter_index: Optional[int] = None
    ) -> List[UserHighlight]:
        """
        获取书籍的划线列表

        注意：返回 ORM 对象列表，FastAPI 会在路由层自动转换为 HighlightResponse
        (因为 HighlightResponse.Config.from_attributes = True)

        Args:
            book_id: 书籍 ID
            chapter_index: 可选，筛选指定章节的划线

        Returns:
            List[UserHighlight]: 划线列表 (ORM 对象)
        """
        query = self.db.query(UserHighlight)\
            .options(selectinload(UserHighlight.archive))\
            .filter(UserHighlight.book_id == book_id)

        if chapter_index is not None:
            query = query.filter(UserHighlight.chapter_index == chapter_index)

        return query.all()

    def get_chapter_highlights(
        self,
        book_id: str,
        chapter_index: int
    ) -> List[UserHighlight]:
        """
        获取特定章节的高亮列表（ORM 对象）

        Args:
            book_id: 书籍 ID
            chapter_index: 章节索引

        Returns:
            List[UserHighlight]: 本章节的高亮列表
        """
        return self.db.query(UserHighlight)\
            .options(selectinload(UserHighlight.archive))\
            .filter(
                UserHighlight.book_id == book_id,
                UserHighlight.chapter_index == chapter_index
            )\
            .all()

    def save_ai_analysis(
        self,
        highlight_id: int,
        analysis_data: AIAnalysisUpdate
    ) -> ArchiveItem:
        """
        保存或更新划线的 AI 分析到积累本

        Args:
            highlight_id: 划线记录 ID
            analysis_data: AI 分析数据

        Returns:
            ArchiveItem: 更新后的积累本条目

        Raises:
            HTTPException(404): 划线不存在
        """
        # 1. 验证划线存在
        highlight = self.db.query(UserHighlight).filter(
            UserHighlight.id == highlight_id
        ).first()

        if not highlight:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Highlight not found"
            )

        # 2. 获取或创建 ArchiveItem
        archive = highlight.archive
        if not archive:
            archive = ArchiveItem(highlight_id=highlight_id)
            self.db.add(archive)

        # 3. 将 AI 分析数据转为 JSON 字符串存储
        archive.ai_analysis = analysis_data.model_dump_json(exclude_none=True) # type: ignore

        self.db.commit()
        self.db.refresh(archive)

        logger.info(f"Saved AI analysis for highlight: {highlight_id}")
        return archive

    def get_archive_item(self, highlight_id: int) -> Optional[ArchiveItem]:
        """
        获取划线对应的积累本条目

        Args:
            highlight_id: 划线记录 ID

        Returns:
            ArchiveItem | None: 积累本条目（如果存在）
        """
        return self.db.query(ArchiveItem).filter(
            ArchiveItem.highlight_id == highlight_id
        ).first()
