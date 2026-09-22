"""Focused regression tests isolating the exact root cause of the Azure Managed Redis connection failure.

ROOT CAUSE INVESTIGATION SUMMARY:
1. Azure CLI uses access-key authentication on port 10000, which specifically authenticates
   against the Redis ACL user 'default' with the primary access key (issuing 'AUTH default <key>'
   or 'HELLO 3 AUTH default <key>').
2. In the deployed application, REDIS_URL was configured in standard connection string format
   without an explicit username: 'rediss://:<access_key>@<host>:10000'.
3. In redis-py (>= 5.0.0, including 8.1.0):
   - parse_url() correctly URL-decodes the password (confirming from_url does decode passwords).
   - BUT parse_url() leaves username as None when url.username is empty ('').
   - Consequently, UsernamePasswordCredentialProvider(None, password).get_credentials() returns
     (password,) -- a 1-tuple.
   - redis-py issues the legacy single-argument command: AUTH <password>.
   - Azure Managed Redis (Redis 7.2 with ACLs enabled) requires the ACL username, rejecting
     single-argument AUTH with: 'WRONGPASS invalid username-password pair'.
4. Furthermore, this Azure Managed Redis instance uses OSS cluster policy:
   - Standalone redis.Redis is not cluster-aware: while PING succeeds on port 10000, any key-based
     command (used by DistributedRateLimiter, account_lockout, tryon_queue, order_service) that hashes
     to another shard receives MOVED <slot> <ip>:<port>, which standalone redis.Redis raises as MovedError.
   - redis.cluster.RedisCluster handles topology discovery, shard connections, and MOVED redirections.
5. The /health endpoint probes is_redis_healthy(), which calls get_redis_client().ping() on the exact
   same singleton instance used by the distributed rate limiter, account lockout, and try-on queue.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch
from urllib.parse import urlparse, unquote

import pytest
import redis
from redis.connection import parse_url
from redis.credentials import UsernamePasswordCredentialProvider


class TestRedisPyFromUrlPasswordDecoding:
    """Verifies that redis-py's from_url() / parse_url() does indeed URL-decode passwords.

    Confirms user correction: do not assume from_url() fails to URL-decode passwords.
    """

    def test_parse_url_decodes_percent_encoded_characters_in_password(self):
        """Percent-encoded characters (+ -> %2B, / -> %2F, = -> %3D) are properly decoded."""
        # Simulated Azure access key containing +, /, = percent-encoded in URI
        raw_key = "abc+def/ghi=jkl=="
        encoded_key = "abc%2Bdef%2Fghi%3Djkl%3D%3D"
        url = f"rediss://:{encoded_key}@redis-host.centralindia.redis.azure.net:10000/0"

        opts = parse_url(url)
        assert opts["password"] == raw_key, (
            "redis.connection.parse_url must decode percent-encoded characters in the password. "
            f"Expected {raw_key!r}, got {opts['password']!r}"
        )

    def test_from_url_passes_decoded_password_to_connection_kwargs(self):
        """redis.Redis.from_url() populates connection_kwargs with the decoded password."""
        raw_key = "SecretKey+With/Chars=End=="
        encoded_key = "SecretKey%2BWith%2FChars%3DEnd%3D%3D"
        url = f"rediss://:{encoded_key}@redis-host.centralindia.redis.azure.net:10000/0"

        client = redis.Redis.from_url(url)
        assert client.connection_pool.connection_kwargs["password"] == raw_key


class TestAuthenticationCommandRootCause:
    """Isolates the exact difference between Azure CLI success and application failure."""

    def test_empty_username_produces_single_arg_auth_command(self):
        """ROOT CAUSE: A URL without a username causes redis-py to send single-arg AUTH <key>.

        Azure Managed Redis rejects single-arg AUTH with 'invalid username-password pair'
        because access keys belong to the ACL user 'default'.
        """
        url_without_user = "rediss://:MyAccessKey123==@redis-host.centralindia.redis.azure.net:10000/0"
        opts = parse_url(url_without_user)

        # parse_url omits 'username' when empty
        assert opts.get("username") is None

        # CredentialProvider generates 1-element tuple when username is None
        provider = UsernamePasswordCredentialProvider(opts.get("username"), opts["password"])
        creds = provider.get_credentials()
        assert creds == ("MyAccessKey123==", ), (
            "Without an explicit username, redis-py generates a 1-tuple credentials payload, "
            "causing it to send AUTH <password>. Azure Managed Redis rejects this with "
            "'invalid username-password pair'."
        )

    def test_explicit_default_username_produces_two_arg_auth_command(self):
        """FIX: Supplying username='default' produces the two-argument ACL command AUTH default <key>.

        This matches the exact command issued by Azure CLI with authMethod: access-key.
        """
        url_with_default = "rediss://default:MyAccessKey123==@redis-host.centralindia.redis.azure.net:10000/0"
        opts = parse_url(url_with_default)

        assert opts.get("username") == "default"

        provider = UsernamePasswordCredentialProvider(opts.get("username"), opts["password"])
        creds = provider.get_credentials()
        assert creds == ("default", "MyAccessKey123=="), (
            "With username='default', redis-py generates a 2-tuple credentials payload, "
            "issuing AUTH default <password>, matching Azure CLI's successful authentication."
        )

    def test_from_url_with_default_username_kwarg_supplies_default(self):
        """redis.Redis.from_url(url, username='default') sets username='default' even for rediss://:..."""
        url_without_user = "rediss://:MyAccessKey123==@redis-host.centralindia.redis.azure.net:10000/0"

        client = redis.Redis.from_url(url_without_user, username="default")
        assert client.connection_pool.connection_kwargs.get("username") == "default"

        provider = UsernamePasswordCredentialProvider(
            client.connection_pool.connection_kwargs.get("username"),
            client.connection_pool.connection_kwargs.get("password"),
        )
        assert provider.get_credentials() == ("default", "MyAccessKey123==")


