from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from models.schema import ApiResponse


def success_response(*, data: Any, message: str) -> ApiResponse:
    return ApiResponse(message=message, data=jsonable_encoder(data))


def error_response(
    *,
    status_code: int,
    detail: Any = None,
    default_message: str = "Request failed.",
) -> JSONResponse:
    message, details = _normalize_error_detail(detail, default_message)
    payload = {
        "success": False,
        "error": {
            "message": message,
            "status_code": status_code,
        },
    }
    if details is not None:
        payload["error"]["details"] = jsonable_encoder(details)
    return JSONResponse(status_code=status_code, content=payload)


def _normalize_error_detail(detail: Any, default_message: str) -> tuple[str, Any | None]:
    if detail is None:
        return default_message, None
    if isinstance(detail, str):
        return detail, None
    if isinstance(detail, dict):
        message = detail.get("message")
        details = detail.get("details")
        if not isinstance(message, str) or not message.strip():
            message = default_message
            details = detail if details is None else details
        return message, details
    return default_message, detail
