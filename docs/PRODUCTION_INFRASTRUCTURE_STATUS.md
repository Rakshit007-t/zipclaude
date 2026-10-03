# ZipRIGHT — Production Infrastructure Verification & Deployment Status Report

> **Audit & Deployment Date:** 2026-10-03  
> **Environment Scoped:** Azure Container Apps, Azure Managed Redis, Appwrite Cluster, Vercel Edge, GitHub/Git Repository  
> **Backend Revision:** `ca-zipright-backend-staging--0000005` (Active, 100% Traffic)  
> **Backend Image:** `acrziprightstaging.azurecr.io/zipright-backend:fce4615` (`sha256:e41da56eaf2b82fb09a6824c78e7e171d5948c768ea1a045f0d570f34f029b7e`)  
> **Mode:** Live Production Configuration & Health Verification

---

## Executive Summary

The live backend Azure Container App deployment (`ca-zipright-backend-staging`) has been successfully upgraded to the current production code (`commit fce4615` / `6c0903e`), reconfigured for production mode, scaled to eliminate cold starts, and verified against the canonical production domain **`https://zipright.in`**.

All 4 critical deployment blockers have been resolved:
1. **CORS Rejection Fixed**: `CORS_ALLOW_ORIGINS` now allows `https://zipright.in`. Real OPTIONS preflight returns HTTP 200 with `Access-Control-Allow-Origin: https://zipright.in`.
2. **Environment Promoted to Production**: `ENV=production` is active. Public documentation endpoints (`/docs`, `/redoc`, `/openapi.json`) return HTTP 404.
3. **Cold Starts Eliminated**: `minReplicas` set to `1` (max `10`). Container remains warm and responsive (sub-10ms response times).
4. **Stale Image Replaced**: Stale image `28939203` replaced with immutable production image `fce4615`. Live health checks confirm commit `fce4615` is running.

---

## 1. PRODUCTION DOMAINS & ROUTING

| Component | Verified Live Production Endpoint | Status | Notes |
|---|---|---|---|
| **Frontend** | `https://zipright.in` | Live (HTTP 200) | Vercel Edge (`216.198.79.1`). Canonical production domain. |
| **Backend API** | `https://ca-zipright-backend-staging.calmfield-d6fa58ac.centralindia.azurecontainerapps.io` | Live (HTTP 200) | Azure Container Apps ingress. HTTPS TLS valid. |
| **Appwrite** | `https://appwrite.zipright.in/v1` | Live (HTTP 401 Protected) | Custom domain CNAME with Azure managed cert. |
| **Seller / Admin** | Single Page App routes on `https://zipright.in` | Live | Served under canonical frontend host. |

> **Note on `zipright.ai`**: The domain `zipright.ai` does not exist in DNS (NXDOMAIN) and is strictly deprecated. All production configurations use `https://zipright.in`.

---

## 2. DEPLOYED REVISION & ROLLBACK STATUS

### Active Production Revision
- **Revision Name**: `ca-zipright-backend-staging--0000005`
- **Traffic Allocation**: **100%**
- **Deployed Image Tag**: `fce4615`
- **ACR Image Manifest Digest**: `sha256:e41da56eaf2b82fb09a6824c78e7e171d5948c768ea1a045f0d570f34f029b7e`
- **Git Commit SHA**: `fce46155fe55d3efba47372d7f872f232cebcf38`
- **Scale**: `minReplicas: 1`, `maxReplicas: 10`
- **Resources**: 1 vCPU, 2 GiB RAM

### Rollback Baseline (Preserved)
- **Previous Revision Name**: `ca-zipright-backend-staging--0000004`
- **Previous Image Tag**: `28939203`
- **Previous Image Digest**: `sha256:55d31b177086e1b19899dcd0ade0d39f07ebb9378cce164c3eea3f728dd0cb74`
- **Previous Traffic Weight**: `0%` (Available for instantaneous rollback if needed)

---

## 3. LIVE HEALTH & SECURITY VALIDATION

