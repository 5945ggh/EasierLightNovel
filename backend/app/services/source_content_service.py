"""Private immutable source-file and parser-source persistence helpers.

This module deliberately has no dependency on the reader JSON contract.  Its
data can be used to re-run a tokenizer later, even though TextSegment clears
its text after creating the compact rendering cache.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import Any, Iterable

from app.config import SOURCE_FILES_DIR
from app.models import BookSourceFile, SourceContentVersion, SourceRubyHint
from app.utils.domain import TextSegment


PARSER_VERSION = "epub-pdf-source-v4"
SOURCE_SCHEMA_VERSION = 4
MEDIA_TYPES = {".epub": "application/epub+zip", ".pdf": "application/pdf"}
logger = logging.getLogger(__name__)


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_content_hash(source_content: dict[str, Any]) -> str:
    canonical = json.dumps(source_content, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _relative_source_path(book_id: str, file_ext: str) -> str:
    return f"{book_id}/original{file_ext.lower()}"


def private_source_path(relative_path: str) -> Path:
    root = Path(SOURCE_FILES_DIR).resolve()
    candidate = (root / relative_path).resolve()
    if os.path.commonpath([str(root), str(candidate)]) != str(root):
        raise ValueError("Invalid private source path")
    return candidate


def copy_immutable_source(temp_path: str, book_id: str, file_ext: str) -> tuple[str, str]:
    """Copy the successful upload to a private, per-book immutable location."""
    relative_path = _relative_source_path(book_id, file_ext)
    destination = private_source_path(relative_path)
    if destination.exists():
        raise FileExistsError(f"Immutable source already exists for book {book_id}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging_path = destination.with_suffix(destination.suffix + ".part")
    try:
        shutil.copyfile(temp_path, staging_path)
        source_hash = sha256_file(staging_path)
        os.replace(staging_path, destination)
    except Exception:
        staging_path.unlink(missing_ok=True)
        raise
    return relative_path, source_hash


def remove_private_source(book_id: str) -> None:
    """Remove only one book's private source directory after DB deletion."""
    target = private_source_path(book_id)
    if target.exists():
        shutil.rmtree(target)


def _cleanup_root() -> Path:
    return private_source_path(".cleanup")


def stage_private_source_removal(book_id: str) -> Path | None:
    """Atomically move a source directory into a retryable cleanup area."""
    source_path = private_source_path(book_id)
    if not source_path.exists():
        return None
    cleanup_path = _cleanup_root() / f"{book_id}-{uuid.uuid4().hex}"
    cleanup_path.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source_path, cleanup_path)
    return cleanup_path


def restore_staged_source_removal(book_id: str, staged_path: Path | None) -> None:
    """Restore staged data when deleting the database record did not commit."""
    if staged_path is not None and staged_path.exists():
        os.replace(staged_path, private_source_path(book_id))


def finalize_staged_source_removal(staged_path: Path) -> None:
    """Permanently remove an already-staged private source directory."""
    if staged_path.exists():
        shutil.rmtree(staged_path)


def recover_staged_source_removals() -> int:
    """Retry cleanup paths left by an interrupted or failed book deletion."""
    root = _cleanup_root()
    if not root.exists():
        return 0
    removed = 0
    for candidate in root.iterdir():
        if not candidate.is_dir():
            continue
        try:
            finalize_staged_source_removal(candidate)
            removed += 1
        except OSError:
            logger.warning("Deferred source cleanup retry failed: %s", candidate, exc_info=True)
    try:
        root.rmdir()
    except OSError:
        pass
    return removed


