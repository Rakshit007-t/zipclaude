"""SSRF guard for outbound requests to seller-supplied URLs.

Sellers register arbitrary ``store_url`` values that the server then fetches
during e-commerce connect/sync. Without validation an (untrusted) seller could
point us at cloud metadata (169.254.169.254), localhost, or private-range hosts
and exfiltrate internal responses into their own catalogue. ``assert_public_http_url``
rejects any URL that is not an http(s) endpoint resolving to public IPs only.

Escape hatch: ``ZIPRIGHT_ALLOW_PRIVATE_STORE_URLS=1`` disables the IP checks for
self-hosted / local development against private hosts.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from typing import Callable

from urllib.parse import urlsplit

_ALLOWED_SCHEMES = {"http", "https"}


def _allow_private() -> bool:
    return os.getenv("ZIPRIGHT_ALLOW_PRIVATE_STORE_URLS", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    # Unwrap IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) so it can't smuggle a
    # private v4 address past the checks.
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_public_http_url(url: str, *, resolver: Callable | None = None) -> None:
    """Raise ValueError unless *url* is an http(s) URL whose host resolves only
    to public IP addresses.

    resolver defaults to socket.getaddrinfo and is injectable for tests. It is
    called only for hostname hosts; IP-literal hosts are checked directly.
    """
    parts = urlsplit((url or "").strip())

    if parts.scheme.lower() not in _ALLOWED_SCHEMES:
        raise ValueError("Store URL must use http or https.")
    if parts.username or parts.password:
        raise ValueError("Store URL must not contain embedded credentials.")

    host = parts.hostname
    if not host:
        raise ValueError("Store URL must include a host.")

    if _allow_private():
        return

    # IP-literal host: validate directly, no DNS.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _is_blocked_ip(literal):
            raise ValueError("Store URL host is not a public address.")
        return

    resolve = resolver or socket.getaddrinfo
    try:
        infos = resolve(host, None)
    except Exception as exc:
        raise ValueError("Store URL host could not be resolved.") from exc

    addresses = {info[4][0] for info in infos if info[4] and info[4][0]}
    if not addresses:
        raise ValueError("Store URL host could not be resolved.")

    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError as exc:
            raise ValueError("Store URL host resolved to an invalid address.") from exc
        if _is_blocked_ip(ip):
            raise ValueError("Store URL host is not a public address.")
