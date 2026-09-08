"""Double-Submit Cookie CSRF Middleware for FastAPI.

Protects state-changing requests against Cross-Site Request Forgery (CSRF).
Client reads the 'csrftoken' cookie and echoes it in the 'X-CSRF-Token' header.
"""

from __future__ import annotations

import hmac
import os
import secrets
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from core.security_logger import log_security_event

CSRF_COOKIE_NAME = "csrftoken"
CSRF_HEADER_NAME = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

# Exempt paths or prefixes: public APIs, integration endpoints, and webhooks
CSRF_EXEMPT_PREFIXES = (
    "/public/",
    "/v1/",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/payments/webhook",
    "/wallet/webhook",
    "/health",
    "/metrics",
)

CSRF_EXEMPT_PATHS = frozenset({
    "/payments/webhook",
    "/wallet/webhook",
    "/health",
    "/metrics",
})


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        method = request.method
        ip_address = request.client.host if request.client else "unknown"

        cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
        new_token_needed = not cookie_token

        if new_token_needed:
            cookie_token = secrets.token_urlsafe(32)

        is_exempt = any(path.startswith(prefix) for prefix in CSRF_EXEMPT_PREFIXES) or path in CSRF_EXEMPT_PATHS

        # Enforce CSRF check on state-changing requests
        if method not in SAFE_METHODS and not is_exempt:
            header_token = request.headers.get(CSRF_HEADER_NAME)
            auth_header = request.headers.get("Authorization", "")
            api_key = request.headers.get("X-API-Key", "")
            has_bearer = auth_header.startswith("Bearer ") or bool(api_key)

            # If header_token is supplied, always validate it against the cookie
            if header_token:
                if not cookie_token or not hmac.compare_digest(header_token, cookie_token):
                    log_security_event(
                        event_type="SECURITY_CSRF_FAILED",
                        severity="WARNING",
                        ip_address=ip_address,
                        endpoint=path,
                        details={"method": method, "reason": "Invalid or mismatched X-CSRF-Token"},
                    )
                    return JSONResponse(
                        status_code=403,
                        content={
                            "status": "error",
                            "message": "CSRF verification failed. Request rejected.",
                            "details": {"code": "csrf_token_invalid"},
                        },
                    )
            # If no Bearer auth token and request relies on browser ambient credentials
            elif not has_bearer and (request.cookies.get("session") or request.cookies.get("auth")):
                log_security_event(
                    event_type="SECURITY_CSRF_FAILED",
                    severity="WARNING",
                    ip_address=ip_address,
                    endpoint=path,
                    details={"method": method, "reason": "Missing required X-CSRF-Token on session-authenticated request"},
                )
                return JSONResponse(
                    status_code=403,
                    content={
                        "status": "error",
                        "message": "CSRF verification failed. X-CSRF-Token required.",
                        "details": {"code": "csrf_token_missing"},
                    },
                )

        response = await call_next(request)

        # Set or refresh the CSRF cookie
        if new_token_needed:
            is_prod = os.getenv("ENV", "development") == "production"
            response.set_cookie(
                key=CSRF_COOKIE_NAME,
                value=cookie_token,
                max_age=86400 * 7,  # 7 days
                path="/",
                secure=is_prod,
                httponly=False,  # Client script must read token to include in header
                samesite="lax",
            )

        return response
