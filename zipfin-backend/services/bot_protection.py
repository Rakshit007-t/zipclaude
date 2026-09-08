"""Bot and automated abuse protection service for ZipRIGHT.

Shields public forms, user registrations, password resets, and contact endpoints
against automated scrapers, credential-stuffing bots, and spam submissions.
"""

from __future__ import annotations

import logging
import os
import re
from fastapi import HTTPException, Request, status

from core.security_logger import log_security_event

logger = logging.getLogger(__name__)

# Known scraper and automated headless tool signatures
_AUTOMATED_USER_AGENTS = re.compile(
    r"(?i)(curl|python-requests|aiohttp|httpx|urllib|scrapy|phantomjs|headlesschrome|selenium|puppeteer|mechanize)",
)

CLOUDFLARE_TURNSTILE_SECRET = os.getenv("CF_TURNSTILE_SECRET_KEY", "").strip()


def check_bot_user_agent(user_agent: str | None, ip_address: str = "unknown", endpoint: str = "unknown") -> None:
    """Verify the User-Agent does not originate from an automated scraper or headless script."""
    if not user_agent or _AUTOMATED_USER_AGENTS.search(user_agent):
        log_security_event(
            event_type="SECURITY_BOT_DETECTED",
            severity="WARNING",
            ip_address=ip_address,
            endpoint=endpoint,
            details={"user_agent": user_agent or "missing", "reason": "Automated scraper signature"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Automated access rejected. Please use an authorized browser.",
                "details": {"code": "bot_detected"},
            },
        )


def validate_honeypot(
    honeypot_value: str | None,
    ip_address: str = "unknown",
    endpoint: str = "unknown",
) -> None:
    """Validate that hidden honeypot fields remain empty.

    Bots parse HTML and automatically populate hidden fields, identifying themselves.
    """
    if honeypot_value and honeypot_value.strip():
        log_security_event(
            event_type="SECURITY_BOT_HONEYPOT_TRIGGERED",
            severity="WARNING",
            ip_address=ip_address,
            endpoint=endpoint,
            details={"reason": "Honeypot field was populated by automated agent"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Invalid form submission.",
                "details": {"code": "bot_trap_triggered"},
            },
        )


async def verify_turnstile_token(
    token: str | None,
    ip_address: str = "unknown",
) -> bool:
    """Verify Cloudflare Turnstile token if configured."""
    if not CLOUDFLARE_TURNSTILE_SECRET:
        # Turnstile not configured; soft pass
        return True

    if not token:
        return False

    try:
        import httpx
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={
                    "secret": CLOUDFLARE_TURNSTILE_SECRET,
                    "response": token,
                    "remoteip": ip_address,
                },
            )
            data = resp.json()
            return bool(data.get("success"))
    except Exception as exc:
        logger.warning("Turnstile verification connection failed: %s", exc)
        return True  # Fail open gracefully if cloud challenge API is unreachable
