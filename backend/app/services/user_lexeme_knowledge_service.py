"""User-owned knowledge state for canonical Lexeme identities."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import AnalysisRun, Lexeme, RunLexeme, UserLexemeKnowledge, Vocabulary
from app.utils.lexeme_identity import normalize_canonical_reading, normalize_identity_text


LEGACY_MASTERED_STATUS = 3
KNOWLEDGE_STATES = {"learning", "known", "ignored"}
MANUAL_SOURCE = "manual"
LEGACY_SOURCE = "legacy_vocabulary"


class UserLexemeKnowledgeNotFound(ValueError):
    """Raised when a lexeme id does not exist."""


class UserLexemeKnowledgeConflict(ValueError):
    """Raised when a request cannot be resolved safely."""


def _normalize_identity_text(value: str) -> str:
    return normalize_identity_text(value)


def _normalize_reading(value: Optional[str]) -> Optional[str]:
    return normalize_canonical_reading(value)


class UserLexemeKnowledgeService:
    """Create and query the single-user knowledge baseline."""

    def __init__(self, db: Session):
        self.db = db

    def resolve_canonical_lexeme(self, lexeme_id: int) -> Lexeme:
        lexeme = self.db.get(Lexeme, lexeme_id)
        if lexeme is None:
            raise UserLexemeKnowledgeNotFound(f"Lexeme not found: {lexeme_id}")

        seen: set[int] = set()
        current = lexeme
        while current.merged_into_id is not None:
            if current.id in seen:
                raise UserLexemeKnowledgeConflict(f"Lexeme merge cycle includes {current.id}")
            seen.add(current.id)
            next_lexeme = self.db.get(Lexeme, current.merged_into_id)
            if next_lexeme is None:
                raise UserLexemeKnowledgeConflict(
                    f"Lexeme {current.id} points to missing merge target {current.merged_into_id}"
                )
            current = next_lexeme
        return current

    def set_manual_state(
        self,
        lexeme_id: int,
        state: str,
        *,
        note: Optional[str] = None,
    ) -> dict[str, Any]:
        if state not in KNOWLEDGE_STATES:
            raise UserLexemeKnowledgeConflict(f"Invalid knowledge state: {state}")

        canonical = self.resolve_canonical_lexeme(lexeme_id)
        if state == "known" and canonical.is_provisional:
            raise UserLexemeKnowledgeConflict(
                "Provisional lexemes cannot be marked known manually"
            )
        row = self._upsert_row(canonical.id, state, source=MANUAL_SOURCE, note=note)
        self.db.commit()
        self.db.refresh(row)
        return self._serialize_row(row, requested_lexeme_id=lexeme_id)

    def delete_manual_state(self, lexeme_id: int) -> bool:
        canonical = self.resolve_canonical_lexeme(lexeme_id)
        rows = [
            row
            for row in self._knowledge_rows_by_terminal_id({canonical.id})[canonical.id]
            if row.source == MANUAL_SOURCE
        ]
        if not rows:
            return False
        for row in rows:
            self.db.delete(row)
        self.db.commit()
        return True

    def get_index(self, lexeme_ids: list[int]) -> list[dict[str, Any]]:
        if not lexeme_ids:
            return []
        canonical_by_requested = {
            lexeme_id: self.resolve_canonical_lexeme(lexeme_id).id
            for lexeme_id in lexeme_ids
        }
        rows_by_lexeme_id = self._knowledge_rows_by_terminal_id(
            set(canonical_by_requested.values())
        )
        result = []
        for requested_id in lexeme_ids:
            canonical_id = canonical_by_requested[requested_id]
            row = self._effective_row(rows_by_lexeme_id.get(canonical_id, []))
            if row is not None:
                result.append(self._serialize_row(
                    row,
                    requested_lexeme_id=requested_id,
                    canonical_lexeme=self.db.get(Lexeme, canonical_id),
                ))
        return result

    def effective_states(self, lexeme_ids: set[int]) -> dict[int, str]:
        """Return only explicit effective states, keyed by final canonical id."""
        if not lexeme_ids:
            return {}
        canonical_ids = {self.resolve_canonical_lexeme(lexeme_id).id for lexeme_id in lexeme_ids}
        by_canonical = self._knowledge_rows_by_terminal_id(canonical_ids)
        return {
            lexeme_id: effective.state
            for lexeme_id, source_rows in by_canonical.items()
            if (effective := self._effective_row(source_rows)) is not None
        }

    def summarize_book_baseline(
        self,
        book_id: str,
        *,
        run_id: Optional[int] = None,
        migrate_legacy: bool = False,
    ) -> dict[str, Any]:
        summary = self.effective_known_lexeme_ids(
            book_id,
            run_id=run_id,
            migrate_legacy=migrate_legacy,
        )[1]
        return summary

    def effective_known_lexeme_ids(
        self,
        book_id: str,
        *,
        run_id: Optional[int] = None,
        migrate_legacy: bool = False,
    ) -> tuple[set[int], dict[str, Any]]:
        """Return canonical known Lexeme ids for a book/run baseline.

        This is the intended integration point for learning-map calculations.
        If ``migrate_legacy`` is true, unambiguous legacy mastered vocabulary
        rows for the active run are inserted as ``known`` with source
        ``legacy_vocabulary``. Existing manual rows are never overwritten.
        """
        run = self._active_run(book_id, run_id)
        legacy_mapping = self._map_legacy_mastered_rows(book_id, run.id) if run else {
            "known_ids": set(),
            "mastered_count": 0,
            "mapped_count": 0,
            "unmapped_count": 0,
            "migration_status": "none",
        }

        migration_result = {
            "created_count": 0,
            "updated_count": 0,
            "preserved_manual_count": 0,
        }
        if migrate_legacy and run is not None:
            migration_result = self._migrate_legacy_ids(legacy_mapping["known_ids"])
            self.db.commit()

        scoped_lexeme_ids = self._run_canonical_lexeme_ids(run.id) if run else set()
        state_counts = {
            "known": 0,
            "learning": 0,
            "ignored": 0,
        }
        source_distribution: dict[str, int] = defaultdict(int)
        latest_updated_at = None
        manual_count = 0
        known_ids: set[int] = set()
        if scoped_lexeme_ids:
            rows_by_lexeme_id = self._knowledge_rows_by_terminal_id(scoped_lexeme_ids)
            for canonical_id, source_rows in rows_by_lexeme_id.items():
                row = self._effective_row(source_rows)
                if row is None:
                    continue
                if row.source == MANUAL_SOURCE:
                    manual_count += 1
                state_counts[row.state] = state_counts.get(row.state, 0) + 1
                source_distribution[row.source] += 1
                if row.updated_at is not None and (
                    latest_updated_at is None or row.updated_at > latest_updated_at
                ):
                    latest_updated_at = row.updated_at
                if row.state == "known":
                    known_ids.add(canonical_id)
        state_counts["unknown"] = max(
            len(scoped_lexeme_ids)
            - state_counts["known"]
            - state_counts["learning"]
            - state_counts["ignored"],
            0,
        )

        baseline_status = "ready" if known_ids else "uninitialized"
        if known_ids:
            message = "个人词汇基线已建立，覆盖率可基于 canonical Lexeme 计算。"
        elif legacy_mapping["unmapped_count"]:
            message = (
                f"尚未建立个人词汇基线；有 {legacy_mapping['unmapped_count']} "
                "条旧的已掌握记录无法无歧义映射。"
            )
        else:
            message = "尚未建立个人词汇基线；尚无明确掌握词。"

        summary = {
            "book_id": book_id,
            "analysis_run_id": run.id if run else None,
            "baseline_status": baseline_status,
            "migration_status": legacy_mapping["migration_status"],
            "known_lexeme_count": state_counts["known"],
            "learning_lexeme_count": state_counts["learning"],
            "ignored_lexeme_count": state_counts["ignored"],
            "unknown_lexeme_count": state_counts["unknown"],
            "legacy_mastered_count": legacy_mapping["mastered_count"],
            "legacy_mapped_count": legacy_mapping["mapped_count"],
            "legacy_unmapped_count": legacy_mapping["unmapped_count"],
            "manual_count": manual_count,
            "source_distribution": dict(sorted(source_distribution.items())),
            "latest_updated_at": latest_updated_at,
            "message": message,
            **migration_result,
        }
        return known_ids, summary

    def _knowledge_rows_by_terminal_id(
        self,
        terminal_ids: set[int],
    ) -> dict[int, list[UserLexemeKnowledge]]:
        """Group current and pre-merge state rows by their final Lexeme id.

        A merge can occur after a user state was written. Until a dedicated
        merge command folds those rows physically, reads must preserve their
        effect at the terminal canonical identity.
        """
        grouped: dict[int, list[UserLexemeKnowledge]] = defaultdict(list)
        if not terminal_ids:
            return grouped
        for row in self.db.query(UserLexemeKnowledge).all():
            terminal_id = self.resolve_canonical_lexeme(row.lexeme_id).id
            if terminal_id in terminal_ids:
                grouped[terminal_id].append(row)
        return grouped

    def _active_run(self, book_id: str, run_id: Optional[int]) -> Optional[AnalysisRun]:
        query = self.db.query(AnalysisRun).filter(AnalysisRun.book_id == book_id)
        if run_id is not None:
            return query.filter(AnalysisRun.id == run_id).one_or_none()
        return query.filter(AnalysisRun.is_active.is_(True)).one_or_none()

    def _run_canonical_lexeme_ids(self, run_id: int) -> set[int]:
        ids = {
            row[0]
            for row in self.db.query(RunLexeme.lexeme_id).filter(
                RunLexeme.analysis_run_id == run_id,
            ).distinct()
        }
        return {self.resolve_canonical_lexeme(lexeme_id).id for lexeme_id in ids}

    def _map_legacy_mastered_rows(self, book_id: str, run_id: int) -> dict[str, Any]:
        legacy_rows = self.db.query(Vocabulary).filter(
            Vocabulary.book_id == book_id,
            Vocabulary.status == LEGACY_MASTERED_STATUS,
        ).all()
        if not legacy_rows:
            return {
                "known_ids": set(),
                "mastered_count": 0,
                "mapped_count": 0,
                "unmapped_count": 0,
                "migration_status": "none",
            }

        candidates_by_form: dict[str, dict[int, list[tuple[RunLexeme, Lexeme]]]] = defaultdict(
            lambda: defaultdict(list)
        )
        rows = self.db.query(RunLexeme, Lexeme).join(
            Lexeme,
            Lexeme.id == RunLexeme.lexeme_id,
        ).filter(
            RunLexeme.analysis_run_id == run_id,
            Lexeme.is_provisional.is_(False),
            Lexeme.merged_into_id.is_(None),
        ).all()
        for run_lexeme, lexeme in rows:
            candidates_by_form[_normalize_identity_text(run_lexeme.dictionary_form)][lexeme.id].append(
                (run_lexeme, lexeme)
            )

        known_ids: set[int] = set()
        mapped_count = 0
        unmapped_count = 0
        for vocabulary in legacy_rows:
            base_form = _normalize_identity_text(vocabulary.base_form or "")
            candidates = candidates_by_form.get(base_form, {})
            reading = _normalize_reading(vocabulary.reading)
            matching_ids: list[int] = []
            for lexeme_id, candidate_rows in candidates.items():
                if reading is None or any(
                    lexeme.canonical_reading_kana == reading
                    or run_lexeme.observed_reading_kana == reading
                    for run_lexeme, lexeme in candidate_rows
                ):
                    matching_ids.append(lexeme_id)

            if len(matching_ids) == 1:
                known_ids.add(self.resolve_canonical_lexeme(matching_ids[0]).id)
                mapped_count += 1
            else:
                unmapped_count += 1

        if mapped_count == len(legacy_rows):
            migration_status = "ready"
        elif known_ids:
            migration_status = "partial"
        else:
            migration_status = "uninitialized"
        return {
            "known_ids": known_ids,
            "mastered_count": len(legacy_rows),
            "mapped_count": mapped_count,
            "unmapped_count": unmapped_count,
            "migration_status": migration_status,
        }

    def _migrate_legacy_ids(self, lexeme_ids: set[int]) -> dict[str, int]:
        result = {
            "created_count": 0,
            "updated_count": 0,
            "preserved_manual_count": 0,
        }
        for lexeme_id in sorted(lexeme_ids):
            row = self.db.query(UserLexemeKnowledge).filter(
                UserLexemeKnowledge.lexeme_id == lexeme_id,
                UserLexemeKnowledge.source == LEGACY_SOURCE,
            ).one_or_none()
            if row is None:
                self.db.add(UserLexemeKnowledge(
                    lexeme_id=lexeme_id,
                    state="known",
                    source=LEGACY_SOURCE,
                ))
                result["created_count"] += 1
            elif row.state != "known":
                row.state = "known"
                result["updated_count"] += 1
            if any(
                knowledge.source == MANUAL_SOURCE
                for knowledge in self._knowledge_rows_by_terminal_id({lexeme_id})[lexeme_id]
            ):
                result["preserved_manual_count"] += 1
        return result

    def _upsert_row(
        self,
        lexeme_id: int,
        state: str,
        *,
        source: str,
        note: Optional[str],
    ) -> UserLexemeKnowledge:
        row = self.db.query(UserLexemeKnowledge).filter(
            UserLexemeKnowledge.lexeme_id == lexeme_id,
            UserLexemeKnowledge.source == source,
        ).one_or_none()
        if row is None:
            row = UserLexemeKnowledge(
                lexeme_id=lexeme_id,
                state=state,
                source=source,
                note=note,
            )
            self.db.add(row)
        else:
            row.state = state
            row.source = source
            row.note = note
        return row

    @staticmethod
    def _effective_row(rows: list[UserLexemeKnowledge]) -> Optional[UserLexemeKnowledge]:
        if not rows:
            return None
        newest = lambda row: (row.updated_at or datetime.min, row.id or 0)
        manual = [row for row in rows if row.source == MANUAL_SOURCE]
        if manual:
            return max(manual, key=newest)

        external = [row for row in rows if row.source != LEGACY_SOURCE]
        known_external = [row for row in external if row.state == "known"]
        if known_external:
            return max(known_external, key=newest)
        if external:
            return max(external, key=newest)

        legacy = [row for row in rows if row.source == LEGACY_SOURCE]
        known_legacy = [row for row in legacy if row.state == "known"]
        if known_legacy:
            return max(known_legacy, key=newest)
        return max(rows, key=newest)

    @staticmethod
    def _serialize_row(
        row: UserLexemeKnowledge,
        *,
        requested_lexeme_id: Optional[int] = None,
        canonical_lexeme: Optional[Lexeme] = None,
    ) -> dict[str, Any]:
        lexeme = canonical_lexeme if canonical_lexeme is not None else row.lexeme
        return {
            "lexeme_id": lexeme.id,
            "requested_lexeme_id": requested_lexeme_id,
            "state": row.state,
            "source": row.source,
            "note": row.note,
            "normalized_form": lexeme.normalized_form,
            "canonical_reading_kana": lexeme.canonical_reading_kana,
            "is_provisional": lexeme.is_provisional,
            "merged_into_id": lexeme.merged_into_id,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
