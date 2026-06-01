import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from core.api import success_response
from models.schema import ApiResponse, AvatarCreateResponse
from services.firebase_auth import AuthenticatedUser, get_current_user, get_optional_user
from services.face_engine import process_avatar_upload

router = APIRouter(tags=["avatar"])
logger = logging.getLogger(__name__)


@router.post(
    "/avatar-create",
    response_model=ApiResponse[AvatarCreateResponse],
    status_code=status.HTTP_201_CREATED,
)
async def avatar_create(
    file: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(get_optional_user),
) -> ApiResponse[AvatarCreateResponse]:
    try:
        logger.info(
            "Processing avatar upload: user_id=%s filename=%s content_type=%s",
            current_user.uid,
            file.filename,
            file.content_type,
        )
        result = await process_avatar_upload(file)
        logger.info(
            "Avatar upload completed: user_id=%s public_path=%s",
            result.user_id,
            result.public_path,
        )
        return success_response(
            message="Avatar uploaded successfully.",
            data=result,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Unexpected avatar route failure for filename=%s.",
            file.filename,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create avatar.",
        ) from exc
