"""AI Security Guardrails: Prompt injection mitigation and usage quota capping.

Protects LLM inference endpoints (Gemini, Ollama, Stylist) from jailbreak attempts,
system prompt extraction, and excessive compute depletion.
"""

from __future__ import annotations

import collections
from datetime import datetime, timezone
import logging
import re
import threading
from fastapi import HTTPException, status

from core.sanitizer import sanitize_text
from core.security_logger import log_security_event

logger = logging.getLogger(__name__)

# Adversarial prompt injection patterns (OWASP Top 10 for LLMs)
INJECTION_PATTERNS = (
    re.compile(r"(?i)\b(ignore|disregard|forget|bypass)\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|commands)\b"),
    re.compile(r"(?i)\b(system\s+prompt|system\s+override|developer\s+mode|jailbreak|dan\s+mode)\b"),
    re.compile(r"(?i)\b(output|reveal|leak|print|display)\s+(the\s+)?(api\s*keys?|secrets?|passwords?|credentials?|instructions?)\b"),
    re.compile(r"(?i)\b(you\s+are\s+now|act\s+as\s+an\s+unrestricted|pretend\s+you\s+have\s+no\s+rules)\b"),
    re.compile(r"(?i)(<\s*\|\s*im_start\s*\|>|<\s*\|\s*endoftext\s*\|>|\[\s*INST\s*\])"),
)

# AI Usage limits
MAX_STYLIST_PER_HOUR = 25
MAX_STYLIST_PER_DAY = 100

_lock = threading.Lock()
# user_id -> deque of timestamps
_stylist_usage: dict[str, collections.deque[float]] = {}


def detect_prompt_injection(user_input: str) -> bool:
    """Return True if prompt injection or jailbreak indicators are detected."""
    for pattern in INJECTION_PATTERNS:
        if pattern.search(user_input):
            return True
    return False


def sanitize_ai_prompt(
    prompt: str,
    user_id: str = "anonymous",
    ip_address: str = "unknown",
    max_length: int = 600,
) -> str:
    """Sanitize and validate a prompt prior to LLM submission.

    Raises HTTP 400 if malicious injection is detected.
    """
    cleaned = sanitize_text(prompt, max_length=max_length)

    if detect_prompt_injection(cleaned):
        log_security_event(
            event_type="SECURITY_PROMPT_INJECTION_BLOCKED",
            severity="CRITICAL",
            ip_address=ip_address,
            user_id=user_id,
            details={"snippet": cleaned[:120]},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Input contains disallowed instructional patterns or prompt overrides.",
                "details": {"code": "prompt_injection_detected"},
            },
        )

    return cleaned


def enforce_ai_usage_cap(
    user_id: str,
    ip_address: str = "unknown",
) -> None:
    """Enforce hourly and daily usage caps on AI generation."""
    now = datetime.now(timezone.utc).timestamp()
    hour_ago = now - 3600
    day_ago = now - 86400

    with _lock:
        calls = _stylist_usage.setdefault(user_id, collections.deque())

        # Prune calls older than 24 hours
        while calls and calls[0] < day_ago:
            calls.popleft()

        daily_count = len(calls)
        hourly_count = sum(1 for ts in calls if ts >= hour_ago)

        if hourly_count >= MAX_STYLIST_PER_HOUR:
            log_security_event(
                event_type="SECURITY_AI_QUOTA_EXCEEDED",
                severity="WARNING",
                ip_address=ip_address,
                user_id=user_id,
                details={"window": "hourly", "count": hourly_count, "limit": MAX_STYLIST_PER_HOUR},
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": f"AI Stylist rate limit reached ({MAX_STYLIST_PER_HOUR} queries/hour). Please try again in a few minutes.",
                    "details": {"code": "ai_quota_hourly_exceeded"},
                },
            )

        if daily_count >= MAX_STYLIST_PER_DAY:
            log_security_event(
                event_type="SECURITY_AI_QUOTA_EXCEEDED",
                severity="WARNING",
                ip_address=ip_address,
                user_id=user_id,
                details={"window": "daily", "count": daily_count, "limit": MAX_STYLIST_PER_DAY},
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "message": f"Daily AI Stylist limit reached ({MAX_STYLIST_PER_DAY} queries/day). Quota resets tomorrow.",
                    "details": {"code": "ai_quota_daily_exceeded"},
                },
            )

        calls.append(now)
