# app/services/progress_service.py
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Book, Chapter, ChapterProgress, UserProgress
from app.schemas import ChapterProgressUpdate, UserProgressUpdate

logger = logging.getLogger(__name__)


class ProgressService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _now() -> datetime:
        """Use a client-independent timestamp with sub-second precision."""
        return datetime.now(timezone.utc)

    def _get_book_or_404(self, book_id: str) -> Book:
        book = self.db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Book not found",
            )
        return book

    def _get_chapter_or_404(self, book_id: str, chapter_index: int) -> Chapter:
        chapter = self.db.query(Chapter).filter(
            Chapter.book_id == book_id,
            Chapter.index == chapter_index,
        ).first()
        if not chapter:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chapter {chapter_index} not found in book {book_id}",
            )
        return chapter

    def get_progress(self, book_id: str) -> UserProgress:
        """Return the book cursor without creating a default database row."""
        self._get_book_or_404(book_id)
        progress = self.db.query(UserProgress).filter(
            UserProgress.book_id == book_id,
        ).first()
        if progress is not None:
            return progress

        # FastAPI's response model can serialize this transient object. It is
        # intentionally never added to the session, so GET remains read-only.
        return UserProgress(
            book_id=book_id,
            current_chapter_index=0,
            current_segment_index=0,
            progress_percentage=0.0,
        )

    def _upsert_chapter_progress(
        self,
        book_id: str,
        chapter: Chapter,
        data: ChapterProgressUpdate,
        timestamp: datetime,
    ) -> ChapterProgress:
        checkpoint = self.db.query(ChapterProgress).filter(
            ChapterProgress.book_id == book_id,
            ChapterProgress.chapter_id == chapter.id,
        ).first()
        if checkpoint is None:
            checkpoint = ChapterProgress(
                book_id=book_id,
                chapter_id=chapter.id,
            )
            self.db.add(checkpoint)

        checkpoint.chapter_index = chapter.index  # type: ignore
        checkpoint.current_segment_index = data.current_segment_index  # type: ignore
        checkpoint.progress_percentage = data.progress_percentage  # type: ignore
        checkpoint.state = data.state  # type: ignore
        checkpoint.updated_at = timestamp  # type: ignore
        return checkpoint

    def update_progress(self, book_id: str, data: UserProgressUpdate) -> UserProgress:
        """Atomically update the book cursor and the current chapter checkpoint."""
        self._get_book_or_404(book_id)
        chapter = self._get_chapter_or_404(book_id, data.current_chapter_index)
        timestamp = self._now()

        progress = self.db.query(UserProgress).filter(
            UserProgress.book_id == book_id,
        ).first()
        if progress is None:
            progress = UserProgress(book_id=book_id)
            self.db.add(progress)

        progress.current_chapter_index = data.current_chapter_index  # type: ignore
        progress.current_segment_index = data.current_segment_index  # type: ignore
        progress.progress_percentage = data.progress_percentage  # type: ignore
        progress.updated_at = timestamp  # type: ignore

        # This is the confirmed-reading path used by the legacy PUT API. Both
        # records are flushed and committed together.
        self._upsert_chapter_progress(
            book_id=book_id,
            chapter=chapter,
            data=ChapterProgressUpdate(
                current_segment_index=data.current_segment_index,
                progress_percentage=data.progress_percentage,
                state=data.state,
            ),
            timestamp=timestamp,
        )

        self.db.commit()
        self.db.refresh(progress)
        logger.debug(
            "Updated book/chapter progress for %s: chapter=%s segment=%s progress=%s%%",
            book_id,
            data.current_chapter_index,
            data.current_segment_index,
            data.progress_percentage,
        )
        return progress

    def get_chapter_progress(self, book_id: str) -> list[ChapterProgress]:
        """Return only persisted checkpoints in current chapter order."""
        self._get_book_or_404(book_id)
        return self.db.query(ChapterProgress).join(
            Chapter, Chapter.id == ChapterProgress.chapter_id,
        ).filter(
            ChapterProgress.book_id == book_id,
            Chapter.book_id == book_id,
        ).order_by(Chapter.index.asc(), ChapterProgress.id.asc()).all()

    def update_chapter_progress(
        self,
        book_id: str,
        chapter_index: int,
        data: ChapterProgressUpdate,
    ) -> ChapterProgress:
        """Upsert one checkpoint without changing UserProgress."""
        self._get_book_or_404(book_id)
        chapter = self._get_chapter_or_404(book_id, chapter_index)
        checkpoint = self._upsert_chapter_progress(
            book_id=book_id,
            chapter=chapter,
            data=data,
            timestamp=self._now(),
        )
        self.db.commit()
        self.db.refresh(checkpoint)
        return checkpoint
