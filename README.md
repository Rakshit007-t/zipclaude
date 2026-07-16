# ZipRIGHT Main App

ZipRIGHT is a production-ready AI fashion application with a React frontend and a Python/FastAPI backend. This repository snapshot preserves the current application structure, business logic, API surface, Firebase integration, and supporting documentation while excluding generated build artifacts, caches, logs, local environments, and other non-source outputs.

## Project Overview

The app combines product discovery, fit and size guidance, authentication, social commerce, AI styling, virtual try-on, and seller tooling. The frontend lives in `zipfend/` and the backend lives in `zipfin-backend/`.

## Features

- Firebase authentication and Firestore-backed user flows.
- AI styling, recommendation, and try-on experiences.
- Size and fit profiling with measurement utilities.
- Seller and admin workflows for catalog and analytics management.
- Backend APIs for auth, profile, product, try-on, and supporting services.
- PWA-ready frontend assets and reusable UI components.

## Folder Structure

```text
zipright-mvpcopy/
├── zipfend/                # Frontend application
├── zipfin-backend/         # Backend API and services
├── codex-video-frames/     # Captured media assets
├── start_backend.ps1       # Backend startup helper
├── start_backend.bat       # Backend startup helper
├── README.md               # This snapshot guide
├── README_MODELS.md        # Model placement guide
└── .gitignore              # Ignore rules for generated files
```

## Installation

### Root

```bash
npm install
```

### Frontend

```bash
cd zipfend
npm install
```

### Backend

```bash
cd zipfin-backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## Backend Setup

Use the backend environment examples in `zipfin-backend/.env.example`, `zipfin-backend/.env.staging.example`, and `zipfin-backend/.env.production.example` as the source of truth for required variables.

Start the backend from the repository root with one of the provided scripts:

```powershell
.\start_backend.ps1
```

```bat
start_backend.bat
```

## Frontend Setup

The frontend uses Vite and React. The main entry points are in `zipfend/` and the local dev server is started with the frontend package scripts.

```bash
cd zipfend
npm run dev
```

## Environment Variables

### Frontend

See `zipfend/.env.example` for the local variables used by the app. The current example includes:

- `VITE_API_URL`
- `RAZORPAY_KEY_ID`

### Backend

See `zipfin-backend/.env.example` for the full backend reference. The production and staging variants in the same folder show the deployment-specific overrides.

### Firebase

The frontend uses Firebase configuration files in `zipfend/` and the backend documents Firebase storage and credentials setup in its environment examples. Do not commit secret keys or service account JSON values.

## Firebase Setup

Firebase is used for authentication, Firestore, and related client/server integrations. The tracked configuration files are the non-secret app configs under `zipfend/`.

Set up your Firebase project, enable the required auth providers, configure Firestore rules, and provide the runtime credentials through environment variables or local secret files as documented in the backend environment examples.

## API Documentation

The backend exposes the application APIs through FastAPI. The current backend documentation in `zipfin-backend/README.md` and `zipfin-backend/PRODUCTION.md` covers the main routes and deployment operations.

Key route groups include authentication, profiles, products, stylist features, size recommendation, seller workflows, and try-on endpoints.

## How to Run Locally

1. Install dependencies for the root, frontend, and backend.
2. Configure frontend and backend environment variables.
3. Start the backend with `start_backend.ps1` or `start_backend.bat`.
4. Start the frontend with the Vite dev script in `zipfend/`.

## Deployment Notes

- The backend includes production guidance in `zipfin-backend/PRODUCTION.md`.
- Firebase secrets must be injected from a secrets manager or local untracked env file.
- Generated logs, caches, and build outputs are intentionally excluded from version control.
- Model weights are not committed in this snapshot; see `README_MODELS.md` for placement guidance.

## Current Implementation Status

- Frontend redesign and UI system work are documented in the frontend engineering reports.
- Backend production operations, API structure, and deployment guidance are documented in the backend README and production guide.
- The repository contains the current production application source, not a cleaned example starter.

## Known Issues

- Local model weights are not stored in the repository and must be fetched or placed separately.
- Some runtime artifacts were present in the working tree and are excluded from the snapshot.
- The frontend and backend maintain separate package and environment setup flows.

## Roadmap

1. Keep source-of-truth environment examples aligned with deployment requirements.
2. Continue documenting model asset placement as new weights are added.
3. Preserve the current production code paths while keeping generated assets out of source control.
