"""Security regression: public store-URL resolution must be exact, never
substring-based, so a widget on one domain can never resolve to another
seller's integration (cross-tenant catalogue / recommendation exposure)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from routes.public import _canonical_store_key, _get_seller_uid_by_store_url


def _seed(fake_client, uid: str, store_url: str) -> None:
    fake_client.seed("seller_integrations", uid, {"seller_uid": uid, "store_url": store_url})


def test_canonical_key_normalizes_scheme_www_path_case():
    assert _canonical_store_key("https://www.Shop.com/") == "shop.com"
    assert _canonical_store_key("http://shop.com/products?x=1#top") == "shop.com"
    assert _canonical_store_key("shop.com") == "shop.com"
    assert _canonical_store_key("") == ""


def test_exact_and_legit_variations_resolve(fake_client):
    _seed(fake_client, "sellerA", "https://mystore.com")
    assert _get_seller_uid_by_store_url(fake_client, "https://mystore.com") == "sellerA"
    assert _get_seller_uid_by_store_url(fake_client, "https://www.mystore.com/") == "sellerA"
    assert _get_seller_uid_by_store_url(fake_client, "mystore.com") == "sellerA"
    assert _get_seller_uid_by_store_url(fake_client, "http://mystore.com/collections/all") == "sellerA"


def test_prefix_substring_no_longer_matches(fake_client):
    # "shop.com" must NOT resolve to the registered "myshop.com".
    _seed(fake_client, "sellerBig", "https://myshop.com")
    with pytest.raises(HTTPException) as exc:
        _get_seller_uid_by_store_url(fake_client, "shop.com")
    assert exc.value.status_code == 404


def test_attacker_suffix_domain_no_longer_matches(fake_client):
    # Registered "shop.com" must NOT be resolved by "shop.com.attacker.com".
    _seed(fake_client, "sellerVictim", "https://shop.com")
    with pytest.raises(HTTPException) as exc:
        _get_seller_uid_by_store_url(fake_client, "https://shop.com.attacker.com")
    assert exc.value.status_code == 404


def test_distinct_stores_stay_isolated(fake_client):
    _seed(fake_client, "sellerA", "https://a-store.com")
    _seed(fake_client, "sellerB", "https://b-store.com")
    assert _get_seller_uid_by_store_url(fake_client, "https://a-store.com") == "sellerA"
    assert _get_seller_uid_by_store_url(fake_client, "https://b-store.com") == "sellerB"


def test_unknown_store_raises_404(fake_client):
    _seed(fake_client, "sellerA", "https://a-store.com")
    with pytest.raises(HTTPException) as exc:
        _get_seller_uid_by_store_url(fake_client, "https://nope.example")
    assert exc.value.status_code == 404
