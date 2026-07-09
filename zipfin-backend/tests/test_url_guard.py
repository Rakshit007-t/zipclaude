"""SSRF guard regression tests (hermetic — DNS is injected, never real)."""

from __future__ import annotations

import pytest

from services.url_guard import assert_public_http_url


def _resolver_to(*ips):
    def _resolve(host, port):
        return [(2, 1, 6, "", (ip, 0)) for ip in ips]

    return _resolve


@pytest.fixture(autouse=True)
def _guard_enabled(monkeypatch):
    monkeypatch.delenv("ZIPRIGHT_ALLOW_PRIVATE_STORE_URLS", raising=False)


def test_public_host_passes():
    assert_public_http_url("https://shop.example/products", resolver=_resolver_to("93.184.216.34"))


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",  # AWS IMDS
        "http://127.0.0.1:8000/",
        "https://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://[::1]/",
        "http://0.0.0.0/",
        "http://[fd00::1]/",
    ],
)
def test_ip_literal_private_or_reserved_blocked(url):
    # IP-literal hosts need no DNS.
    with pytest.raises(ValueError):
        assert_public_http_url(url)


def test_hostname_resolving_to_private_is_blocked():
    # DNS-rebinding style: a "normal" hostname that resolves to loopback.
    with pytest.raises(ValueError):
        assert_public_http_url("https://evil.example/", resolver=_resolver_to("127.0.0.1"))


def test_any_private_answer_blocks_even_with_public_present():
    with pytest.raises(ValueError):
        assert_public_http_url(
            "https://mixed.example/", resolver=_resolver_to("93.184.216.34", "10.1.2.3")
        )


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://host/x", "gopher://h/", "notaurl", "//host/p"])
def test_non_http_scheme_blocked(url):
    with pytest.raises(ValueError):
        assert_public_http_url(url)


def test_embedded_credentials_blocked():
    with pytest.raises(ValueError):
        assert_public_http_url("https://user:pass@shop.example/", resolver=_resolver_to("93.184.216.34"))


def test_unresolvable_host_blocked():
    def _boom(host, port):
        raise OSError("nxdomain")

    with pytest.raises(ValueError):
        assert_public_http_url("https://nope.example/", resolver=_boom)


def test_escape_hatch_allows_private(monkeypatch):
    monkeypatch.setenv("ZIPRIGHT_ALLOW_PRIVATE_STORE_URLS", "1")
    assert_public_http_url("http://127.0.0.1:8000/")  # no raise under escape hatch


# --- Route-level wiring: connect must 400 on a private store_url --------------


def test_connect_route_rejects_private_store_url(fake_client, monkeypatch):
    monkeypatch.delenv("ZIPRIGHT_ALLOW_PRIVATE_STORE_URLS", raising=False)
    from firebase_config import get_firestore_client
    from tests.test_seller_m2 import _active_seller_client

    client = _active_seller_client(fake_client)
    client.app.dependency_overrides[get_firestore_client] = lambda: fake_client

    resp = client.post(
        "/seller/integration/connect",
        json={
            "platform": "rest",
            "store_url": "http://169.254.169.254/latest/meta-data/",
            "credentials": {},
        },
    )
    assert resp.status_code == 400