def source_documents_from_chapters(chapters: Iterable[Any]) -> list[dict[str, Any]]:
    """Fallback contract retaining reader segments and structural boundaries.

    A newline inserted for a non-text segment is explicitly marked as a source
    boundary. It must never be projected back as reader text, but ensures an
    image between ``日`` and ``本`` cannot become a rebuilt ``日本`` token.
    """
    documents: list[dict[str, Any]] = []
    for chapter in chapters:
        text_parts: list[str] = []
        spans: list[dict[str, int]] = []
        boundaries: list[dict[str, Any]] = []
        previous_was_text = False
        for segment_index, segment in enumerate(chapter.segments):
            if isinstance(segment, TextSegment) and segment.text:
                start_offset = sum(len(part) for part in text_parts)
                text_parts.append(segment.text)
                end_offset = sum(len(part) for part in text_parts)
                spans.append({
                    "start_offset": start_offset,
                    "end_offset": end_offset,
                    "reader_segment_index": segment_index,
                })
                previous_was_text = True
            elif previous_was_text:
                boundary_offset = sum(len(part) for part in text_parts)
                text_parts.append("\n")
                boundaries.append({
                    "offset": boundary_offset,
                    "text": "\n",
                    "reason": "non_text_segment",
                    "reader_segment_index": segment_index,
                })
                previous_was_text = False
        documents.append({
            "document_id": f"chapter-{chapter.index}",
            "spine_index": chapter.index,
            "text": "".join(text_parts),
            "reader_projection": {
                "reader_chapter_index": chapter.index,
                "text_spans": spans,
                "structural_boundaries": boundaries,
            },
        })
    return documents


def attach_reader_projections(documents: list[dict[str, Any]], chapters: Iterable[Any]) -> None:
    """Persist source document to final reader chapter/segment projections.

    EPUB source documents are created before optional chapter merging. Each
    parser Chapter retains the ordered count of segments it contributed. This
    function runs after merging and projects document-relative offsets onto
    final reader chapter indices without relying on mutable titles or search.
    """
    by_document_id = {document["document_id"]: document for document in documents}
    for chapter in chapters:
        segment_start = 0
        for document_id, segment_count in getattr(chapter, "source_document_segment_counts", []):
            document = by_document_id.get(document_id)
            if document is None:
                raise ValueError(f"Missing source document for parser provenance: {document_id}")
            segment_end = segment_start + segment_count
            source_text = document["text"]
            source_cursor = 0
            text_spans: list[dict[str, int]] = []
            for reader_segment_index in range(segment_start, segment_end):
                segment = chapter.segments[reader_segment_index]
                if not isinstance(segment, TextSegment) or not segment.text:
                    continue
                source_start = source_text.find(segment.text, source_cursor)
                if source_start < 0:
                    raise ValueError(
                        f"Cannot project source document {document_id} to reader segment "
                        f"{reader_segment_index} without ambiguous offsets"
                    )
                source_end = source_start + len(segment.text)
                text_spans.append({
                    "start_offset": source_start,
                    "end_offset": source_end,
                    "reader_segment_index": reader_segment_index,
                })
                source_cursor = source_end
            document["reader_projection"] = {
                "reader_chapter_index": chapter.index,
                "reader_segment_start_index": segment_start,
                "reader_segment_end_index": segment_end,
                "text_spans": text_spans,
                "structural_boundaries": document.get("structural_boundaries", []),
            }
            segment_start = segment_end


def build_source_content(documents: list[dict[str, Any]]) -> dict[str, Any]:
    """Return the versioned, document-relative coordinate space contract."""
    return {
        "schema_version": SOURCE_SCHEMA_VERSION,
        "offset_unit": "unicode_codepoint",
        "documents": documents,
    }


def create_source_records(
    *,
    book_id: str,
    file_ext: str,
    relative_path: str,
    source_file_sha256: str,
    source_content: dict[str, Any],
) -> tuple[BookSourceFile, SourceContentVersion]:
    """Create uncommitted ORM rows for one successful import."""
    source_file = BookSourceFile(
        book_id=book_id,
        file_type=file_ext.lstrip(".").lower(),
        media_type=MEDIA_TYPES[file_ext.lower()],
        sha256=source_file_sha256,
        relative_path=relative_path,
    )
    version = SourceContentVersion(
        book_id=book_id,
        source_file_sha256=source_file_sha256,
        parser_version=PARSER_VERSION,
        source_schema_version=SOURCE_SCHEMA_VERSION,
        source_content_sha256=source_content_hash(source_content),
        source_content_json=source_content,
    )
    for document in source_content["documents"]:
        for hint in document.get("ruby_hints", []):
            version.ruby_hints.append(SourceRubyHint(
                document_id=document["document_id"],
                start_offset=hint["start_offset"],
                end_offset=hint["end_offset"],
                base_text=hint["base_text"],
                reading_raw=hint["reading_raw"],
                markup=hint["markup"],
                provenance=hint.get("provenance", "epub_ruby"),
            ))
    return source_file, version
