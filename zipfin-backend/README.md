# ZipRIGHT Backend

FastAPI backend for ZipRIGHT with modular `routes`, `services`, and `models` folders, JSON responses, CORS support, file upload handling, and Supabase-backed auth/profile APIs.

This repo now supports:

1. `POST /auth/signup`: email/password sign-up.
2. `POST /auth/login`: email/password sign-in.
3. `GET /profiles/me`: fetch the authenticated user's profile.
4. `PUT /profiles/me`: save the authenticated user's profile.

This repo now supports two try-on flows:

1. `POST /tryon-image`: existing static 2D image try-on.
2. `POST /tryon-live/*`: live mobile try-on session APIs for a client-side AR renderer.

Important: true Snapchat-style real-time 3D cloth try-on must render on the mobile device with ARKit, ARCore, Unity, or a React Native camera stack. The backend in this repo now manages garment metadata, session state, and body-anchored transform estimation, but it does not perform full cloth simulation or on-device camera rendering.

## Project Structure

```text
zipfin-backend/
├── main.py
├── models/
│   ├── __init__.py
│   └── schema.py
├── routes/
│   ├── __init__.py
│   ├── avatar.py
│   ├── size.py
│   ├── tryon.py
│   └── tryon_live.py
├── services/
│   ├── __init__.py
│   ├── face_engine.py
│   ├── live_tryon_engine.py
│   ├── size_engine.py
│   ├── tryon_engine.py
│   └── tryon_live_store.py
├── storage/
│   └── tryon_live.db
├── requirements.txt
└── README.md
```

## Development Startup

The canonical backend virtual environment is `zipfin-backend/venv`.

The backend must be started through the repo-level startup script. The script
uses the canonical venv, installs dependencies from `zipfin-backend/requirements.txt`
when needed, verifies `uvicorn`, changes into `zipfin-backend`, and runs:

```bash
python -m uvicorn main:app --reload
```

Copy `zipfin-backend/.env.example` to `zipfin-backend/.env` and fill in the
required environment variables before running the app.

The API will be available at `http://127.0.0.1:8000` and docs at
`http://127.0.0.1:8000/docs`.

### Windows

### PowerShell

From the repository root:

```powershell
.\start_backend.ps1
```

### CMD

From the repository root:

```bat
start_backend.bat
```

### Linux

From the repository root:

```bash
cd zipfin-backend
python3 -m venv venv
. venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

### Mac

From the repository root:

```bash
cd zipfin-backend
python3 -m venv venv
. venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

## Production Server

The project now includes a Gunicorn configuration for production deployments using Uvicorn workers.

```bash
gunicorn -c gunicorn.conf.py main:app
```

The default config:

- uses `uvicorn.workers.UvicornWorker`
- scales worker count from CPU cores with a conservative cap
- enables request recycling via `max_requests` and jitter
- writes logs to stdout/stderr for container-friendly deployments

## Environment Variables

All service configuration is environment-variable driven.

### External API Keys

```bash
REPLICATE_API_TOKEN=your_replicate_token_here
INSIGHTFACE_API_KEY=your_insightface_key_here
```

### Firebase

Required:

```bash
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
```

Recommended credential option:

```bash
FIREBASE_CREDENTIALS_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...","token_uri":"https://oauth2.googleapis.com/token"}
```

Alternative credential option:

```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
```

Fallback option for mounted secrets:

```bash
FIREBASE_CREDENTIALS_PATH=/run/secrets/firebase-service-account.json
```

### Virtual Try-On Quality Flags

The local CatVTON engine applies a quality pipeline on top of raw diffusion
output. Every stage defaults to on and has an env kill-switch for rollback:

```bash
VTON_REPAINT=1              # composite only the garment region back onto the
                            # original photo at full resolution (identity,
                            # background and framing stay pixel-original)
VTON_CLIP_TO_SILHOUETTE=1   # clip the garment mask to the person segmentation
                            # so background is never repainted
VTON_PROTECT_FACE_HANDS=1   # carve face/hands/feet out of the repaint mask
VTON_SUPERRES=1             # Real-ESRGAN x2 on the render before compositing
                            # (weights auto-download once to storage/upscaler/)
VTON_SEED=                  # optional fixed seed to replay a generation
VTON_PROVIDERS=local,cloud  # try-on engine order
```

### AI Stylist (local-first)

