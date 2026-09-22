"""Focused tests for discrete and URL-based Redis credential resolution.

Verifies:
1. Discrete configuration (REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD, REDIS_SSL)
   delivers the EXACT intended password to redis-py and redis.cluster.RedisCluster
   without any URL encoding, decoding, delimiter collision, or corruption.
2. Synthetic passwords containing +, /, =, %2B, %2F, %3D, @, colon (:), and trailing =
   reach Redis client connection kwargs without being altered.
3. Non-secret SHA-256 diagnostics compare the extracted password against the expected
   synthetic password without printing or exposing the secret value.
4. Discrete configuration takes precedence over REDIS_URL while maintaining full
   backward compatibility for local development, tests, and CI.
"""

from __future__ import annotations

import hashlib
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import core.redis_client as rc
from core.redis_client import (
    _create_client,
    _parse_redis_url_to_kwargs,
    _resolve_redis_connection_config,
    reset_redis_client_for_testing,
)


def _compute_sha256(val: str | bytes | None) -> str | None:
    """Compute SHA-256 hex digest for non-secret diagnostic comparison."""
    if val is None:
        return None
    if isinstance(val, str):
        return hashlib.sha256(val.encode("utf-8")).hexdigest()
    return hashlib.sha256(val).hexdigest()


# Synthetic test passwords covering all required edge-case characters:
# +, /, =, %2B, %2F, %3D, @, colon (:), and trailing =
SYNTHETIC_TEST_PASSWORDS = [
    ("plus", "Secret+Key+With+Plus123="),
    ("slash", "Secret/Key/With/Slash456="),
    ("equals", "Secret=Key=With=Equals789="),
    ("trailing_single_equals", "SecretKeyWithSingleTrailingEquals="),
    ("trailing_double_equals", "SecretKeyWithDoubleTrailingEquals=="),
    ("percent_2B", "SecretKey%2BContainsLiteralPercent2B"),
    ("percent_2F", "SecretKey%2FContainsLiteralPercent2F"),
    ("percent_3D", "SecretKey%3DContainsLiteralPercent3D"),
    ("at_sign", "SecretKey@With@AtSign@Chars"),
    ("colon", "SecretKey:With:Colons:Inside"),
    ("literal_percent", "SecretKey%With%LiteralPercent"),
    ("azure_base64_typical", "dGVzdC1rZXkrd2l0aC9zbGFzaCthbmQ9ZXF1YWxzPT0="),
    ("all_special_combined", "Key+With/All=Special@Chars:And%2B%2F%3DCombined=="),
]


@pytest.fixture(autouse=True)
def clean_redis_env():
    """Ensure a pristine environment for each test and reset the Redis client singleton."""
    rc.reset_redis_client_for_testing(None)
    env_vars_to_clear = [
        "REDIS_HOST",
        "REDIS_PORT",
        "REDIS_USERNAME",
        "REDIS_PASSWORD",
        "REDIS_SSL",
        "REDIS_CLUSTER_MODE",
        "REDIS_URL",
        "STRICT_REDIS_SECURITY",
    ]
    saved = {k: os.environ.get(k) for k in env_vars_to_clear}
    for k in env_vars_to_clear:
        os.environ.pop(k, None)
    yield
    rc.reset_redis_client_for_testing(None)
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v
        else:
            os.environ.pop(k, None)


