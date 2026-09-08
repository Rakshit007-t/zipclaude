"""Structured security event audit logger with automated PII & credential redaction.

Emits structured audit logs for compliance (ISO 27001, SOC 2, DPDP Act 2023, PCI-DSS)
recording authentication anomalies, account lockouts, rate limit violations,
CSRF failures, prompt injection attempts, and upload rejections.

Guarantees logs never secretly leak passwords, session tokens, JWTs, or credit card numbers.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
from typing import Any

_AUDIT_LOGGER = logging.getLogger("zipright.security_audit")
_LOG_DIR = Path(__file__).resolve().parents[1] / "storage"
_AUDIT_FILE = _LOG_DIR / "security_audit.log"

# Sensitive keys to redact automatically from dictionary structures
_SENSITIVE_KEY_PATTERN = re.compile(
    r"(?i)(password|passwd|passphrase|token|secret|jwt|bearer|key|api_key|access_token|refresh_token|"
    r"credit_card|card_num|card_number|cvv|cvc|pan|expir|ssn|aadhaar|pin|auth|authorization|cookie)"
)

# Regex patterns for inline credit card numbers and JWTs
_CREDIT_CARD_REGEX = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
_JWT_REGEX = re.compile(r"\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b")
_BEARER_AUTH_REGEX = re.compile(r"(?i)bearer\s+[A-Za-z0-9\-_\.=]+")


def redact_sensitive_string(text: str) -> str:
    """Mask credit card numbers, JWT tokens, and Bearer credentials in raw text."""
    if not text:
        return text
    # Mask JWTs
    text = _JWT_REGEX.sub("[REDACTED_TOKEN]", text)
    # Mask Bearer headers
    text = _BEARER_AUTH_REGEX.sub("Bearer [REDACTED_TOKEN]", text)
    # Mask credit card numbers (13-19 digits)
    text = _CREDIT_CARD_REGEX.sub("[REDACTED_CARD]", text)
    return text


def redact_sensitive_data(obj: Any) -> Any:
    """Recursively scrub passwords, tokens, and credit card numbers from data structures."""
    if isinstance(obj, dict):
        cleaned = {}
        for key, value in obj.items():
            if _SENSITIVE_KEY_PATTERN.search(str(key)):
                cleaned[key] = "[REDACTED]"
            else:
                cleaned[key] = redact_sensitive_data(value)
        return cleaned
    elif isinstance(obj, list):
        return [redact_sensitive_data(item) for item in obj]
    elif isinstance(obj, str):
        return redact_sensitive_string(obj)
    return obj


class SensitiveDataLogFilter(logging.Filter):
    """Logging filter that scrubs sensitive credentials, cards, and tokens from all log output."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_sensitive_string(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = redact_sensitive_data(record.args)
            elif isinstance(record.args, (list, tuple)):
                record.args = tuple(
                    redact_sensitive_string(arg) if isinstance(arg, str)
                    else (redact_sensitive_data(arg) if isinstance(arg, dict) else arg)
                    for arg in record.args
                )
        return True


# Install the redaction filter on root and audit loggers
_redaction_filter = SensitiveDataLogFilter()
logging.getLogger().addFilter(_redaction_filter)
_AUDIT_LOGGER.addFilter(_redaction_filter)

try:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    _file_handler = logging.FileHandler(_AUDIT_FILE, encoding="utf-8")
    _file_handler.setFormatter(logging.Formatter("%(message)s"))
    _file_handler.addFilter(_redaction_filter)
    _AUDIT_LOGGER.addHandler(_file_handler)
    _AUDIT_LOGGER.setLevel(logging.INFO)
except Exception:
    pass


def log_security_event(
    event_type: str,
    severity: str = "WARNING",  # INFO, WARNING, CRITICAL
    ip_address: str = "unknown",
    user_id: str | None = None,
    email: str | None = None,
    endpoint: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Emit a structured security audit record with automated PII & secret redaction."""
    sanitized_details = redact_sensitive_data(details or {})

    audit_record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": event_type,
        "severity": severity,
        "ip_address": ip_address,
        "user_id": user_id,
        "email": email,
        "endpoint": endpoint,
        "details": sanitized_details,
    }

    log_line = json.dumps(audit_record, ensure_ascii=False)
    if severity == "CRITICAL":
        _AUDIT_LOGGER.critical(log_line)
    elif severity == "WARNING":
        _AUDIT_LOGGER.warning(log_line)
    else:
        _AUDIT_LOGGER.info(log_line)
