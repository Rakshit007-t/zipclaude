import json
import os
import threading
from datetime import datetime
from models.schema import RecentScan

STORE_FILE = "data/recent_scans.json"
MAX_SCANS = 10
_lock = threading.Lock()

def _ensure_dir():
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)

def _load_scans() -> list[dict]:
    if not os.path.exists(STORE_FILE):
        return []
    try:
        with open(STORE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _save_scans(scans: list[dict]):
    _ensure_dir()
    with open(STORE_FILE, "w", encoding="utf-8") as f:
        json.dump(scans, f, indent=2)

def store_scan(url: str, title: str, brand: str, image: str):
    """Store a successful product extraction to recent scans."""
    if not title:
        return
        
    with _lock:
        scans = _load_scans()
        
        # Remove if url already exists to push it to top
        scans = [s for s in scans if s.get("url") != url]
        
        new_scan = {
            "url": url,
            "title": title,
            "brand": brand,
            "image": image,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        scans.insert(0, new_scan)
        
        # Keep only the latest MAX_SCANS
        scans = scans[:MAX_SCANS]
        _save_scans(scans)

def get_recent_scans() -> list[RecentScan]:
    """Retrieve the recent scans."""
    with _lock:
        scans = _load_scans()
        return [RecentScan(**s) for s in scans]
