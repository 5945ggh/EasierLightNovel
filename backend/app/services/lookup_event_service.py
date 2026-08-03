"""Persist deliberate Reader dictionary lookup facts and derive observations."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.enums import AnalysisRunStatus
from app.models import (
    AnalysisRun,
    Book,
    Chapter,
    LexemeOccurrence,
    ReaderLookupEvent,
    RunLexeme,
)
from app.services.user_lexeme_knowledge_service import UserLexemeKnowledgeService


class LookupEventBookNotFound(ValueError):
    """The lookup event references a book that does not exist."""


class LookupEventChapterNotFound(ValueError):
    """The lookup event references a chapter that does not exist in the book."""


class LookupEventConflict(ValueError):
    """The client event id conflicts with an existing immutable event."""


class LookupEventService:
    """Own the append-only Reader lookup event contract."""

    def __init__(self, db: Session):
        self.db = db

    def record_reader_lookup(
        self,
        book_id: str,
        *,
        client_event_id: str,
        chapter_index: int,
        reader_segment_index: int,
        reader_token_index: int,
        surface: str,
        query_text: str,
        event_type: str = "reader_dictionary_lookup",
        source_document_id: Optional[str] = None,
        source_start: Optional[int] = None,
        source_end: Optional[int] = None,
        source_token_index: Optional[int] = None,
    ) -> dict[str, Any]:
        """Append one event, returning an existing row for an idempotent retry.

        The active run is selected inside this write transaction. Mapping is
        accepted only when the supplied reader coordinates or complete source
        coordinates identify exactly one occurrence with the same surface.
        """
        existing = self.db.query(ReaderLookupEvent).filter(
            ReaderLookupEvent.client_event_id == client_event_id,
        ).one_or_none()
        if existing is not None:
            self._assert_idempotent_retry(
                existing,
                book_id=book_id,
                chapter_index=chapter_index,
                reader_segment_index=reader_segment_index,
                reader_token_index=reader_token_index,
                surface=surface,
                query_text=query_text,
                event_type=event_type,
                source_document_id=source_document_id,
                source_start=source_start,
                source_end=source_end,
                source_token_index=source_token_index,
            )
            return self.serialize_event(existing)

        book = self.db.get(Book, book_id)
        if book is None:
            raise LookupEventBookNotFound(f"Book not found: {book_id}")

        chapter = self.db.query(Chapter).filter(
            Chapter.book_id == book_id,
            Chapter.index == chapter_index,
        ).one_or_none()
        if chapter is None:
            raise LookupEventChapterNotFound(
                f"Chapter {chapter_index} not found in book {book_id}"
            )

        run = self._active_run(book_id)
        occurrence = self._resolve_occurrence(
            run,
            chapter_id=chapter.id,
            reader_segment_index=reader_segment_index,
            reader_token_index=reader_token_index,
            surface=surface,
            source_document_id=source_document_id,
            source_start=source_start,
            source_end=source_end,
            source_token_index=source_token_index,
        )

        occurrence_row, run_lexeme = occurrence or (None, None)
        event = ReaderLookupEvent(
            book_id=book_id,
            chapter_id=chapter.id,
            chapter_index=chapter_index,
            analysis_run_id=run.id if run is not None else None,
            lexeme_id=run_lexeme.lexeme_id if run_lexeme is not None else None,
            run_lexeme_id=run_lexeme.id if run_lexeme is not None else None,
            surface=surface,
            query_text=query_text,
            reader_segment_index=reader_segment_index,
            reader_token_index=reader_token_index,
            source_document_id=(
                occurrence_row.source_document_id
                if occurrence_row is not None
                else source_document_id
            ),
            source_start=(
                occurrence_row.source_start
                if occurrence_row is not None
                else source_start
            ),
            source_end=(
                occurrence_row.source_end
                if occurrence_row is not None
                else source_end
            ),
            source_token_index=(
                occurrence_row.source_token_index
                if occurrence_row is not None
                else source_token_index
            ),
            event_type=event_type,
            client_event_id=client_event_id,
        )
        self.db.add(event)
        try:
            self.db.flush()
        except IntegrityError:
            # A concurrent retry may win the unique client-event insert.
            self.db.rollback()
            existing = self.db.query(ReaderLookupEvent).filter(
                ReaderLookupEvent.client_event_id == client_event_id,
            ).one_or_none()
            if existing is not None:
                self._assert_idempotent_retry(
                    existing,
                    book_id=book_id,
                    chapter_index=chapter_index,
                    reader_segment_index=reader_segment_index,
                    reader_token_index=reader_token_index,
                    surface=surface,
                    query_text=query_text,
                    event_type=event_type,
                    source_document_id=source_document_id,
                    source_start=source_start,
                    source_end=source_end,
                    source_token_index=source_token_index,
                )
                return self.serialize_event(existing)
            raise LookupEventConflict(
                f"Client event id is already used: {client_event_id}"
            )

        self.db.commit()
        self.db.refresh(event)
        return self.serialize_event(event)

    @staticmethod
    def _assert_idempotent_retry(
        existing: ReaderLookupEvent,
        *,
        book_id: str,
        chapter_index: int,
        reader_segment_index: int,
        reader_token_index: int,
        surface: str,
        query_text: str,
        event_type: str,
        source_document_id: Optional[str],
        source_start: Optional[int],
        source_end: Optional[int],
        source_token_index: Optional[int],
    ) -> None:
        immutable_fields = {
            "book_id": book_id,
            "chapter_index": chapter_index,
            "reader_segment_index": reader_segment_index,
            "reader_token_index": reader_token_index,
            "surface": surface,
            "query_text": query_text,
            "event_type": event_type,
        }
        if any(getattr(existing, field) != value for field, value in immutable_fields.items()):
            raise LookupEventConflict(
                f"Client event id already belongs to a different lookup: {existing.client_event_id}"
            )

        # Source fields may have been filled from a proven occurrence on the
        # first request, so only compare source values explicitly supplied by
        # this retry.
        explicit_source_fields = {
            "source_document_id": source_document_id,
            "source_start": source_start,
            "source_end": source_end,
            "source_token_index": source_token_index,
        }
        if any(
            value is not None and getattr(existing, field) != value
            for field, value in explicit_source_fields.items()
        ):
            raise LookupEventConflict(
                f"Client event id already belongs to a different source lookup: {existing.client_event_id}"
            )

    def serialize_event(self, event: ReaderLookupEvent) -> dict[str, Any]:
        return {
            "id": event.id,
            "client_event_id": event.client_event_id,
            "book_id": event.book_id,
            "chapter_id": event.chapter_id,
            "chapter_index": event.chapter_index,
            "analysis_run_id": event.analysis_run_id,
            "lexeme_id": event.lexeme_id,
            "run_lexeme_id": event.run_lexeme_id,
            "surface": event.surface,
            "query_text": event.query_text,
            "reader_segment_index": event.reader_segment_index,
            "reader_token_index": event.reader_token_index,
            "source_document_id": event.source_document_id,
            "source_start": event.source_start,
            "source_end": event.source_end,
            "source_token_index": event.source_token_index,
            "event_type": event.event_type,
            "mapping_status": "resolved" if event.lexeme_id is not None else "unresolved",
            "created_at": event.created_at,
        }

    def get_learning_map_observations(
        self,
        book_id: str,
        run: AnalysisRun,
        canonical_lexeme_ids: set[int],
    ) -> dict[int, dict[str, Any]]:
        """Return fact-only lookup observations keyed by current canonical id."""
        if not canonical_lexeme_ids:
            return {}

        knowledge_service = UserLexemeKnowledgeService(self.db)
        grouped_events: dict[int, list[ReaderLookupEvent]] = defaultdict(list)
        for event in self.db.query(ReaderLookupEvent).join(
            AnalysisRun,
            AnalysisRun.id == ReaderLookupEvent.analysis_run_id,
        ).filter(
            ReaderLookupEvent.book_id == book_id,
            ReaderLookupEvent.lexeme_id.is_not(None),
            AnalysisRun.book_id == book_id,
            AnalysisRun.source_content_version_id == run.source_content_version_id,
        ).order_by(
            ReaderLookupEvent.created_at,
            ReaderLookupEvent.id,
        ).all():
            canonical_id = knowledge_service.resolve_canonical_lexeme(event.lexeme_id).id  # type: ignore[arg-type]
            if canonical_id in canonical_lexeme_ids:
                grouped_events[canonical_id].append(event)

        if not grouped_events:
            return {}

        occurrences_by_lexeme: dict[int, list[tuple[tuple[Any, ...], LexemeOccurrence]]] = defaultdict(list)
        rows = self.db.query(LexemeOccurrence, RunLexeme).join(
            RunLexeme,
            RunLexeme.id == LexemeOccurrence.run_lexeme_id,
        ).filter(
            LexemeOccurrence.analysis_run_id == run.id,
        ).all()
        for occurrence, run_lexeme in rows:
            canonical_id = knowledge_service.resolve_canonical_lexeme(run_lexeme.lexeme_id).id
            if canonical_id in grouped_events:
                occurrences_by_lexeme[canonical_id].append((
                    self._occurrence_location(occurrence),
                    occurrence,
                ))
        for values in occurrences_by_lexeme.values():
            values.sort(key=lambda value: value[0])

        observations: dict[int, dict[str, Any]] = {}
        for canonical_id, events in grouped_events.items():
            first = events[0]
            last = events[-1]
            observations[canonical_id] = {
                "lookup_count": len(events),
                "first_lookup": self._serialize_lookup_position(first),
                "last_lookup": self._serialize_lookup_position(last),
                "occurrences_after_first_lookup": self._count_occurrences_after(
                    first,
                    run,
                    occurrences_by_lexeme[canonical_id],
                ),
                "occurrences_after_last_lookup": self._count_occurrences_after(
                    last,
                    run,
                    occurrences_by_lexeme[canonical_id],
                ),
                "later_lookup_count_after_first": max(0, len(events) - 1),
            }
        return observations

    def _active_run(self, book_id: str) -> Optional[AnalysisRun]:
        return self.db.query(AnalysisRun).filter(
            AnalysisRun.book_id == book_id,
            AnalysisRun.is_active.is_(True),
            AnalysisRun.status == AnalysisRunStatus.COMPLETED,
        ).one_or_none()

    def _resolve_occurrence(
        self,
        run: Optional[AnalysisRun],
        *,
        chapter_id: int,
        reader_segment_index: int,
        reader_token_index: int,
        surface: str,
        source_document_id: Optional[str],
        source_start: Optional[int],
        source_end: Optional[int],
        source_token_index: Optional[int],
    ) -> Optional[tuple[LexemeOccurrence, RunLexeme]]:
        if run is None:
            return None

        base_query = self.db.query(LexemeOccurrence, RunLexeme).join(
            RunLexeme,
            RunLexeme.id == LexemeOccurrence.run_lexeme_id,
        ).filter(
            LexemeOccurrence.analysis_run_id == run.id,
            LexemeOccurrence.chapter_id == chapter_id,
        )

        has_source_coordinates = (
            source_document_id is not None
            and source_start is not None
            and source_end is not None
        )
        if has_source_coordinates:
            candidates = base_query.filter(
                LexemeOccurrence.source_document_id == source_document_id,
                LexemeOccurrence.source_start == source_start,
                LexemeOccurrence.source_end == source_end,
            )
            if source_token_index is not None:
                candidates = candidates.filter(
                    LexemeOccurrence.source_token_index == source_token_index,
                )
        else:
            candidates = base_query.filter(
                LexemeOccurrence.reader_segment_index == reader_segment_index,
                LexemeOccurrence.reader_token_index == reader_token_index,
            )

        matches = [
            (occurrence, run_lexeme)
            for occurrence, run_lexeme in candidates.all()
            if occurrence.surface == surface
            and (
                occurrence.reader_segment_index is None
                or occurrence.reader_segment_index == reader_segment_index
            )
            and (
                occurrence.reader_token_index is None
                or occurrence.reader_token_index == reader_token_index
            )
        ]
        return matches[0] if len(matches) == 1 else None

    def _serialize_lookup_position(self, event: ReaderLookupEvent) -> dict[str, Any]:
        return {
            "chapter_index": event.chapter_index,
            "reader_segment_index": event.reader_segment_index,
            "reader_token_index": event.reader_token_index,
            "created_at": event.created_at,
        }

    def _count_occurrences_after(
        self,
        event: ReaderLookupEvent,
        run: AnalysisRun,
        occurrences: list[tuple[tuple[Any, ...], LexemeOccurrence]],
    ) -> Optional[int]:
        location = self._event_location_for_run(event, run)
        if location is None:
            return None
        return sum(occurrence_location > location for occurrence_location, _ in occurrences)

    def _event_location_for_run(
        self,
        event: ReaderLookupEvent,
        run: AnalysisRun,
    ) -> Optional[tuple[Any, ...]]:
        if (
            event.source_document_id is None
            or event.source_start is None
            or event.source_end is None
        ):
            return None
        if event.analysis_run_id == run.id:
            return self._event_location(event)

        historical_run = (
            self.db.get(AnalysisRun, event.analysis_run_id)
            if event.analysis_run_id is not None
            else None
        )
        if (
            historical_run is None
            or historical_run.source_content_version_id != run.source_content_version_id
        ):
            return None
        return self._event_location(event)

    @staticmethod
    def _event_location(event: ReaderLookupEvent) -> tuple[Any, ...]:
        return (
            event.chapter_index,
            event.source_document_id or "",
            event.source_start if event.source_start is not None else -1,
            event.source_end if event.source_end is not None else -1,
            event.source_token_index if event.source_token_index is not None else -1,
        )

    @staticmethod
    def _occurrence_location(occurrence: LexemeOccurrence) -> tuple[Any, ...]:
        return (
            occurrence.chapter_index,
            occurrence.source_document_id,
            occurrence.source_start,
            occurrence.source_end,
            occurrence.source_token_index,
        )
