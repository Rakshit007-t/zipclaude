"""Privacy-safe Sentry integration for ZipRIGHT backend.

Features:
- Error monitoring only (traces, profiling, replays, metrics explicitly disabled).
- Comprehensive privacy filter:
  * Sensitive headers scrubbed (Authorization, Cookie, Secrets, Signatures, Keys).
  * Sensitive request data / body fields redacted (passwords, payment credentials,
    biometrics, fit/body measurements, private media URLs, tokens).
  * User PII stripped (email, phone, name, ip_address).
  * User IDs non-reversibly hashed with SHA-256.
  * Breadcrumbs scrubbed of sensitive query parameters and auth headers.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

# Headers that must be completely redacted from Sentry events
SENSITIVE_HEADER_PATTERNS = [
    re.compile(r"^authorization$", re.I),
    re.compile(r"^cookie$", re.I),
    re.compile(r"^set-cookie$", re.I),
    re.compile(r"^x-wallet-topup-secret$", re.I),
    re.compile(r"^x-razorpay-signature$", re.I),
    re.compile(r"^x-csrf-token$", re.I),
    re.compile(r"^x-api-key$", re.I),
    re.compile(r".*(token|secret|key|auth|credential|password|signature).*", re.I),
]

# Field names across request data, contexts, and extras that must be redacted
SENSITIVE_FIELD_PATTERNS = [
    re.compile(r".*(password|token|secret|credential|api_?key).*", re.I),
    re.compile(r".*(razorpay|card|cvv|account_number).*", re.I),
    re.compile(r".*(firebase_credentials|service_account|private_key).*", re.I),
    re.compile(r".*(measurement|body_?shape|fit_?profile|smart_?fit|shoulder).*", re.I),
    re.compile(r"^(bust|waist|hips|chest|height|weight|inseam|thigh)$", re.I),
    re.compile(r".*(biometric|face_?crop|avatar_?image|selfie).*", re.I),
    re.compile(r".*(private_media|signed_url|download_token).*", re.I),
    re.compile(r"^(email|phone|phone_number|full_name|shipping_address|address)$", re.I),
    re.compile(r"^(message_text|chat_content|private_message)$", re.I),
]

# URL query parameter keys that must be redacted
SENSITIVE_QUERY_PARAMS = {
    "token", "secret", "key", "api_key", "password", "auth",
    "signature", "sig", "code", "access_token", "refresh_token",
}


def hash_user_id(user_id: str | int | None) -> str | None:
    """Return a non-reversible truncated SHA-256 hash of the user ID."""
    if not user_id:
        return None
    raw = str(user_id).strip()
    if not raw:
        return None
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def is_sensitive_key(key: str) -> bool:
    """Check if a dictionary key matches any sensitive field pattern."""
    return any(pattern.search(key) for pattern in SENSITIVE_FIELD_PATTERNS)


def sanitize_value(key: str, value: Any) -> Any:
    """Recursively scrub sensitive keys and nested dictionaries/lists."""
    if is_sensitive_key(key):
        return "[REDACTED]"

    if isinstance(value, dict):
        return {k: sanitize_value(k, v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_value(key, item) for item in value]
    if isinstance(value, str):
        # Scrub potential private media or bearer tokens embedded in strings
        if "firebasestorage.googleapis.com" in value and "token=" in value:
            return re.sub(r"token=[^&\s]+", "token=[REDACTED]", value)
        if "Bearer " in value:
            return re.sub(r"Bearer\s+[^\s]+", "Bearer [REDACTED]", value)
    return value


def sanitize_headers(headers: dict[str, Any]) -> dict[str, Any]:
    """Scrub sensitive request headers."""
    sanitized = {}
    for header, value in headers.items():
        if any(pattern.match(header) for pattern in SENSITIVE_HEADER_PATTERNS):
            sanitized[header] = "[REDACTED]"
        else:
            sanitized[header] = value
    return sanitized


def sanitize_query_string(query_string: str) -> str:
    """Redact sensitive query parameter values."""
    if not query_string:
        return ""
    parts = query_string.split("&")
    clean_parts = []
    for part in parts:
        if "=" in part:
            k, v = part.split("=", 1)
            if k.lower() in SENSITIVE_QUERY_PARAMS or is_sensitive_key(k):
                clean_parts.append(f"{k}=[REDACTED]")
            else:
                clean_parts.append(part)
        else:
            clean_parts.append(part)
    return "&".join(clean_parts)


def sanitize_url(url: str) -> str:
    """Redact sensitive query parameters in a full URL."""
    if not url:
        return ""
    if "?" in url:
        base, query = url.split("?", 1)
        return f"{base}?{sanitize_query_string(query)}"
    return url


def before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    """Central event scrubber applied immediately before an event is dispatched to Sentry."""
    try:
        # 1. Scrub Request Information
        req = event.get("request")
        if isinstance(req, dict):
            # Headers
            if "headers" in req and isinstance(req["headers"], dict):
                req["headers"] = sanitize_headers(req["headers"])

            # Cookies
            if "cookies" in req:
                req["cookies"] = "[REDACTED]"

            # Query string
            if "query_string" in req and isinstance(req["query_string"], str):
                req["query_string"] = sanitize_query_string(req["query_string"])

            # URL
            if "url" in req and isinstance(req["url"], str):
                req["url"] = sanitize_url(req["url"])

            # Request body / data
            if "data" in req:
                req["data"] = sanitize_value("data", req["data"])

        # 2. Scrub User Information
        user = event.get("user")
        if isinstance(user, dict):
            # Strip all direct PII
            user.pop("email", None)
            user.pop("phone", None)
            user.pop("username", None)
            user.pop("name", None)
            user.pop("ip_address", None)

            # Hash user ID non-reversibly
            raw_id = user.get("id")
            if raw_id:
                user["id"] = hash_user_id(raw_id)
            else:
                user.pop("id", None)

        # 3. Scrub Contexts & Extras
        for container_key in ("contexts", "extra"):
            container = event.get(container_key)
            if isinstance(container, dict):
                event[container_key] = sanitize_value(container_key, container)

        # 4. Scrub Breadcrumbs attached to the event
        crumbs = event.get("breadcrumbs")
        if isinstance(crumbs, dict) and "values" in crumbs:
            for crumb in crumbs["values"]:
                _sanitize_single_breadcrumb(crumb)
        elif isinstance(crumbs, list):
            for crumb in crumbs:
                _sanitize_single_breadcrumb(crumb)

    except Exception as exc:
        logger.warning("Error during Sentry before_send sanitization: %s", exc)

    return event


def _sanitize_single_breadcrumb(crumb: dict[str, Any]) -> None:
    """In-place sanitizer for a single breadcrumb."""
    if not isinstance(crumb, dict):
        return

    # Sanitize URL data in HTTP breadcrumbs
    data = crumb.get("data")
    if isinstance(data, dict):
        if "url" in data and isinstance(data["url"], str):
            data["url"] = sanitize_url(data["url"])
        crumb["data"] = sanitize_value("data", data)

    # Sanitize breadcrumb message
    msg = crumb.get("message")
    if isinstance(msg, str):
        if "firebasestorage.googleapis.com" in msg and "token=" in msg:
            crumb["message"] = re.sub(r"token=[^&\s]+", "token=[REDACTED]", msg)


def before_breadcrumb(crumb: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    """Filter and sanitize breadcrumbs before recording."""
    try:
        _sanitize_single_breadcrumb(crumb)
    except Exception as exc:
        logger.warning("Error during Sentry before_breadcrumb sanitization: %s", exc)
    return crumb


def init_sentry() -> bool:
    """Initialize Sentry with strict privacy safeguards.

    Returns True if initialized, False if skipped (e.g. SENTRY_DSN not configured).
    """
    dsn = settings.SENTRY_DSN
    if not dsn:
        logger.info("SENTRY_DSN is not configured; Sentry monitoring is disabled.")
        return False

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    environment = settings.SENTRY_ENVIRONMENT
    release = settings.SENTRY_RELEASE

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        # Phase 5B Quota & Privacy settings:
        send_default_pii=False,
        traces_sample_rate=0.0,      # Tracing DISABLED
        profiles_sample_rate=0.0,    # Profiling DISABLED
        enable_tracing=False,
        attach_stacktrace=True,
        max_breadcrumbs=30,
        before_send=before_send,
        before_breadcrumb=before_breadcrumb,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
        ],
    )
    logger.info("Sentry initialized successfully for environment '%s'.", environment)
    return True