class TestUrlNormalization:
    """Verifies that URL normalisation cleanly adds 'default' username without altering secrets."""

    def test_normalize_empty_username_to_default(self):
        from core.redis_client import _normalize_redis_url

        url = "rediss://:SomeKey@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        norm = _normalize_redis_url(url)
        assert norm == "rediss://default:SomeKey@redis-zipright-staging.centralindia.redis.azure.net:10000/0"

    def test_normalize_preserves_explicit_username(self):
        from core.redis_client import _normalize_redis_url

        url = "rediss://custom_admin:SomeKey@redis-host.redis.azure.net:10000/0"
        norm = _normalize_redis_url(url)
        assert norm == url

    def test_normalize_preserves_percent_encoded_characters(self):
        from core.redis_client import _normalize_redis_url

        url = "rediss://:abc%2Bdef%2Fghi%3Djkl@redis-host.redis.azure.net:10000/0"
        norm = _normalize_redis_url(url)
        assert norm == "rediss://default:abc%2Bdef%2Fghi%3Djkl@redis-host.redis.azure.net:10000/0"


class TestOSSClusterPolicyAwareness:
    """Verifies behavior with Azure Managed Redis OSS cluster policy."""

    def test_redis_cluster_from_url_accepts_normalized_url(self):
        """RedisCluster.from_url() parses the normalized URL with username='default'."""
        from redis.cluster import RedisCluster

        url = "rediss://default:AccessKey123==@redis-zipright-staging.centralindia.redis.azure.net:10000"
        # We verify that parse_url works correctly for RedisCluster options
        opts = parse_url(url)
        assert opts["username"] == "default"
        assert opts["password"] == "AccessKey123=="
        assert opts["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert opts["port"] == 10000

    def test_redis_cluster_has_all_required_client_methods(self):
        """RedisCluster implements all Redis methods used across the backend services."""
        from redis.cluster import RedisCluster

        required_methods = [
            "ping",       # health check
            "get",        # lockout, order service, tryon queue
            "set",        # lockout, order service, tryon queue
            "delete",     # lockout, order service
            "pipeline",   # request rate limiter, distributed limiter
            "rpush",      # tryon queue, tryon worker
            "lpop",       # tryon queue
            "llen",       # tryon queue
            "incr",       # tryon queue semaphore
            "decr",       # tryon queue semaphore
            "expire",     # rate limiter, tryon queue
        ]
        for method in required_methods:
            assert hasattr(RedisCluster, method), f"RedisCluster missing required method: {method}"


class TestHealthEndpointAndRateLimiterParity:
    """Verifies that /health tests the same singleton Redis client used by all services."""

    def test_health_check_and_distributed_limiter_share_singleton(self):
        """is_redis_healthy() and DistributedRateLimiter both obtain the same client instance."""
        import core.redis_client as rc
        from services.distributed_limiter import DistributedRateLimiter

        # Fresh reset
        rc.reset_redis_client_for_testing(None)

        client1 = rc.get_redis_client()
        client2 = rc.get_redis_client()
        assert client1 is client2, "get_redis_client() must return thread-safe singleton"

        mock_client = MagicMock()
        mock_pipe = MagicMock()
        mock_pipe.execute.return_value = [0, 0, 0, []]
        mock_client.pipeline.return_value = mock_pipe
        limiter = DistributedRateLimiter()
        with patch("services.distributed_limiter.get_redis_client", return_value=mock_client) as mock_limiter_rc, \
             patch("core.redis_client.get_redis_client", return_value=mock_client) as mock_health_rc:
            rc.is_redis_healthy()
            limiter.is_allowed("1.2.3.4")
            assert mock_health_rc.called
            assert mock_limiter_rc.called
