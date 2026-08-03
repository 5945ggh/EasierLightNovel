"""Build and query disposable lexical analysis runs."""

from __future__ import annotations

import hashlib
import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version as package_version
from typing import Any, Callable, Iterable, Optional

from sqlalchemy.orm import Session

from app.config import TOKENIZER_DEFAULT_MODE
from app.enums import AnalysisRunStatus
from app.models import (
    AnalysisRun,
    Book,
    Chapter,
    ChapterLexemeStat,
    Lexeme,
    LexemeOccurrence,
    RunLexeme,
    SourceContentVersion,
    UserProgress,
    Vocabulary,
)
from app.services.source_content_service import source_content_hash
from app.services.user_lexeme_knowledge_service import UserLexemeKnowledgeService
from app.utils.lexeme_identity import normalize_canonical_reading, normalize_identity_text
from app.utils.tokenizer import JapaneseTokenizer, RebuildToken


logger = logging.getLogger(__name__)

ANALYSIS_SCHEMA_VERSION = 1
TOKENIZER_CONTRACT_VERSION = "rebuild-token-v1"
CONTENT_POS_ALLOWLIST = ("名詞", "動詞", "形容詞", "形状詞", "副詞")
FILTER_SPEC = {
    "pos_allowlist": list(CONTENT_POS_ALLOWLIST),
    "exclude_oov": False,
    "exclude_proper_nouns": False,
    "identity": "normalized_form_and_trusted_canonical_reading",
}
LEARNING_MAP_TARGETS = (0.80, 0.90, 0.95, 0.96)
LEGACY_MASTERED_STATUS = 3


class AnalysisSourceUnavailable(ValueError):
    """Raised before a run exists when no rebuildable source can be selected."""


