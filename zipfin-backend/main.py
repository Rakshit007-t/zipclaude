"""ZipRIGHT Backend — application entry point.

Environment variables:
  ENV              development | staging | production  (default: development)
  LOG_LEVEL        DEBUG | INFO | WARNING | ERROR       (default: INFO)
  LOG_FORMAT       pretty | json                        (auto-detected from ENV)
  HOST             bind address                         (default: 0.0.0.0)
  PORT             bind port                            (default: 8000)
  CORS_ALLOW_ORIGINS comma-separated allowed origins
  PRODUCTION_CORS_ORIGIN  e.g. https://zipright.ai
"""

import logging
import os
import time
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from core.api import error_response, success_response
from core.logging_config import configure_logging
from core.rate_limit_middleware import RateLimitMiddleware
from core.csrf_middleware import CSRFMiddleware
from core.request_size_limiter import RequestSizeLimiterMiddleware
from models.schema import ApiResponse
from routes.auth import router as auth_router
from routes.product import router as product_router
from routes.seller import router as seller_router
from routes.size import router as size_router
from routes.stylist import router as stylist_router
from routes.tryon import router as tryon_router
from routes.tryon_live import router as tryon_live_router
from routes.wallet import router as wallet_router
from routes.public import router as public_router
from routes.developer import router as developer_router
from routes.v1_public import router as v1_public_router
from routes.feed import router as feed_router
from routes.social import router as social_router
from routes.search import router as search_router
from routes.notification import router as notification_router
from routes.brand import router as brand_router
from routes.gifts import router as gifts_router
from routes.payments import router as payments_router
from routes.media import router as media_router
from routes.orders import router as orders_router
from services.billing_alerts import router as billing_router
from services.tryon_live_store import initialize_tryon_store

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()

APP_VERSION = "1.0.0"
APP_START_TIME = time.time()

# ── Configure logging before anything else emits a log record ─────────────────
configure_logging(os.getenv("ENV", "development"))

logger = logging.getLogger(__name__)
UPLOAD_DIR = Path("uploads")
UI_DIR = Path("ui")

# ── Simple in-process metrics counters ───────────────────────────────────────
_metrics: dict = {
    "requests_total": 0,
    "requests_4xx": 0,
    "requests_5xx": 0,
    "requests_in_flight": 0,
}


