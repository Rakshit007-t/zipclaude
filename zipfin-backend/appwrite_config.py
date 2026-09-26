"""Appwrite client configuration and service factories for ZipRIGHT.

Supports Self-Hosted Appwrite (http://localhost/v1 or custom VPS) as well as
Appwrite Cloud (https://cloud.appwrite.io/v1).
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from appwrite.client import Client
from appwrite.services.account import Account
from appwrite.services.databases import Databases
from appwrite.services.storage import Storage
from appwrite.services.users import Users

logger = logging.getLogger(__name__)

# Default configuration matching Self-Hosted and Staging standards
DEFAULT_APPWRITE_ENDPOINT = "https://appwrite.zipright.in/v1"
DEFAULT_APPWRITE_PROJECT_ID = "zipright-staging"
DEFAULT_APPWRITE_DATABASE_ID = "zipright-staging-db"

DEFAULT_BUCKET_PUBLIC = "zipright-public"
DEFAULT_BUCKET_COMMUNITY = "zipright-community"
DEFAULT_BUCKET_PRIVATE = "zipright-private"


class AppwriteSettings:
    """Settings resolver for Appwrite integration."""

    @property
    def ENDPOINT(self) -> str:
        return os.getenv("APPWRITE_ENDPOINT", DEFAULT_APPWRITE_ENDPOINT).strip().rstrip("/")

    @property
    def PROJECT_ID(self) -> str:
        return os.getenv("APPWRITE_PROJECT_ID", DEFAULT_APPWRITE_PROJECT_ID).strip()

    @property
    def API_KEY(self) -> str:
        return os.getenv("APPWRITE_API_KEY", "").strip()

    @property
    def DATABASE_ID(self) -> str:
        return os.getenv("APPWRITE_DATABASE_ID", DEFAULT_APPWRITE_DATABASE_ID).strip()

    @property
    def BUCKET_PUBLIC(self) -> str:
        return os.getenv("APPWRITE_STORAGE_BUCKET_PUBLIC", os.getenv("APPWRITE_BUCKET_PUBLIC", DEFAULT_BUCKET_PUBLIC)).strip()

    @property
    def BUCKET_COMMUNITY(self) -> str:
        return os.getenv("APPWRITE_STORAGE_BUCKET_COMMUNITY", os.getenv("APPWRITE_BUCKET_COMMUNITY", DEFAULT_BUCKET_COMMUNITY)).strip()

    @property
    def BUCKET_PRIVATE(self) -> str:
        return os.getenv("APPWRITE_STORAGE_BUCKET_PRIVATE", os.getenv("APPWRITE_BUCKET_PRIVATE", DEFAULT_BUCKET_PRIVATE)).strip()

    @property
    def SELF_SIGNED(self) -> bool:
        """Allow self-signed certificates for local Docker/dev environments."""
        return os.getenv("APPWRITE_SELF_SIGNED", "true").strip().lower() in ("true", "1", "yes")


appwrite_settings = AppwriteSettings()

_APPWRITE_CLIENT: Optional[Client] = None
_APPWRITE_DATABASES: Optional[Databases] = None
_APPWRITE_STORAGE: Optional[Storage] = None
_APPWRITE_USERS: Optional[Users] = None
_APPWRITE_ACCOUNT: Optional[Account] = None

_EFFECTIVE_ENDPOINT: Optional[str] = None
_EFFECTIVE_HOST_HEADER: Optional[str] = None


def get_effective_appwrite_target() -> tuple[str, Optional[str]]:
    """Determine effective endpoint and host header.

    If custom domain (appwrite.zipright.in) is blocked by a local network firewall
    (Sophos webcat / 307 redirect), transparently routes via the Azure Container App
    direct endpoint with Host: appwrite.zipright.in header.
    """
    global _EFFECTIVE_ENDPOINT, _EFFECTIVE_HOST_HEADER
    if _EFFECTIVE_ENDPOINT is not None:
        return _EFFECTIVE_ENDPOINT, _EFFECTIVE_HOST_HEADER

    configured_endpoint = appwrite_settings.ENDPOINT
    direct_azure = os.getenv(
        "APPWRITE_DIRECT_ENDPOINT",
        "https://ca-zipright-appwrite.calmfield-d6fa58ac.centralindia.azurecontainerapps.io/v1",
    ).strip()

    if "appwrite.zipright.in" in configured_endpoint:
        try:
            import requests
            r = requests.get(
                f"{configured_endpoint}/health",
                timeout=2,
                verify=False,
                allow_redirects=False,
            )
            if r.status_code in (301, 302, 307) or "172.16." in r.headers.get("Location", "") or "Blocked site" in r.text or "Sophos" in r.text or "<!DOCTYPE html" in r.text:
                logger.info("Custom domain intercepted by local network firewall; routing via Azure direct endpoint with Host header.")
                _EFFECTIVE_ENDPOINT = direct_azure
                _EFFECTIVE_HOST_HEADER = "appwrite.zipright.in"
                return _EFFECTIVE_ENDPOINT, _EFFECTIVE_HOST_HEADER
        except Exception as e:
            logger.info("Custom domain probe exception (%s); routing via Azure direct endpoint.", e)
            _EFFECTIVE_ENDPOINT = direct_azure
            _EFFECTIVE_HOST_HEADER = "appwrite.zipright.in"
            return _EFFECTIVE_ENDPOINT, _EFFECTIVE_HOST_HEADER

    _EFFECTIVE_ENDPOINT = configured_endpoint
    _EFFECTIVE_HOST_HEADER = None
    return _EFFECTIVE_ENDPOINT, _EFFECTIVE_HOST_HEADER


def get_appwrite_client(api_key: Optional[str] = None) -> Client:
    """Return an initialized Appwrite Server Client."""
    global _APPWRITE_CLIENT
    if api_key is None and _APPWRITE_CLIENT is not None:
        return _APPWRITE_CLIENT

    key = api_key or appwrite_settings.API_KEY
    endpoint, host_hdr = get_effective_appwrite_target()
    client = Client()
    client.set_endpoint(endpoint)
    client.set_project(appwrite_settings.PROJECT_ID)
    if host_hdr:
        client.add_header("Host", host_hdr)
    if key:
        client.set_key(key)
    if appwrite_settings.SELF_SIGNED:
        client.set_self_signed(True)

    if api_key is None:
        _APPWRITE_CLIENT = client
    return client


def get_appwrite_databases(client: Optional[Client] = None) -> Databases:
    """Return Databases service client."""
    global _APPWRITE_DATABASES
    if client is not None:
        return Databases(client)
    if _APPWRITE_DATABASES is None:
        _APPWRITE_DATABASES = Databases(get_appwrite_client())
    return _APPWRITE_DATABASES


def get_appwrite_storage(client: Optional[Client] = None) -> Storage:
    """Return Storage service client."""
    global _APPWRITE_STORAGE
    if client is not None:
        return Storage(client)
    if _APPWRITE_STORAGE is None:
        _APPWRITE_STORAGE = Storage(get_appwrite_client())
    return _APPWRITE_STORAGE


def get_appwrite_users(client: Optional[Client] = None) -> Users:
    """Return Users service client (admin user management)."""
    global _APPWRITE_USERS
    if client is not None:
        return Users(client)
    if _APPWRITE_USERS is None:
        _APPWRITE_USERS = Users(get_appwrite_client())
    return _APPWRITE_USERS


def get_appwrite_account(client: Optional[Client] = None) -> Account:
    """Return Account service client."""
    global _APPWRITE_ACCOUNT
    if client is not None:
        return Account(client)
    if _APPWRITE_ACCOUNT is None:
        _APPWRITE_ACCOUNT = Account(get_appwrite_client())
    return _APPWRITE_ACCOUNT


def check_appwrite_health() -> dict[str, str | bool]:
    """Probe Appwrite server availability."""
    endpoint, host_hdr = get_effective_appwrite_target()
    headers = {"Host": host_hdr} if host_hdr else {}
    if appwrite_settings.API_KEY:
        headers["X-Appwrite-Key"] = appwrite_settings.API_KEY
    if appwrite_settings.PROJECT_ID:
        headers["X-Appwrite-Project"] = appwrite_settings.PROJECT_ID
    try:
        import requests
        resp = requests.get(
            f"{endpoint}/health",
            headers=headers,
            timeout=3,
            verify=not appwrite_settings.SELF_SIGNED,
        )
        return {
            "status": "ok" if resp.status_code == 200 else "degraded",
            "http_status": resp.status_code,
            "endpoint": endpoint,
            "project_id": appwrite_settings.PROJECT_ID,
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "error": str(exc),
            "endpoint": endpoint,
            "project_id": appwrite_settings.PROJECT_ID,
        }
