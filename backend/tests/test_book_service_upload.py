from io import BytesIO

import pytest
from fastapi import UploadFile

from app.services.book_service import BookService


@pytest.mark.asyncio
async def test_stream_upload_to_path_writes_file(tmp_path):
    destination = tmp_path / "sample.epub"
    upload = UploadFile(filename="sample.epub", file=BytesIO(b"epub-content"))

    size = await BookService.stream_upload_to_path(upload, str(destination), max_file_size=1024)

    assert size == len(b"epub-content")
    assert destination.read_bytes() == b"epub-content"


@pytest.mark.asyncio
async def test_stream_upload_to_path_rejects_oversized_file(tmp_path):
    destination = tmp_path / "oversized.epub"
    upload = UploadFile(filename="oversized.epub", file=BytesIO(b"0123456789"))

    with pytest.raises(ValueError, match="文件过大"):
        await BookService.stream_upload_to_path(upload, str(destination), max_file_size=5)

    assert not destination.exists()
