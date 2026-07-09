# ZipRIGHT — Final Backend Engineering Report

> Date: 2026-07-08 · Branch: `recovery/foundation-freeze` · Status: **BACKEND FROZEN**
>
> The final two tasks (Ecommerce Sync Upsert, Widget Store Name Mapping) are complete and
> verified. All 136 backend tests pass. No further backend refactoring, optimization,
> architectural change, or feature work will occur. The next phase is frontend-only.

---

## 1. Final Architecture Overview

**Stack**: FastAPI (Python 3.12 locally, 3.11 in CI) · Firebase Auth · Firestore (named
database `ai-studio-b0abadf0-…`, asia-east1, accessed exclusively through
`firebase_config.get_firestore_client()`) · Firebase Storage · Docker (multi-stage,
non-root) · GitHub Actions CI.

**Application factory** (`main.py::create_app`) mounts nine routers plus operational
endpoints:

| Router | Prefix / role |
|---|---|
| `routes/auth.py` | Firebase ID-token session endpoints |
| `routes/size.py` | Size Recommendation Engine + `/size-feedback` outcomes |
| `routes/stylist.py` | AI Stylist chat |
| `routes/product.py` | Product URL/image extraction for shoppers |
| `routes/seller.py` | Seller platform (M0–M5): onboarding, profile, catalog, import, dashboard, integration |
| `routes/avatar.py` | Avatar generation (lazy-loaded) |
| `routes/tryon.py` + `tryon_live` | Virtual Try-On: sync endpoint, job API, live frames |
| `routes/public.py` | Unauthenticated Widget SDK endpoints (M6) |
| `main.py` | `/`, `/health` (deep Firestore probe, 503 on failure), `/metrics` (in-process counters) |

**Service layer** (all injectable for testing; repository pattern for data access):

- `size_engine.py` + `calibration_service.py` — recommendation + feedback-driven calibration
  at product / brand+category / brand / user granularities (most-specific-wins, bounded deltas).
- `stylist_engine.py` — provider chain: local Ollama (qwen2.5:3b) → OpenAI-compatible seam
  (vLLM-ready) → Gemini fallback. Context = fit profile + rule-based body shape + purchase history.
- `tryon_engine.py` / `local_catvton_engine.py` / `tryon_jobs.py` / `upscaler.py` — see §4.
- `ecommerce_service.py` + `ecommerce_providers.py` (Shopify / WooCommerce / Generic REST)
  + `product_repository.py` — store connect, credential encryption, sync with upsert semantics.
- `seller_repository.py`, `product_import.py`, `storage_provider.py` (provider-agnostic
  uploads), `url_guard.py` (SSRF), `firebase_auth.py` / `seller_auth.py` / `admin_auth.py`.
- `core/logging_config.py` — request-ID middleware; JSON-line structured logs when
  `ENV=production`.

**Firestore collections**: `sellers`, `seller_products`, `seller_integrations`,
`seller_sync_history`, `seller_activity`, `fit_profiles`, `size_feedback`,
`recommendation_generated_events`, `recent_scans`.

**Ops surface**: `Dockerfile` + `.dockerignore`, `PRODUCTION.md` (deploy, backup, secrets,
scaling, incident runbooks), `.github/workflows/ci.yml` (backend pytest, frontend
typecheck, Docker build validation), `start_backend.bat` / `start_backend.ps1`.

---

## 2. Security Improvements Completed

1. **Seller credential encryption** — Shopify/Woo/REST tokens encrypted with Fernet.
   No hardcoded key exists; production **fails closed** without `ECOMMERCE_ENCRYPTION_KEY`;
   non-production uses a process-ephemeral key so a real secret can never be committed.
   Regression-tested in `tests/test_ecommerce_encryption.py`.
2. **SSRF guard** (`services/url_guard.py`) — seller-supplied store URLs must be http(s)
   resolving to public IPs only; IPv4-mapped IPv6 unwrapped so `::ffff:127.0.0.1` cannot
   smuggle past checks. Enforced at **connect and again at every sync** (defends stored
   integrations and DNS rebinding). Hermetic tests with injected DNS (`test_url_guard.py`).
