# ─── ZipRIGHT Backend — Production Dockerfile ───────────────────────────────
#
# Multi-stage build:
#   builder   — installs Python dependencies (layer-cached when requirements unchanged)
#   runtime   — minimal image; copies installed packages + app code only
#
# Non-root user (appuser) for container security.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Install build tools needed by some packages (e.g. mediapipe, insightface)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt

# Install Playwright + Chromium (required by product_extractor.py)
RUN pip install --no-cache-dir playwright && \
    playwright install --with-deps chromium

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    ENV=production

# Runtime system libs only (no build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy Playwright browser installation from builder
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright

# Non-root user for container security
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app

# Copy application code (respects .dockerignore)
COPY . .

# Create required runtime directories and set ownership
RUN mkdir -p uploads ui storage && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

# Health check for container orchestrators (Kubernetes, ECS, etc.)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["gunicorn", "-c", "gunicorn.conf.py", "main:app"]
