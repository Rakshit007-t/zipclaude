from functools import lru_cache

from supabase import Client, ClientOptions, create_client

from core.config import settings


def _create_options(access_token: str | None = None) -> ClientOptions:
    headers: dict[str, str] = {}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    return ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
        headers=headers,
    )


def _validate_supabase_settings() -> None:
    if not settings.SUPABASE_URL:
        raise RuntimeError("SUPABASE_URL is missing from environment variables.")
    if not settings.SUPABASE_ANON_KEY:
        raise RuntimeError("SUPABASE_ANON_KEY is missing from environment variables.")


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
