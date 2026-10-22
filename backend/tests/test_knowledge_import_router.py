import hashlib
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import knowledge_imports
from app.schemas import JLPTKnowledgeImportApplyRequest, JLPTKnowledgeImportRequest
from app.services.external_knowledge_import_service import ImportPreview, ImportPreviewStats


def test_safe_jlpt_path_accepts_only_real_json_files_under_import_root(tmp_path, monkeypatch):
    monkeypatch.setattr(knowledge_imports, "KNOWLEDGE_IMPORT_DIR", str(tmp_path))
    source = tmp_path / "jlpt.json"
    source.write_text('{"schema_version": 1, "entries": []}', encoding="utf-8")

    assert knowledge_imports._safe_jlpt_path("jlpt.json") == source.resolve()
    assert knowledge_imports._safe_jlpt_path(str(source)) == source.resolve()

    outside = tmp_path.parent / "outside.json"
    outside.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="受控导入目录"):
        knowledge_imports._safe_jlpt_path(str(outside))

    with pytest.raises(ValueError, match="\\.json"):
        knowledge_imports._safe_jlpt_path("jlpt.txt")


def test_safe_jlpt_path_rejects_symlinks(tmp_path, monkeypatch):
    monkeypatch.setattr(knowledge_imports, "KNOWLEDGE_IMPORT_DIR", str(tmp_path))
    target = tmp_path / "target.json"
    target.write_text("{}", encoding="utf-8")
    link = tmp_path / "link.json"
    link.symlink_to(target)

    with pytest.raises(ValueError, match="符号链接"):
        knowledge_imports._safe_jlpt_path("link.json")


def test_jlpt_preview_digest_is_bound_to_source_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(knowledge_imports, "KNOWLEDGE_IMPORT_DIR", str(tmp_path))
    source = tmp_path / "jlpt.json"
    original_bytes = b'{"schema_version": 1, "entries": []}'
    source.write_bytes(original_bytes)
    snapshots = []

    class SnapshotSource:
        def __init__(self, _path, *, json_bytes):
            snapshots.append(json_bytes)

        def fetch_candidates(self, *, levels):
            source.write_text('{"schema_version": 1, "source_id": "changed", "entries": []}', encoding="utf-8")
            return []

    monkeypatch.setattr(knowledge_imports, "JLPTJsonKnowledgeSource", SnapshotSource)

    monkeypatch.setattr(
        knowledge_imports,
        "_service",
        lambda _db: SimpleNamespace(
            preview_candidates=lambda _source_kind, _candidates: ImportPreview(
                source_kind="jlpt",
                import_digest="a" * 64,
                accepted=[],
                skipped=[],
                stats=ImportPreviewStats(total=0, parsable=0, unique=0, ambiguous=0, unmatched=0, provisional=0),
            ),
        ),
    )
    request = JLPTKnowledgeImportRequest(path="jlpt.json", levels=["N5"])
    digest = knowledge_imports._jlpt_preview(object(), request).import_digest
    expected_digest = hashlib.sha256(
        f"{'a' * 64}:{hashlib.sha256(original_bytes).hexdigest()}".encode("ascii")
    ).hexdigest()

    assert snapshots == [original_bytes]
    assert digest == expected_digest


def test_apply_jlpt_rejects_a_digest_mismatch_before_writing(monkeypatch):
    applied = False

    class FakeService:
        def apply_preview(self, _preview):
            nonlocal applied
            applied = True

    monkeypatch.setattr(knowledge_imports, "_service", lambda _db: FakeService())
    monkeypatch.setattr(
        knowledge_imports,
        "_jlpt_preview",
        lambda _db, _request: SimpleNamespace(import_digest="b" * 64),
    )

    request = JLPTKnowledgeImportApplyRequest(
        path="jlpt.json",
        levels=["N5"],
        preview_digest="a" * 64,
    )
    with pytest.raises(HTTPException) as exc_info:
        knowledge_imports.apply_jlpt(request, db=object())

    assert exc_info.value.status_code == 409
    assert applied is False
