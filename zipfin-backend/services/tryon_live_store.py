import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import uuid4

DB_PATH = Path("storage") / "tryon_live.db"
_DB_LOCK = Lock()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_tryon_store() -> None:
    with _DB_LOCK:
        with _connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS garments (
                    garment_id TEXT PRIMARY KEY,
                    sku TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    preview_image_url TEXT,
                    asset_url TEXT,
                    texture_image_url TEXT,
                    scale_multiplier REAL NOT NULL,
                    anchor_profile_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS live_tryon_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    garment_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    frame_width INTEGER NOT NULL,
                    frame_height INTEGER NOT NULL,
                    camera_fov_degrees REAL NOT NULL,
                    status TEXT NOT NULL,
                    last_transform_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (garment_id) REFERENCES garments (garment_id)
                )
                """
            )
            connection.commit()


def create_garment_record(payload: dict) -> dict:
    initialize_tryon_store()
    garment_id = str(uuid4())
    created_at = _utc_now_iso()
    record = {
        "garment_id": garment_id,
        "sku": payload["sku"],
        "name": payload["name"],
        "category": payload["category"],
        "preview_image_url": payload.get("preview_image_url"),
        "asset_url": payload.get("asset_url"),
        "texture_image_url": payload.get("texture_image_url"),
        "scale_multiplier": payload["scale_multiplier"],
        "anchor_profile_json": json.dumps(payload["anchor_profile"]),
        "created_at": created_at,
    }
    with _DB_LOCK:
        with _connect() as connection:
            connection.execute(
                """
                INSERT INTO garments (
                    garment_id,
                    sku,
                    name,
                    category,
                    preview_image_url,
                    asset_url,
                    texture_image_url,
                    scale_multiplier,
                    anchor_profile_json,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record["garment_id"],
                    record["sku"],
                    record["name"],
                    record["category"],
                    record["preview_image_url"],
                    record["asset_url"],
                    record["texture_image_url"],
                    record["scale_multiplier"],
                    record["anchor_profile_json"],
                    record["created_at"],
                ),
            )
            connection.commit()
    return _deserialize_garment_record(record)


def list_garment_records() -> list[dict]:
    initialize_tryon_store()
    with _DB_LOCK:
        with _connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    garment_id,
                    sku,
                    name,
                    category,
                    preview_image_url,
                    asset_url,
                    texture_image_url,
                    scale_multiplier,
                    anchor_profile_json,
                    created_at
                FROM garments
                ORDER BY created_at DESC
                """
            ).fetchall()
    return [_deserialize_garment_record(dict(row)) for row in rows]


def get_garment_record(garment_id: str) -> dict | None:
    initialize_tryon_store()
    with _DB_LOCK:
        with _connect() as connection:
            row = connection.execute(
                """
                SELECT
                    garment_id,
                    sku,
                    name,
                    category,
                    preview_image_url,
                    asset_url,
                    texture_image_url,
                    scale_multiplier,
                    anchor_profile_json,
                    created_at
                FROM garments
                WHERE garment_id = ?
                """,
                (garment_id,),
            ).fetchone()
    if row is None:
        return None
    return _deserialize_garment_record(dict(row))


def create_session_record(payload: dict) -> dict:
    initialize_tryon_store()
    session_id = str(uuid4())
    created_at = _utc_now_iso()
    record = {
        "session_id": session_id,
        "user_id": payload["user_id"],
        "garment_id": payload["garment_id"],
        "platform": payload["platform"],
        "frame_width": payload["frame_width"],
        "frame_height": payload["frame_height"],
        "camera_fov_degrees": payload["camera_fov_degrees"],
        "status": "active",
        "last_transform_json": None,
        "created_at": created_at,
        "updated_at": created_at,
    }
    with _DB_LOCK:
        with _connect() as connection:
            connection.execute(
                """
                INSERT INTO live_tryon_sessions (
                    session_id,
                    user_id,
                    garment_id,
                    platform,
                    frame_width,
                    frame_height,
                    camera_fov_degrees,
                    status,
                    last_transform_json,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record["session_id"],
                    record["user_id"],
                    record["garment_id"],
                    record["platform"],
                    record["frame_width"],
                    record["frame_height"],
                    record["camera_fov_degrees"],
                    record["status"],
                    record["last_transform_json"],
                    record["created_at"],
                    record["updated_at"],
                ),
            )
            connection.commit()
    return record


def get_session_record(session_id: str) -> dict | None:
    initialize_tryon_store()
    with _DB_LOCK:
        with _connect() as connection:
            row = connection.execute(
                """
                SELECT
                    session_id,
                    user_id,
                    garment_id,
                    platform,
                    frame_width,
                    frame_height,
                    camera_fov_degrees,
                    status,
                    last_transform_json,
                    created_at,
                    updated_at
                FROM live_tryon_sessions
                WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
    if row is None:
        return None
    return _deserialize_session_record(dict(row))


def _deserialize_garment_record(record: dict) -> dict:
    parsed = dict(record)
    parsed["anchor_profile"] = json.loads(parsed.pop("anchor_profile_json"))
    return parsed


def _deserialize_session_record(record: dict) -> dict:
    parsed = dict(record)
    raw_last_transform = parsed.get("last_transform_json")
    parsed["last_transform"] = json.loads(raw_last_transform) if raw_last_transform else None
    parsed.pop("last_transform_json", None)
    return parsed