def _get_cors_origins() -> list[str]:
    configured_origins = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
    if configured_origins and configured_origins != "*":
        requested_origins = [
            origin.strip().rstrip("/")
            for origin in configured_origins.split(",")
            if origin.strip()
        ]
    else:
        requested_origins = []

    origins = requested_origins or [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    production_origin = os.getenv("PRODUCTION_CORS_ORIGIN", "https://zipright.ai").strip()
    if production_origin:
        origins.append(production_origin.rstrip("/"))

    unique_origins: list[str] = []
    for origin in origins:
        normalized = origin.rstrip("/")
        if normalized and normalized not in unique_origins:
            unique_origins.append(normalized)

    return unique_origins


def _get_cors_origin_regex() -> str | None:
    configured_regex = os.getenv("CORS_ALLOW_ORIGIN_REGEX", "").strip()
    if configured_regex:
        return configured_regex

    # In production, disable broad private IP regex matching
    if os.getenv("ENV", "development") == "production":
        return None

    return (
        r"https?://"
        r"(localhost|127\.0\.0\.1|"
        r"192\.168\.\d{1,3}\.\d{1,3}|"
        r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
        r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
        r")(:\d+)?$"
    )


def create_app() -> FastAPI:
    initialize_tryon_store()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    UI_DIR.mkdir(parents=True, exist_ok=True)

    env = os.getenv("ENV", "development")

    app = FastAPI(
        title="ZipRIGHT Backend",
        version=APP_VERSION,
        description="Production-ready FastAPI backend for ZipRIGHT.",
        # Hide docs in production
        docs_url=None if env == "production" else "/docs",
        redoc_url=None if env == "production" else "/redoc",
        openapi_url=None if env == "production" else "/openapi.json",
    )

    # ── Security & defense middlewares ─────────────────────────────────────────
    app.add_middleware(RequestSizeLimiterMiddleware)
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(RateLimitMiddleware, requests_per_minute=120, burst_limit=35)

    cors_origins = _get_cors_origins()
    cors_regex = _get_cors_origin_regex()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_origin_regex=cors_regex,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-Id",
            "X-CSRF-Token",
            "X-Wallet-Topup-Secret",
            "X-Razorpay-Signature",
            "Accept",
        ],
    )

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(auth_router)
    app.include_router(size_router)
    app.include_router(stylist_router)
    app.include_router(product_router)
    app.include_router(seller_router)
    app.include_router(_load_router("routes.avatar", "avatar"))
    _include_optional_router(app, "routes.profile", "profile")
    app.include_router(tryon_router)
    app.include_router(wallet_router)
    app.include_router(tryon_live_router)
    app.include_router(public_router)
    app.include_router(developer_router)
    app.include_router(v1_public_router)
    app.include_router(feed_router)
    app.include_router(social_router)
    app.include_router(search_router)
    app.include_router(notification_router)
    app.include_router(brand_router)
    app.include_router(gifts_router)
    app.include_router(payments_router)
    app.include_router(billing_router)
    app.include_router(media_router)
    app.include_router(orders_router)

    # ── Static file mounts (directory listing disabled) ───────────────────────
    # Phase 1B: /uploads unauthenticated public mount removed for customer privacy.
    # Private media is now securely retrieved via /media/private/...
    # Public assets are served via /media/public/...
    app.mount("/ui", StaticFiles(directory=UI_DIR, html=False), name="ui")

    # ── Request logging + metrics middleware ──────────────────────────────────
    @app.middleware("http")
    async def observe_requests(request: Request, call_next):
        # Force HTTPS redirect in production if request arrives via insecure HTTP
        if env == "production" and request.headers.get("x-forwarded-proto") == "http":
            from starlette.responses import RedirectResponse
            secure_url = request.url.replace(scheme="https")
            return RedirectResponse(url=str(secure_url), status_code=308)

        start_time = perf_counter()
        request_id = request.headers.get("X-Request-Id", "").strip() or str(uuid4())
        request.state.request_id = request_id

        _metrics["requests_total"] += 1
        _metrics["requests_in_flight"] += 1

        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-Id"] = request_id
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["X-XSS-Protection"] = "1; mode=block"
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
            response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
            return response
        except Exception:
            raise
        finally:
            _metrics["requests_in_flight"] -= 1
            duration_ms = (perf_counter() - start_time) * 1000

            if 400 <= status_code < 500:
                _metrics["requests_4xx"] += 1
            elif status_code >= 500:
                _metrics["requests_5xx"] += 1

            # Emit structured-friendly log record (JsonFormatter picks up extras)
            extra = {
                "request_id": request_id,
                "duration_ms": round(duration_ms, 2),
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
            }
            logger.info(
                "[%s] %s %s | %.2fms | %s",
                request_id,
                request.method,
                request.url.path,
                duration_ms,
                status_code,
                extra=extra,
            )

    # ── Exception handlers ────────────────────────────────────────────────────
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
    ):
        return error_response(
            status_code=422,
            detail=exc.errors(),
            default_message="Request validation failed.",
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(
        request: Request,
        exc: HTTPException,
    ):
        return error_response(
            status_code=exc.status_code,
            detail=exc.detail,
            default_message="Request failed.",
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request,
        exc: Exception,
    ):
        logger.exception(
            "Unhandled application error for %s %s.",
            request.method,
            request.url.path,
        )
        return error_response(
            status_code=500,
            detail=None,
            default_message="Internal server error.",
        )

    # ── Core routes ───────────────────────────────────────────────────────────
    @app.get("/", tags=["root"], response_model=ApiResponse[dict[str, str]])
    async def root() -> ApiResponse[dict[str, str]]:
        return success_response(
            message="ZipRIGHT backend running.",
            data={"status": "running", "version": APP_VERSION, "env": env},
        )

    @app.get("/health", tags=["health"], response_model=ApiResponse[dict])
    async def health_check() -> ApiResponse[dict]:
        """Deep health check.

        Verifies Firebase connectivity. Returns HTTP 503 if any dependency is
        degraded so load balancers and uptime monitors can detect failures.
        """
        checks: dict[str, str] = {}
        overall = "ok"

        # Firebase Firestore probe
        try:
            from firebase_config import get_firestore_client
            db = get_firestore_client()
            # Lightweight read — fetches at most 1 document from a sentinel collection
            list(db.collection("_health_probe").limit(1).get())
            checks["firestore"] = "ok"
        except Exception as exc:
            logger.warning("Health check — Firestore degraded: %s", exc)
            checks["firestore"] = "degraded"
            overall = "degraded"

        uptime_seconds = round(time.time() - APP_START_TIME)
        data = {
            "status": overall,
            "version": APP_VERSION,
            "env": env,
            "uptime_seconds": uptime_seconds,
            "checks": checks,
        }

        if overall != "ok":
            from fastapi.responses import JSONResponse
            from core.api import success_response as _sr
            resp = _sr(message="Health check degraded.", data=data)
            return JSONResponse(status_code=503, content=resp.model_dump(by_alias=True))

        return success_response(message="Health check passed.", data=data)

    @app.get("/metrics", tags=["health"])
    async def metrics(request: Request) -> dict:
        """Protected in-process metrics for authorized uptime monitors."""
        metrics_key = os.getenv("METRICS_API_KEY", "").strip()
        if env == "production" and metrics_key:
            provided_key = request.headers.get("X-Metrics-Key", "").strip()
            import hmac
            if not provided_key or not hmac.compare_digest(provided_key, metrics_key):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Metrics access forbidden.")

        return {
            "version": APP_VERSION,
            "env": env,
            "uptime_seconds": round(time.time() - APP_START_TIME),
            "requests_total": _metrics["requests_total"],
            "requests_4xx": _metrics["requests_4xx"],
            "requests_5xx": _metrics["requests_5xx"],
            "requests_in_flight": _metrics["requests_in_flight"],
        }

    return app


def _load_router(module_path: str, router_name: str):
    module = __import__(module_path, fromlist=[router_name])
    return getattr(module, "router")


def _include_optional_router(app: FastAPI, module_path: str, label: str) -> None:
    try:
        router = _load_router(module_path, label)
    except ModuleNotFoundError as exc:
        logger.warning(
            "Skipping optional '%s' router because a dependency is missing: %s",
            label,
            exc,
        )
        return

    app.include_router(router)


app = create_app()


if __name__ == "__main__":
    is_prod = os.getenv("ENV", "development") == "production"
    reload_default = "false" if is_prod else "true"
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("UVICORN_RELOAD", reload_default).strip().lower() in {"1", "true", "yes"},
    )
