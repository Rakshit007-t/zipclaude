# ZipRIGHT — Production Operations Guide

> Last updated: 2026-07-07 · Version 1.0.0

---

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Configuration](#environment-configuration)
3. [Docker Deployment](#docker-deployment)
4. [Health & Monitoring](#health--monitoring)
5. [Backup Strategy](#backup-strategy)
6. [Secrets Management](#secrets-management)
7. [Scaling Guide](#scaling-guide)
8. [Incident Response](#incident-response)

---

## Pre-Deployment Checklist

### Security
- [ ] `ENV=production` is set — disables Swagger UI and ReDoc
- [ ] `ECOMMERCE_ENCRYPTION_KEY` is set to a unique Fernet key from a secrets manager — encrypts seller store credentials (Shopify/Woo tokens). **The service refuses to start credential operations in production without it.** Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Never commit it; rotate per environment.
- [ ] `CORS_ALLOW_ORIGINS` is set to production domain(s) only — no `*`
- [ ] `serviceAccountKey.json` is absent from the Docker image (covered by `.dockerignore`)
- [ ] Firebase credentials are injected from a secrets manager — not stored in `.env`
- [ ] All API keys (`REPLICATE_API_TOKEN`, `FIRECRAWL_API_KEY`) are rotated from dev keys
- [ ] Docker container runs as non-root user (`appuser`)
- [ ] TLS/HTTPS is terminated at the load balancer (Nginx, Cloud Run, etc.)

### Infrastructure
- [ ] Firestore scheduled exports are enabled (see [Backup Strategy](#backup-strategy))
- [ ] Uptime monitor is configured for `/health` endpoint
- [ ] Log aggregation is configured (GCP Cloud Logging, Datadog, etc.)
- [ ] Container resource limits are set (CPU + memory)
- [ ] Auto-scaling rules are defined

### Application
- [ ] All 97 backend tests pass on the production Docker image
- [ ] `/health` endpoint returns HTTP 200 with `"status": "ok"`
- [ ] `/metrics` endpoint is accessible and shows reasonable counters
- [ ] CORS preflight works from the production frontend origin

---

## Environment Configuration

### Environment Files

| File | Purpose |
|---|---|
| `.env.example` | Master reference — all variables documented |
| `.env.staging.example` | Staging overrides |
| `.env.production.example` | Production overrides + secret injection placeholders |

### Key Variables

| Variable | Required | Description |
|---|---|---|
| `ENV` | ✅ | `production` (enables JSON logging, hides docs) |
| `FIREBASE_CREDENTIALS_JSON` | ✅ | Full service account JSON (escaped) |
| `FIREBASE_STORAGE_BUCKET` | ✅ | GCS bucket name |
| `FIRESTORE_DATABASE_ID` | ✅ | Named Firestore database ID |
| `CORS_ALLOW_ORIGINS` | ✅ | Comma-separated allowed origins |
| `REPLICATE_API_TOKEN` | ✅ | CatVTON inference |
| `FIRECRAWL_API_KEY` | ✅ | Product URL scraping |
| `WEB_CONCURRENCY` | ❌ | Gunicorn workers (default: auto) |

---

## Docker Deployment

### Build

```bash
docker build -t zipright-backend:v1.0.0 ./zipfin-backend
```

### Run

```bash
docker run -d \
  --name zipright-backend \
  -p 8000:8000 \
  --env-file .env.production \
  --memory=2g \
  --cpus=2 \
  --restart unless-stopped \
  zipright-backend:v1.0.0
```

### Docker Compose (recommended for single-server deployments)

```yaml
services:
  backend:
    image: zipright-backend:v1.0.0
    env_file: .env.production
    ports:
      - "8000:8000"
    restart: unless-stopped
    mem_limit: 2g
    cpus: "2"
    healthcheck:
      test: ["CMD", "python", "-c",
             "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Cloud Run (recommended for production)

```bash
gcloud run deploy zipright-backend \
  --image gcr.io/PROJECT_ID/zipright-backend:v1.0.0 \
  --region asia-south1 \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --set-secrets FIREBASE_CREDENTIALS_JSON=zipright-firebase-creds:latest \
  --set-env-vars ENV=production
```

---

## Health & Monitoring

### Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | None | Deep health check — probes Firebase |
| `GET /metrics` | None | In-process counters — requests, errors, uptime |

### Health Check Response

```json
{
  "isValid": true,
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "env": "production",
    "uptime_seconds": 3600,
    "checks": {
      "firestore": "ok"
    }
  }
}
```

Returns **HTTP 503** if Firestore is unreachable.

### Recommended Uptime Monitors

1. **UptimeRobot** — Monitor `GET /health`, alert if non-200 for 2+ checks.
2. **GCP Cloud Monitoring** — Uptime check on Cloud Run URL `/health`.
3. **Statuspage.io** — Public status page for merchant partners.

### Logging

In production (`ENV=production`), every log record is emitted as a JSON line:

```json
{
  "timestamp": "2026-07-07T12:00:00+00:00",
  "level": "INFO",
  "logger": "main",
  "message": "[req-id] POST /public/integration/recommendation | 45.2ms | 200",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "duration_ms": 45.2,
  "method": "POST",
  "path": "/public/integration/recommendation",
  "status": 200
}
```

**GCP Cloud Logging** auto-parses JSON logs. **Datadog** ingests JSON logs with `source=python`.

### Alerting Thresholds (recommended)

| Metric | Alert Condition |
|---|---|
| `requests_5xx` rate | > 1% of requests over 5 min |
| `/health` check | non-200 for 2 consecutive checks |
| Response time p95 | > 3000ms |
| Container memory | > 80% limit |

---

## Backup Strategy

### Firestore Automated Exports

ZipRIGHT uses Firestore as its primary data store. Enable scheduled exports to GCS:

```bash
# Create a GCS bucket for backups
gsutil mb -l asia-south1 gs://zipright-firestore-backups

# Grant Firestore service account access
gsutil iam ch \
  serviceAccount:service-PROJECT_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com:objectAdmin \
  gs://zipright-firestore-backups

# Schedule daily exports (Cloud Scheduler)
gcloud scheduler jobs create http zipright-firestore-backup \
  --schedule="0 2 * * *" \
  --uri="https://firestore.googleapis.com/v1/projects/PROJECT_ID/databases/(default):exportDocuments" \
  --message-body='{"outputUriPrefix":"gs://zipright-firestore-backups/daily"}' \
  --oauth-service-account-email=PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --location=asia-south1
```

### Backup Retention Policy

| Backup Type | Retention | Storage Class |
|---|---|---|
| Daily export | 30 days | Nearline |
| Weekly export | 12 weeks | Coldline |
| Monthly export | 12 months | Archive |

### Collections to Protect

| Collection | Criticality | Notes |
|---|---|---|
| `sellers` | 🔴 Critical | Seller profiles and onboarding state |
| `seller_products` | 🔴 Critical | Full product catalog |
| `seller_integrations` | 🔴 Critical | E-commerce platform connections |
| `seller_activity` | 🟡 Medium | Activity feed (regenerable) |
| `fit_profiles` | 🔴 Critical | User body measurements |
| `recent_scans` | 🟢 Low | Temporary scan results |

### Restore Procedure

```bash
gcloud firestore import gs://zipright-firestore-backups/daily/YYYY-MM-DD/ \
  --async \
  --project=zipright-prod
```

> **Warning**: Restore overwrites current data. Always restore to a staging project first and verify data integrity before restoring production.

---

## Secrets Management

### Recommended: GCP Secret Manager

```bash
# Store Firebase credentials
echo "$FIREBASE_CREDENTIALS_JSON" | \
  gcloud secrets create zipright-firebase-creds --data-file=-

# Rotate credentials
gcloud secrets versions add zipright-firebase-creds --data-file=new_key.json

# Access in Cloud Run via --set-secrets flag (see Docker Deployment above)
```

### Rotation Schedule

| Secret | Rotation Frequency | Notes |
|---|---|---|
| Firebase service account key | Every 90 days | Or after any team member offboarding |
| `REPLICATE_API_TOKEN` | Every 180 days | |
| `FIRECRAWL_API_KEY` | Every 180 days | |
| Encryption key (M5 integration) | Every 90 days | Requires re-encrypting stored credentials |

---

## Scaling Guide

### Single Server (current recommended for MVP)

- 2 vCPU, 4 GB RAM
- `WEB_CONCURRENCY=5` (2×CPU+1)
- Handles ~200 concurrent requests

### Horizontal Scaling

ZipRIGHT is **stateless** — all state lives in Firestore and GCS.

1. Deploy multiple containers behind a load balancer (Nginx, GCP HTTP LB, AWS ALB).
2. Set `GUNICORN_MAX_REQUESTS=1000` (already configured) to prevent memory growth.
3. Rate limiter is in-process — with multiple replicas, limits are per-instance. Upgrade to Redis-backed rate limiting if abuse protection becomes critical.

### Heavy Workloads

- **CatVTON** (local): GPU-accelerated container required. Run as a separate service behind the VTon API.
- **Product extraction** (Playwright): Each extraction spawns a browser. Cap concurrency with `RATE_LIMIT_IP_MAX_REQUESTS`.
- **SmartFit Scan** (MediaPipe): CPU-bound. Scale workers accordingly.

---

## Incident Response

### Runbook: High Error Rate

1. Check `/metrics` — compare `requests_5xx` to `requests_total`
2. Check `/health` — identify which dependency is `degraded`
3. Check Cloud Logging for `"level": "ERROR"` or `"exc_info"` fields
4. If Firestore: check GCP Console → Firestore → Usage
5. If Firebase Auth: check Firebase Console → Authentication

### Runbook: Container OOM

1. Increase `--memory` limit
2. Reduce `WEB_CONCURRENCY`
3. If CatVTON is running in-process, move to dedicated GPU container

### Runbook: Secrets Rotation

1. Generate new credential in provider console
2. Store in GCP Secret Manager (new version)
3. Update Cloud Run service to use new secret version: `gcloud run services update ... --set-secrets ...`
4. Verify new version in `/health`
5. Revoke old credential
