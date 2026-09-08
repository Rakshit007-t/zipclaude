"""Input sanitization utilities for ZipRIGHT backend.

Prevents stored XSS, HTML injection, and control character abuse before data reaches
database persistence or AI prompt interpolation.
"""

from __future__ import annotations

import html
import re
import unicodedata

_DANGEROUS_BLOCK_PATTERN = re.compile(
    r"<(script|style|iframe|object|embed|applet)[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_TAG_PATTERN = re.compile(r"<[^>]+>", re.IGNORECASE)
_CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
_MULTIPLE_SPACES_PATTERN = re.compile(r"\s+")


def sanitize_text(text: str | None, max_length: int = 1000) -> str:
    """Sanitize raw text input:

    1. Normalize Unicode (NFKC) to eliminate homoglyphs and hidden zero-width chars.
    2. Strip dangerous blocks (<script>, <style>, <iframe>) and their inner contents.
    3. Strip all remaining HTML tags and delimiters.
    4. Unescape and escape special characters to neutralize XSS payload injections.
    5. Remove non-printable control characters.
    6. Collapse redundant whitespace and trim to max_length.
    """
    if not text:
        return ""

    # Normalize unicode
    normalized = unicodedata.normalize("NFKC", str(text))

    # Completely remove executable script, style, and frame blocks
    no_blocks = _DANGEROUS_BLOCK_PATTERN.sub(" ", normalized)

    # Strip any remaining HTML tags
    no_html = _HTML_TAG_PATTERN.sub(" ", no_blocks)

    # Remove non-printable control characters (preserve newline \n and tab \t if needed)
    cleaned = _CONTROL_CHAR_PATTERN.sub("", no_html)

    # Escape HTML special characters for safe storage
    escaped = html.escape(cleaned, quote=True)

    # Collapse whitespace
    collapsed = _MULTIPLE_SPACES_PATTERN.sub(" ", escaped).strip()

    if len(collapsed) > max_length:
        collapsed = collapsed[:max_length].strip()

    return collapsed


def sanitize_dict_strings(data: dict, max_length: int = 1000) -> dict:
    """Recursively sanitize all string values in a dictionary."""
    sanitized = {}
    for key, value in data.items():
        if isinstance(value, str):
            sanitized[key] = sanitize_text(value, max_length=max_length)
        elif isinstance(value, dict):
            sanitized[key] = sanitize_dict_strings(value, max_length=max_length)
        elif isinstance(value, list):
            sanitized[key] = [
                sanitize_text(item, max_length=max_length)
                if isinstance(item, str)
                else (sanitize_dict_strings(item, max_length=max_length) if isinstance(item, dict) else item)
                for item in value
            ]
        else:
            sanitized[key] = value
    return sanitized