The stylist runs on a local LLM via [Ollama](https://ollama.com) — no API
keys, no cloud cost. Install Ollama, then `ollama pull qwen2.5:3b` (fits a
6GB GPU). The Gemini path remains as automatic fallback.

```bash
STYLIST_PROVIDERS=ollama,gemini   # provider order; add "openai" for vLLM
OLLAMA_HOST=http://localhost:11434
OLLAMA_STYLIST_MODEL=qwen2.5:3b

# Production scale-out: point at any OpenAI-compatible server (vLLM,
# TensorRT-LLM, llama.cpp) running an open-weight model, no code changes:
#   vllm serve Qwen/Qwen3-8B
# OPENAI_COMPAT_BASE_URL=http://gpu-box:8001
# OPENAI_COMPAT_MODEL=Qwen/Qwen3-8B
# STYLIST_PROVIDERS=openai,ollama,gemini
```

Authenticated requests automatically include the shopper's context: Fit
Profile (Smart Fit measurements, usual size, fit preference, preferred
brand), derived body shape, and recent purchase/recommendation outcomes.

### Concurrency

```bash
TRYON_MAX_WORKERS=2   # bounded try-on worker pool; extra jobs queue with
                      # status "queued" instead of spawning unbounded threads
```

Generated images upload with `Cache-Control: public, max-age=31536000,
immutable` (UUID filenames never change), so Firebase Storage's CDN edge and
browsers cache them for free.

## Size Recommendation Learning Loop

Recommendation accuracy improves continuously from real purchase outcomes:

```
User Scan -> Measurement Extraction (services/measurement_service.py)
          -> Size Recommendation    (services/size_engine.py)
          -> Purchase
          -> Feedback               (POST /size-feedback -> Firestore size_feedback)
          -> Calibration Update     (services/calibration_service.py)
          -> Improved Future Recommendations
```

`calibration_service.calibration_for(...)` aggregates feedback at four
granularities — product, brand+category, brand, and per-user — picks the most
specific one with enough evidence, and returns a bounded `CalibrationSignal`
(size step, confidence adjustment, human-readable reason). The size engine
consumes only that signal, so a learned model can replace the rule-based
internals later without changing any API.

## Supabase Setup

Add these variables to `.env`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Run the SQL in [storage/supabase_profiles.sql](/C:/Users/abcra/zipfin-backend/storage/supabase_profiles.sql:1) inside the Supabase SQL editor. It creates the `profiles` table, sync triggers, and row-level security policies so users can only read and update their own profile row.

## Live Try-On API

### 1. Register a garment

`POST /tryon-live/garments`

```json
{
  "sku": "hoodie-black-001",
  "name": "Black Hoodie",
  "category": "hoodie",
  "preview_image_url": "https://cdn.example.com/hoodie.png",
  "asset_url": "https://cdn.example.com/hoodie.glb",
  "texture_image_url": "https://cdn.example.com/hoodie-texture.png",
  "scale_multiplier": 1.0,
  "anchor_profile": {
    "width_scale": 1.2,
    "height_scale": 1.4,
    "y_offset": 0.16,
    "z_offset": 0.02,
    "smoothing": 0.25
  }
}
```

### 2. Create a mobile try-on session

`POST /tryon-live/session`

```json
{
  "user_id": "user_123",
  "garment_id": "returned-garment-id",
  "platform": "android",
  "frame_width": 1080,
  "frame_height": 1920,
  "camera_fov_degrees": 68
}
```

### 3. Send pose landmarks per frame

`POST /tryon-live/frame`

```json
{
  "session_id": "returned-session-id",
  "frame_width": 1080,
  "frame_height": 1920,
  "landmarks": {
    "left_shoulder": { "x": 0.39, "y": 0.24, "z": -0.18, "visibility": 0.99 },
    "right_shoulder": { "x": 0.61, "y": 0.25, "z": -0.16, "visibility": 0.98 },
    "left_hip": { "x": 0.43, "y": 0.54, "z": -0.14, "visibility": 0.91 },
    "right_hip": { "x": 0.58, "y": 0.55, "z": -0.12, "visibility": 0.92 }
  }
}
```

### 4. Receive a render transform

```json
{
  "session_id": "returned-session-id",
  "garment_id": "returned-garment-id",
  "tracking_status": "tracked",
  "missing_landmarks": [],
  "transform": {
    "anchor_x": 0.5,
    "anchor_y": 0.293,
    "anchor_z": -0.13,
    "width_px": 299.68,
    "height_px": 846.83,
    "rotation_degrees": 2.6,
    "confidence": 0.91
  }
}
```

### 5. Optional WebSocket mode

Use `websocket_path` from session creation and send the same frame payload without `session_id`.

## Mobile Integration Notes

- Run pose detection on-device with MediaPipe Tasks, ARCore, ARKit, or Vision/MoveNet.
- Render the `asset_url` garment model on the client, not on the backend.
- Apply `anchor_x`, `anchor_y`, `anchor_z`, `width_px`, `height_px`, and `rotation_degrees` to your garment node each frame.
- Mirror the smoothing logic client-side for the lowest latency path.
- For production-grade realism, add segmentation, occlusion masks, and a proper 3D cloth rig in the mobile renderer.
