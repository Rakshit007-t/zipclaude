import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from models.schema import (
    GarmentCreateRequest,
    GarmentResponse,
    LiveTryOnFrameRequest,
    LiveTryOnFrameResponse,
    LiveTryOnSessionCreateRequest,
    LiveTryOnSessionResponse,
)
from services.live_tryon_engine import (
    create_live_tryon_session,
    estimate_live_tryon_frame,
    list_garments,
    register_garment,
)
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
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> GarmentResponse:
    try:
        logger.info("create_garment requested by user_id=%s", current_user.uid)
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
        verify_firebase_token(token)
    except HTTPException:
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