3. **Cross-tenant isolation** — public store-URL resolution is exact canonical-host
   matching, never substring (`shop.com.attacker.com` can no longer resolve to `shop.com`);
   product lookups and sync upserts are scoped to `seller_uid`
   (`test_public_store_resolution.py`, `test_ecommerce_sync.py`).
4. **Auth layering** — Firebase ID-token auth for users, `require_active_seller` gate for
   seller routes, separate admin auth for analytics.
5. **Mass-assignment protection** — update paths strip `id`, `seller_uid`, `uid`,
   `created_at` from client payloads.
6. **Public endpoint rate limiting** — per-IP sliding windows on all widget endpoints
   (config/product 30/min, products 20/min, recommendation 10/min).
7. **Production hardening** — `ENV=production` disables Swagger/ReDoc; CORS origins from
   env (no wildcard); service-account JSON excluded from the Docker image; container runs
   as non-root `appuser`; secrets injected via secret manager per `PRODUCTION.md`.
8. **Gemini key moved server-side** — no AI key ships to the browser anymore
   (rotation of the previously exposed key is still a pending user action, see §8).

---

## 3. Performance Improvements

- **Job-based try-on** (`POST /tryon-job`) with a **bounded ThreadPoolExecutor**
  (`TRYON_MAX_WORKERS`, default 2) — generation survives client disconnects, reports real
  per-step progress, and cannot fork-bomb the GPU.
- **Weights gate** — local model weights are never downloaded inside a request;
  `WeightsNotReadyError` is not cached, so the engine recovers automatically.
- **Real-ESRGAN x2 upscaler** — tiled fp16 via spandrel: 1.1s warm, 164 MB VRAM, garment
  sharpness +70–148%.
- **Quality pipeline at zero latency cost** — repaint window + silhouette clip + face/hand
  protection kept render time at ~34s/30 steps (HD) on an RTX 3050 while outside-mask
  PSNR improved from ~30 dB to 55–60 dB.
- **Local stylist** — Ollama qwen2.5:3b answers in ~4.2s warm with zero API cost/latency;
  graceful fallback chain when unavailable.
- **Immutable caching** — Firebase Storage uploads get 1-year immutable `Cache-Control`.
- **Cloud engine resilience** — 180s write timeouts + one submit retry (handles bandwidth
  contention during model downloads).
- **Observability with negligible overhead** — request-ID middleware, per-request duration
  in structured JSON logs, in-process `/metrics` counters.

---

## 4. Virtual Try-On Pipeline Summary

Engine chain in `services/tryon_engine.py` (no paid APIs anywhere):

1. **Local CatVTON** (`local_catvton_engine.py`, vendored repo in `vendor/CatVTON`) on the
   user's RTX 3050 6GB. MediaPipe-tasks-based mask building (DensePose won't build on
   Windows). Quality flags (env kill-switches, default on): `VTON_REPAINT` (person-centered
   3:4 render window + full-res composite of only the masked region), `VTON_CLIP_TO_SILHOUETTE`
   (pose bands ∩ person segmentation — background never repainted), `VTON_PROTECT_FACE_HANDS`,
   `VTON_SUPERRES` (Real-ESRGAN pre-composite), `VTON_SEED` (reproducibility).
2. **Cloud CatVTON** — free HuggingFace Space `zhengchong/CatVTON` via gradio_client.
3. **OpenCV overlay** — guaranteed last-resort fallback.

API: `/tryon-image` (sync; `cloth_type`, `quality` fast/hd/2k, optional person+garment
data URLs) and `/tryon-job` + `/tryon-job/{id}` (async with real progress; frontend
persists the job ID and resumes after refresh). Reported engines: `catvton`,
`catvton_cloud`, `overlay`. Live mode runs in-browser (30fps MediaPipe pose + garment warp).

Benchmarked results: outside-mask PSNR 55–60 dB, LAB color shift ~0, face sharpness ratio
~1.0, unchanged render time.

---