class AnalysisBookNotFound(ValueError):
    """Raised when a learning-map request references an unknown book."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _package_version(distribution: str) -> str:
    try:
        return package_version(distribution)
    except PackageNotFoundError:
        return "unknown"


def _stable_hash(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _normalize_identity_text(value: str) -> str:
    return normalize_identity_text(value)


def _normalize_reading(value: Optional[str]) -> Optional[str]:
    return normalize_canonical_reading(value)


def _reader_segment_for(
    start_offset: int,
    end_offset: int,
    spans: Iterable[dict[str, Any]],
) -> Optional[int]:
    for span in spans:
        if start_offset >= span["start_offset"] and end_offset <= span["end_offset"]:
            return int(span["reader_segment_index"])
    return None


def _is_nonnegative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _normalized_filter_spec(value: Any) -> dict[str, Any]:
    """Return the small, reproducible filter contract exposed by read APIs."""
    raw = value if isinstance(value, dict) else {}
    pos_allowlist = raw.get("pos_allowlist", FILTER_SPEC["pos_allowlist"])
    if not isinstance(pos_allowlist, list) or not pos_allowlist:
        pos_allowlist = FILTER_SPEC["pos_allowlist"]
    return {
        "pos_allowlist": [str(pos) for pos in pos_allowlist],
        "exclude_proper_nouns": bool(raw.get("exclude_proper_nouns", False)),
        "exclude_oov": bool(raw.get("exclude_oov", False)),
        "identity": str(raw.get("identity", FILTER_SPEC["identity"])),
    }


def _validate_source_span(
    *,
    document_id: str,
    text: str,
    span: Any,
    label: str,
    previous_end: int,
    require_reader_segment: bool,
) -> int:
    if not isinstance(span, dict):
        raise ValueError(f"{label} in source document {document_id} must be an object")
    start = span.get("start_offset")
    end = span.get("end_offset")
    if not _is_nonnegative_int(start) or not _is_nonnegative_int(end):
        raise ValueError(f"{label} in source document {document_id} has invalid offsets")
    if start < previous_end or end <= start or end > len(text):
        raise ValueError(f"{label} in source document {document_id} is out of order or bounds")
    if require_reader_segment and not _is_nonnegative_int(span.get("reader_segment_index")):
        raise ValueError(f"{label} in source document {document_id} has invalid reader segment")
    return end


def _validate_structural_boundary(
    *,
    document_id: str,
    text: str,
    boundary: Any,
    previous_end: int,
) -> tuple[int, int]:
    """Validate the Phase 1 offset-based boundary schema without rewriting it."""
    if not isinstance(boundary, dict):
        raise ValueError(f"Structural boundary in source document {document_id} must be an object")
    start = boundary.get("offset")
    boundary_text = boundary.get("text")
    if not _is_nonnegative_int(start):
        raise ValueError(f"Structural boundary in source document {document_id} has invalid offset")
    if not isinstance(boundary_text, str) or not boundary_text:
        raise ValueError(f"Structural boundary in source document {document_id} has no text")
    expected_end = start + len(boundary_text)
    end = boundary.get("end_offset", expected_end)
    if not _is_nonnegative_int(end) or end != expected_end:
        raise ValueError(f"Structural boundary in source document {document_id} has invalid end offset")
    if start < previous_end or end > len(text):
        raise ValueError(f"Structural boundary in source document {document_id} is out of order or bounds")
    if boundary_text != text[start:end]:
        raise ValueError(f"Structural boundary in source document {document_id} does not match text")
    if not isinstance(boundary.get("reason"), str) or not boundary["reason"]:
        raise ValueError(f"Structural boundary in source document {document_id} has no reason")
    return start, end


def _validate_source_content_contract(
    source_content: Any,
    source_version: SourceContentVersion,
) -> list[dict[str, Any]]:
    """Validate the persisted Phase 1 source schema before publishing a run."""
    if not isinstance(source_content, dict):
        raise ValueError("Source content payload must be an object")
    if source_content.get("schema_version") != source_version.source_schema_version:
        raise ValueError("Source content schema version does not match its row")
    if source_content.get("offset_unit") != "unicode_codepoint":
        raise ValueError("Source content offset unit must be unicode_codepoint")
    documents = source_content.get("documents")
    if not isinstance(documents, list):
        raise ValueError("Source content documents must be a list")

    document_ids: set[str] = set()
    for document in documents:
        if not isinstance(document, dict):
            raise ValueError("Source content document must be an object")
        document_id = document.get("document_id")
        text = document.get("text")
        if not isinstance(document_id, str) or not document_id:
            raise ValueError("Source content document has no document_id")
        if document_id in document_ids:
            raise ValueError(f"Duplicate source document id: {document_id}")
        document_ids.add(document_id)
        if not isinstance(text, str):
            raise ValueError(f"Source document {document_id} has no text")

        ruby_hints = document.get("ruby_hints")
        if not isinstance(ruby_hints, list):
            raise ValueError(f"Source document {document_id} ruby_hints must be a list")
        for hint in ruby_hints:
            end = _validate_source_span(
                document_id=document_id,
                text=text,
                span=hint,
                label="Ruby hint",
                previous_end=0,
                require_reader_segment=False,
            )
            assert isinstance(hint, dict)
            start = hint["start_offset"]
            if hint.get("base_text") != text[start:end]:
                raise ValueError(f"Ruby hint in source document {document_id} does not match text")
            if not isinstance(hint.get("reading_raw"), str) or not hint["reading_raw"]:
                raise ValueError(f"Ruby hint in source document {document_id} has no reading")
            if not isinstance(hint.get("markup"), dict):
                raise ValueError(f"Ruby hint in source document {document_id} has invalid markup")

        boundaries = document.get("structural_boundaries")
        if not isinstance(boundaries, list):
            raise ValueError(f"Source document {document_id} structural_boundaries must be a list")
        boundary_end = 0
        validated_boundaries: list[tuple[int, int]] = []
        for boundary in boundaries:
            boundary_start, boundary_end = _validate_structural_boundary(
                document_id=document_id,
                text=text,
                boundary=boundary,
                previous_end=boundary_end,
            )
            validated_boundaries.append((boundary_start, boundary_end))

        projection = document.get("reader_projection")
        if not text.strip() and projection is None:
            continue
        if not isinstance(projection, dict):
            raise ValueError(f"Source document {document_id} has no reader projection")
        if not _is_nonnegative_int(projection.get("reader_chapter_index")):
            raise ValueError(f"Source document {document_id} has invalid reader chapter index")
        spans = projection.get("text_spans")
        if not isinstance(spans, list):
            raise ValueError(f"Source document {document_id} text_spans must be a list")
        span_end = 0
        for span in spans:
            span_end = _validate_source_span(
                document_id=document_id,
                text=text,
                span=span,
                label="Reader text span",
                previous_end=span_end,
                require_reader_segment=True,
            )
            assert isinstance(span, dict)
            span_start = span["start_offset"]
            if any(span_start < boundary_end and span_end > boundary_start
                   for boundary_start, boundary_end in validated_boundaries):
                raise ValueError(
                    f"Reader text span in source document {document_id} crosses a structural boundary"
                )
    return documents


class AnalysisService:
    """Owns run lifecycle, publication, and Phase 3-facing read contracts."""

    def __init__(
        self,
        db: Session,
        tokenizer_factory: Callable[..., JapaneseTokenizer] = JapaneseTokenizer,
    ):
        self.db = db
        self.tokenizer_factory = tokenizer_factory

    def rebuild_book_analysis(
        self,
        book_id: str,
        *,
        source_content_version_id: Optional[int] = None,
        split_mode: str = TOKENIZER_DEFAULT_MODE,
    ) -> AnalysisRun:
        """Build a fresh run and atomically publish it only after validation."""
        book = self.db.get(Book, book_id)
        if book is None:
            raise AnalysisSourceUnavailable(f"Book not found: {book_id}")
        if book.source_rebuild_status != "rebuildable":
            raise AnalysisSourceUnavailable(
                f"Book {book_id} has no rebuildable source content"
            )

        source_query = self.db.query(SourceContentVersion).filter(
            SourceContentVersion.book_id == book_id
        )
        if source_content_version_id is not None:
            source_query = source_query.filter(
                SourceContentVersion.id == source_content_version_id
            )
        source_version = source_query.order_by(SourceContentVersion.id.desc()).first()
        if source_version is None:
            raise AnalysisSourceUnavailable(
                f"Source content version not found for book {book_id}"
            )

        split_mode_is_valid = split_mode in {"A", "B", "C"}
        run = AnalysisRun(
            book_id=book_id,
            source_content_version_id=source_version.id,
            status=AnalysisRunStatus.PENDING,
            is_active=False,
            tokenizer_name="SudachiPy",
            tokenizer_version=_package_version("SudachiPy"),
            tokenizer_contract_version=TOKENIZER_CONTRACT_VERSION,
            dictionary_name="sudachidict-core",
            dictionary_version=_package_version("sudachidict-core"),
            # Keep the persisted column within its A/B/C contract when an
            # internal caller supplies an invalid value; the error message
            # below preserves the reason the run could not start.
            split_mode=split_mode if split_mode_is_valid else TOKENIZER_DEFAULT_MODE,
            analysis_schema_version=ANALYSIS_SCHEMA_VERSION,
            source_content_sha256=source_version.source_content_sha256,
            filter_spec=FILTER_SPEC,
        )
        self.db.add(run)

        if not split_mode_is_valid:
            run.status = AnalysisRunStatus.FAILED
            run.is_active = False
            run.error_message = "split_mode must be one of A, B, or C"
            run.completed_at = _utcnow()
            self.db.commit()
            self.db.refresh(run)
            return run

        self.db.commit()
        self.db.refresh(run)

        try:
            run.status = AnalysisRunStatus.PROCESSING
            run.started_at = _utcnow()
            self.db.commit()

            self._build_run(run, source_version, split_mode)
            return run
        except Exception as exc:
            logger.exception("Analysis run %s failed for book %s", run.id, book_id)
            self.db.rollback()
            failed_run = self.db.get(AnalysisRun, run.id)
            if failed_run is None:
                raise
            failed_run.status = AnalysisRunStatus.FAILED
            failed_run.is_active = False
            failed_run.error_message = str(exc)[:2000]
            failed_run.completed_at = _utcnow()
            self.db.commit()
            self.db.refresh(failed_run)
            return failed_run

    def _build_run(
        self,
        run: AnalysisRun,
        source_version: SourceContentVersion,
        split_mode: str,
    ) -> None:
        source_content = source_version.source_content_json
        documents = _validate_source_content_contract(source_content, source_version)
        if source_content_hash(source_content) != source_version.source_content_sha256:
            raise ValueError("Source content hash does not match its immutable identity")

        chapters = {
            chapter.index: chapter
            for chapter in self.db.query(Chapter).filter(Chapter.book_id == run.book_id)
        }
        tokenizer = self.tokenizer_factory(mode=split_mode)

        identity_specs: dict[str, tuple[str, Optional[str]]] = {}
        observation_specs: dict[str, dict[str, Any]] = {}
        occurrence_drafts: list[dict[str, Any]] = []
        stat_counts: Counter[tuple[int, int, str]] = Counter()

        for document in documents:
            projection = document.get("reader_projection")
            if not projection:
                continue
            chapter_index = int(projection["reader_chapter_index"])
            chapter = chapters.get(chapter_index)
            if chapter is None:
                raise ValueError(
                    f"Source document maps to missing chapter index {chapter_index}"
                )

            document_id = str(document["document_id"])
            text = document.get("text")
            if not isinstance(text, str):
                raise ValueError(f"Source document {document_id} has no text")
            spans = projection.get("text_spans", [])

            for source_token_index, token in enumerate(
                tokenizer.tokenize_for_rebuild(text)
            ):
                if token.part_of_speech[0] not in CONTENT_POS_ALLOWLIST:
                    continue
                normalized_form = _normalize_identity_text(
                    token.normalized_form or token.dictionary_form or token.surface
                )
                if not normalized_form:
                    continue
                self._validate_token_offsets(document_id, text, token)

                canonical_reading = None
                if token.has_trusted_reading:
                    canonical_reading = _normalize_reading(
                        tokenizer.canonical_reading_for(token)
                    )
                identity_key = _stable_hash([normalized_form, canonical_reading])
                identity_specs[identity_key] = (normalized_form, canonical_reading)

                observed_reading_kana = _normalize_reading(token.reading_form)
                observation = {
                    "identity_key": identity_key,
                    "dictionary_form": token.dictionary_form or token.surface,
                    "normalized_form": normalized_form,
                    "observed_reading": token.reading_form,
                    "observed_reading_kana": observed_reading_kana,
                "reading_source": token.reading_provenance,
                "reading_is_trusted": token.has_trusted_reading,
                "is_oov": token.is_oov,
                "excluded_from_learning_target": token.is_oov,
                "part_of_speech": list(token.part_of_speech),
                    "inflection_type": token.conjugation_type,
                    "inflection_form": token.conjugation_form,
                    "word_id": token.word_id,
                    "dictionary_id": token.dictionary_id,
                }
                observation_key = _stable_hash({
                    key: value
                    for key, value in observation.items()
                    if key not in {"word_id", "dictionary_id"}
                })
                observation_specs.setdefault(observation_key, observation)
                occurrence_drafts.append({
                    "chapter": chapter,
                    "chapter_index": chapter_index,
                    "observation_key": observation_key,
                    "identity_key": identity_key,
                    "surface": token.surface,
                    "source_document_id": document_id,
                    "source_start": token.start_offset,
                    "source_end": token.end_offset,
                    "source_token_index": source_token_index,
                    "reader_segment_index": _reader_segment_for(
                        token.start_offset,
                        token.end_offset,
                        spans,
                    ),
                })
                stat_counts[(chapter.id, chapter_index, identity_key)] += 1

        lexemes = self._resolve_lexemes(identity_specs)
        run_lexemes = self._create_run_lexemes(run, observation_specs, lexemes)

        occurrences = [
            LexemeOccurrence(
                analysis_run=run,
                chapter=draft["chapter"],
                chapter_index=draft["chapter_index"],
                run_lexeme=run_lexemes[draft["observation_key"]],
                surface=draft["surface"],
                source_document_id=draft["source_document_id"],
                source_start=draft["source_start"],
                source_end=draft["source_end"],
                source_token_index=draft["source_token_index"],
                reader_segment_index=draft["reader_segment_index"],
            )
            for draft in occurrence_drafts
        ]
        self.db.add_all(occurrences)

        stats = [
            ChapterLexemeStat(
                analysis_run=run,
                chapter_id=chapter_id,
                chapter_index=chapter_index,
                lexeme=lexemes[identity_key],
                occurrence_count=count,
            )
            for (chapter_id, chapter_index, identity_key), count in stat_counts.items()
        ]
        self.db.add_all(stats)

        result_rows = sorted(
            (
                draft["source_document_id"],
                draft["source_start"],
                draft["source_end"],
                draft["identity_key"],
                draft["observation_key"],
            )
            for draft in occurrence_drafts
        )
        run.lexeme_count = len(identity_specs)
        run.occurrence_count = len(occurrences)
        run.chapter_stat_count = len(stats)
        run.result_sha256 = _stable_hash(result_rows)

        self.db.flush()
        self.db.query(AnalysisRun).filter(
            AnalysisRun.book_id == run.book_id,
            AnalysisRun.is_active.is_(True),
            AnalysisRun.id != run.id,
        ).update({AnalysisRun.is_active: False}, synchronize_session=False)
        self.db.flush()
        run.status = AnalysisRunStatus.COMPLETED
        run.is_active = True
        run.completed_at = _utcnow()
        run.error_message = None
        self.db.commit()

    @staticmethod
    def _validate_token_offsets(
        document_id: str,
        text: str,
        token: RebuildToken,
    ) -> None:
        if not 0 <= token.start_offset < token.end_offset <= len(text):
            raise ValueError(f"Invalid token offsets in source document {document_id}")
        if text[token.start_offset:token.end_offset] != token.surface:
            raise ValueError(f"Token surface does not match source offsets in {document_id}")

    def _resolve_lexemes(
        self,
        identity_specs: dict[str, tuple[str, Optional[str]]],
    ) -> dict[str, Lexeme]:
        keys = list(identity_specs)
        existing: dict[str, Lexeme] = {}
        for start in range(0, len(keys), 500):
            rows = self.db.query(Lexeme).filter(
                Lexeme.identity_key.in_(keys[start:start + 500])
            ).all()
            existing.update({row.identity_key: row for row in rows})

        for identity_key, (normalized_form, canonical_reading) in identity_specs.items():
            if identity_key in existing:
                continue
            lexeme = Lexeme(
                normalized_form=normalized_form,
                canonical_reading_kana=canonical_reading,
                is_provisional=canonical_reading is None,
                identity_key=identity_key,
            )
            self.db.add(lexeme)
            existing[identity_key] = lexeme
        self.db.flush()
        return existing

    def _create_run_lexemes(
        self,
        run: AnalysisRun,
        observation_specs: dict[str, dict[str, Any]],
        lexemes: dict[str, Lexeme],
    ) -> dict[str, RunLexeme]:
        rows: dict[str, RunLexeme] = {}
        for observation_key, spec in observation_specs.items():
            row = RunLexeme(
                analysis_run=run,
                lexeme=lexemes[spec["identity_key"]],
                observation_key=observation_key,
                dictionary_form=spec["dictionary_form"],
                normalized_form=spec["normalized_form"],
                observed_reading=spec["observed_reading"],
                observed_reading_kana=spec["observed_reading_kana"],
                reading_source=spec["reading_source"],
                reading_is_trusted=spec["reading_is_trusted"],
                is_oov=spec["is_oov"],
                excluded_from_learning_target=spec["excluded_from_learning_target"],
                part_of_speech=spec["part_of_speech"],
                inflection_type=spec["inflection_type"],
                inflection_form=spec["inflection_form"],
                word_id=spec["word_id"],
                dictionary_id=spec["dictionary_id"],
            )
            self.db.add(row)
            rows[observation_key] = row
        self.db.flush()
        return rows

    def get_active_run(self, book_id: str) -> Optional[AnalysisRun]:
        return self.db.query(AnalysisRun).filter(
            AnalysisRun.book_id == book_id,
            AnalysisRun.is_active.is_(True),
            AnalysisRun.status == AnalysisRunStatus.COMPLETED,
        ).one_or_none()

    @staticmethod
    def _occurrence_matches_filter(run_lexeme: RunLexeme, filter_spec: dict[str, Any]) -> bool:
        pos = run_lexeme.part_of_speech or []
        pos_values = [str(value) for value in pos]
        if not pos_values or pos_values[0] not in filter_spec["pos_allowlist"]:
            return False
        if filter_spec["exclude_oov"] and run_lexeme.is_oov:
            return False
        if filter_spec["exclude_proper_nouns"] and "固有名詞" in pos_values:
            return False
        return True

    @staticmethod
    def _is_learning_target_excluded(run_lexeme: RunLexeme) -> bool:
        # The explicit flag is persisted for future policy changes. The OOV
        # fallback keeps old Phase 2 rows conservative after migration.
        return bool(
            getattr(run_lexeme, "excluded_from_learning_target", False)
            or run_lexeme.is_oov
        )

    def _reading_anchor_chapter(self, book_id: str, chapter_index: Optional[int]) -> int:
        if chapter_index is not None:
            return chapter_index
        progress = self.db.query(UserProgress).filter(
            UserProgress.book_id == book_id,
        ).one_or_none()
        return int(progress.current_chapter_index) if progress else 0

    def _legacy_known_lexeme_ids(
        self,
        book_id: str,
        run_id: int,
    ) -> tuple[set[int], str, int]:
        """Map only unambiguous legacy mastered rows to canonical Lexemes."""
        legacy_rows = self.db.query(Vocabulary).filter(
            Vocabulary.book_id == book_id,
            Vocabulary.status == LEGACY_MASTERED_STATUS,
        ).all()
        if not legacy_rows:
            return set(), "none", 0

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
            candidates_by_form[run_lexeme.dictionary_form][lexeme.id].append(
                (run_lexeme, lexeme)
            )

        known_ids: set[int] = set()
        mapped_row_count = 0
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

            # A base form without a reading is accepted only when it has one
            # canonical meaning in this active run. This avoids guessing in
            # homograph and provisional/OOV cases.
            if len(matching_ids) == 1:
                known_ids.add(matching_ids[0])
                mapped_row_count += 1
            else:
                unmapped_count += 1

        if mapped_row_count == len(legacy_rows):
            migration_status = "ready"
        elif known_ids:
            migration_status = "partial"
        else:
            migration_status = "uninitialized"
        return known_ids, migration_status, unmapped_count

    def get_learning_map(
        self,
        book_id: str,
        *,
        chapter_index: Optional[int] = None,
        recommendation_limit: int = 20,
    ) -> dict[str, Any]:
        """Build the user-visible book learning map from one active run."""
        book = self.db.get(Book, book_id)
        if book is None:
            raise AnalysisBookNotFound(f"Book not found: {book_id}")

        run = self.get_active_run(book_id)
        filter_spec = _normalized_filter_spec(run.filter_spec if run else FILTER_SPEC)
        anchor_chapter_index = self._reading_anchor_chapter(book_id, chapter_index)
        if run is None:
            return {
                "book_id": book_id,
                "analysis_status": "needs_analysis",
                "analysis_run_id": None,
                "knowledge_baseline_status": "uninitialized",
                "knowledge_baseline_migration_status": "none",
                "knowledge_baseline_message": (
                    "本书还没有可用的分析结果，请重新分析后生成学习地图。"
                ),
                "filter_spec": filter_spec,
                "reading_anchor_chapter_index": anchor_chapter_index,
                "coverage": None,
                "coverage_curve": [],
                "chapters": [],
                "recommended_lexemes": [],
                "manageable_lexemes": [],
            }

        chapter_rows = self.db.query(Chapter).filter(
            Chapter.book_id == book_id,
        ).order_by(Chapter.index).all()
        chapter_data: dict[int, dict[str, Any]] = {
            chapter.index: {
                "chapter_index": chapter.index,
                "title": chapter.title or f"第 {chapter.index + 1} 章",
                "eligible_occurrences": 0,
                "explicit_known_occurrences": None,
                "unknown_occurrences": None,
                "unknown_lexeme_count": None,
                "new_lexeme_count": 0,
                "lexeme_ids": set(),
            }
            for chapter in chapter_rows
        }
        aggregates: dict[int, dict[str, Any]] = {}

        occurrence_rows = self.db.query(
            LexemeOccurrence,
            RunLexeme,
            Lexeme,
        ).join(
            RunLexeme,
            RunLexeme.id == LexemeOccurrence.run_lexeme_id,
        ).join(
            Lexeme,
            Lexeme.id == RunLexeme.lexeme_id,
        ).filter(
            LexemeOccurrence.analysis_run_id == run.id,
        ).order_by(
            LexemeOccurrence.chapter_index,
            LexemeOccurrence.source_document_id,
            LexemeOccurrence.source_start,
            LexemeOccurrence.source_token_index,
        ).all()

        knowledge_service = UserLexemeKnowledgeService(self.db)
        for occurrence, run_lexeme, lexeme in occurrence_rows:
            if not self._occurrence_matches_filter(run_lexeme, filter_spec):
                continue
            canonical_lexeme = knowledge_service.resolve_canonical_lexeme(lexeme.id)
            chapter = chapter_data.setdefault(occurrence.chapter_index, {
                "chapter_index": occurrence.chapter_index,
                "title": f"第 {occurrence.chapter_index + 1} 章",
                "eligible_occurrences": 0,
                "explicit_known_occurrences": None,
                "unknown_occurrences": None,
                "unknown_lexeme_count": None,
                "new_lexeme_count": 0,
                "lexeme_ids": set(),
            })
            chapter["eligible_occurrences"] += 1
            chapter["lexeme_ids"].add(canonical_lexeme.id)

            item = aggregates.setdefault(canonical_lexeme.id, {
                "lexeme": canonical_lexeme,
                "representative": run_lexeme,
                "book_occurrence_count": 0,
                "chapter_counts": defaultdict(int),
                "first_chapter_index": occurrence.chapter_index,
                "excluded_from_learning_target": False,
            })
            if (
                item["representative"].is_oov
                and not run_lexeme.is_oov
            ):
                item["representative"] = run_lexeme
            item["book_occurrence_count"] += 1
            item["chapter_counts"][occurrence.chapter_index] += 1
            item["first_chapter_index"] = min(
                item["first_chapter_index"],
                occurrence.chapter_index,
            )
            item["excluded_from_learning_target"] = (
                item["excluded_from_learning_target"]
                or self._is_learning_target_excluded(run_lexeme)
            )

        known_ids, baseline_summary = knowledge_service.effective_known_lexeme_ids(
            book_id,
            run_id=run.id,
            migrate_legacy=True,
        )
        baseline_ready = bool(known_ids)
        migration_status = baseline_summary["migration_status"]
        unmapped_count = baseline_summary["legacy_unmapped_count"]
        if baseline_ready:
            baseline_status = "ready"
        else:
            baseline_status = "uninitialized"
        baseline_message = baseline_summary["message"]

        eligible_occurrences = sum(
            item["book_occurrence_count"] for item in aggregates.values()
        )
        known_occurrences = sum(
            item["book_occurrence_count"]
            for lexeme_id, item in aggregates.items()
            if lexeme_id in known_ids
        )
        coverage = (
            {
                "explicit_known_coverage": known_occurrences / eligible_occurrences,
                "known_occurrences": known_occurrences,
                "eligible_occurrences": eligible_occurrences,
            }
            if baseline_ready and eligible_occurrences > 0
            else None
        )

        frequency_items = sorted(
            aggregates.values(),
            key=lambda item: (
                -item["book_occurrence_count"],
                item["lexeme"].normalized_form,
                item["lexeme"].id,
            ),
        )
        coverage_curve = []
        for target_coverage in LEARNING_MAP_TARGETS:
            if eligible_occurrences == 0:
                required_count = 0
                covered_occurrences = 0
            else:
                cumulative = 0
                required_count = 0
                covered_occurrences = 0
                for item in frequency_items:
                    cumulative += item["book_occurrence_count"]
                    required_count += 1
                    covered_occurrences = cumulative
                    if cumulative / eligible_occurrences >= target_coverage:
                        break
            coverage_curve.append({
                "target_coverage": target_coverage,
                "required_lexeme_count": required_count,
                "covered_occurrences": covered_occurrences,
            })

        chapters = []
        for chapter_index_value in sorted(chapter_data):
            chapter = chapter_data[chapter_index_value]
            lexeme_ids = chapter.pop("lexeme_ids")
            chapter["new_lexeme_count"] = sum(
                item["first_chapter_index"] == chapter_index_value
                for item in aggregates.values()
            )
            if baseline_ready:
                known_in_chapter = sum(
                    aggregates[lexeme_id]["chapter_counts"].get(chapter_index_value, 0)
                    for lexeme_id in lexeme_ids
                    if lexeme_id in known_ids
                )
                chapter["explicit_known_occurrences"] = known_in_chapter
                chapter["unknown_occurrences"] = chapter["eligible_occurrences"] - known_in_chapter
                chapter["unknown_lexeme_count"] = len(lexeme_ids - known_ids)
            chapters.append(chapter)

        effective_states = knowledge_service.effective_states(set(aggregates))
        manageable_lexemes = []
        recommendation_candidates = []
        for lexeme_id, item in aggregates.items():
            if item["excluded_from_learning_target"]:
                continue
            upcoming_count = sum(
                count
                for index, count in item["chapter_counts"].items()
                if index >= anchor_chapter_index
            )
            recommendation_candidates.append((
                -upcoming_count,
                -item["book_occurrence_count"],
                item["first_chapter_index"],
                item["lexeme"].normalized_form,
                item["lexeme"].id,
                item,
                upcoming_count,
            ))
        recommendation_candidates.sort(key=lambda candidate: candidate[:5])
        for candidate in recommendation_candidates[:recommendation_limit]:
            item = candidate[5]
            representative = item["representative"]
            pos = representative.part_of_speech or []
            manageable_lexemes.append({
                "lexeme_id": item["lexeme"].id,
                "normalized_form": item["lexeme"].normalized_form,
                "display_form": representative.dictionary_form or item["lexeme"].normalized_form,
                "reading": item["lexeme"].canonical_reading_kana,
                "part_of_speech": str(pos[0]) if pos else "",
                "book_occurrence_count": item["book_occurrence_count"],
                "upcoming_chapter_occurrence_count": candidate[6],
                "first_chapter_index": item["first_chapter_index"],
                "excluded_from_learning_target": item["excluded_from_learning_target"],
                "knowledge_status": effective_states.get(item["lexeme"].id),
                "is_recommended": (
                    item["lexeme"].id not in known_ids
                    and effective_states.get(item["lexeme"].id) != "ignored"
                ),
            })

        recommended_lexemes = []
        if baseline_ready:
            for candidate in recommendation_candidates[:recommendation_limit]:
                item = candidate[5]
                if (
                    item["lexeme"].id in known_ids
                    or effective_states.get(item["lexeme"].id) == "ignored"
                ):
                    continue
                representative = item["representative"]
                pos = representative.part_of_speech or []
                recommended_lexemes.append({
                    "lexeme_id": item["lexeme"].id,
                    "normalized_form": item["lexeme"].normalized_form,
                    "display_form": representative.dictionary_form or item["lexeme"].normalized_form,
                    "reading": item["lexeme"].canonical_reading_kana,
                    "part_of_speech": str(pos[0]) if pos else "",
                    "book_occurrence_count": item["book_occurrence_count"],
                    "upcoming_chapter_occurrence_count": candidate[6],
                    "first_chapter_index": item["first_chapter_index"],
                    "excluded_from_learning_target": item["excluded_from_learning_target"],
                    "knowledge_status": effective_states.get(item["lexeme"].id),
                })

        return {
            "book_id": book_id,
            "analysis_status": "ready",
            "analysis_run_id": run.id,
            "knowledge_baseline_status": baseline_status,
            "knowledge_baseline_migration_status": migration_status,
            "knowledge_baseline_message": baseline_message,
            "filter_spec": filter_spec,
            "reading_anchor_chapter_index": anchor_chapter_index,
            "coverage": coverage,
            "coverage_curve": coverage_curve,
            "chapters": chapters,
            "recommended_lexemes": recommended_lexemes,
            "manageable_lexemes": manageable_lexemes,
        }

    def get_active_lexeme_stats(
        self,
        book_id: str,
        *,
        chapter_index: Optional[int] = None,
    ) -> tuple[Optional[AnalysisRun], list[dict[str, Any]]]:
        """Aggregate book counts from chapter rows; no BookLexemeStat is stored."""
        run = self.get_active_run(book_id)
        if run is None:
            return None, []

        query = self.db.query(ChapterLexemeStat, Lexeme).join(
            Lexeme,
            Lexeme.id == ChapterLexemeStat.lexeme_id,
        ).filter(ChapterLexemeStat.analysis_run_id == run.id)
        if chapter_index is not None:
            query = query.filter(ChapterLexemeStat.chapter_index == chapter_index)

        aggregated: dict[int, dict[str, Any]] = {}
        for stat, lexeme in query.all():
            item = aggregated.setdefault(lexeme.id, {
                "lexeme_id": lexeme.id,
                "normalized_form": lexeme.normalized_form,
                "canonical_reading_kana": lexeme.canonical_reading_kana,
                "is_provisional": lexeme.is_provisional,
                "merged_into_id": lexeme.merged_into_id,
                "occurrence_count": 0,
                "chapter_counts": [],
            })
            item["occurrence_count"] += stat.occurrence_count
            item["chapter_counts"].append({
                "chapter_index": stat.chapter_index,
                "occurrence_count": stat.occurrence_count,
            })
        for item in aggregated.values():
            item["chapter_counts"].sort(key=lambda count: count["chapter_index"])
        return run, sorted(
            aggregated.values(),
            key=lambda item: (-item["occurrence_count"], item["normalized_form"]),
        )

    def get_active_lexeme_occurrences(
        self,
        book_id: str,
        lexeme_id: int,
    ) -> tuple[Optional[AnalysisRun], list[dict[str, Any]]]:
        run = self.get_active_run(book_id)
        if run is None:
            return None, []
        rows = self.db.query(LexemeOccurrence, RunLexeme).join(
            RunLexeme,
            RunLexeme.id == LexemeOccurrence.run_lexeme_id,
        ).filter(
            LexemeOccurrence.analysis_run_id == run.id,
            RunLexeme.lexeme_id == lexeme_id,
        ).order_by(
            LexemeOccurrence.chapter_index,
            LexemeOccurrence.source_document_id,
            LexemeOccurrence.source_start,
            LexemeOccurrence.source_token_index,
        ).all()
        return run, [
            {
                "occurrence_id": occurrence.id,
                "run_lexeme_id": run_lexeme.id,
                "chapter_index": occurrence.chapter_index,
                "surface": occurrence.surface,
                "source_document_id": occurrence.source_document_id,
                "source_start": occurrence.source_start,
                "source_end": occurrence.source_end,
                "source_token_index": occurrence.source_token_index,
                "reader_segment_index": occurrence.reader_segment_index,
            }
            for occurrence, run_lexeme in rows
        ]

    def delete_run(self, run_id: int) -> bool:
        run = self.db.get(AnalysisRun, run_id)
        if run is None:
            return False
        self.db.delete(run)
        self.db.commit()
        return True


def recover_interrupted_analysis_runs() -> int:
    """Mark unpublished runs left by a process interruption as failed."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        interrupted = db.query(AnalysisRun).filter(
            AnalysisRun.status.in_([
                AnalysisRunStatus.PENDING,
                AnalysisRunStatus.PROCESSING,
            ])
        ).all()
        for run in interrupted:
            run.status = AnalysisRunStatus.FAILED
            run.is_active = False
            run.error_message = run.error_message or "Analysis interrupted by backend shutdown"
            run.completed_at = _utcnow()
        if interrupted:
            db.commit()
        return len(interrupted)
    except Exception:
        db.rollback()
        logger.exception("Failed to recover interrupted analysis runs")
        raise
    finally:
        db.close()
