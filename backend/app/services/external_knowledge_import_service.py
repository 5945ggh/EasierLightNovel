"""External personal-knowledge import helpers.

This module is intentionally storage-agnostic. Phase 4C/4D needs durable
models and routes to expose this behavior, but the import rules can be tested
before those shared integration points exist.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Protocol

import requests

from app.utils.lexeme_identity import normalize_canonical_reading, normalize_identity_text


TRUSTED_STATUS = "known"
MANUAL_SOURCE = "manual"
EXTERNAL_SOURCE_KINDS = {"anki", "jlpt"}
JLPT_LEVELS = {"N5", "N4", "N3", "N2", "N1"}
ANKI_STATE_NAMES = ("new", "learning", "relearning", "young", "mature", "suspended", "buried")
ANKI_STATE_QUERY_NAMES = {
    "new": "is:new",
    "learning": "is:learn",
    # Anki exposes relearning cards through the intersection of learn and
    # review searches; keep it separate from initial learning evidence.
    "relearning": "is:learn is:review",
    "young_or_mature": "is:review",
    "suspended": "is:suspended",
    "buried": "is:buried",
}
MATURE_INTERVAL_DAYS = 21


class ExternalKnowledgeImportError(RuntimeError):
    """Raised when an external import source cannot produce a safe preview."""


class ExternalKnowledgeProtocolError(ExternalKnowledgeImportError):
    """Raised when a source response does not match its declared protocol."""


@dataclass(frozen=True)
class ResolvedLexeme:
    lexeme_id: int
    normalized_form: str
    canonical_reading_kana: str
    is_provisional: bool = False
    merged_into_id: int | None = None


@dataclass(frozen=True)
class LexemeResolution:
    matches: tuple[ResolvedLexeme, ...] = ()

    @classmethod
    def unmatched(cls) -> "LexemeResolution":
        return cls(())

    @classmethod
    def single(cls, lexeme: ResolvedLexeme) -> "LexemeResolution":
        return cls((lexeme,))


class LexemeResolver(Protocol):
    """Optional bridge to the eventual canonical Lexeme store."""

    def resolve_unique(
        self,
        normalized_form: str,
        canonical_reading_kana: str,
    ) -> ResolvedLexeme | LexemeResolution | None:
        """Return one trusted canonical match, or None when not unique/trusted."""


class SQLAlchemyLexemeResolver:
    """Resolve imports only against exact trusted canonical identities."""

    def __init__(self, db: Any, lexeme_model: type[Any]) -> None:
        self.db = db
        self.Lexeme = lexeme_model

    def resolve_unique(
        self,
        normalized_form: str,
        canonical_reading_kana: str,
    ) -> ResolvedLexeme | LexemeResolution:
        exact = self.db.query(self.Lexeme).filter(
            self.Lexeme.normalized_form == normalized_form,
            self.Lexeme.canonical_reading_kana == canonical_reading_kana,
            self.Lexeme.is_provisional.is_(False),
            self.Lexeme.merged_into_id.is_(None),
        ).all()
        if len(exact) == 1:
            row = exact[0]
            return ResolvedLexeme(
                lexeme_id=row.id,
                normalized_form=row.normalized_form,
                canonical_reading_kana=row.canonical_reading_kana,
            )
        if len(exact) > 1:
            return LexemeResolution(tuple(
                ResolvedLexeme(row.id, row.normalized_form, row.canonical_reading_kana)
                for row in exact
            ))
        provisional = self.db.query(self.Lexeme).filter(
            self.Lexeme.normalized_form == normalized_form,
            self.Lexeme.is_provisional.is_(True),
        ).first()
        if provisional is not None:
            return ResolvedLexeme(
                lexeme_id=provisional.id,
                normalized_form=provisional.normalized_form,
                canonical_reading_kana=canonical_reading_kana,
                is_provisional=True,
            )
        return LexemeResolution.unmatched()


@dataclass(frozen=True)
class ImportCandidate:
    normalized_form: str
    canonical_reading_kana: str
    source_kind: str
    source_entry_id: str
    display_form: str | None = None
    level: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    lexeme_id: int | None = None
    target_state: str | None = TRUSTED_STATUS

    @property
    def identity_key(self) -> str:
        return stable_identity_key(self.normalized_form, self.canonical_reading_kana)


@dataclass(frozen=True)
class ImportSkip:
    source_entry_id: str
    reason: str
    normalized_form: str | None = None
    canonical_reading_kana: str | None = None
    # Internal, non-serialized evidence used to keep card counts accurate.
    # It must never contain Anki field values or template HTML.
    metadata: Mapping[str, Any] = field(default_factory=dict, repr=False)


@dataclass(frozen=True)
class UserLexemeKnowledgeRecord:
    identity_key: str
    normalized_form: str
    canonical_reading_kana: str
    source_kind: str
    source_entry_id: str
    status: str = TRUSTED_STATUS
    source_batch_id: str | None = None
    lexeme_id: int | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @property
    def is_manual(self) -> bool:
        return self.source_kind == MANUAL_SOURCE


class KnowledgeImportRepository(Protocol):
    """Persistence API required by the importer.

    A SQLAlchemy implementation should back this with a future personal
    knowledge table keyed by canonical Lexeme identity plus source provenance.
    """

    def get_by_identity(self, identity_key: str) -> UserLexemeKnowledgeRecord | None:
        """Return the active record for this identity, if any."""

    def save_external_batch(
        self,
        batch_id: str,
        source_kind: str,
        import_digest: str,
        candidates: list[ImportCandidate],
    ) -> list[UserLexemeKnowledgeRecord]:
        """Persist candidates as one reversible external batch."""

    def delete_external_batch(self, batch_id: str) -> int:
        """Delete only non-manual records from the external batch."""


class SQLAlchemyKnowledgeImportRepository:
    """Adapter for future durable Phase 4C/4D models.

    The adapter stores external state separately from manual state. A manually
    overridden Lexeme therefore remains reversible: revoking the import never
    deletes the manual row and clearing a manual override reveals remaining
    external evidence.
    """

    def __init__(
        self,
        db: Any,
        *,
        user_lexeme_knowledge_model: type[Any],
        external_knowledge_import_model: type[Any],
        external_knowledge_import_item_model: type[Any],
        lexeme_model: type[Any],
    ) -> None:
        self.db = db
        self.UserLexemeKnowledge = user_lexeme_knowledge_model
        self.ExternalKnowledgeImport = external_knowledge_import_model
        self.ExternalKnowledgeImportItem = external_knowledge_import_item_model
        self.Lexeme = lexeme_model

    def get_by_identity(self, identity_key: str) -> UserLexemeKnowledgeRecord | None:
        lexeme = next((row for row in self.db.query(self.Lexeme).all()
                       if not row.is_provisional and stable_identity_key(
                           row.normalized_form, row.canonical_reading_kana or ""
                       ) == identity_key), None)
        if lexeme is None:
            return None
        rows = self.db.query(self.UserLexemeKnowledge).filter(
            self.UserLexemeKnowledge.lexeme_id == lexeme.id,
        ).all()
        row = next((item for item in rows if item.source == MANUAL_SOURCE), None)
        if row is None:
            row = next(
                (item for item in rows if item.source in EXTERNAL_SOURCE_KINDS),
                None,
            )
        if row is None:
            return None
        return UserLexemeKnowledgeRecord(
            identity_key=identity_key,
            normalized_form=lexeme.normalized_form,
            canonical_reading_kana=lexeme.canonical_reading_kana,
            source_kind=row.source,
            source_entry_id="",
            status=row.state,
            lexeme_id=lexeme.id,
        )

    def find_existing_batch(self, source_kind: str, import_digest: str) -> str | None:
        row = self.db.query(self.ExternalKnowledgeImport).filter(
            self.ExternalKnowledgeImport.source_kind == source_kind,
            self.ExternalKnowledgeImport.import_digest == import_digest,
            self.ExternalKnowledgeImport.status == "applied",
        ).one_or_none()
        return row.batch_id if row else None

    def get_learning_map_impact(
        self,
        candidates: Iterable[ImportCandidate],
    ) -> list[Mapping[str, Any]]:
        """Return before/after coverage for active books touched by an import."""
        from app.models import AnalysisRun, Book, LexemeOccurrence, RunLexeme

        candidates = list(candidates)
        candidate_ids = {
            int(candidate.lexeme_id)
            for candidate in candidates
            if candidate.lexeme_id is not None
        }
        if not candidate_ids:
            return []

        known_before, manual_ids = self._effective_known_ids()
        known_additions = {
            int(candidate.lexeme_id)
            for candidate in candidates
            if candidate.lexeme_id is not None
            and candidate.target_state == TRUSTED_STATUS
            and int(candidate.lexeme_id) not in manual_ids
        }
        known_after = known_before | known_additions
        runs = self.db.query(AnalysisRun, Book).join(
            Book,
            Book.id == AnalysisRun.book_id,
        ).filter(AnalysisRun.is_active.is_(True)).all()

        impact: list[Mapping[str, Any]] = []
        for run, book in runs:
            filter_spec = run.filter_spec if isinstance(run.filter_spec, Mapping) else {}
            pos_allowlist = set(filter_spec.get(
                "pos_allowlist",
                ("名詞", "動詞", "形容詞", "形状詞", "副詞"),
            ))
            exclude_oov = bool(filter_spec.get("exclude_oov", False))
            exclude_proper_nouns = bool(filter_spec.get("exclude_proper_nouns", False))
            rows = self.db.query(LexemeOccurrence, RunLexeme).join(
                RunLexeme,
                RunLexeme.id == LexemeOccurrence.run_lexeme_id,
            ).filter(LexemeOccurrence.analysis_run_id == run.id).all()
            occurrence_counts: dict[int, int] = {}
            for occurrence, run_lexeme in rows:
                pos_values = [str(value) for value in (run_lexeme.part_of_speech or [])]
                if not pos_values or pos_values[0] not in pos_allowlist:
                    continue
                if exclude_oov and run_lexeme.is_oov:
                    continue
                if exclude_proper_nouns and "固有名詞" in pos_values:
                    continue
                canonical_id = self._canonical_lexeme_id(run_lexeme.lexeme_id)
                occurrence_counts[canonical_id] = occurrence_counts.get(canonical_id, 0) + 1
            if not candidate_ids.intersection(occurrence_counts):
                continue
            eligible_occurrences = sum(occurrence_counts.values())
            before_occurrences = sum(
                count for lexeme_id, count in occurrence_counts.items()
                if lexeme_id in known_before
            )
            after_occurrences = sum(
                count for lexeme_id, count in occurrence_counts.items()
                if lexeme_id in known_after
            )
            lexeme_ids = set(occurrence_counts)
            before_lexeme_count = len(lexeme_ids & known_before)
            after_lexeme_count = len(lexeme_ids & known_after)
            coverage_before = (
                before_occurrences / eligible_occurrences
                if eligible_occurrences else None
            )
            coverage_after = (
                after_occurrences / eligible_occurrences
                if eligible_occurrences else None
            )
            impact.append({
                "book_id": book.id,
                "book_title": book.title,
                "eligible_occurrences": eligible_occurrences,
                "known_lexeme_count_before": before_lexeme_count,
                "known_lexeme_count_after": after_lexeme_count,
                "known_occurrences_before": before_occurrences,
                "known_occurrences_after": after_occurrences,
                "coverage_before": coverage_before,
                "coverage_after": coverage_after,
                "coverage_delta": (
                    coverage_after - coverage_before
                    if coverage_before is not None and coverage_after is not None
                    else coverage_after
                ),
            })
        return impact

    def _canonical_lexeme_id(self, lexeme_id: int) -> int:
        seen: set[int] = set()
        current = self.db.get(self.Lexeme, lexeme_id)
        while current is not None and current.merged_into_id is not None:
            if current.id in seen:
                break
            seen.add(current.id)
            current = self.db.get(self.Lexeme, current.merged_into_id)
        return current.id if current is not None else lexeme_id

    def _effective_known_ids(self) -> tuple[set[int], set[int]]:
        rows = self.db.query(self.UserLexemeKnowledge).all()
        by_lexeme: dict[int, list[Any]] = {}
        for row in rows:
            by_lexeme.setdefault(self._canonical_lexeme_id(row.lexeme_id), []).append(row)
        known_ids: set[int] = set()
        manual_ids: set[int] = set()
        for lexeme_id, source_rows in by_lexeme.items():
            manual_rows = [row for row in source_rows if row.source == MANUAL_SOURCE]
            if manual_rows:
                manual_ids.add(lexeme_id)
                if any(row.state == TRUSTED_STATUS for row in manual_rows):
                    known_ids.add(lexeme_id)
                continue
            if any(row.state == TRUSTED_STATUS for row in source_rows):
                known_ids.add(lexeme_id)
        return known_ids, manual_ids

    def save_external_batch(
        self,
        batch_id: str,
        source_kind: str,
        import_digest: str,
        candidates: list[ImportCandidate],
    ) -> list[UserLexemeKnowledgeRecord]:
        target_state_counts: dict[str, int] = {}
        for candidate in candidates:
            if candidate.target_state is not None:
                target_state_counts[candidate.target_state] = (
                    target_state_counts.get(candidate.target_state, 0) + 1
                )
        batch = self.ExternalKnowledgeImport(
            batch_id=batch_id,
            source_kind=source_kind,
            status="applied",
            import_digest=import_digest,
            summary_json={
                "accepted_count": len(candidates),
                "target_state_counts": target_state_counts,
            },
        )
        self.db.add(batch)

        created: list[UserLexemeKnowledgeRecord] = []
        for candidate in candidates:
            if candidate.target_state is not None:
                knowledge = self.db.query(self.UserLexemeKnowledge).filter(
                    self.UserLexemeKnowledge.lexeme_id == candidate.lexeme_id,
                    self.UserLexemeKnowledge.source == candidate.source_kind,
                ).one_or_none()
                if knowledge is None:
                    knowledge = self.UserLexemeKnowledge(
                        lexeme_id=candidate.lexeme_id,
                        state=candidate.target_state,
                        source=candidate.source_kind,
                    )
                    self.db.add(knowledge)
                elif candidate.target_state == TRUSTED_STATUS:
                    # A later mature card upgrades an earlier learning-only
                    # import, but a learning card never downgrades maturity.
                    knowledge.state = TRUSTED_STATUS
                elif knowledge.state != TRUSTED_STATUS:
                    knowledge.state = "learning"

            evidence_rows = _selected_anki_evidence(candidate)
            if not evidence_rows:
                evidence_rows = ({},)
            item_metadata = dict(candidate.metadata)
            # Preserve the decision per evidence row so rollback can rebuild
            # source knowledge from the remaining active batches.
            item_metadata["_target_state"] = candidate.target_state
            for evidence in evidence_rows:
                card_id = _optional_string(evidence.get("card_id"))
                source_entry_id = card_id or candidate.source_entry_id
                item = self.ExternalKnowledgeImportItem(
                    knowledge_import=batch,
                    lexeme_id=candidate.lexeme_id,
                    normalized_form=candidate.normalized_form,
                    canonical_reading_kana=candidate.canonical_reading_kana,
                    source_entry_id=source_entry_id,
                    level=candidate.level,
                    metadata_json=item_metadata,
                    status="applied",
                    card_id=card_id,
                    note_id=_optional_string(evidence.get("note_id")),
                    deck_name=_optional_string(evidence.get("deck_name")),
                    model_name=_optional_string(evidence.get("model_name")),
                    template_ord=_optional_int(evidence.get("template_ord")),
                    anki_state=_optional_string(evidence.get("state")),
                    anki_underlying_state=_optional_string(evidence.get("underlying_state")),
                    anki_queue=_optional_int(evidence.get("queue")),
                    anki_type=_optional_int(evidence.get("type")),
                    interval=_optional_int(evidence.get("interval")),
                    reps=_optional_int(evidence.get("reps")),
                    lapses=_optional_int(evidence.get("lapses")),
                    buried=bool(evidence.get("buried")) if evidence else None,
                    suspended=bool(evidence.get("suspended")) if evidence else None,
                    snapshot_at=_parse_snapshot(evidence.get("snapshot_at")),
                )
                self.db.add(item)

            if candidate.target_state is not None:
                created.append(UserLexemeKnowledgeRecord(
                    identity_key=candidate.identity_key,
                    normalized_form=candidate.normalized_form,
                    canonical_reading_kana=candidate.canonical_reading_kana,
                    source_kind=candidate.source_kind,
                    source_entry_id=candidate.source_entry_id,
                    status=candidate.target_state,
                    source_batch_id=batch_id,
                    lexeme_id=candidate.lexeme_id,
                    metadata=candidate.metadata,
                ))

        self.db.commit()
        return created

    def delete_external_batch(self, batch_id: str) -> int:
        batch = self.db.query(self.ExternalKnowledgeImport).filter(
            self.ExternalKnowledgeImport.batch_id == batch_id,
        ).one_or_none()
        if batch is None or batch.status == "rolled_back":
            return 0
        items = self.db.query(self.ExternalKnowledgeImportItem).filter(
            self.ExternalKnowledgeImportItem.import_id == batch.id,
            self.ExternalKnowledgeImportItem.status == "applied",
        ).all()
        deleted = 0
        affected_lexeme_ids: set[int] = set()
        for item in items:
            affected_lexeme_ids.add(item.lexeme_id)
            item.status = "rolled_back"
        batch.status = "rolled_back"
        batch.revoked_at = datetime.now(timezone.utc)

        for lexeme_id in affected_lexeme_ids:
            active_items = self.db.query(self.ExternalKnowledgeImportItem).join(
                self.ExternalKnowledgeImport,
                self.ExternalKnowledgeImport.id == self.ExternalKnowledgeImportItem.import_id,
            ).filter(
                self.ExternalKnowledgeImportItem.lexeme_id == lexeme_id,
                self.ExternalKnowledgeImport.source_kind == batch.source_kind,
                self.ExternalKnowledgeImport.status == "applied",
                self.ExternalKnowledgeImportItem.status == "applied",
            ).all()
            target_states = {
                _external_item_target_state(item, batch.source_kind)
                for item in active_items
            }
            target_state = (
                TRUSTED_STATUS if TRUSTED_STATUS in target_states
                else "learning" if "learning" in target_states
                else None
            )
            row = self.db.query(self.UserLexemeKnowledge).filter(
                self.UserLexemeKnowledge.lexeme_id == lexeme_id,
                self.UserLexemeKnowledge.source == batch.source_kind,
            ).one_or_none()
            if target_state is None:
                if row is not None:
                    self.db.delete(row)
                    deleted += 1
            elif row is None:
                self.db.add(self.UserLexemeKnowledge(
                    lexeme_id=lexeme_id,
                    state=target_state,
                    source=batch.source_kind,
                ))
            else:
                row.state = target_state
        self.db.commit()
        return deleted


@dataclass(frozen=True)
class ImportPreviewStats:
    total: int
    parsable: int
    unique: int
    ambiguous: int
    unmatched: int
    provisional: int
    card_count: int = 0
    note_count: int = 0
    unique_lexeme_count: int = 0
    known_candidate_count: int = 0
    learning_candidate_count: int = 0
    anki_state_counts: Mapping[str, int] = field(default_factory=dict)
    conversion_funnel: Mapping[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportPreview:
    source_kind: str
    import_digest: str
    accepted: list[ImportCandidate]
    skipped: list[ImportSkip]
    stats: ImportPreviewStats
    known_before_count: int = 0
    known_after_count: int = 0
    learning_map_impact: list[Mapping[str, Any]] = field(default_factory=list)

    @property
    def accepted_count(self) -> int:
        return len(self.accepted)

    @property
    def skipped_count(self) -> int:
        return len(self.skipped)


@dataclass(frozen=True)
class ImportBatchResult:
    batch_id: str
    source_kind: str
    import_digest: str
    created: list[UserLexemeKnowledgeRecord]
    skipped: list[ImportSkip]

    @property
    def created_count(self) -> int:
        return len(self.created)

    @property
    def skipped_count(self) -> int:
        return len(self.skipped)


@dataclass(frozen=True)
class RollbackResult:
    batch_id: str
    deleted_count: int


def stable_identity_key(normalized_form: str, canonical_reading_kana: str) -> str:
    payload = json.dumps(
        [normalized_form, canonical_reading_kana],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _normalize_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return normalize_identity_text(value)


def normalize_reading(value: Any) -> str:
    return normalize_canonical_reading(value if isinstance(value, str) else None) or ""


def _digest_candidates(candidates: Iterable[ImportCandidate]) -> str:
    def digest_cards(value: Any) -> Any:
        if not isinstance(value, list):
            return []
        cards = [
            {
                key: item[key]
                for key in sorted(item)
                if key != "snapshot_at"
            }
            for item in value
            if isinstance(item, Mapping)
        ]
        return sorted(
            cards,
            key=lambda item: (
                _optional_string(item.get("card_id")) or "",
                json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            ),
        )

    rows = [
        {
            "identity_key": candidate.identity_key,
            "source_kind": candidate.source_kind,
            "source_entry_id": candidate.source_entry_id,
            "target_state": candidate.target_state,
            "selected_anki_cards": digest_cards(candidate.metadata.get("selected_anki_cards", [])),
        }
        for candidate in candidates
    ]
    payload = json.dumps(
        sorted(rows, key=lambda row: (row["identity_key"], row["source_entry_id"])),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _external_item_target_state(item: Any, source_kind: str) -> str | None:
    """Recover an item's applied target for rollback, including legacy rows."""
    metadata = item.metadata_json if isinstance(item.metadata_json, Mapping) else {}
    if "_target_state" in metadata:
        target = metadata["_target_state"]
        return target if target in {TRUSTED_STATUS, "learning"} else None
    if item.anki_state == "mature":
        return TRUSTED_STATUS
    if item.anki_state in {"new", "learning", "relearning", "young"}:
        return "learning"
    # Older JLPT rows predate per-item target metadata and were all known.
    return TRUSTED_STATUS if source_kind == "jlpt" else None


