"""Request Size Limiter Middleware for FastAPI.

Prevents Denial of Service (DoS) attacks via oversized payloads or decompression bombs.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from core.security_logger import log_security_event

MAX_JSON_PAYLOAD_BYTES = 1024 * 1024  # 1 MB
MAX_UPLOAD_PAYLOAD_BYTES = 15 * 1024 * 1024  # 15 MB

UPLOAD_PATH_PREFIXES = (
    "/avatar",
    "/seller/profile/logo",
    "/seller/catalog/import",
    "/tryon",
    "/measurement",
)


class RequestSizeLimiterMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        content_length = request.headers.get("content-length")
        path = request.url.path
        ip_address = request.client.host if request.client else "unknown"

        if content_length:
            try:
                length = int(content_length)
                is_upload = any(path.startswith(prefix) for prefix in UPLOAD_PATH_PREFIXES)
                limit = MAX_UPLOAD_PAYLOAD_BYTES if is_upload else MAX_JSON_PAYLOAD_BYTES

                if length > limit:
                    log_security_event(
                        event_type="SECURITY_PAYLOAD_TOO_LARGE",
                        severity="WARNING",
                        ip_address=ip_address,
                        endpoint=path,
                        details={"content_length": length, "limit": limit},
                    )
                    return JSONResponse(
                        status_code=413,
                        content={
                            "status": "error",
                            "message": f"Request payload exceeds allowed limit of {limit // (1024 * 1024)} MB.",
                            "details": {"code": "payload_too_large"},
                        },
                    )
            except ValueError:
                pass

        return await call_next(request)