## 5. Seller Platform Summary (Milestones M0–M6)

| Milestone | Scope | Tests |
|---|---|---|
| **M0** | Seller authentication: repository, `require_active_seller`, `GET /seller/me` | `test_seller_m0.py` |
| **M1** | Onboarding + profile CRUD, logo upload, admin approval, storage abstraction | `test_seller_m1.py` |
| **M2** | AI Product Import: URL + image providers, enrichment/generated-field marking, preview, save-on-approve | `test_seller_m2.py` |
| **M3** | Product management: list/search/filter, update with optimistic concurrency (`expected_updated_at`), archive/delete, images | `test_seller_m3.py` |
| **M4** | Seller dashboard + analytics (recommendation events, size-feedback insights per store) | `test_seller_m4.py` |
| **M5** | E-commerce integration: connect/disconnect (Shopify/Woo/REST), encrypted credentials, sync history | `test_seller_m5.py` |
| **M6** | Storefront Widget public endpoints | `test_seller_m6.py` |

**Final two tasks (this session, verified passing):**

- **Ecommerce Sync Upsert** — products synced from a store carry a stable
  `external_id` (`{platform}:{id}`); `SellerProductRepository.upsert_product` updates in
  place per seller, so re-syncing never duplicates the catalogue. Covered end-to-end in
  `test_ecommerce_sync.py` (create-then-update, per-seller scoping, no-external-id
  fallback, full resync through `EcommerceService`).
- **Widget Store Name Mapping** — `/public/widget-config` resolves `store_name` from flat
  M1 seller docs first, falling back to legacy nested `profile.store_name`. Covered in
  `test_seller_m6.py` (`test_widget_config`, `test_widget_config_flat_seller_profile`).

---

## 6. Widget SDK Summary

Deliverables in `zipfin-backend/ui/`: `zipright-widget.js` (embeddable SDK),
`merchant-example.html` (working storefront demo), `INTEGRATION.md` (merchant guide).

Public API (all unauthenticated, rate-limited per IP):

- `GET /public/widget-config` — resolves seller UID + store branding from the merchant's URL.
- `GET /public/integration/products` — active catalogue (archived excluded), stable Firestore IDs.
- `GET /public/integration/product` — lookup by stable `product_id` (preferred; no silent
  title fallback on miss) or title (legacy).
- `POST /public/integration/recommendation` — full Size Engine run for anonymous shoppers;
  brand/product/category calibration still applies (anonymous = `""`, never `None`);
  supports flat and nested per-size measurement charts.

---

## 7. Test Summary

**136 tests · 17 files · all passing (~31s locally).**

| Area | Files |
|---|---|
| Seller platform M0–M6 | `test_seller_m0..m6.py` (7 files) |
| Ecommerce security + sync | `test_ecommerce_encryption.py`, `test_ecommerce_sync.py`, `test_url_guard.py` |
| Public widget security | `test_public_store_resolution.py`, `test_public_recommendation.py` |
| Size engine + calibration | `test_size_engine.py`, `test_calibration_service.py`, `test_measurement_calibration.py` |
| Stylist | `test_stylist_engine.py` |
| Shared fixtures | `conftest.py` — hermetic in-memory Firestore fake; no network, no real DNS |

CI (`.github/workflows/ci.yml`): backend pytest on Python 3.11 with a lightweight
dependency subset, frontend `tsc --noEmit`, and Docker build validation on every push/PR
to `main`.

---

## 8. Remaining Technical Debt

**User actions (blocked on you):**
1. **Rotate the Gemini API key** — it was exposed client-side before the server-side move.
2. **Photo retention policy** — `uploads/` has no auto-deletion; blocked on a product
   decision (avatars share the folder try-on reads from).
3. **Live try-on transport decision** — `POST /tryon-live/frame` (HTTP) vs websocket both
   exist; one should eventually be retired.

**Scale-out items (fine at MVP scale, needed before high traffic):**
4. In-process rate limiter is per-instance — Redis-backed limiting needed for multi-replica.
5. Canonical store-URL fallback scans `seller_integrations` (O(n)); `list_products`
   filters in memory — Firestore composite indexes + indexed canonical-key field needed at
   catalogue scale.
