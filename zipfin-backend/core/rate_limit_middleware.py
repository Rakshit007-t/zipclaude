"""Fast In-Memory Sliding Window Rate Limiting Middleware for FastAPI.

Provides an initial defense line against denial-of-service and credential stuffing
attacks before hitting database or compute-heavy operations.
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict
from threading import Lock
from typing import Callable

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class InMemoryRateLimiter:
    """Thread-safe sliding-window in-memory request counter per client IP."""

    def __init__(self, requests_per_minute: int = 120, burst_limit: int = 35) -> None:
        self.requests_per_minute = requests_per_minute
        self.burst_limit = burst_limit
        self._lock = Lock()
        # client_ip -> list of timestamps
        self._history: dict[str, list[float]] = defaultdict(list)
        self._last_cleanup = time.time()

    def _cleanup(self, now: float) -> None:
        """Purge entries older than 60 seconds every 5 minutes."""
        if now - self._last_cleanup > 300:
            threshold = now - 60.0
            expired_keys = [
                ip for ip, timestamps in self._history.items()
                if not timestamps or timestamps[-1] < threshold
            ]
            for ip in expired_keys:
                self._history.pop(ip, None)
            self._last_cleanup = now

    def is_allowed(self, client_ip: str) -> tuple[bool, int, int]:
        """Check if client IP is within rate limits.
        
        Returns:
            (allowed: bool, retry_after: int, remaining: int)
        """
        now = time.time()
        minute_ago = now - 60.0
        ten_sec_ago = now - 10.0

        with self._lock:
            self._cleanup(now)
            timestamps = self._history[client_ip]

            # Keep only timestamps from the last 60 seconds
            valid_timestamps = [ts for ts in timestamps if ts > minute_ago]
            self._history[client_ip] = valid_timestamps

            # Check burst (last 10 seconds)
            burst_count = sum(1 for ts in valid_timestamps if ts > ten_sec_ago)
            if burst_count >= self.burst_limit:
                retry_after = max(1, int(10.0 - (now - valid_timestamps[-self.burst_limit])))
                return False, retry_after, 0

            # Check minute limit
            if len(valid_timestamps) >= self.requests_per_minute:
                oldest_in_window = valid_timestamps[0]
                retry_after = max(1, int(60.0 - (now - oldest_in_window)))
                return False, retry_after, 0

            # Record this request
            valid_timestamps.append(now)
            remaining = self.requests_per_minute - len(valid_timestamps)
            return True, 0, remaining


class RateLimitMiddleware(BaseHTTPMiddleware):
    """FastAPI/Starlette middleware enforcing in-memory client IP rate limits."""

    EXEMPT_PATHS = {"/health", "/api/health", "/metrics", "/docs", "/redoc", "/openapi.json"}

    def __init__(self, app, requests_per_minute: int = 120, burst_limit: int = 35) -> None:
        super().__init__(app)
        self.limiter = InMemoryRateLimiter(requests_per_minute, burst_limit)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path.rstrip("/") or "/"
        
        # Skip rate limit for exempt endpoints and static uploads
        if path in self.EXEMPT_PATHS or path.startswith("/uploads/") or path.startswith("/ui/"):
            return await call_next(request)

        # Extract client IP (respecting X-Forwarded-For only if configured behind a trusted proxy)
        peer_host = request.client.host if request.client else "127.0.0.1"
        trust_proxy = os.getenv("TRUST_PROXY_HEADERS", "").strip().lower() in {"1", "true", "yes"}
        forwarded_for = request.headers.get("X-Forwarded-For", "").strip()

        if trust_proxy and forwarded_for and peer_host in {"127.0.0.1", "::1", "localhost", "testclient"}:
            client_ip = forwarded_for.split(",")[0].strip()
        else:
            client_ip = peer_host

        allowed, retry_after, remaining = self.limiter.is_allowed(client_ip)

        if not allowed:
            logger.warning("Rate limit exceeded for IP=%s on path=%s", client_ip, path)
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "success": False,
                    "message": "Too many requests. Please slow down and try again later.",
                    "details": {"retry_after_seconds": retry_after},
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(self.limiter.requests_per_minute),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limiter.requests_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(max(0, remaining))
        return response
