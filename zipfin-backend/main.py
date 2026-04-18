import logging
import os
from pathlib import Path
from time import perf_counter

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from core.api import error_response, success_response
from models.schema import ApiResponse
from routes.product import router as product_router
from routes.size import router as size_router
from routes.tryon import router as tryon_router
from routes.tryon_live import router as tryon_live_router
from services.tryon_live_store import initialize_tryon_store

load_dotenv()

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)
UPLOAD_DIR = Path("uploads")
UI_DIR = Path("ui")


def _get_cors_origins() -> list[str]:
    configured_origins = os.getenv("CORS_ALLOW_ORIGINS", "*").strip()
    if not configured_origins:
        return ["*"]

    origins = [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
    return origins or ["*"]


def create_app() -> FastAPI:
    initialize_tryon_store()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    UI_DIR.mkdir(parents=True, exist_ok=True)

    app = FastAPI(
        title="ZipRIGHT Backend",
        version="1.0.0",
        description="Production-ready FastAPI backend for ZipRIGHT.",
    )

    cors_origins = _get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(size_router)
    app.include_router(product_router)
    _include_optional_router(app, "routes.auth", "auth")
    app.include_router(_load_router("routes.avatar", "avatar"))
    _include_optional_router(app, "routes.profile", "profile")
    app.include_router(tryon_router)
    app.include_router(tryon_live_router)
    app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
    app.mount("/ui", StaticFiles(directory=UI_DIR, html=True), name="ui")

    @app.middleware("http")
    async def log_http_requests(request: Request, call_next):
        started_at = perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (perf_counter() - started_at) * 1000
            logger.exception(
                "HTTP %s %s failed after %.2f ms.",
                request.method,
                request.url.path,
                duration_ms,
            )
            raise

        duration_ms = (perf_counter() - started_at) * 1000
        logger.info(
            "HTTP %s %s -> %s in %.2f ms.",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response

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

    @app.get("/", tags=["root"], response_model=ApiResponse[dict[str, str]])
    async def root() -> ApiResponse[dict[str, str]]:
        return success_response(
            message="ZipRIGHT backend running.",
            data={"status": "running"},
        )

    @app.get("/health", tags=["health"], response_model=ApiResponse[dict[str, str]])
    async def health_check() -> ApiResponse[dict[str, str]]:
        return success_response(
            message="Health check passed.",
            data={"status": "ok"},
        )

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
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
