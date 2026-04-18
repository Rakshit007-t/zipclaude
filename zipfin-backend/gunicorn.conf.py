import multiprocessing
import os


def _env_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        return int(raw_value)
    except ValueError:
        return default


def _default_workers() -> int:
    cpu_count = multiprocessing.cpu_count()
    # Keep a modest default in containers while still scaling with CPU count.
    return max(2, min((cpu_count * 2) + 1, 8))


bind = os.getenv("GUNICORN_BIND", "0.0.0.0:8000")
worker_class = "uvicorn.workers.UvicornWorker"
workers = _env_int("WEB_CONCURRENCY", _default_workers())
threads = _env_int("GUNICORN_THREADS", 1)
timeout = _env_int("GUNICORN_TIMEOUT", 120)
graceful_timeout = _env_int("GUNICORN_GRACEFUL_TIMEOUT", 30)
keepalive = _env_int("GUNICORN_KEEPALIVE", 5)
max_requests = _env_int("GUNICORN_MAX_REQUESTS", 1000)
max_requests_jitter = _env_int("GUNICORN_MAX_REQUESTS_JITTER", 100)
worker_tmp_dir = "/dev/shm"

accesslog = "-"
errorlog = "-"
loglevel = os.getenv("GUNICORN_LOG_LEVEL", "info")

preload_app = False
capture_output = True
