# ─── ZipRIGHT Backend — Production / Staging Dockerfile ──────────────────────
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
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /build

# Install build tools needed by some packages (e.g. mediapipe, insightface)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt

# Download Chromium browser into /ms-playwright using Playwright CLI
RUN pip install --no-cache-dir playwright && \
    playwright install chromium

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Runtime system libs: image processing libs + minimum Chromium headless runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy Playwright browser installation from builder and ensure read/exec for all users
COPY --from=builder /ms-playwright /ms-playwright
RUN chmod -R 755 /ms-playwright

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

# Shallow process liveness check for container orchestrators (Azure Container Apps, Kubernetes)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

CMD ["gunicorn", "-c", "gunicorn.conf.py", "main:app"]
