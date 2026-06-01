import logging
from functools import lru_cache

from supabase import Client, ClientOptions, create_client

from core.config import settings

logger = logging.getLogger(__name__)
_has_warned_supabase_disabled = False


def _create_options(access_token: str | None = None) -> ClientOptions:
    headers: dict[str, str] = {}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    return ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
        headers=headers,
    )


def supabase_enabled() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_ANON_KEY)


def _warn_supabase_disabled_once() -> None:
    global _has_warned_supabase_disabled
    if _has_warned_supabase_disabled:
        return

    logger.warning("Supabase disabled")
    _has_warned_supabase_disabled = True


def _validate_supabase_settings() -> None:
    if supabase_enabled():
        return

    _warn_supabase_disabled_once()
    missing = []
    if not settings.SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not settings.SUPABASE_ANON_KEY:
        missing.append("SUPABASE_ANON_KEY")
    raise RuntimeError(
        f"Supabase disabled: missing {', '.join(missing) or 'required configuration'}."
    )


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    _validate_supabase_settings()
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY,
        options=_create_options(),
    )


def get_supabase_user_client(access_token: str) -> Client:
    _validate_supabase_settings()
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY,
        options=_create_options(access_token),
    )
