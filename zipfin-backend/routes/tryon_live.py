import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from models.schema import (
    DecartSessionEndRequest,
    DecartTokenRequest,
    DecartTokenResponse,
    GarmentCreateRequest,
    GarmentResponse,
    LiveTryOnFrameRequest,
    LiveTryOnFrameResponse,
    LiveTryOnSessionCreateRequest,
    LiveTryOnSessionResponse,
)
from core.config import settings
from services.decart_vto import (
    is_decart_enabled,
    mint_decart_client_token,
    release_decart_session,
)
from services.request_rate_limiter import enforce_rate_limit
from services.live_tryon_engine import (
    _fetch_session_record,
    create_live_tryon_session,
    estimate_live_tryon_frame,
    list_garments,
    register_garment,
)
from services.admin_auth import require_admin
from services.firebase_auth import AuthenticatedUser, get_current_user, verify_firebase_token

router = APIRouter(tags=["tryon-live"])
logger = logging.getLogger(__name__)


@router.post(
    "/tryon-live/garments",
    response_model=GarmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_garment(
    payload: GarmentCreateRequest,
    admin: AuthenticatedUser = Depends(require_admin),
) -> GarmentResponse:
    try:
        logger.info("create_garment requested by admin_id=%s", admin.uid)
        return register_garment(payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected garment creation route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create garment.",
        ) from exc


@router.get(
    "/tryon-live/garments",
    response_model=list[GarmentResponse],
    status_code=status.HTTP_200_OK,
)
async def get_garments(
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> list[GarmentResponse]:
    try:
        logger.info("get_garments requested by user_id=%s", current_user.uid)
        return list_garments()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected garment list route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load garments.",
        ) from exc


@router.post(
    "/tryon-live/session",
    response_model=LiveTryOnSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    payload: LiveTryOnSessionCreateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> LiveTryOnSessionResponse:
    try:
        if payload.user_id != current_user.uid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "user_id must match authenticated user.",
                    "details": {"code": "user_mismatch"},
                },
            )
        return create_live_tryon_session(payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected live try-on session route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create live try-on session.",
        ) from exc


@router.post(
    "/tryon-live/frame",
    response_model=LiveTryOnFrameResponse,
    status_code=status.HTTP_200_OK,
)
async def estimate_frame(
    payload: LiveTryOnFrameRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> LiveTryOnFrameResponse:
    try:
        session = _fetch_session_record(
            payload.session_id,
            not_found_detail=f"Session '{payload.session_id}' was not found.",
        )
        if session["user_id"] != current_user.uid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "Not authorized to submit frames for this session.",
                    "details": {"code": "session_mismatch"},
                },
            )
        return estimate_live_tryon_frame(payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unexpected live try-on frame route failure.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to estimate live try-on frame.",
        ) from exc


@router.websocket("/tryon-live/ws/{session_id}")
async def tryon_live_ws(websocket: WebSocket, session_id: str) -> None:
    token = websocket.query_params.get("token", "")
    if not token:
        await websocket.close(code=1008)
        return
    try:
        auth_user = verify_firebase_token(token)
    except HTTPException:
        await websocket.close(code=1008)
        return

    try:
        session = _fetch_session_record(
            session_id,
            not_found_detail=f"Session '{session_id}' was not found.",
        )
        if session["user_id"] != auth_user.uid:
            await websocket.close(code=1008)
            return
    except Exception:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    try:
        while True:
            try:
                message = await websocket.receive_json()
                payload = LiveTryOnFrameRequest.model_validate(
                    {
                        "session_id": session_id,
                        "frame_width": message.get("frame_width"),
                        "frame_height": message.get("frame_height"),
                        "landmarks": message.get("landmarks"),
                    }
                )
                response = estimate_live_tryon_frame(payload)
                await websocket.send_json(response.model_dump(mode="json"))
            except ValidationError as exc:
                await _send_websocket_error(
                    websocket=websocket,
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=exc.errors(),
                )
            except HTTPException as exc:
                await _send_websocket_error(
                    websocket=websocket,
                    status_code=exc.status_code,
                    detail=exc.detail,
                )
            except ValueError as exc:
                await _send_websocket_error(
                    websocket=websocket,
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(exc),
                )
            except Exception:
                logger.exception(
                    "Unexpected live try-on websocket failure for session '%s'.",
                    session_id,
                )
                await _send_websocket_error(
                    websocket=websocket,
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to process live try-on frame.",
                )
    except WebSocketDisconnect:
        return


async def _send_websocket_error(
    *,
    websocket: WebSocket,
    status_code: int,
    detail: object,
) -> None:
    try:
        await websocket.send_json(
            {
                "tracking_status": "lost",
                "error": {
                    "status_code": status_code,
                    "detail": detail,
                },
            }
        )
    except (RuntimeError, WebSocketDisconnect):
        return


@router.get(
    "/tryon-live/decart/status",
    status_code=status.HTTP_200_OK,
)
async def get_decart_status() -> dict[str, object]:
    """Public status endpoint to check if AI Live Try-On is available."""
    enabled = is_decart_enabled() and bool(settings.DECART_API_KEY)
    return {
        "enabled": enabled,
        "model": settings.DECART_VTO_MODEL,
        "max_session_seconds": settings.DECART_VTO_MAX_SESSION_SECONDS,
    }


@router.post(
    "/tryon-live/decart/token",
    response_model=DecartTokenResponse,
    status_code=status.HTTP_200_OK,
)
async def create_decart_token(
    payload: DecartTokenRequest | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> DecartTokenResponse:
    """Issue a short-lived Decart client token for real-time AI VTO.

    Enforces authentication, rate limits, feature flags, and anti-duplication guards.
    Never returns DECART_API_KEY.
    """
    logger.info("Decart token requested by user_id=%s", current_user.uid)

    # Check feature flag early
    if not is_decart_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "AI Live Try-On is currently disabled.",
                "details": {"code": "decart_vto_disabled"},
            },
        )

    if not settings.DECART_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "message": "Decart realtime VTO service is not configured.",
                "details": {"code": "decart_not_configured"},
            },
        )

    # Rate limit: 5 token requests per minute per authenticated user
    enforce_rate_limit(
        key=f"decart_token:{current_user.uid}",
        max_requests=5,
        window_seconds=60,
        detail="Too many Decart session requests. Please wait a moment.",
    )

    requested_duration = payload.requested_duration_seconds if payload else None
    return mint_decart_client_token(
        user_id=current_user.uid,
        requested_duration=requested_duration,
    )


@router.post(
    "/tryon-live/decart/session/end",
    status_code=status.HTTP_200_OK,
)
async def end_decart_session(
    payload: DecartSessionEndRequest | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, str]:
    """Release active Decart session slot when user stops or leaves."""
    logger.info("Decart session end requested for user_id=%s", current_user.uid)
    release_decart_session(current_user.uid)
    return {"status": "released"}

