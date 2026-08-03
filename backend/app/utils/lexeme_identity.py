"""Shared normalization for stable Lexeme and external-list identity joins."""

from __future__ import annotations

import unicodedata
from typing import Optional

import jaconv


def normalize_identity_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip()


def normalize_canonical_reading(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = normalize_identity_text(value)
    return jaconv.kata2hira(normalized) if normalized else None
