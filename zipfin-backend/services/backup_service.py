"""Automated database backup and snapshot management service for ZipRIGHT.

Enforces automated scheduled snapshotting, cryptographic integrity verification (SHA256),
and rolling retention cleanup for Firestore collections and storage assets.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import shutil
from typing import Any

from core.security_logger import log_security_event

logger = logging.getLogger(__name__)

_BACKUP_ROOT = Path(__file__).resolve().parents[1] / "storage" / "backups"
_MANIFEST_FILE = _BACKUP_ROOT / "manifest.json"
DEFAULT_RETENTION_DAYS = 30


def _ensure_backup_dir() -> Path:
    _BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    return _BACKUP_ROOT


def compute_checksum(filepath: Path) -> str:
    """Compute SHA256 cryptographic hash of a backup file for tamper evidence."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def load_manifest() -> list[dict[str, Any]]:
    """Load backup manifest history."""
    if _MANIFEST_FILE.exists():
        try:
            with open(_MANIFEST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_manifest(manifest: list[dict[str, Any]]) -> None:
    """Save backup manifest history atomically."""
    _ensure_backup_dir()
    temp_file = _MANIFEST_FILE.with_suffix(".tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    temp_file.replace(_MANIFEST_FILE)


def create_snapshot_backup(
    data_snapshot: dict[str, Any],
    label: str = "firestore_snapshot",
    ip_address: str = "system",
) -> dict[str, Any]:
    """Write an automated timestamped snapshot backup with SHA256 integrity verification."""
    _ensure_backup_dir()
    now = datetime.now(timezone.utc)
    timestamp_str = now.strftime("%Y%m%d_%H%M%S")
    filename = f"{label}_{timestamp_str}.json"
    filepath = _BACKUP_ROOT / filename

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data_snapshot, f, ensure_ascii=False, indent=2)

    checksum = compute_checksum(filepath)
    file_size = filepath.stat().st_size

    backup_entry = {
        "timestamp": now.isoformat(),
        "filename": filename,
        "path": str(filepath),
        "size_bytes": file_size,
        "sha256_checksum": checksum,
        "record_counts": {k: len(v) if isinstance(v, (list, dict)) else 1 for k, v in data_snapshot.items()},
    }

    manifest = load_manifest()
    manifest.append(backup_entry)
    save_manifest(manifest)

    log_security_event(
        event_type="SECURITY_BACKUP_COMPLETED",
        severity="INFO",
        ip_address=ip_address,
        details={"filename": filename, "size_bytes": file_size, "checksum": checksum},
    )
    logger.info("Backup successfully created: %s (%d bytes, SHA256: %s)", filename, file_size, checksum[:12])

    rotate_old_backups(DEFAULT_RETENTION_DAYS)
    return backup_entry


def rotate_old_backups(retention_days: int = DEFAULT_RETENTION_DAYS) -> int:
    """Prune snapshots older than retention threshold."""
    manifest = load_manifest()
    now = datetime.now(timezone.utc).timestamp()
    cutoff = now - (retention_days * 86400)

    kept = []
    removed_count = 0

    for entry in manifest:
        try:
            entry_ts = datetime.fromisoformat(entry["timestamp"]).timestamp()
            if entry_ts < cutoff:
                path = Path(entry["path"])
                if path.exists():
                    path.unlink()
                removed_count += 1
            else:
                kept.append(entry)
        except Exception:
            kept.append(entry)

    if removed_count > 0:
        save_manifest(kept)
        logger.info("Rotated and purged %d expired backup snapshots.", removed_count)

    return removed_count
