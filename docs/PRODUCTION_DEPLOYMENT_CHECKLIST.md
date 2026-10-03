# ZipRIGHT — Production Deployment Checklist

> **Version:** 1.0.0 · **Last audited:** 2026-10-02 · **Auditor:** Antigravity IDE  
> This document is the **single source of truth** for deploying ZipRIGHT to
> the public production environment.  
> Complete every checked item in order. Do **not** promote to production until
> all ✅ items are confirmed.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Pre-Deployment Security Checklist](#2-pre-deployment-security-checklist)
3. [Environment Variables Reference](#3-environment-variables-reference)
4. [Service-by-Service Deployment Steps](#4-service-by-service-deployment-steps)
5. [Post-Deployment Smoke Test](#5-post-deployment-smoke-test)
6. [Rollback Procedures](#6-rollback-procedures)
7. [Monitoring and Alerting](#7-monitoring-and-alerting)
8. [Secrets Rotation Schedule](#8-secrets-rotation-schedule)

---

## 1. Architecture Overview

### Production Infrastructure

| Component | Service | Region | Notes |
|---|---|---|---|
| **Frontend** | Firebase Hosting / Vercel (SPA) | CDN | Static Vite build; no server secrets |
| **Backend API** | Azure Container Apps | Central India | FastAPI + Gunicorn; `ca-zipright-backend-staging` |
| **Auth + DB** | Appwrite (Azure Container App) | Central India | `ca-zipright-appwrite`; custom domain `appwrite.zipright.in` |
| **Database (secondary)** | Google Firestore | asia-south1 | Named DB: `(default)`; project: `zipright-staging` |
| **Storage** | Firebase Storage / Appwrite Storage | asia-south1 / Central India | Dual-provider; profile images, VTO results |
| **Cache / Rate Limiter** | Azure Managed Redis | Central India | `redis-zipright-staging.centralindia.redis.azure.net:10000`; SSL+Cluster |
| **VTO Inference** | Replicate (CatVTON) | Cloud | GPU inference; server-side token only |
| **Realtime AI VTO** | Decart Lucy VTON | Cloud | Token broker: backend only; disabled by default |
| **Container Registry** | Azure Container Registry | — | `acrziprightstaging.azurecr.io` |
| **Payments** | Razorpay | — | Webhook verified server-side; key secret never in frontend |
| **Error Monitoring** | Sentry | — | Backend + Frontend DSNs configured separately |

### Network and TLS

- TLS is terminated at the **Azure Container Apps managed load balancer** — no plain HTTP in production.
- Appwrite custom domain: `https://appwrite.zipright.in` (SniEnabled managed certificate).
- Backend FQDN: `ca-zipright-backend-staging.calmfield-d6fa58ac.centralindia.azurecontainerapps.io`
- Production frontend: `https://zipright.in`

### Data Flow Summary

```
Browser (SPA)
  |
  +-- Auth --> Appwrite (https://appwrite.zipright.in/v1)
  +-- API  --> FastAPI Backend (HTTPS, CORS-restricted to zipright.in)
  |             +-- Firebase Firestore (server-side)
  |             +-- Firebase Storage (server-side)
  |             +-- Appwrite DB/Storage (server-side)
  |             +-- Redis (rate limits, job queue)
  |             +-- Replicate (CatVTON)
  |             +-- Decart (token broker, disabled by default)
  +-- Static Assets --> CDN (Firebase Hosting / Vercel)
```

---

## 2. Pre-Deployment Security Checklist

### 2.1 Secrets and Credentials

- [ ] `ENV=production` is set on the backend container — disables Swagger UI, ReDoc, `/openapi.json`
- [ ] `FIREBASE_CREDENTIALS_JSON` is injected as a **secret reference** (not a plain env var) in Azure Container Apps
- [ ] `REDIS_PASSWORD` is injected as a **secret reference** — never as a plain value
- [ ] `DECART_API_KEY` is set **only** on the backend container — confirmed absent from all frontend build artifacts
- [ ] `RAZORPAY_KEY_SECRET` is set **only** on the backend — `VITE_RAZORPAY_KEY_ID` (public) is the only payment value in the frontend build
- [ ] `RAZORPAY_WEBHOOK_SECRET` is set on the backend for payment verification
- [ ] `WALLET_TOPUP_SECRET` is set to a strong random value (>= 32 chars) — rotate from any dev/test value
- [ ] `BILLING_WEBHOOK_SECRET` is set — required by `validate_production_configuration()`
- [ ] `ECOMMERCE_ENCRYPTION_KEY` is set (Fernet key) — generate with: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- [ ] `serviceAccountKey.json` is **absent** from the Docker image (verified by `.dockerignore`)
- [ ] No `.env` file is baked into the Docker image (verified by `.dockerignore`)
- [ ] No `VITE_*` keys containing secrets appear in the compiled JS bundle

### 2.2 CORS

- [ ] `CORS_ALLOW_ORIGINS` is set to **exactly**: `https://zipright.in`
- [ ] No `*` wildcard in CORS config
- [ ] `CORS_ALLOW_ORIGIN_REGEX` is left **blank** in production
- [ ] CORS preflight (`OPTIONS`) from `https://zipright.in` returns correct `Access-Control-Allow-Origin`

### 2.3 Auth and JWT

- [ ] `VITE_AUTH_PROVIDER` matches the backend `AUTH_PROVIDER` setting
- [ ] Appwrite endpoint in frontend points to `https://appwrite.zipright.in/v1` — not localhost
- [ ] Backend verifies Appwrite JWTs server-side before any protected route responds
- [ ] `ADMIN_USER_IDS` is set to the production admin user UID list

### 2.4 Rate Limiting and CSRF

- [ ] Redis is reachable from the backend container (verify via `/health`)
- [ ] `RateLimitMiddleware` is active: 120 req/min with burst 35
- [ ] `CSRFMiddleware` is active
- [ ] `RequestSizeLimiterMiddleware` is active

### 2.5 Frontend Bundle Audit

Run before every production deploy:

```bash
cd zipfend
npm run build
grep -r "DECART_API_KEY\|KEY_SECRET\|WEBHOOK_SECRET\|serviceAccount" dist/ && echo "FAIL" || echo "PASS"
grep -r "localhost\|127\.0\.0\.1" dist/assets/*.js | grep -v "//.*localhost" && echo "WARN: localhost found" || echo "PASS"
```

- [ ] No `DECART_API_KEY` value in `dist/`
- [ ] No `RAZORPAY_KEY_SECRET` value in `dist/`
- [ ] No `FIREBASE_CREDENTIALS_JSON` / service account private key in `dist/`
- [ ] No hardcoded `localhost` API calls in `dist/`

---

## 3. Environment Variables Reference

### 3.1 Backend — Required for Production

> All secrets must be stored in Azure Container Apps **Secrets** and
> referenced via `secretRef`, not plain `value` fields.

| Variable | Delivery | Notes |
|---|---|---|
| `ENV` | Plain value | Must be `production` |
| `LOG_LEVEL` | Plain value | `INFO` recommended |
| `FIREBASE_PROJECT_ID` | Plain value | e.g. `zipright-prod` |
| `FIREBASE_STORAGE_BUCKET` | Plain value | e.g. `zipright-prod.firebasestorage.app` |
| `FIRESTORE_DATABASE_ID` | Plain value | `(default)` or named DB |
| `FIREBASE_CREDENTIALS_JSON` | **Secret ref** | Full service account JSON (escaped) |
| `REDIS_HOST` | Plain value | Azure Redis hostname |
| `REDIS_PORT` | Plain value | `10000` |
| `REDIS_USERNAME` | Plain value | `default` |
| `REDIS_PASSWORD` | **Secret ref** | Azure Managed Redis primary access key |
| `REDIS_SSL` | Plain value | `true` |
| `REDIS_CLUSTER_MODE` | Plain value | `true` |
| `CORS_ALLOW_ORIGINS` | Plain value | `https://zipright.in` |
| `WEB_CONCURRENCY` | Plain value | `2` (1 vCPU), `4-5` (2 vCPU) |
| `GUNICORN_BIND` | Plain value | `0.0.0.0:8000` |
| `RAZORPAY_KEY_ID` | Plain value | Public key ID |
| `RAZORPAY_KEY_SECRET` | **Secret ref** | Never plain value |
| `RAZORPAY_WEBHOOK_SECRET` | **Secret ref** | Never plain value |
| `PAYMENT_PROVIDER` | Plain value | `razorpay` |
| `WALLET_TOPUP_SECRET` | **Secret ref** | Strong random string |
| `BILLING_WEBHOOK_SECRET` | **Secret ref** | Strong random string |
| `SENTRY_DSN` | **Secret ref** | Backend Sentry project DSN |
| `SENTRY_ENVIRONMENT` | Plain value | `production` |
| `SENTRY_RELEASE` | Plain value | `zipright-backend@1.0.0` |
| `ADMIN_USER_IDS` | Plain value | Comma-separated UIDs |

### 3.2 Backend — Optional / Feature Flags

| Variable | Default | Notes |
|---|---|---|
| `DECART_VTO_ENABLED` | `false` | Set `true` only when Decart credits are funded |
| `DECART_API_KEY` | `""` | **Secret ref**; server-side only |
| `DECART_VTO_MODEL` | `lucy-vton-3.5` | |
| `DECART_VTO_MAX_SESSION_SECONDS` | `60` | Cost protection cap |
| `REPLICATE_API_TOKEN` | `""` | CatVTON inference; **secret ref** |
| `FIRECRAWL_API_KEY` | `""` | Product import; **secret ref** |
| `AI_EMERGENCY_KILL_SWITCH` | `false` | Set `true` to disable all AI features immediately |
| `VTO_EMERGENCY_KILL_SWITCH` | `false` | Set `true` to disable all VTO immediately |
| `TRYON_MAX_CONCURRENT_JOBS` | `2` | GPU concurrency cap |
| `AUTH_PROVIDER` | `firebase` | `firebase` or `appwrite` |
| `DATABASE_PROVIDER` | `firebase` | `firebase` or `appwrite` |
| `STORAGE_PROVIDER` | `firebase` | `firebase` or `appwrite` |

### 3.3 Frontend — Required (VITE_* only, all public)

| Variable | Production Value |
|---|---|
| `VITE_API_URL` | `https://ca-zipright-backend-staging.calmfield-d6fa58ac.centralindia.azurecontainerapps.io` |
| `VITE_BACKEND_URL` | `https://ca-zipright-backend-staging.calmfield-d6fa58ac.centralindia.azurecontainerapps.io` |
| `VITE_AUTH_PROVIDER` | `appwrite` |
| `VITE_BACKEND_PROVIDER` | `appwrite` |
| `VITE_APPWRITE_ENDPOINT` | `https://appwrite.zipright.in/v1` |
| `VITE_APPWRITE_PROJECT_ID` | `zipright-staging` |
| `VITE_APPWRITE_DATABASE_ID` | `zipright-staging-db` |
| `VITE_FIREBASE_API_KEY` | `<production web API key>` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `zipright-staging.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `zipright-staging` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `zipright-staging.firebasestorage.app` |
| `VITE_FIRESTORE_DATABASE_ID` | `(default)` |
| `VITE_RAZORPAY_KEY_ID` | `rzp_live_<id>` (public key ID only) |
| `VITE_SENTRY_DSN` | `<frontend Sentry DSN>` |
| `VITE_SENTRY_ENVIRONMENT` | `production` |
| `VITE_SENTRY_RELEASE` | `zipright-frontend@1.0.0` |
| `VITE_VAPID_PUBLIC_KEY` | `<VAPID public key>` |
| `VITE_ENABLE_PHONE_AUTH` | `false` (set `true` after OTP verification) |
| `VITE_PASSWORD_RESET_CONTINUE_URL` | `https://zipright.in/#/login?passwordReset=complete` |

---

## 4. Service-by-Service Deployment Steps

### 4.1 Backend (Azure Container App)

```bash
# 1. Build and push image
docker build -t acrziprightstaging.azurecr.io/zipright-backend:v<VERSION> ./zipfin-backend
az acr login --name acrziprightstaging
docker push acrziprightstaging.azurecr.io/zipright-backend:v<VERSION>

# 2. Update container app
az containerapp update \
  --name ca-zipright-backend-staging \
  --resource-group rg-zipright-staging \
  --image acrziprightstaging.azurecr.io/zipright-backend:v<VERSION>

# 3. Verify health
curl -f https://<backend-fqdn>/health
```

**Checklist:**
- [ ] `ENV=production` confirmed in container env
- [ ] `CORS_ALLOW_ORIGINS` set to production domains only
- [ ] All secret refs verified as populated in Azure portal
- [ ] `/health` returns HTTP 200 with `"status": "ok"`
- [ ] `/docs`, `/redoc`, `/openapi.json` return **404** (hidden in production)
- [ ] Container probes (liveness, readiness, startup) all pass

### 4.2 Frontend (Static Build)

```bash
cd zipfend

# 1. Create production .env (git-ignored)
# Populate with all VITE_* production values from section 3.3

# 2. Build
npm run typecheck  # must pass with 0 errors
npm run build

# 3. Bundle security audit
grep -r "DECART_API_KEY\|KEY_SECRET\|WEBHOOK_SECRET" dist/ && echo "FAIL: secret found" || echo "PASS"

# 4. Deploy
firebase deploy --only hosting
# OR
vercel --prod
```

**Checklist:**
- [ ] `VITE_API_URL` points to production backend (not localhost)
- [ ] `VITE_APPWRITE_ENDPOINT` points to `https://appwrite.zipright.in/v1`
- [ ] `VITE_RAZORPAY_KEY_ID` is the live key (`rzp_live_`)
- [ ] TypeScript typecheck passes: 0 errors
- [ ] No `localhost` in compiled bundle
- [ ] `sourcemap: false` in `vite.config.ts` (confirmed)

### 4.3 Appwrite (Azure Container App)

**Checklist:**
- [ ] Custom domain `appwrite.zipright.in` resolves and TLS is valid
- [ ] TLS certificate does not expire within 30 days
- [ ] Production Appwrite project/database IDs match frontend `VITE_APPWRITE_*` vars
- [ ] Appwrite API key scopes are production-restricted

### 4.4 Redis (Azure Managed Redis)

**Checklist:**
- [ ] Backend connects to Redis (confirmed via `/health` or startup logs)
- [ ] `REDIS_SSL=true` and `REDIS_CLUSTER_MODE=true` set on backend
- [ ] Redis password stored as Azure Container App secret
- [ ] No unauthenticated Redis access allowed

---

## 5. Post-Deployment Smoke Test

### 5.1 Backend API

```bash
BASE=https://<backend-fqdn>

# Health check
curl -f "$BASE/health" | jq .data.status

# CORS preflight
curl -s -X OPTIONS "$BASE/auth/me" \
  -H "Origin: https://zipright.in" \
  -H "Access-Control-Request-Method: GET" -v 2>&1 | grep "Access-Control-Allow-Origin"

# Docs must be hidden (expect 404)
curl -o /dev/null -s -w "%{http_code}" "$BASE/docs"
curl -o /dev/null -s -w "%{http_code}" "$BASE/redoc"
curl -o /dev/null -s -w "%{http_code}" "$BASE/openapi.json"

# Metrics
curl -f "$BASE/metrics" | jq .
```

### 5.2 Frontend Pages

| Route | Expected |
|---|---|
| `/welcome` | Renders; no console errors |
| `/login` | Auth form loads; Appwrite SDK init succeeds |
| `/home` | Redirect to `/login` if unauthenticated |
| `/fit-profile` | Measurements load from Appwrite; persist on save |
| `/marketplace` | Product grid loads from backend API |
| `/recommendation` | Size recommendation logic runs with profile context |
| `/settings` | Profile edits persist after page refresh |
| `/admin` | 403 for non-admin users; accessible for users in `ADMIN_USER_IDS` |

### 5.3 Security Spot Checks

- [ ] `DECART_API_KEY` not visible in browser DevTools → Network responses
- [ ] `RAZORPAY_KEY_SECRET` not visible in browser DevTools
- [ ] `FIREBASE_CREDENTIALS_JSON` private key not exposed via any browser endpoint
- [ ] `/health` response contains no secret values
- [ ] POST to `/payments/razorpay/webhook` without valid `X-Razorpay-Signature` returns 400/401

### 5.4 VTO Pipeline

- [ ] Free 2D VTO: submit job → poll → retrieve result image — all succeed
- [ ] Paid AI VTO: entitlement check returns appropriate wallet/payment response
- [ ] Decart Live VTO: `DECART_VTO_ENABLED=false` returns graceful fallback

---

## 6. Rollback Procedures

### 6.1 Backend Rollback (Azure Container App)

```bash
# List revisions
az containerapp revision list \
  --name ca-zipright-backend-staging \
  --resource-group rg-zipright-staging \
  --query "[].{name:name,active:properties.active,created:systemData.createdAt}" \
  --output table

# Activate previous revision
az containerapp revision activate \
  --revision <PREVIOUS_REVISION_NAME> \
  --name ca-zipright-backend-staging \
  --resource-group rg-zipright-staging

# Deactivate broken revision
az containerapp revision deactivate \
  --revision <BROKEN_REVISION_NAME> \
  --name ca-zipright-backend-staging \
  --resource-group rg-zipright-staging
```

> Target RTO: **< 5 minutes**

### 6.2 Frontend Rollback

```bash
# Firebase Hosting
firebase hosting:releases:list
firebase hosting:clone <SOURCE_VERSION_NAME>:live <TARGET_SITE>:live

# Vercel
vercel rollback [deployment-url]
```

> Target RTO: **< 2 minutes**

### 6.3 Database Rollback (Firestore)

> WARNING: Restore overwrites current data. Always restore to staging first.

```bash
gcloud firestore import gs://zipright-firestore-backups/daily/YYYY-MM-DD/ \
  --async \
  --project=zipright-prod
```

### 6.4 Emergency Kill Switches

Set these on the backend container without a full redeploy:

| Variable | Effect |
|---|---|
| `AI_EMERGENCY_KILL_SWITCH=true` | Disables all AI-powered features |
| `VTO_EMERGENCY_KILL_SWITCH=true` | Disables all Virtual Try-On endpoints |
| `DECART_VTO_ENABLED=false` | Disables Decart Lucy realtime VTO token broker |

```bash
az containerapp update \
  --name ca-zipright-backend-staging \
  --resource-group rg-zipright-staging \
  --set-env-vars VTO_EMERGENCY_KILL_SWITCH=true
```

---

## 7. Monitoring and Alerting

### 7.1 Health Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | None | Deep probe (Firestore connectivity); 503 if degraded |
| `GET /healthz` | None | Lightweight liveness (process alive only) |
| `GET /metrics` | None | In-process counters: requests, 4xx, 5xx, in-flight |

### 7.2 Recommended Alert Thresholds

| Metric | Alert Condition | Action |
|---|---|---|
| `requests_5xx` rate | > 1% over 5 min | Page on-call; check `/health` and logs |
| `/health` check | Non-200 for 2 consecutive checks | Page on-call immediately |
| Response time p95 | > 3000ms | Scale workers; check Redis latency |
| Container memory | > 80% of 2Gi limit | Increase memory or reduce `WEB_CONCURRENCY` |
| Redis p99 latency | > 100ms | Check Azure Managed Redis metrics |

### 7.3 Log Access

```bash
# Stream container logs
az containerapp logs show \
  --name ca-zipright-backend-staging \
  --resource-group rg-zipright-staging \
  --follow

# Filter errors only
az containerapp logs show \
  --name ca-zipright-backend-staging \
  --resource-group rg-zipright-staging \
  | grep '"level":"ERROR"'
```

---

## 8. Secrets Rotation Schedule

| Secret | Frequency | Notes |
|---|---|---|
| `FIREBASE_CREDENTIALS_JSON` | Every 90 days or after offboarding | Revoke old SA key after rotation |
| `RAZORPAY_KEY_SECRET` | Every 180 days | |
| `RAZORPAY_WEBHOOK_SECRET` | Every 180 days | |
| `WALLET_TOPUP_SECRET` | Every 90 days | |
| `BILLING_WEBHOOK_SECRET` | Every 90 days | |
| `DECART_API_KEY` | Every 90 days or on compromise | |
| `REPLICATE_API_TOKEN` | Every 180 days | |
| `ECOMMERCE_ENCRYPTION_KEY` | Every 90 days | Requires re-encrypting stored seller creds |
| Redis password | Every 90 days | |

### Rotation Procedure

1. Generate new credential in provider console.
2. Store new value as a new version in Azure Container Apps Secrets.
3. Update container app to reference the new secret version.
4. Verify `/health` after redeployment.
5. Revoke the old credential.
6. Update this document's **Last audited** date.

---

## Appendix: Known Constraints

| Item | Status | Notes |
|---|---|---|
| Unverified HTTPS to Appwrite internal FQDN | Warning (non-blocking) | Backend uses Azure internal network; acceptable for vnet traffic |
| `minReplicas: 0` on backend | Cold-start risk | Set `minReplicas: 1` in production to eliminate cold starts |
| Firestore + Appwrite dual-write | Informational | Firestore writes are guarded by null-checks when Appwrite is auth provider |
| Swagger/ReDoc hidden in production | Confirmed | `ENV=production` suppresses all OpenAPI endpoints |
| `sourcemap: false` in Vite build | Confirmed | Source maps not shipped to users |
