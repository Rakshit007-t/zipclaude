"""Security regression tests for seller store-credential encryption.

Guards the fix for the hardcoded fallback Fernet key: production must fail
closed without a configured key, and no committed key may ever protect
credentials.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from services import ecommerce_service


@pytest.fixture(autouse=True)
def _reset_cipher(monkeypatch):
    """Each test gets a clean cipher cache and a controlled environment."""
    monkeypatch.delenv("ECOMMERCE_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("ENV", raising=False)
    ecommerce_service._fernet = None
    yield
    ecommerce_service._fernet = None


def test_production_without_key_fails_closed(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    with pytest.raises(RuntimeError, match="ECOMMERCE_ENCRYPTION_KEY is required"):
        ecommerce_service.encrypt_credentials({"access_token": "shpat_secret"})


def test_configured_key_round_trips(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("ECOMMERCE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    token = ecommerce_service.encrypt_credentials({"access_token": "shpat_secret", "api_key": "k"})
    assert token != "shpat_secret"
    assert ecommerce_service.decrypt_credentials(token) == {
        "access_token": "shpat_secret",
        "api_key": "k",
    }


def test_no_hardcoded_key_in_source():
    # The previously committed fallback key must not reappear.
    import inspect

    source = inspect.getsource(ecommerce_service)
    assert "K3xCwGE-c5LtMUmcsHlmWDTqzYRhn_5Uy-740w07miQ=" not in source


def test_dev_without_key_uses_ephemeral_key(monkeypatch):
    monkeypatch.setenv("ENV", "development")
    token = ecommerce_service.encrypt_credentials({"access_token": "shpat_dev"})
    # Same process → same ephemeral cipher → round-trips.
    assert ecommerce_service.decrypt_credentials(token) == {"access_token": "shpat_dev"}


def test_malformed_key_raises_clear_error(monkeypatch):
    monkeypatch.setenv("ECOMMERCE_ENCRYPTION_KEY", "not-a-valid-fernet-key")
    with pytest.raises(RuntimeError, match="not a valid Fernet key"):
        ecommerce_service.encrypt_credentials({"access_token": "x"})