def _parse_snapshot(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _selected_anki_evidence(candidate: ImportCandidate) -> tuple[Mapping[str, Any], ...]:
    selected = candidate.metadata.get("selected_anki_cards")
    if not isinstance(selected, list):
        return ()
    result: list[Mapping[str, Any]] = []
    seen: set[str] = set()
    for item in selected:
        if not isinstance(item, Mapping):
            continue
        card_id = _optional_string(item.get("card_id"))
        key = card_id or json.dumps(dict(item), sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return tuple(result)


def _anki_evidence(metadata: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    evidence = metadata.get("anki_cards")
    if not isinstance(evidence, list):
        return []
    return [item for item in evidence if isinstance(item, Mapping)]


def _count_anki_evidence(metadata: Mapping[str, Any]) -> int:
    return len(_anki_evidence(metadata))


def _anki_note_ids(metadata: Mapping[str, Any]) -> set[str]:
    return {
        note_id
        for item in _anki_evidence(metadata)
        if (note_id := _optional_string(item.get("note_id"))) is not None
    }


def _count_anki_states(metadata: Mapping[str, Any]) -> tuple[dict[str, int], int]:
    counts = {state: 0 for state in ANKI_STATE_NAMES}
    buried_count = 0
    seen: set[str] = set()
    for item in _anki_evidence(metadata):
        card_id = _optional_string(item.get("card_id"))
        key = card_id or json.dumps(dict(item), sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        state = _optional_string(item.get("state"))
        if state in ANKI_STATE_NAMES:
            counts[state] += 1
        if item.get("buried") is True:
            buried_count += 1
    return counts, buried_count


def _merge_import_candidates(left: ImportCandidate, right: ImportCandidate) -> ImportCandidate:
    merged_metadata = dict(left.metadata)
    for key in ("anki_cards", "selected_anki_cards"):
        values: list[Mapping[str, Any]] = []
        seen: set[str] = set()
        for source in (left.metadata.get(key), right.metadata.get(key)):
            if not isinstance(source, list):
                continue
            for item in source:
                if not isinstance(item, Mapping):
                    continue
                card_id = _optional_string(item.get("card_id"))
                identity = card_id or json.dumps(dict(item), sort_keys=True, ensure_ascii=False)
                if identity in seen:
                    continue
                seen.add(identity)
                values.append(item)
        if values:
            merged_metadata[key] = values

    state_rank = {None: 0, "learning": 1, TRUSTED_STATUS: 2}
    target_state = max(
        (left.target_state, right.target_state),
        key=lambda state: state_rank.get(state, 0),
    )
    return ImportCandidate(
        normalized_form=left.normalized_form,
        canonical_reading_kana=left.canonical_reading_kana,
        source_kind=left.source_kind,
        source_entry_id=left.source_entry_id,
        display_form=left.display_form or right.display_form,
        level=left.level or right.level,
        metadata=merged_metadata,
        lexeme_id=left.lexeme_id,
        target_state=target_state,
    )


def _anki_id(value: Any) -> str:
    return "" if value is None else str(value)


def _compose_anki_query(query: str | None, deck_name: str | None) -> str:
    base = _normalize_text(query)
    if deck_name:
        escaped = deck_name.replace("\\", "\\\\").replace('"', '\\"')
        deck_clause = f'deck:"{escaped}"'
        if deck_clause not in base:
            base = f"{base} {deck_clause}".strip()
    return base or "*"


def _template_catalog(result: Any) -> list[Mapping[str, Any]]:
    if not isinstance(result, Mapping):
        return []
    catalog: list[Mapping[str, Any]] = []
    for ordinal, name in enumerate(result):
        if isinstance(name, str):
            catalog.append({"ord": ordinal, "name": name})
    return catalog


def _cards_to_notes_map(card_ids: list[Any], result: Any) -> dict[str, str]:
    if isinstance(result, Mapping):
        return {
            _anki_id(card_id): _anki_id(note_id)
            for card_id, note_id in result.items()
            if note_id is not None
        }
    if isinstance(result, list) and len(result) == len(card_ids):
        return {
            _anki_id(card_id): _anki_id(note_id)
            for card_id, note_id in zip(card_ids, result)
            if note_id is not None
        }
    raise ExternalKnowledgeProtocolError(
        "cardsToNotes result must map each requested card to a note"
    )


def _state_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower().replace(" ", "_")
    aliases = {
        "new": "new",
        "learning": "learning",
        "learn": "learning",
        "relearning": "relearning",
        "relearn": "relearning",
        "young": "young",
        "mature": "mature",
        "review": "young",
        "suspended": "suspended",
        "buried": "young",
    }
    return aliases.get(normalized)


def _anki_card_state(
    card_id: str,
    card: Mapping[str, Any],
    state_memberships: Mapping[str, set[str]],
) -> tuple[str | None, str | None, bool, bool]:
    raw_state = _state_name(card.get("state", card.get("status")))
    interval = _optional_int(card.get("interval")) or 0
    buried = card_id in state_memberships.get("buried", set()) or (
        isinstance(card.get("status"), str) and card.get("status", "").lower() == "buried"
    )
    if raw_state in {"new", "learning", "relearning", "young", "mature"}:
        underlying = raw_state
    elif card_id in state_memberships.get("new", set()):
        underlying = "new"
    elif card_id in state_memberships.get("relearning", set()):
        underlying = "relearning"
    elif card_id in state_memberships.get("learning", set()):
        underlying = "learning"
    elif card_id in state_memberships.get("young_or_mature", set()):
        underlying = "mature" if interval >= MATURE_INTERVAL_DAYS else "young"
    elif buried:
        # Some Anki searches may omit a buried card from is:review. Preserve
        # its maturity from the documented interval boundary rather than
        # letting the temporary buried flag erase the underlying evidence.
        underlying = (
            "mature" if interval >= MATURE_INTERVAL_DAYS
            else "young" if interval > 0
            else "new"
        )
    else:
        underlying = None

    suspended = card_id in state_memberships.get("suspended", set()) or raw_state == "suspended"
    state = "suspended" if suspended else underlying
    return state, underlying, suspended, buried


def _anki_card_evidence(
    *,
    card_id: str,
    note_id: str,
    card: Mapping[str, Any],
    state_memberships: Mapping[str, set[str]],
    template_catalog: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    state, underlying, suspended, buried = _anki_card_state(
        card_id, card, state_memberships
    )
    template_ord = _optional_int(card.get("ord"))
    template_name = next(
        (
            _optional_string(item.get("name"))
            for item in template_catalog
            if _optional_int(item.get("ord")) == template_ord
        ),
        None,
    )
    return {
        "card_id": card_id,
        "note_id": note_id,
        "deck_name": _optional_string(card.get("deckName", card.get("deck_name"))),
        "model_name": _optional_string(card.get("modelName", card.get("model_name"))),
        "template_ord": template_ord,
        "template_name": template_name,
        "state": state,
        "underlying_state": underlying,
        "raw_state": card.get("state", card.get("status")),
        # queue/type are evidence only. Classification deliberately does not
        # branch on their integer values.
        "queue": card.get("queue"),
        "type": card.get("type"),
        "raw_queue": card.get("queue"),
        "raw_type": card.get("type"),
        "interval": _optional_int(card.get("interval")),
        "reps": _optional_int(card.get("reps")),
        "lapses": _optional_int(card.get("lapses")),
        "buried": buried,
        "suspended": suspended,
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
    }


def _select_anki_template(
    evidence: list[Mapping[str, Any]],
    *,
    template_ord: int | None,
    names_by_ord: Mapping[int, str | None],
) -> tuple[Mapping[str, Any], ...]:
    enriched: list[Mapping[str, Any]] = []
    for item in evidence:
        ordinal = _optional_int(item.get("template_ord"))
        selected = dict(item)
        if ordinal in names_by_ord and names_by_ord[ordinal]:
            selected["template_name"] = names_by_ord[ordinal]
        enriched.append(selected)
    if template_ord is not None:
        return tuple(item for item in enriched if item.get("template_ord") == template_ord)
    recognition = [
        item for item in enriched
        if "recogn" in (_optional_string(item.get("template_name")) or "").lower()
    ]
    if recognition:
        return (recognition[0],)
    return (min(enriched, key=lambda item: _optional_int(item.get("template_ord")) or 0),) if enriched else ()


def _anki_target_state(evidence: Iterable[Mapping[str, Any]]) -> str | None:
    states = {
        _optional_string(item.get("state"))
        for item in evidence
        if _optional_string(item.get("state")) is not None
    }
    if "mature" in states:
        return TRUSTED_STATUS
    if states & {"new", "learning", "relearning", "young"}:
        return "learning"
    return None


def _candidate_from_raw(
    *,
    source_kind: str,
    source_entry_id: Any,
    expression: Any,
    reading: Any,
    level: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> ImportCandidate | ImportSkip:
    entry_id = _normalize_text(source_entry_id) or f"{source_kind}:unknown"
    normalized_form = _normalize_text(expression)
    canonical_reading = normalize_reading(reading)
    if not normalized_form:
        return ImportSkip(entry_id, "missing_normalized_form", metadata=metadata or {})
    if not canonical_reading:
        return ImportSkip(
            entry_id,
            "missing_trusted_canonical_reading",
            normalized_form,
            metadata=metadata or {},
        )
    return ImportCandidate(
        normalized_form=normalized_form,
        canonical_reading_kana=canonical_reading,
        source_kind=source_kind,
        source_entry_id=entry_id,
        display_form=normalized_form,
        level=level,
        metadata=metadata or {},
    )


class ExternalKnowledgeImportService:
    """Build previews and apply reversible imports from trusted external lists."""

    def __init__(
        self,
        repository: KnowledgeImportRepository,
        *,
        lexeme_resolver: LexemeResolver | None = None,
        batch_id_factory: Callable[[], str] | None = None,
    ) -> None:
        self.repository = repository
        self.lexeme_resolver = lexeme_resolver
        self.batch_id_factory = batch_id_factory or (lambda: uuid.uuid4().hex)

    def preview_candidates(
        self,
        source_kind: str,
        raw_candidates: Iterable[ImportCandidate | ImportSkip],
    ) -> ImportPreview:
        if source_kind not in EXTERNAL_SOURCE_KINDS:
            raise ValueError(f"Unsupported external source: {source_kind}")

        accepted: list[ImportCandidate] = []
        skipped: list[ImportSkip] = []
        accepted_by_identity: dict[str, int] = {}
        total = 0
        parsable = 0
        ambiguous = 0
        unmatched = 0
        provisional = 0
        card_count = 0
        note_ids: set[str] = set()
        anki_state_counts = {state: 0 for state in ANKI_STATE_NAMES}
        buried_count = 0

        for raw in raw_candidates:
            total += 1
            if isinstance(raw, ImportSkip):
                skipped.append(raw)
                card_count += _count_anki_evidence(raw.metadata)
                note_ids.update(_anki_note_ids(raw.metadata))
                state_counts, buried = _count_anki_states(raw.metadata)
                for state, count in state_counts.items():
                    anki_state_counts[state] += count
                buried_count += buried
                continue

            candidate = raw
            parsable += 1
            card_count += _count_anki_evidence(candidate.metadata)
            note_ids.update(_anki_note_ids(candidate.metadata))
            state_counts, buried = _count_anki_states(candidate.metadata)
            for state, count in state_counts.items():
                anki_state_counts[state] += count
            buried_count += buried
            if candidate.source_kind != source_kind:
                skipped.append(ImportSkip(
                    candidate.source_entry_id,
                    "source_kind_mismatch",
                    candidate.normalized_form,
                    candidate.canonical_reading_kana,
                ))
                continue

            resolved = self._resolve_candidate(candidate)
            if isinstance(resolved, ImportSkip):
                if resolved.reason == "ambiguous_canonical_lexeme":
                    ambiguous += 1
                elif resolved.reason == "unmatched_canonical_lexeme":
                    unmatched += 1
                elif resolved.reason == "provisional_or_merged_lexeme":
                    provisional += 1
                skipped.append(resolved)
                continue
            existing_index = accepted_by_identity.get(resolved.identity_key)
            if existing_index is not None:
                # Keep the duplicate diagnostic, but merge its card evidence
                # before choosing the strongest state for this Lexeme.
                current = accepted[existing_index]
                accepted[existing_index] = _merge_import_candidates(current, resolved)
                skipped.append(ImportSkip(
                    resolved.source_entry_id,
                    "duplicate_in_preview",
                    resolved.normalized_form,
                    resolved.canonical_reading_kana,
                ))
                continue
            accepted_by_identity[resolved.identity_key] = len(accepted)
            accepted.append(resolved)

        known_before_count = 0
        known_after_count = 0
        for candidate in accepted:
            existing = self.repository.get_by_identity(candidate.identity_key)
            if existing is not None and existing.status == TRUSTED_STATUS:
                known_before_count += 1
            if existing is not None and existing.status == TRUSTED_STATUS:
                continue
            if candidate.target_state == TRUSTED_STATUS and (
                existing is None or not existing.is_manual
            ):
                known_after_count += 1
        known_after_count += known_before_count
        learning_map_impact = list(
            getattr(self.repository, "get_learning_map_impact", lambda *_: [])(accepted)
        )
        unique_lexeme_count = len(accepted)
        known_candidate_count = sum(
            candidate.target_state == TRUSTED_STATUS for candidate in accepted
        )
        learning_candidate_count = sum(
            candidate.target_state == "learning" for candidate in accepted
        )
        conversion_funnel = {
            "cards": card_count,
            "unique_notes": len(note_ids) if note_ids else total,
            "parsable_notes": parsable,
            "matched_lexemes": unique_lexeme_count,
            "known_candidates": known_candidate_count,
        }
        if buried_count:
            anki_state_counts["buried"] = buried_count

        return ImportPreview(
            source_kind=source_kind,
            import_digest=_digest_candidates(accepted),
            accepted=accepted,
            skipped=skipped,
            stats=ImportPreviewStats(
                total=total,
                parsable=parsable,
                unique=len(accepted),
                ambiguous=ambiguous,
                unmatched=unmatched,
                provisional=provisional,
                card_count=card_count,
                note_count=len(note_ids) if note_ids else total,
                unique_lexeme_count=unique_lexeme_count,
                known_candidate_count=known_candidate_count,
                learning_candidate_count=learning_candidate_count,
                anki_state_counts=anki_state_counts,
                conversion_funnel=conversion_funnel,
            ),
            known_before_count=known_before_count,
            known_after_count=known_after_count,
            learning_map_impact=learning_map_impact,
        )

    def apply_preview(self, preview: ImportPreview) -> ImportBatchResult:
        existing_batch = getattr(self.repository, "find_existing_batch", lambda *_: None)(
            preview.source_kind, preview.import_digest,
        )
        if existing_batch:
            return ImportBatchResult(
                batch_id=existing_batch,
                source_kind=preview.source_kind,
                import_digest=preview.import_digest,
                created=[],
                skipped=list(preview.skipped) + [
                    ImportSkip("import", "already_imported")
                ],
            )
        batch_id = self.batch_id_factory()
        to_create: list[ImportCandidate] = []
        skipped = list(preview.skipped)

        for candidate in preview.accepted:
            existing = self.repository.get_by_identity(candidate.identity_key)
            if existing is not None and existing.is_manual:
                skipped.append(ImportSkip(
                    candidate.source_entry_id,
                    "manual_precedence",
                    candidate.normalized_form,
                    candidate.canonical_reading_kana,
                ))
                continue
            # A different active batch is still evidence that must remain
            # independently reversible. The source-scoped knowledge row may
            # be reused, but this batch must retain its own item.
            to_create.append(candidate)

        created = self.repository.save_external_batch(
            batch_id,
            preview.source_kind,
            preview.import_digest,
            to_create,
        )
        return ImportBatchResult(
            batch_id=batch_id,
            source_kind=preview.source_kind,
            import_digest=preview.import_digest,
            created=created,
            skipped=skipped,
        )

    def rollback_batch(self, batch_id: str) -> RollbackResult:
        return RollbackResult(
            batch_id=batch_id,
            deleted_count=self.repository.delete_external_batch(batch_id),
        )

    def _resolve_candidate(self, candidate: ImportCandidate) -> ImportCandidate | ImportSkip:
        if self.lexeme_resolver is None:
            return candidate
        resolved = self.lexeme_resolver.resolve_unique(
            candidate.normalized_form,
            candidate.canonical_reading_kana,
        )
        if isinstance(resolved, LexemeResolution):
            if len(resolved.matches) == 0:
                return ImportSkip(
                    candidate.source_entry_id,
                    "unmatched_canonical_lexeme",
                    candidate.normalized_form,
                    candidate.canonical_reading_kana,
                )
            if len(resolved.matches) > 1:
                return ImportSkip(
                    candidate.source_entry_id,
                    "ambiguous_canonical_lexeme",
                    candidate.normalized_form,
                    candidate.canonical_reading_kana,
                )
            resolved = resolved.matches[0]
        if resolved is None:
            return ImportSkip(
                candidate.source_entry_id,
                "unmatched_canonical_lexeme",
                candidate.normalized_form,
                candidate.canonical_reading_kana,
            )
        if resolved.is_provisional or resolved.merged_into_id is not None:
            return ImportSkip(
                candidate.source_entry_id,
                "provisional_or_merged_lexeme",
                candidate.normalized_form,
                candidate.canonical_reading_kana,
            )
        return ImportCandidate(
            normalized_form=resolved.normalized_form,
            canonical_reading_kana=resolved.canonical_reading_kana,
            source_kind=candidate.source_kind,
            source_entry_id=candidate.source_entry_id,
            display_form=candidate.display_form,
            level=candidate.level,
            metadata=candidate.metadata,
            lexeme_id=resolved.lexeme_id,
            target_state=candidate.target_state,
        )


class AnkiConnectKnowledgeSource:
    """Read-only AnkiConnect client for producing import candidates."""

    def __init__(
        self,
        *,
        endpoint: str = "http://127.0.0.1:8765",
        timeout_seconds: float = 2.0,
        post: Callable[..., Any] | None = None,
    ) -> None:
        self.endpoint = endpoint
        self.timeout_seconds = timeout_seconds
        self.post = post or requests.post

    def fetch_candidates(
        self,
        *,
        query: str | None = None,
        deck_name: str | None = None,
        model_name: str | None = None,
        template_ord: int | None = None,
        expression_fields: Iterable[str] = ("Expression", "Word", "Vocabulary", "Front"),
        reading_fields: Iterable[str] = ("Reading", "Kana", "Yomi"),
    ) -> list[ImportCandidate | ImportSkip]:
        version = self._invoke("version", {})
        if version != 6:
            raise ExternalKnowledgeProtocolError(
                f"AnkiConnect v6 is required, received version {version!r}"
            )

        deck_names = self._invoke("deckNames", {})
        model_names = self._invoke("modelNames", {})
        if not isinstance(deck_names, list) or not all(isinstance(name, str) for name in deck_names):
            raise ExternalKnowledgeProtocolError("deckNames result must be a list of strings")
        if not isinstance(model_names, list) or not all(isinstance(name, str) for name in model_names):
            raise ExternalKnowledgeProtocolError("modelNames result must be a list of strings")
        if deck_name and deck_name not in deck_names:
            return [ImportSkip(
                "deck",
                "deck_not_found",
                metadata={"requested_deck": deck_name, "available_deck_count": len(deck_names)},
            )]
        if model_name and model_name not in model_names:
            return [ImportSkip(
                "model",
                "model_not_found",
                metadata={"requested_model": model_name, "available_model_count": len(model_names)},
            )]

        template_catalog: list[Mapping[str, Any]] = []
        if model_name:
            templates = self._invoke("modelTemplates", {"modelName": model_name})
            template_catalog = _template_catalog(templates)

        search_query = _compose_anki_query(query, deck_name)
        card_ids = self._invoke("findCards", {"query": search_query})
        if not isinstance(card_ids, list):
            raise ExternalKnowledgeProtocolError("findCards result must be a list")
        if not card_ids:
            return []

        state_memberships: dict[str, set[str]] = {}
        for state_name, predicate in ANKI_STATE_QUERY_NAMES.items():
            state_card_ids = self._invoke(
                "findCards",
                {"query": f"{search_query} {predicate}".strip()},
            )
            if not isinstance(state_card_ids, list):
                raise ExternalKnowledgeProtocolError(
                    f"findCards {state_name} result must be a list"
                )
            state_memberships[state_name] = {_anki_id(card_id) for card_id in state_card_ids}

        cards = self._invoke("cardsInfo", {"cards": card_ids})
        if not isinstance(cards, list):
            raise ExternalKnowledgeProtocolError("cardsInfo result must be a list")
        card_by_id: dict[str, Mapping[str, Any]] = {}
        candidates: list[ImportCandidate | ImportSkip] = []
        for card in cards:
            if not isinstance(card, Mapping):
                raise ExternalKnowledgeProtocolError("cardsInfo item must be an object")
            card_id = card.get("cardId", card.get("card_id"))
            if card_id is None:
                candidates.append(ImportSkip("card:unknown", "missing_card_id"))
                continue
            card_by_id[_anki_id(card_id)] = card

        cards_to_notes = self._invoke("cardsToNotes", {"cards": card_ids})
        note_by_card = _cards_to_notes_map(card_ids, cards_to_notes)
        notes_to_cards: dict[str, list[Mapping[str, Any]]] = {}
        for card_id in card_ids:
            normalized_card_id = _anki_id(card_id)
            card = card_by_id.get(normalized_card_id)
            note_id = note_by_card.get(normalized_card_id)
            if card is None:
                candidates.append(ImportSkip(
                    normalized_card_id or "card:unknown",
                    "missing_card_info",
                    metadata={"anki_cards": [{"card_id": normalized_card_id}]},
                ))
                continue
            if note_id is None:
                candidates.append(ImportSkip(
                    normalized_card_id or "card:unknown",
                    "missing_card_note_mapping",
                    metadata={"anki_cards": [{"card_id": normalized_card_id}]},
                ))
                continue
            evidence = _anki_card_evidence(
                card_id=normalized_card_id,
                note_id=note_id,
                card=card,
                state_memberships=state_memberships,
                template_catalog=template_catalog,
            )
            notes_to_cards.setdefault(note_id, []).append(evidence)

        note_ids = list(notes_to_cards)
        notes = self._invoke("notesInfo", {"notes": note_ids})
        if not isinstance(notes, list):
            raise ExternalKnowledgeProtocolError("notesInfo result must be a list")

        returned_note_ids: set[str] = set()
        for note in notes:
            if not isinstance(note, Mapping):
                raise ExternalKnowledgeProtocolError("note info item must be an object")
            note_id = _anki_id(note.get("noteId", note.get("note_id", note.get("id"))))
            if note_id:
                returned_note_ids.add(note_id)
            all_evidence = notes_to_cards.get(note_id, [])
            evidence_metadata = {
                "anki_cards": [dict(item) for item in all_evidence],
                "template_catalog": [dict(item) for item in template_catalog],
            }
            fields = note.get("fields")
            if not isinstance(fields, Mapping):
                candidates.append(ImportSkip(
                    note_id or "unknown",
                    "missing_fields",
                    metadata=evidence_metadata,
                ))
                continue
            note_model_name = _optional_string(note.get("modelName", note.get("model_name")))
            if model_name and note_model_name and note_model_name != model_name:
                candidates.append(ImportSkip(
                    note_id or "unknown",
                    "model_not_selected",
                    metadata=evidence_metadata,
                ))
                continue

            note_cards = note.get("cards")
            names_by_ord: dict[int, str | None] = {}
            if isinstance(note_cards, list):
                for note_card in note_cards:
                    if not isinstance(note_card, Mapping):
                        continue
                    ordinal = _optional_int(note_card.get("ord"))
                    if ordinal is not None:
                        names_by_ord[ordinal] = _optional_string(note_card.get("name"))
            if template_ord is not None and names_by_ord and template_ord not in names_by_ord:
                candidates.append(ImportSkip(
                    note_id or "unknown",
                    "template_not_found",
                    metadata=evidence_metadata,
                ))
                continue
            selected_evidence = _select_anki_template(
                all_evidence,
                template_ord=template_ord,
                names_by_ord=names_by_ord,
            )
            if not selected_evidence:
                candidates.append(ImportSkip(
                    note_id or "unknown",
                    "template_not_found",
                    metadata=evidence_metadata,
                ))
                continue
            evidence_metadata["selected_anki_cards"] = [dict(item) for item in selected_evidence]
            evidence_metadata["template_ord"] = selected_evidence[0].get("template_ord")
            evidence_metadata["model_name"] = note_model_name
            expression = _first_field(fields, expression_fields)
            reading = _first_field(fields, reading_fields)
            parsed = _candidate_from_raw(
                source_kind="anki",
                source_entry_id=note_id,
                expression=expression,
                reading=reading,
                metadata=evidence_metadata,
            )
            if isinstance(parsed, ImportCandidate):
                candidates.append(ImportCandidate(
                    normalized_form=parsed.normalized_form,
                    canonical_reading_kana=parsed.canonical_reading_kana,
                    source_kind=parsed.source_kind,
                    source_entry_id=parsed.source_entry_id,
                    display_form=parsed.display_form,
                    level=parsed.level,
                    metadata=parsed.metadata,
                    lexeme_id=parsed.lexeme_id,
                    target_state=_anki_target_state(selected_evidence),
                ))
            else:
                candidates.append(parsed)
        for note_id, evidence in notes_to_cards.items():
            if note_id in returned_note_ids:
                continue
            candidates.append(ImportSkip(
                note_id,
                "missing_note_info",
                metadata={"anki_cards": [dict(item) for item in evidence]},
            ))
        return candidates

    def inspect_catalog(self, *, model_name: str | None = None) -> dict[str, Any]:
        """Return a redacted Anki catalog for import configuration UIs.

        This deliberately reads only names, field names, and template names;
        note fields and card content never cross this boundary.
        """
        version = self._invoke("version", {})
        if version != 6:
            raise ExternalKnowledgeProtocolError(
                f"AnkiConnect v6 is required, received version {version!r}"
            )
        deck_names = self._invoke("deckNames", {})
        model_names = self._invoke("modelNames", {})
        if not isinstance(deck_names, list) or not all(isinstance(name, str) for name in deck_names):
            raise ExternalKnowledgeProtocolError("deckNames result must be a list of strings")
        if not isinstance(model_names, list) or not all(isinstance(name, str) for name in model_names):
            raise ExternalKnowledgeProtocolError("modelNames result must be a list of strings")

        selected_model = model_name if model_name in model_names else None
        fields: list[str] = []
        templates: list[dict[str, Any]] = []
        if model_name:
            if selected_model is None:
                raise ExternalKnowledgeProtocolError(f"Anki model not found: {model_name}")
            raw_fields = self._invoke("modelFieldNames", {"modelName": model_name})
            if not isinstance(raw_fields, list) or not all(isinstance(item, str) for item in raw_fields):
                raise ExternalKnowledgeProtocolError("modelFieldNames result must be a list of strings")
            fields = list(raw_fields)
            raw_templates = self._invoke("modelTemplates", {"modelName": model_name})
            if not isinstance(raw_templates, Mapping):
                raise ExternalKnowledgeProtocolError("modelTemplates result must be an object")
            templates = [
                {"ord": ordinal, "name": name}
                for ordinal, name in enumerate(raw_templates)
                if isinstance(name, str)
            ]
        return {
            "version": version,
            "deck_names": deck_names,
            "model_names": model_names,
            "selected_model": selected_model,
            "fields": fields,
            "templates": templates,
        }

    def _invoke(self, action: str, params: Mapping[str, Any]) -> Any:
        try:
            response = self.post(
                self.endpoint,
                json={"action": action, "version": 6, "params": dict(params)},
                timeout=self.timeout_seconds,
            )
        except requests.Timeout as exc:
            raise ExternalKnowledgeImportError(f"AnkiConnect timed out during {action}") from exc
        except requests.RequestException as exc:
            raise ExternalKnowledgeImportError(f"AnkiConnect request failed during {action}") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise ExternalKnowledgeProtocolError("AnkiConnect returned non-JSON response") from exc
        if not isinstance(payload, Mapping):
            raise ExternalKnowledgeProtocolError("AnkiConnect response must be an object")
        if payload.get("error"):
            raise ExternalKnowledgeProtocolError(f"AnkiConnect {action} error: {payload['error']}")
        if "result" not in payload:
            raise ExternalKnowledgeProtocolError("AnkiConnect response missing result")
        return payload["result"]


class JLPTJsonKnowledgeSource:
    """Load known JLPT entries from an explicit local JSON contract."""

    def __init__(self, json_path: str | Path) -> None:
        self.json_path = Path(json_path)

    def fetch_candidates(
        self,
        *,
        levels: Iterable[str] | None = None,
    ) -> list[ImportCandidate | ImportSkip]:
        allowed_levels = _validate_levels(levels)
        try:
            payload = json.loads(self.json_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise ExternalKnowledgeImportError(f"Unable to read JLPT JSON: {self.json_path}") from exc
        except json.JSONDecodeError as exc:
            raise ExternalKnowledgeProtocolError("JLPT JSON is not valid JSON") from exc

        if not isinstance(payload, Mapping) or payload.get("schema_version") != 1:
            raise ExternalKnowledgeProtocolError("JLPT JSON must be an object with schema_version=1")
        entries = payload.get("entries")
        if not isinstance(entries, list):
            raise ExternalKnowledgeProtocolError("JLPT JSON entries must be a list")

        candidates: list[ImportCandidate | ImportSkip] = []
        source_id = _normalize_text(payload.get("source_id"))
        for index, entry in enumerate(entries):
            if not isinstance(entry, Mapping):
                raise ExternalKnowledgeProtocolError(f"JLPT entry {index} must be an object")
            level = _normalize_text(entry.get("level"))
            if level not in JLPT_LEVELS:
                raise ExternalKnowledgeProtocolError(f"JLPT entry {index} has invalid level")
            if allowed_levels is not None and level not in allowed_levels:
                continue
            entry_id = entry.get("id") or f"{level}:{index}"
            candidates.append(_candidate_from_raw(
                source_kind="jlpt",
                source_entry_id=entry_id,
                expression=entry.get("word") or entry.get("expression"),
                reading=entry.get("reading"),
                level=level,
                metadata={
                    "level": level,
                    **({"source_id": source_id} if source_id else {}),
                },
            ))
        return candidates


def _first_field(fields: Mapping[str, Any], names: Iterable[str]) -> Any:
    for name in names:
        raw = fields.get(name)
        if isinstance(raw, Mapping):
            value = raw.get("value")
        else:
            value = raw
        if _normalize_text(value):
            return value
    return ""


def _validate_levels(levels: Iterable[str] | None) -> set[str] | None:
    if levels is None:
        return None
    normalized = {_normalize_text(level) for level in levels}
    invalid = normalized - JLPT_LEVELS
    if invalid:
        raise ValueError(f"Unsupported JLPT levels: {', '.join(sorted(invalid))}")
    return normalized