6. GPU workloads (CatVTON, upscaler) run in-process — should become a dedicated GPU
   service for horizontal scaling.
7. Firestore positional-filter deprecation warnings (3 call sites) — cosmetic today,
   breaking in a future SDK major.

**Housekeeping:**
8. `PRODUCTION.md` says "97 tests" (now 136) — one-line doc drift.
9. Stray `start_backend*_verify_*.log` files in the working tree.
10. The entire engineering phase is **uncommitted** on `recovery/foundation-freeze` —
    committing is the single most important next housekeeping step.
11. Non-production ephemeral Fernet key means dev-stored credentials don't survive restarts
    (by design, but worth knowing).

---

## 9. Production Readiness Score

| Dimension | Score | Notes |
|---|---|---|
| Correctness / test coverage | 9/10 | 136 hermetic tests, CI-enforced; core flows all covered |
| Security | 8.5/10 | SSRF, encryption, tenant isolation, rate limits done; key rotation pending |
| Observability | 8/10 | JSON logs, request IDs, /health, /metrics; no external APM yet |
| Deployability | 8/10 | Docker, CI, runbooks; not yet deployed to a managed platform |
| Scalability | 6.5/10 | Stateless app but in-process rate limits, O(n) fallbacks, GPU in-process |
| Data safety | 7/10 | Backup strategy documented, not yet enabled; work uncommitted |

**Overall: 8.0/10 for single-instance MVP production.** Reaching 9+ requires: committing
the work, rotating the exposed key, enabling Firestore scheduled exports, and (at scale)
Redis rate limiting + a dedicated GPU inference service.

---

## 10. Files Changed During the Engineering Phase

**Modified (20):**

Backend: `main.py`, `Dockerfile`, `.gitignore`, `README.md`, `requirements.txt`,
`firebase_upload.py`, `routes/size.py`, `routes/stylist.py`, `routes/tryon.py`,
`services/firebase_auth.py`, `services/local_catvton_engine.py`,
`services/product_extractor.py`, `services/size_engine.py`, `services/tryon_engine.py`,
`services/tryon_jobs.py`
Frontend (integration-only): `App.tsx`, `screens/Settings.tsx`, `screens/TryOnStudio.tsx`,
`services/stylistService.ts`, `services/ziprightApi.ts`

**Added — backend (24):** `PRODUCTION.md`, `.dockerignore`, `pytest.ini`,
`core/logging_config.py`, `models/seller_schema.py`, `routes/public.py`,
`routes/seller.py`, `services/admin_auth.py`, `services/calibration_service.py`,
`services/ecommerce_providers.py`, `services/ecommerce_service.py`,
`services/product_import.py`, `services/product_repository.py`,
`services/seller_auth.py`, `services/seller_repository.py`,
`services/storage_provider.py`, `services/stylist_engine.py`, `services/upscaler.py`,
`services/url_guard.py`, `ui/zipright-widget.js`, `ui/merchant-example.html`,
`ui/INTEGRATION.md`, plus launcher scripts `start_backend.bat` / `start_backend.ps1`.

**Added — tests (15):** `conftest.py`, `test_seller_m0.py` … `test_seller_m6.py`,
`test_ecommerce_encryption.py`, `test_ecommerce_sync.py`, `test_url_guard.py`,
`test_public_store_resolution.py`, `test_public_recommendation.py`,
`test_calibration_service.py`, `test_stylist_engine.py`.

**Added — infrastructure:** `.github/workflows/ci.yml`.

**Added — frontend seller screens (6):** `SellerDashboard.tsx`, `SellerCatalog.tsx`,
`SellerAddProduct.tsx`, `SellerEditProduct.tsx`, `SellerIntegration.tsx`,
`SellerIntegrationSandbox.tsx`.

---

*Backend development is now frozen. All subsequent work is frontend-only UI/UX redesign,
treating every endpoint above as a stable production contract.*
