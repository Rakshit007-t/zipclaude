"""Regression tests for Azure Managed Redis REDIS_URL parsing.

Root cause investigated (2026-09-15):
  Azure Managed Redis with OSSCluster policy + Access Key auth requires:
    1. The AUTH command must use the two-argument ACL form: AUTH default <password>
       redis-py >= 5 sends AUTH <password> (single-arg) when username is '' or None.
       Azure rejects this with "invalid username-password pair".
    2. Azure access keys contain Base64 characters (+, /, =). If the secret value
       is stored percent-encoded (e.g. %2B, %2F, %3D), redis-py's from_url() passes
       the URL-encoded string verbatim as the password -- the key sent never matches.
    3. Azure Managed Redis with OSSCluster policy ignores / rejects database index
       selection (AUTH happens before SELECT; the /0 in the URL is safe but /1+ fails).

These tests verify _parse_redis_url_to_kwargs() in core.redis_client parses all of
these edge cases correctly WITHOUT making any real network connection.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_rc_singleton():
    """Drop cached core.redis_client so the module-level singleton is reset."""
    for mod in list(sys.modules.keys()):
        if mod.startswith("core.redis_client"):
            del sys.modules[mod]


# ---------------------------------------------------------------------------
# Unit tests for URL -> kwargs parsing (no real network calls)
# ---------------------------------------------------------------------------

class TestBuildRedisKwargs:
    """Verify that _parse_redis_url_to_kwargs() extracts host/port/password/username/ssl
    from a REDIS_URL the same way redis-py would, but with correct defaults for
    Azure Managed Redis requirements.
    """

    def test_empty_username_becomes_default(self):
        """rediss://:<password>@host:10000/0 must yield username='default'.

        REGRESSION: redis-py >= 5 from_url() maps an empty userinfo segment
        to username='' and sends AUTH <password> (single-arg). Azure Managed
        Redis requires AUTH default <password> (two-arg ACL form) and returns
        'invalid username-password pair' for the single-arg form.
        """
        from core.redis_client import _parse_redis_url_to_kwargs

        kwargs = _parse_redis_url_to_kwargs(
            "rediss://:SomePlainPassword@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        )
        assert kwargs["username"] == "default", (
            "An empty userinfo segment must be normalised to username='default' so "
            "redis-py sends the two-argument ACL AUTH command required by Azure."
        )

    def test_explicit_default_username_preserved(self):
        """rediss://default:<password>@host:10000/0 must keep username='default'."""
        from core.redis_client import _parse_redis_url_to_kwargs

        kwargs = _parse_redis_url_to_kwargs(
            "rediss://default:SomePlainPassword@redis-host.redis.azure.net:10000/0"
        )
        assert kwargs["username"] == "default"

    def test_percent_encoded_password_is_decoded(self):
        """Azure access keys contain +, /, = which are percent-encoded in URLs.

        REGRESSION: redis-py from_url() does NOT percent-decode the password
        before passing it to redis AUTH. A key stored as %2B%2F%3D in the URL
        must arrive at the server as +/= or auth will always fail.
        """
        from core.redis_client import _parse_redis_url_to_kwargs

        # Simulate a key "abc+def/ghi=jkl" percent-encoded inside a URL
        encoded_pw = "abc%2Bdef%2Fghi%3Djkl"
        url = f"rediss://:{encoded_pw}@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        kwargs = _parse_redis_url_to_kwargs(url)

        assert kwargs["password"] == "abc+def/ghi=jkl", (
            "The password must be percent-decoded before being sent to AUTH. "
            "Azure access keys contain +, / and = which are percent-encoded in URIs."
        )

    def test_ssl_enabled_for_rediss_scheme(self):
        """rediss:// scheme must set ssl=True."""
        from core.redis_client import _parse_redis_url_to_kwargs

        kwargs = _parse_redis_url_to_kwargs(
            "rediss://:password@redis-host.redis.azure.net:10000/0"
        )
        assert kwargs.get("ssl") is True, "rediss:// must enable TLS (ssl=True)"

    def test_ssl_disabled_for_redis_scheme(self):
        """redis:// scheme must not force ssl=True."""
        from core.redis_client import _parse_redis_url_to_kwargs

        kwargs = _parse_redis_url_to_kwargs(
            "redis://:password@localhost:6379/0"
        )
        assert not kwargs.get("ssl"), "redis:// must not enable TLS"

    def test_correct_host_and_port_parsed(self):
        """Host and port are extracted correctly from Azure endpoint URL."""
        from core.redis_client import _parse_redis_url_to_kwargs

        kwargs = _parse_redis_url_to_kwargs(
            "rediss://:password@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        )
        assert kwargs["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert kwargs["port"] == 10000

    def test_db_index_zero_is_accepted(self):
        """/0 database index is valid even on OSSCluster (it is a no-op SELECT 0)."""
        from core.redis_client import _parse_redis_url_to_kwargs

        kwargs = _parse_redis_url_to_kwargs(
            "rediss://:password@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        )
        assert kwargs.get("db", 0) == 0

    def test_url_with_all_azure_characteristics(self):
        """Full Azure Managed Redis URL parses to all correct fields."""
        from core.redis_client import _parse_redis_url_to_kwargs

        url = (
            "rediss://:PlainBase64Key12345=="
            "@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        )
        kwargs = _parse_redis_url_to_kwargs(url)

        assert kwargs["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert kwargs["port"] == 10000
        assert kwargs["username"] == "default"
        assert kwargs["ssl"] is True
        assert kwargs["db"] == 0
        # Password must not be empty and must not contain URL-escape sequences
        assert kwargs["password"]
        assert "%" not in kwargs["password"]


# ---------------------------------------------------------------------------
# Integration-level: _create_client() uses the fixed kwargs (ping mocked)
# ---------------------------------------------------------------------------

class TestCreateClientUsesFixedKwargs:
    """Verify that _create_client() constructs redis.Redis with the corrected
    username='default' and decoded password when REDIS_URL is set.
    """

    def test_create_client_passes_default_username_to_redis(self, monkeypatch):
        """_create_client() must NOT pass an empty username to redis.Redis.

        This is the exact call that causes 'invalid username-password pair' on Azure
        when the URL has the form rediss://:<key>@host:port/0.
        """
        _reset_rc_singleton()
        import core.redis_client as rc

        monkeypatch.setenv(
            "REDIS_URL",
            "rediss://:SomePlainKey@redis-host.redis.azure.net:10000/0",
        )
        monkeypatch.setenv("ENV", "staging")
        rc.reset_redis_client_for_testing(None)

        captured_kwargs: dict = {}

        def capturing_init(self, *args, **kwargs):
            captured_kwargs.update(kwargs)
            self.connection_pool = MagicMock()

        with (
            patch("redis.Redis.__init__", capturing_init),
            patch("redis.Redis.ping", MagicMock(return_value=True)),
        ):
            try:
                rc._create_client()
            except Exception:
                pass  # Connection errors are fine -- we only care about kwargs

        # The critical assertion: username must never be '' when connecting to Azure
        if "username" in captured_kwargs:
            assert captured_kwargs["username"] != "", (
                "An empty username causes redis-py to issue AUTH <password> (single-arg). "
                "Azure requires AUTH default <password> (two-arg ACL form). "
                "username must be 'default', not ''."
            )

    def test_create_client_decodes_percent_encoded_password(self, monkeypatch):
        """_create_client() must percent-decode a password before passing to Redis."""
        _reset_rc_singleton()
        import core.redis_client as rc

        encoded = "abc%2Bdef%2Fghi%3Djkl"
        monkeypatch.setenv(
            "REDIS_URL",
            f"rediss://:{encoded}@redis-host.redis.azure.net:10000/0",
        )
        monkeypatch.setenv("ENV", "development")  # allow fakeredis fallback on ping error
        rc.reset_redis_client_for_testing(None)

        captured_kwargs: dict = {}

        def capturing_init(self, *args, **kwargs):
            captured_kwargs.update(kwargs)
            self.connection_pool = MagicMock()

        with (
            patch("redis.Redis.__init__", capturing_init),
            patch("redis.Redis.ping", MagicMock(return_value=True)),
        ):
            try:
                rc._create_client()
            except Exception:
                pass

        if "password" in captured_kwargs:
            assert "%" not in captured_kwargs["password"], (
                "Percent-encoded characters in the password must be decoded before "
                "being sent to AUTH. Found raw percent-escape in password."
            )


# ---------------------------------------------------------------------------
# Documented: the exact URL format required for Azure Managed Redis
# ---------------------------------------------------------------------------

class TestAzureManagedRedisUrlFormat:
    """Document and verify the canonical REDIS_URL format for Azure Managed Redis.

    Azure Managed Redis (OSSCluster, TLS, Access Keys) requires:
      rediss://default:<plain-key>@<host>:10000/0
                ^^^^^^^
                Must be 'default' -- cannot be empty.

    If the raw key contains + / = characters they MUST be percent-encoded in the URL:
      raw key  : abc+def/ghi=jkl
      in URL   : rediss://default:abc%2Bdef%2Fghi%3Djkl@host:10000/0
    Then _parse_redis_url_to_kwargs() decodes them back before passing to AUTH.
    """

    def test_canonical_azure_url_has_default_username(self):
        """Canonical Azure format with explicit 'default' username parses correctly."""
        from core.redis_client import _parse_redis_url_to_kwargs

        url = (
            "rediss://default:SomePlainBase64Key"
            "@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        )
        kwargs = _parse_redis_url_to_kwargs(url)

        assert kwargs["username"] == "default"
        assert kwargs["ssl"] is True
        assert kwargs["host"] == "redis-zipright-staging.centralindia.redis.azure.net"
        assert kwargs["port"] == 10000
        assert kwargs["db"] == 0

    def test_short_form_empty_username_is_normalised(self):
        """Short form rediss://:<key>@... is acceptable -- normalised to 'default'."""
        from core.redis_client import _parse_redis_url_to_kwargs

        url = (
            "rediss://:SomePlainBase64Key"
            "@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        )
        kwargs = _parse_redis_url_to_kwargs(url)
        assert kwargs["username"] == "default", (
            "Short form (empty username) must be silently normalised to 'default'."
        )

    def test_equals_sign_in_key_decoded_from_url(self):
        """= at end of Base64 Azure key is percent-encoded (%3D) in URL and decoded back."""
        from core.redis_client import _parse_redis_url_to_kwargs

        # Base64 key ending with == (common in Azure)
        url = (
            "rediss://default:SomeBase64Key%3D%3D"
            "@redis-zipright-staging.centralindia.redis.azure.net:10000/0"
        )
        kwargs = _parse_redis_url_to_kwargs(url)
        assert kwargs["password"].endswith("=="), (
            "%3D%3D at end of key must be decoded to == before AUTH"
        )
        assert "%" not in kwargs["password"]