| Probe | Endpoint / Method | Expected | Actual Result | Verification Status |
|---|---|---|---|---|
| **Liveness Probe** | `GET /healthz` | 200 OK, `status: "ok"` | `HTTP 200`: `{"isValid":true,"message":"ZipRIGHT process alive.","data":{"status":"ok","version":"1.0.0","commit":"fce4615"}}` | ✅ **PASS** |
| **Deep Health Probe** | `GET /health` | 200 OK, dependencies ok | `HTTP 200`: `{"status":"ok","env":"production","commit":"fce4615","checks":{"firestore":"ok","redis":"ok"}}` | ✅ **PASS** |
| **CORS Preflight** | `OPTIONS /health` from `https://zipright.in` | 200 OK, ACAO header | `HTTP 200`: `Access-Control-Allow-Origin: https://zipright.in`, `Access-Control-Allow-Credentials: true` | ✅ **PASS** |
| **Swagger UI** | `GET /docs` | 404 Not Found | `HTTP 404 Not Found` | ✅ **PASS** |
| **ReDoc** | `GET /redoc` | 404 Not Found | `HTTP 404 Not Found` | ✅ **PASS** |
| **OpenAPI Schema** | `GET /openapi.json` | 404 Not Found | `HTTP 404 Not Found` | ✅ **PASS** |
| **Firestore Probe** | Deep health probe read | `checks.firestore = "ok"` | Live sentinel collection read passed | ✅ **PASS** |
| **Redis Probe** | Standalone TLS Redis ping | `checks.redis = "ok"` | Connected to `redis-zipright-staging.centralindia.redis.azure.net:10000` | ✅ **PASS** |
| **Appwrite Probe** | `GET /v1/health` | HTTP 401 native auth | HTTP 401 `general_unauthorized_scope` returned from Appwrite gateway | ✅ **PASS** |

---

## 4. SECRETS AUDIT & READINESS

### Configured Azure Secret References
The following secrets are safely stored in Azure Container Apps Secret Store and injected via `secretRef`:
1. `firebase-credentials-json` -> Injected as `FIREBASE_CREDENTIALS_JSON`
2. `redis-password` -> Injected as `REDIS_PASSWORD`
3. `redis-url` -> Injected as `REDIS_URL`

### Missing Production Secrets (Action Required for Live Payments / Sentry)
Per strict instructions ("Do NOT invent secret values. Use existing secure Azure secrets only. If a required secret is genuinely missing, STOP and report exactly which secret is missing"):
1. **`BILLING_WEBHOOK_SECRET`**: Missing from Azure secret store. Required for Cloud Billing / AWS Budget alert webhooks (`/billing/webhook`).
2. **`RAZORPAY_KEY_SECRET`**: Missing from Azure secret store. Currently Razorpay is in **TEST mode** (`RAZORPAY_KEY_ID=rzp_test_placeholder`). Live payments must not be activated until genuine merchant keys are injected.
3. **`RAZORPAY_WEBHOOK_SECRET`**: Missing from Azure secret store. Required for signature verification on payment confirmation webhooks.
4. **`SENTRY_DSN`**: Missing from Azure secret store. Sentry monitoring is safely disabled in logs (`SENTRY_DSN is not configured; Sentry monitoring is disabled`).

---

## 5. REMAINING ITEMS BEFORE PUBLIC COMMERCE

1. **Operator Injection of Missing Secrets**:
   When live payment processing and production Sentry monitoring are launched, an operator must run:
   ```bash
   az containerapp secret set --name ca-zipright-backend-staging --resource-group rg-zipright-staging --secrets \
     billing-webhook-secret="<OPERATOR_SECRET>" \
     razorpay-key-secret="<LIVE_RAZORPAY_SECRET>" \
     razorpay-webhook-secret="<LIVE_RAZORPAY_WEBHOOK_SECRET>" \
     sentry-dsn="<PRODUCTION_SENTRY_DSN>"
   ```
2. **Razorpay Key ID Update**:
   Update `RAZORPAY_KEY_ID` from `rzp_test_placeholder` to the live merchant ID `rzp_live_*` simultaneously with the key secret injection.
3. **Custom Domain for Backend (Optional)**:
   If a custom domain like `api.zipright.in` is desired instead of `ca-zipright-backend-staging...azurecontainerapps.io`, configure a CNAME record and Azure managed certificate.
