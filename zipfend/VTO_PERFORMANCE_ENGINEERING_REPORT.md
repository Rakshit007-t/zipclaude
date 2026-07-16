# Virtual Try-On Performance Engineering Report

Date: 2026-07-12  
Scope: frontend Virtual Try-On only. Backend endpoints, API payload shapes, product logic, Smart Fit, authentication, and Firestore were not changed.

## Baseline

| Area | Baseline | Evidence |
| --- | --- | --- |
| Type safety | Passing | `npm run typecheck` |
| Production build | Passing in 5.55 s | `npm run build` |
| Live Try-On download | 133.20 kB / 41.40 kB gzip | lazy route chunk |
| Initial application bundle | 933.18 kB / 252.94 kB gzip | production build |
| MediaPipe model download | 5.51 MiB | model URL `Content-Length` |
| Live render scheduling | `requestAnimationFrame` at display rate | source audit |
| Pose inference cadence | one synchronous `detectForVideo` per new camera frame | source audit |
| Steady React dispatches | one status setter call every render frame | source audit |
| Garment preparation | full source-resolution canvas and pixel readback | source audit |

The live preview had the highest impact: it composited a 1280×720 canvas at display cadence even when the camera supplied fewer frames, and performed main-thread MediaPipe work at the input-camera cadence. The studio paths also retained avoidable image/base64 allocations and continued polling after the owning screen was gone.

## Improvements implemented

1. **Video-frame-paced live rendering**
   - Uses `requestVideoFrameCallback` when available; retains `requestAnimationFrame` as a compatibility fallback.
   - Draws once per decoded video frame instead of drawing duplicate frames at display cadence.
   - Caps pose updates at 30 Hz while leaving the camera preview at its native decoded-frame cadence.
   - Pauses scheduled frame work while the document is hidden and resumes cleanly when visible.

2. **Canvas and MediaPipe hot-path cleanup**
   - Reuses one 2D context configured as opaque and desynchronized.
   - Avoids per-frame `getContext()` lookups and steady-state React status dispatches.
   - Uses a transform reset for the mirrored video draw rather than a second save/restore pair.
   - Aligns the WASM asset URL with the installed MediaPipe package (`0.10.34`) and falls back from GPU to CPU only when the GPU delegate is unavailable.
   - Closes streams, landmarker resources, frame callbacks, and canvas references on every exit/error path.

3. **Bounded garment and upload image work**
   - Caps the one-time garment sprite at 1536 px on its longest edge, above the 1280 px live render target; high-quality interpolation is explicitly enabled.
   - Uses a readback-optimized canvas for background removal.
   - Encodes uploaded studio images from an `ImageBitmap`/object URL path instead of first creating a full-source base64 string. The VTO upload cap is 2048 px at JPEG quality 0.90, preserving source detail for the 2K output option.
   - Releases `ImageBitmap` and object-URL resources deterministically and enables asynchronous image decoding for previews/results.

4. **Cancellation-safe render polling**
   - Adds an optional abort signal to client-side job polling without changing backend requests or response contracts.
   - Fashion Studio and Try-On Studio stop frontend polling when unmounted.
   - Try-On Studio retains the persisted job ID after cancellation so the existing resume behavior is preserved.

## Before / after measurements

| Metric | Before | After | Result |
| --- | ---: | ---: | --- |
| Live canvas draws with a 30 FPS camera on a 60 Hz display | up to 60/s | 30/s | up to 50% fewer duplicate composites |
| Pose inference with a 60 FPS camera | up to 60/s | max 30/s | up to 50% fewer synchronous inferences |
| Steady-state status setter calls | 30–60/s | 0/s | removes React scheduler pressure from the render loop |
| 4K (4032×3024) garment pixel buffer | 46.5 MiB | 6.75 MiB at 1536×1152 | 85.5% smaller preprocessing buffer |
| Live Try-On chunk | 133.20 kB / 41.40 kB gzip | 134.96 kB / 42.02 kB gzip | +1.76 kB raw for lifecycle, fallback, and pacing safeguards |
| Initial application chunk | 933.18 kB / 252.94 kB gzip | 933.19 kB / 252.95 kB gzip | unchanged in practical terms; VTO remains route-lazy |

The frame and memory reductions are deterministic scheduling/buffer bounds. Hardware-specific FPS, GPU time, and battery drain require a physical camera-equipped target device; the local browser test environment was not granted camera access.

## Verification

- `npm run typecheck` passes.
- `npm run build` passes (550 modules transformed).
- The local app loads at a 390×844 mobile viewport with no browser console warnings/errors.
- No backend code, endpoint URL, request field, response field, product logic, Smart Fit code, authentication, or Firestore schema was changed.

## Remaining technical debt

1. The initial application bundle remains 252.95 kB gzip. It does not block the lazy VTO split, but a separate, broader application-shell chunking initiative could reduce initial parse time.
2. MediaPipe's 5.51 MiB model and WASM are remote assets. Production should establish a CDN cache policy and collect real-user model-load telemetry before considering prefetching; unconditional prefetch would hurt battery and data use.
3. A physical-device matrix is still needed for final release sign-off: low-end Android, mid-tier Android, iPhone Safari, and a GPU-disabled/CPU-fallback browser. Capture camera-to-canvas latency, pose inference duration, dropped frames, memory, and battery drain with browser/device tooling.

## Production readiness

**8.5 / 10 — ready for controlled production rollout.** The major client-side VTO bottlenecks and lifecycle leaks are addressed without quality or contract regressions. The remaining score is reserved for device-lab measurements and application-shell bundle work outside this frozen-feature scope.
