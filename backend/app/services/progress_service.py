# app/services/progress_service.py
import logging
from typing import Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models import UserProgress, Book
from app.schemas import UserProgressUpdate

logger = logging.getLogger(__name__)


class ProgressService:
    def __init__(self, db: Session):
        self.db = db

    def get_progress(self, book_id: str) -> UserProgress:
        """
        获取书籍的阅读进度

        如果没有进度记录，创建并返回默认进度（全为 0）

        Args:
            book_id: 书籍 ID

        Returns:
            UserProgress: 进度记录

        Raises:
            HTTPException(404): 书籍不存在
        """
        # 1. 验证书籍存在
        book = self.db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Book not found"
            )

        # 2. 查找现有进度
        progress = self.db.query(UserProgress).filter(
            UserProgress.book_id == book_id
        ).first()

        # 3. 如果不存在，创建默认进度
        if not progress:
            progress = UserProgress(
                book_id=book_id,
                current_chapter_index=0,
                current_segment_index=0,
                current_segment_offset=0
            )
            self.db.add(progress)
            self.db.commit()
            self.db.refresh(progress)
            logger.info(f"Created default progress for book: {book_id}")

        return progress

    def update_progress(self, book_id: str, data: UserProgressUpdate) -> UserProgress:
        """
        更新书籍的阅读进度

        如果没有进度记录，创建新记录

        Args:
            book_id: 书籍 ID
            data: 更新数据

        Returns:
            UserProgress: 更新后的进度记录

        Raises:
            HTTPException(404): 书籍不存在
        """
        # 1. 验证书籍存在
        book = self.db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Book not found"
            )

        # 2. 查找现有进度
        progress = self.db.query(UserProgress).filter(
            UserProgress.book_id == book_id
        ).first()

        if progress:
            # 更新现有记录
            progress.current_chapter_index = data.current_chapter_index # type: ignore
            progress.current_segment_index = data.current_segment_index # type: ignore
            progress.current_segment_offset = data.current_segment_offset # type: ignore
        else:
            # 创建新记录
            progress = UserProgress(
                book_id=book_id,
                current_chapter_index=data.current_chapter_index,
                current_segment_index=data.current_segment_index,
                current_segment_offset=data.current_segment_offset
            )
            self.db.add(progress)

        self.db.commit()
        self.db.refresh(progress)

        logger.debug(
            f"Updated progress for book {book_id}: "
            f"chapter={data.current_chapter_index}, "
            f"segment={data.current_segment_index}, "
            f"offset={data.current_segment_offset}"
        )

        return progress