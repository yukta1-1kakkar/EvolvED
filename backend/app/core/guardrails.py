from __future__ import annotations

import re
import unicodedata
from typing import Any


_TERMS = {
    "asshole": "profanity",
    "bastard": "profanity",
    "bitch": "profanity",
    "bullshit": "profanity",
    "cunt": "profanity",
    "dick": "sexual_language",
    "dumbass": "harassment",
    "fuck": "profanity",
    "idiot": "harassment",
    "kill yourself": "harassment",
    "moron": "harassment",
    "motherfucker": "profanity",
    "pussy": "sexual_language",
    "shit": "profanity",
    "shut up": "harassment",
    "slut": "sexual_language",
    "whore": "sexual_language",
}
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})
_CHAR_PATTERNS = {"a": "[a@4]", "e": "[e3]", "i": "[i1]", "o": "[o0]", "s": "[s$5]", "t": "[t7]"}


def _normalized(value: str) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).lower().translate(_LEET)


def _pattern(term: str) -> re.Pattern[str]:
    separated = r"[\W_]*".join(_CHAR_PATTERNS.get(char, re.escape(char)) for char in term)
    return re.compile(rf"(?<![a-z]){separated}(?![a-z])", re.IGNORECASE)


_PATTERNS = {term: _pattern(term) for term in _TERMS}


def moderation_flags(value: str) -> list[str]:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    return sorted({_TERMS[term] for term, pattern in _PATTERNS.items() if pattern.search(text)})


def redact_inappropriate_text(value: str) -> str:
    redacted = str(value or "")
    normalized = unicodedata.normalize("NFKC", redacted).lower()
    for term, pattern in _PATTERNS.items():
        if pattern.search(normalized):
            # Apply the same separator-aware match to the original text so layout is preserved.
            redacted = pattern.sub("[removed]", redacted)
            normalized = _normalized(redacted)
    return redacted


def redact_inappropriate_content(value: Any) -> Any:
    if isinstance(value, str):
        return redact_inappropriate_text(value)
    if isinstance(value, list):
        return [redact_inappropriate_content(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_inappropriate_content(item) for key, item in value.items()}
    return value


def require_safe_generated_text(value: str, context: str) -> None:
    flags = moderation_flags(value)
    if flags:
        raise ValueError(f"{context} failed the language safety guardrail: {', '.join(flags)}")
