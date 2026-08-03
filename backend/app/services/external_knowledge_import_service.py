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

    @property
    def identity_key(self) -> str:
        return stable_identity_key(self.normalized_form, self.canonical_reading_kana)


@dataclass(frozen=True)
class ImportSkip:
    source_entry_id: str
    reason: str
    normalized_form: str | None = None
    canonical_reading_kana: str | None = None


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

    def save_external_batch(
        self,
        batch_id: str,
        source_kind: str,
        import_digest: str,
        candidates: list[ImportCandidate],
    ) -> list[UserLexemeKnowledgeRecord]:
        batch = self.ExternalKnowledgeImport(
            batch_id=batch_id,
            source_kind=source_kind,
            status="applied",
            import_digest=import_digest,
            summary_json={"accepted_count": len(candidates)},
        )
        self.db.add(batch)

        created: list[UserLexemeKnowledgeRecord] = []
        for candidate in candidates:
            knowledge = self.db.query(self.UserLexemeKnowledge).filter(
                self.UserLexemeKnowledge.lexeme_id == candidate.lexeme_id,
                self.UserLexemeKnowledge.source == candidate.source_kind,
            ).one_or_none()
            if knowledge is None:
                knowledge = self.UserLexemeKnowledge(
                    lexeme_id=candidate.lexeme_id,
                    state=TRUSTED_STATUS,
                    source=candidate.source_kind,
                )
                self.db.add(knowledge)
            item = self.ExternalKnowledgeImportItem(
                knowledge_import=batch,
                lexeme_id=candidate.lexeme_id,
                normalized_form=candidate.normalized_form,
                canonical_reading_kana=candidate.canonical_reading_kana,
                source_entry_id=candidate.source_entry_id,
                level=candidate.level,
                metadata_json=dict(candidate.metadata),
                status="applied",
            )
            self.db.add(item)
            created.append(UserLexemeKnowledgeRecord(
                identity_key=candidate.identity_key,
                normalized_form=candidate.normalized_form,
                canonical_reading_kana=candidate.canonical_reading_kana,
                source_kind=candidate.source_kind,
                source_entry_id=candidate.source_entry_id,
                status=TRUSTED_STATUS,
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
        for item in items:
            has_other_active_item = self.db.query(self.ExternalKnowledgeImportItem).join(
                self.ExternalKnowledgeImport,
                self.ExternalKnowledgeImport.id == self.ExternalKnowledgeImportItem.import_id,
            ).filter(
                self.ExternalKnowledgeImportItem.lexeme_id == item.lexeme_id,
                self.ExternalKnowledgeImport.source_kind == batch.source_kind,
                self.ExternalKnowledgeImport.status == "applied",
                self.ExternalKnowledgeImportItem.status == "applied",
                self.ExternalKnowledgeImportItem.import_id != batch.id,
            ).first()
            if has_other_active_item is None:
                row = self.db.query(self.UserLexemeKnowledge).filter(
                    self.UserLexemeKnowledge.lexeme_id == item.lexeme_id,
                    self.UserLexemeKnowledge.source == batch.source_kind,
                ).one_or_none()
                if row is not None:
                    self.db.delete(row)
                    deleted += 1
            item.status = "rolled_back"
        batch.status = "rolled_back"
        batch.revoked_at = datetime.now(timezone.utc)
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


@dataclass(frozen=True)
class ImportPreview:
    source_kind: str
    import_digest: str
    accepted: list[ImportCandidate]
    skipped: list[ImportSkip]
    stats: ImportPreviewStats

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
    rows = [
        {
            "identity_key": candidate.identity_key,
            "source_kind": candidate.source_kind,
            "source_entry_id": candidate.source_entry_id,
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
        return ImportSkip(entry_id, "missing_normalized_form")
    if not canonical_reading:
        return ImportSkip(entry_id, "missing_trusted_canonical_reading", normalized_form)
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
        seen: set[str] = set()
        total = 0
        parsable = 0
        ambiguous = 0
        unmatched = 0
        provisional = 0

        for raw in raw_candidates:
            total += 1
            if isinstance(raw, ImportSkip):
                skipped.append(raw)
                continue

            candidate = raw
            parsable += 1
            if candidate.source_kind != source_kind:
                skipped.append(ImportSkip(
                    candidate.source_entry_id,
                    "source_kind_mismatch",
                    candidate.normalized_form,
                    candidate.canonical_reading_kana,
                ))
                continue

            if candidate.identity_key in seen:
                skipped.append(ImportSkip(
                    candidate.source_entry_id,
                    "duplicate_in_preview",
                    candidate.normalized_form,
                    candidate.canonical_reading_kana,
                ))
                continue
            seen.add(candidate.identity_key)

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
            accepted.append(resolved)

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
            ),
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
        query: str,
        expression_fields: Iterable[str] = ("Expression", "Word", "Vocabulary", "Front"),
        reading_fields: Iterable[str] = ("Reading", "Kana", "Yomi"),
    ) -> list[ImportCandidate | ImportSkip]:
        version = self._invoke("version", {})
        if not isinstance(version, int):
            raise ExternalKnowledgeProtocolError("version result must be an integer")
        note_ids = self._invoke("findNotes", {"query": query})
        if not isinstance(note_ids, list):
            raise ExternalKnowledgeProtocolError("findNotes result must be a list")
        if not note_ids:
            return []
        notes = self._invoke("notesInfo", {"notes": note_ids})
        if not isinstance(notes, list):
            raise ExternalKnowledgeProtocolError("notesInfo result must be a list")

        candidates: list[ImportCandidate | ImportSkip] = []
        for note in notes:
            if not isinstance(note, Mapping):
                raise ExternalKnowledgeProtocolError("note info item must be an object")
            note_id = note.get("noteId") or note.get("note_id") or note.get("id")
            fields = note.get("fields")
            if not isinstance(fields, Mapping):
                candidates.append(ImportSkip(str(note_id or "unknown"), "missing_fields"))
                continue
            expression = _first_field(fields, expression_fields)
            reading = _first_field(fields, reading_fields)
            candidates.append(_candidate_from_raw(
                source_kind="anki",
                source_entry_id=note_id,
                expression=expression,
                reading=reading,
                metadata={
                    "model": note.get("modelName"),
                    "tags": note.get("tags") if isinstance(note.get("tags"), list) else [],
                    "anki_connect_version": version,
                },
            ))
        return candidates

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
