"""Distributed Sliding Window Rate Limiter backed by Redis.

Ensures client request limits are enforced consistently across all workers/instances
and survive worker restarts. Automatically expires inactive keys to prevent memory leaks.
Falls back to a thread-safe local sliding window limiter if Redis is unavailable.
"""

from __future__ import annotations

import logging
import time
from uuid import uuid4
from typing import TYPE_CHECKING

from core.redis_client import get_redis_client

if TYPE_CHECKING:
    import redis

logger = logging.getLogger(__name__)


class DistributedRateLimiter:
    """Sliding-window request rate limiter using Redis sorted sets."""

    def __init__(self, requests_per_minute: int = 120, burst_limit: int = 35) -> None:
        self.requests_per_minute = requests_per_minute
        self.burst_limit = burst_limit
        # Local fallback in case Redis is unreachable
        from core.rate_limit_middleware import InMemoryRateLimiter
        self._local_fallback = InMemoryRateLimiter(requests_per_minute, burst_limit)

    def is_allowed(self, client_ip: str) -> tuple[bool, int, int]:
        """Check if client IP is within rate limits.

        Returns:
            (allowed: bool, retry_after: int, remaining: int)
        """
        now = time.time()
        minute_ago = now - 60.0
        ten_sec_ago = now - 10.0
        key = f"zipright:ratelimit:{client_ip}"

        try:
            r = get_redis_client()
            pipe = r.pipeline(transaction=True)
            # Remove timestamps older than 60s
            pipe.zremrangebyscore(key, "-inf", minute_ago)
            # Total count in the 60s window
            pipe.zcard(key)
            # Burst count in the last 10s window
            pipe.zcount(key, ten_sec_ago, "+inf")
            # Fetch oldest elements to compute exact retry_after if exceeded
            pipe.zrangebyscore(key, "-inf", "+inf", withscores=True, start=0, num=1)
            results = pipe.execute()

            total_count = int(results[1])
            burst_count = int(results[2])
            oldest_entries = results[3]

            # Check burst limit
            if burst_count >= self.burst_limit:
                # Get oldest in burst window
                burst_entries = r.zrangebyscore(key, ten_sec_ago, "+inf", withscores=True, start=0, num=1)
                oldest_in_burst = burst_entries[0][1] if burst_entries else now
                retry_after = max(1, int(10.0 - (now - oldest_in_burst)))
                return False, retry_after, 0

            # Check minute limit
            if total_count >= self.requests_per_minute:
                oldest_in_window = oldest_entries[0][1] if oldest_entries else now
                retry_after = max(1, int(60.0 - (now - oldest_in_window)))
                return False, retry_after, 0

            # Under limits: record this request with unique member and set TTL
            member = f"{now}:{uuid4().hex[:8]}"
            pipe = r.pipeline(transaction=True)
            pipe.zadd(key, {member: now})
            pipe.expire(key, 65)  # 65s TTL ensures zero unbounded memory growth
            pipe.execute()

            remaining = max(0, self.requests_per_minute - (total_count + 1))
            return True, 0, remaining

        except Exception as exc:
            logger.warning(
                "Redis rate limiter unavailable (%s), applying local in-memory fallback for %s.",
                exc,
                client_ip,
            )
            return self._local_fallback.is_allowed(client_ip)
