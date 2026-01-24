# app/services/vocabulary_service.py
import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.models import Vocabulary, Book
from app.schemas import VocabularyCreate

logger = logging.getLogger(__name__)


class VocabularyService:
    def __init__(self, db: Session):
        self.db = db

    def add_vocabulary(self, book_id: str, data: VocabularyCreate) -> Vocabulary:
        """
        添加生词到生词本

        约束：同一本书 + 同一个 base_form 只记录一次
        如果已存在，返回已存在的记录

        Args:
            book_id: 书籍 ID
            data: 生词创建数据

        Returns:
            Vocabulary: 创建或已存在的生词记录

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

        # 2. 检查是否已存在（同书 + 同原型）
        existing = self.db.query(Vocabulary).filter(
            Vocabulary.book_id == book_id,
            Vocabulary.base_form == data.base_form
        ).first()

        if existing:
            logger.info(f"Vocabulary already exists: book_id={book_id}, base_form={data.base_form}")
            return existing

        # 3. 创建新生词记录
        new_vocabulary = Vocabulary(
            book_id=book_id,
            word=data.word,
            reading=data.reading,
            base_form=data.base_form,
            part_of_speech=data.part_of_speech,
            status=0,  # 新学
            definition=None,
            next_review_at=None,
            context_sentences=None
        )

        self.db.add(new_vocabulary)
        self.db.commit()
        self.db.refresh(new_vocabulary)

        logger.info(f"Added vocabulary: book_id={book_id}, base_form={data.base_form}")
        return new_vocabulary

    def delete_vocabulary(self, vocabulary_id: int) -> bool:
        """
        删除生词

        Args:
            vocabulary_id: 生词记录 ID

        Returns:
            bool: 删除成功返回 True

        Raises:
            HTTPException(404): 生词不存在
        """
        vocabulary = self.db.query(Vocabulary).filter(
            Vocabulary.id == vocabulary_id
        ).first()

        if not vocabulary:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Vocabulary not found"
            )

        self.db.delete(vocabulary)
        self.db.commit()

        logger.info(f"Deleted vocabulary: id={vocabulary_id}")
        return True

    def get_vocabulary(self, vocabulary_id: int) -> Optional[Vocabulary]:
        """
        获取单个生词记录

        Args:
            vocabulary_id: 生词记录 ID

        Returns:
            Vocabulary | None
        """
        return self.db.query(Vocabulary).filter(
            Vocabulary.id == vocabulary_id
        ).first()
