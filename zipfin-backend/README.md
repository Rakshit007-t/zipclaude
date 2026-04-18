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

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in the required environment variables before running the app.

If you previously installed dependencies and saw `mediapipe` / `protobuf` import errors, reinstall after the new `protobuf` pin:

```bash
pip install --upgrade --force-reinstall -r requirements.txt
```

## Run Server

```bash
uvicorn main:app --reload
```

The API will be available at `http://127.0.0.1:8000` and docs at `http://127.0.0.1:8000/docs`.

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
