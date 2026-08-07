from types import SimpleNamespace

import pytest

from pydantic import ValidationError

from app.schemas import AnkiKnowledgeImportApplyRequest, ChapterHighlightData, HighlightResponse


def test_highlight_response_exposes_both_archive_fields_and_normalizes_style():
    orm_like = SimpleNamespace(
        id=1,
        book_id="book-1",
        chapter_index=0,
        start_segment_index=0,
        start_token_idx=0,
        end_segment_index=0,
        end_token_idx=1,
        style_category="blue",
        selected_text="食べる",
        created_at="2026-01-01T00:00:00Z",
        has_archive=True,
    )

    response = HighlightResponse.model_validate(orm_like)

    assert response.style_category == "default"
    assert response.has_archive is True
    assert response.has_Archive is True


def test_chapter_highlight_data_normalizes_legacy_style_keys():
    item = ChapterHighlightData.model_validate(
        {
            "id": 1,
            "start_segment_index": 0,
            "start_token_idx": 0,
            "end_segment_index": 0,
            "end_token_idx": 1,
            "style_category": "yellow",
        }
    )

    assert item.style_category == "vocab"


def test_chapter_highlight_data_maps_deep_to_favorite():
    item = ChapterHighlightData.model_validate(
        {
            "id": 2,
            "start_segment_index": 0,
            "start_token_idx": 0,
            "end_segment_index": 0,
            "end_token_idx": 1,
            "style_category": "deep",
        }
    )

    assert item.style_category == "favorite"


def test_anki_apply_requires_the_confirmed_preview_digest():
    with pytest.raises(ValidationError):
        AnkiKnowledgeImportApplyRequest(deck_name="Deck")

    request = AnkiKnowledgeImportApplyRequest(
        deck_name="Deck",
        preview_digest="a" * 64,
    )
    assert request.preview_digest == "a" * 64