class TestDiscreteCredentialsResolution:
    """Verifies that discrete configuration (REDIS_HOST, REDIS_PASSWORD, etc.)
    preserves exact password bytes without URL parsing corruption.
    """

    @pytest.mark.parametrize("label,expected_password", SYNTHETIC_TEST_PASSWORDS)
    def test_discrete_password_reaches_redis_client_unaltered(self, label, expected_password):
        """Verify that every synthetic password reaches Redis client kwargs with identical SHA-256."""
        os.environ["REDIS_HOST"] = "redis-zipright-staging.centralindia.redis.azure.net"
        os.environ["REDIS_PORT"] = "10000"
        os.environ["REDIS_USERNAME"] = "default"
        os.environ["REDIS_PASSWORD"] = expected_password
        os.environ["REDIS_SSL"] = "true"
        os.environ["ENV"] = "staging"

        expected_hash = _compute_sha256(expected_password)

        cfg = _resolve_redis_connection_config()
        resolved_password = cfg["password"]
        actual_hash = _compute_sha256(resolved_password)

        # NON-SECRET DIAGNOSTIC ASSERTION:
        # Compare SHA-256 digests without logging or exposing the raw password
        assert actual_hash == expected_hash, (
            f"[{label}] Password hash mismatch in _resolve_redis_connection_config! "
            f"Expected SHA256={expected_hash}, Actual SHA256={actual_hash}"
        )
        assert cfg["username"] == "default"
        assert cfg["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert cfg["port"] == 10000
        assert cfg["ssl"] is True
        assert cfg["is_cluster"] is True

        # Verify that redis.Redis constructor receives the exact password
        captured_kwargs: dict[str, Any] = {}

        def mock_redis_init(self, *args, **kwargs):
            captured_kwargs.update(kwargs)
            self.connection_pool = MagicMock()

        with (
            patch("redis.Redis.__init__", mock_redis_init),
            patch("redis.Redis.ping", return_value=True),
        ):
            client = _create_client()

        client_password = captured_kwargs.get("password")
        client_hash = _compute_sha256(client_password)
        assert client_hash == expected_hash, (
            f"[{label}] Password hash mismatch in redis.Redis init kwargs! "
            f"Expected SHA256={expected_hash}, Actual SHA256={client_hash}"
        )
        assert captured_kwargs.get("username") == "default"
        assert captured_kwargs.get("host") == "redis-zipright-staging.centralindia.redis.azure.net"
        assert captured_kwargs.get("port") == 10000
        assert captured_kwargs.get("ssl") is True

    @pytest.mark.parametrize("label,expected_password", SYNTHETIC_TEST_PASSWORDS)
    def test_discrete_password_reaches_redis_cluster_unaltered(self, label, expected_password):
        """Verify that RedisCluster receives the exact discrete password without going through from_url."""
        os.environ["REDIS_HOST"] = "redis-zipright-staging.centralindia.redis.azure.net"
        os.environ["REDIS_PORT"] = "10000"
        os.environ["REDIS_USERNAME"] = "default"
        os.environ["REDIS_PASSWORD"] = expected_password
        os.environ["REDIS_CLUSTER_MODE"] = "true"
        os.environ["ENV"] = "staging"

        expected_hash = _compute_sha256(expected_password)

        captured_cluster_kwargs: dict[str, Any] = {}

        def mock_cluster_init(self, *args, **kwargs):
            captured_cluster_kwargs.update(kwargs)
            self.startup_nodes = {}
            self.default_node = None

        with (
            patch("redis.cluster.RedisCluster.__init__", mock_cluster_init),
            patch("redis.cluster.RedisCluster.ping", return_value=True),
        ):
            client = _create_client()

        cluster_password = captured_cluster_kwargs.get("password")
        cluster_hash = _compute_sha256(cluster_password)
        assert cluster_hash == expected_hash, (
            f"[{label}] Password hash mismatch in RedisCluster init kwargs! "
            f"Expected SHA256={expected_hash}, Actual SHA256={cluster_hash}"
        )
        assert captured_cluster_kwargs.get("username") == "default"
        assert captured_cluster_kwargs.get("host") == "redis-zipright-staging.centralindia.redis.azure.net"
        assert captured_cluster_kwargs.get("port") == 10000
        assert captured_cluster_kwargs.get("ssl") is True


class TestUrlParsingDiagnosticsAndComparison:
    """Non-secret SHA-256 diagnostics comparing REDIS_URL extraction vs discrete configuration."""

    def test_sha256_diagnostic_url_with_slashes_and_colons(self):
        """Demonstrates that regex-enhanced URL parser extracts passwords with / and : correctly,
        and verifies hash equality without exposing password content.
        """
        synthetic_pw = "AzureSecret/With/Slashes:And:Colons=="
        expected_hash = _compute_sha256(synthetic_pw)

        url = f"rediss://default:{synthetic_pw}@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        os.environ["REDIS_URL"] = url
        os.environ["ENV"] = "staging"

        cfg = _resolve_redis_connection_config()
        extracted_pw = cfg["password"]
        extracted_hash = _compute_sha256(extracted_pw)

        # DIAGNOSTIC VERIFICATION:
        assert extracted_hash == expected_hash
        assert cfg["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert cfg["port"] == 10000
        assert cfg["username"] == "default"

    def test_discrete_password_takes_precedence_over_url_password(self):
        """When REDIS_PASSWORD is provided, it must override any password in REDIS_URL."""
        url_pw = "PasswordInsideUrl123=="
        discrete_pw = "SuperiorDiscretePassword456=="
        expected_hash = _compute_sha256(discrete_pw)

        os.environ["REDIS_URL"] = f"rediss://default:{url_pw}@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        os.environ["REDIS_PASSWORD"] = discrete_pw

        cfg = _resolve_redis_connection_config()
        actual_hash = _compute_sha256(cfg["password"])

        assert actual_hash == expected_hash, "Discrete REDIS_PASSWORD must take precedence over URL password"
        assert cfg["password"] == discrete_pw

    def test_discrete_host_and_url_password_composition(self):
        """If REDIS_HOST is given without REDIS_PASSWORD, but REDIS_URL has credentials,
        credentials are recovered without failure.
        """
        pw = "RecoveredPassword789=="
        expected_hash = _compute_sha256(pw)

        os.environ["REDIS_HOST"] = "redis-zipright-staging.centralindia.redis.azure.net"
        os.environ["REDIS_PORT"] = "10000"
        os.environ["REDIS_URL"] = f"rediss://:{pw}@dummy-host:6379/0"

        cfg = _resolve_redis_connection_config()
        actual_hash = _compute_sha256(cfg["password"])

        assert actual_hash == expected_hash
        assert cfg["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert cfg["port"] == 10000
        assert cfg["username"] == "default"

    def test_redis_password_holding_url_is_safely_handled(self):
        """If REDIS_PASSWORD was configured pointing to a full rediss:// URL secret,
        the system safely detects and parses it rather than crashing.
        """
        raw_pw = "KeyInsideSecretUrl123=="
        expected_hash = _compute_sha256(raw_pw)
        url_as_password = f"rediss://default:{raw_pw}@redis-zipright-staging.centralindia.redis.azure.net:10000/0"

        os.environ["REDIS_PASSWORD"] = url_as_password

        cfg = _resolve_redis_connection_config()
        actual_hash = _compute_sha256(cfg["password"])

        assert actual_hash == expected_hash
        assert cfg["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert cfg["port"] == 10000
        assert cfg["username"] == "default"


class TestSecurityHardeningAndFallbackBehavior:
    """Verifies environment-based security constraints and fail-closed behaviors."""

    def test_staging_production_fails_closed_without_configuration(self):
        """In staging or production, missing Redis configuration must fail closed."""
        os.environ["ENV"] = "staging"
        client = _create_client()
        # Must return client targeting unconfigured host, never fakeredis
        assert not rc.is_using_fake_redis()

    def test_development_falls_back_to_fakeredis(self):
        """In development with no configuration, in-process fakeredis is used."""
        os.environ["ENV"] = "development"
        client = _create_client()
        assert rc.is_using_fake_redis()
        assert client.ping() is True


class TestAzureDefaultsAndOperationalBehaviors:
    """Verifies Azure auto-detection defaults, local compatibility, and log protection."""

    def test_azure_hostname_applies_intended_defaults(self):
        """When host is an Azure Managed Redis endpoint, SSL, port 10000, and cluster mode default to True."""
        os.environ["REDIS_HOST"] = "redis-zipright-staging.centralindia.redis.azure.net"
        cfg = _resolve_redis_connection_config()
        assert cfg["port"] == 10000
        assert cfg["ssl"] is True
        assert cfg["is_cluster"] is True
        assert cfg["username"] == "default"

    def test_non_azure_hostname_does_not_apply_azure_defaults(self):
        """Standard non-Azure hostnames do NOT force port 10000, SSL, or cluster mode."""
        os.environ["REDIS_HOST"] = "redis.internal.service"
        cfg = _resolve_redis_connection_config()
        assert cfg["port"] == 6379
        assert cfg["ssl"] is False
        assert cfg["is_cluster"] is False
        assert cfg["username"] == "default"

    def test_local_dev_redis_url_compatibility(self):
        """Local development with REDIS_URL=redis://localhost:6379/0 functions without discrete variables."""
        os.environ["REDIS_URL"] = "redis://localhost:6379/0"
        os.environ["ENV"] = "development"
        cfg = _resolve_redis_connection_config()
        assert cfg["host"] == "localhost"
        assert cfg["port"] == 6379
        assert cfg["ssl"] is False
        assert cfg["is_cluster"] is False
        assert cfg["username"] == "default"

    def test_standalone_redis_fallback_when_cluster_fails(self):
        """If RedisCluster fails during connection, the client falls back to standalone redis.Redis with same kwargs."""
        os.environ["REDIS_HOST"] = "redis-zipright-staging.centralindia.redis.azure.net"
        os.environ["REDIS_PASSWORD"] = "FallbackPassword123=="
        os.environ["REDIS_CLUSTER_MODE"] = "true"

        captured_standalone: dict[str, Any] = {}

        def mock_cluster_failing(*args, **kwargs):
            raise ConnectionError("Cluster topology unreachable")

        def mock_redis_init(self, *args, **kwargs):
            captured_standalone.update(kwargs)
            self.connection_pool = MagicMock()

        with (
            patch("redis.cluster.RedisCluster.__init__", mock_cluster_failing),
            patch("redis.Redis.__init__", mock_redis_init),
            patch("redis.Redis.ping", return_value=True),
        ):
            client = _create_client()

        assert captured_standalone.get("password") == "FallbackPassword123=="
        assert captured_standalone.get("host") == "redis-zipright-staging.centralindia.redis.azure.net"
        assert captured_standalone.get("port") == 10000
        assert captured_standalone.get("username") == "default"

    def test_no_secret_values_in_logs(self, caplog):
        """Verify that secret passwords are NEVER printed, logged, or exposed in log records."""
        import logging

        secret = "UltraConfidentialSecretPassword123=="
        os.environ["REDIS_HOST"] = "redis-zipright-staging.centralindia.redis.azure.net"
        os.environ["REDIS_PASSWORD"] = secret
        os.environ["ENV"] = "development"

        with caplog.at_level(logging.DEBUG):
            with (
                patch("redis.cluster.RedisCluster.__init__", return_value=None),
                patch("redis.cluster.RedisCluster.ping", return_value=True),
            ):
                _create_client()

        logged_text = caplog.text
        assert secret not in logged_text, "Secret password MUST NEVER appear in log text!"
        assert "len=36" in logged_text or "present" in logged_text

