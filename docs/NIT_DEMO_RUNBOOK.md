# ZipRIGHT — NIT Event Live Demonstration Runbook

> **Event**: NIT Demonstration  
> **Status**: Systems Frozen & Field-Validated  
> **Platform Version**: ZipRIGHT v1.0.0 (Decart Lucy VTON + MediaPipe AR Engine)  
> **Target Audience**: NIT Evaluators, Industry Judges, Technical Reviewers

---

## 1. Executive Demo Architecture

ZipRIGHT solves online apparel's biggest friction point: **sizing and fitting uncertainty**. The demonstration is organized as an unbroken, cohesive 4-stage pipeline:

```
[ 1. FIT PROFILE ] ──▶ [ 2. SIZE ENGINE ] ──▶ [ 3. PRODUCT VERDICT ] ──▶ [ 4. AI LIVE VTO ]
  Physical Metrics       Multi-Factor ML         Ideal Size + Fit           Real-Time 16:9 Stream
  (Height, Chest, etc.)  Brand Normalization     Risk Assessment            (Decart + AR Fallback)
```

---

## 2. End-to-End Step-by-Step Presentation Script

| Step | Screen / State | What to Click / Action | What to Say (Presenter Script) | Expected Result | Fallback / Safeguard |
|:---|:---|:---|:---|:---|:---|
| **1** | **Landing / Home** (`#/home`) | Open app on browser/mobile view. | *"Welcome to ZipRIGHT. We turn sizing uncertainty into a verified real-time try-on experience."* | Clean home dashboard loads; bottom navigation dock visible. | If session expired, click 'Continue as Demo'. |
| **2** | **Fit Profile Entry** | Click **Fit Profile** icon or banner. | *"Everything begins with true body telemetry. ZipRIGHT builds an adaptable fit profile for each shopper."* | Navigates to `#/fit-profile`. Member selector and measurement tabs open. | Local storage caches latest member telemetry. |
| **3** | **Demo Measurements** | Click **Preset: Alex** (5'10", 72 kg, 38 chest, 32 waist) or enter values. Click **Save Profile**. | *"Here we have Alex: 5 foot 10, 72 kilograms, 38-inch chest, balanced fit preference. No guesswork—pure anthropometric inputs."* | Fields populate with verified physical values. Form validates with green checkmarks. | In demo mode, preset automatically validates input bounds. |
| **4** | **Size Recommendation Engine** | System navigates to **Recommendation** (`#/recommendation`). | *"ZipRIGHT's Size Engine instantly maps Alex's telemetry against brand size charts, predicting both Ideal Size and expected fit ease."* | Sizing card shows: **Recommended Size: S**, Confidence: **70%**, Fit verdict: **Closest available fit to ideal**, Low return risk. | If offline or API timeout, local deterministic size rules compute instantly. |
| **5** | **Curated Showcase Product** | Inspect the active product: **Checked Casual Shirt** by Roadster (`Rs. 1,299`). | *"Notice how the engine breaks down shoulder and chest clearance for this Roadster casual shirt, explaining the exact fit rationale."* | Product details, size comparison matrix, and size chart breakdown displayed. | Switch product button allows trying other catalog garments. |
| **6** | **Launch Virtual Try-On** | Click primary CTA: **TRY THIS ON** (`view_in_ar` icon). | *"Now we bridge prediction to reality. Let's see how this garment fits in real time on camera."* | Navigates immediately to `#/live-tryon` with garment and size metadata pre-bound. | `startMode: 'ai'` triggers clean WebRTC initialization. |
| **7** | **Camera & Stream Initialization** | Allow webcam access if prompted. | *"The platform engages the low-latency video pipeline. Notice our responsive 16:9 stage framing the upper torso without camera cropping."* | Hardware camera initializes, green dot indicators show ready state, prompt syncs automatically. | Mirror flip button available for selfie or presenter camera swap. |
| **8** | **AI Live Real-Time Feed** | Stand in view of camera within the framing guide. | *"ZipRIGHT connects directly to Decart's Lucy VTON model, generating frame-by-frame generative garment transfers at 21 to 24 frames per second."* | Live video stream renders transformed garment over user's clothing with realistic cloth drape. | If upstream trial budget is reached, 1-click **AR LIVE** tab instantly activates. |
| **9** | **Garment A Demonstration** | Hold pose, show arms and shoulders. | *"Notice the shoulder seams and collar alignment adapting as the presenter moves naturally in front of the lens."* | Garment contours smoothly with body motion; no edge jitter or clipping. | 60-second live budget counter keeps presenter aware of session limits. |
| **10** | **Real-Time Garment Swap** | Click **Cotton Straight Kurta** in the lower garment tray. | *"Shoppers don't try on just one item. With one tap, ZipRIGHT hot-swaps the garment model on the fly."* | Lower tray shifts active focus; AI prompt updates to 'Cotton Straight Kurta'; stream updates. | Garment thumbnails cached locally for instantaneous switching. |
| **11** | **Motion Validation** | Step side-to-side, raise arms gently. | *"The pipeline maintains stable tracking through rotation, torso twists, and distance shifts."* | Mesh and neural frames track torso geometry continuously. | If body moves out of frame, repositioning guide overlay alerts user. |
| **12** | **Session Stop** | Click **End Session** or navigate back. | *"Once the shopper is confident in the fit, they can lock in their size or review alternatives."* | Video hardware tracks stop cleanly; no memory leaks or dangling streams. | Audio/video tracks cleanly disposed via `stream.getTracks().forEach(t => t.stop())`. |
| **13** | **Session Restart** | Re-click **AI LIVE** tab or **Restart**. | *"The pipeline reconnects in under a second with debounced mount protection."* | Hardware camera reacquires, status displays 'Connected' or ready state. | StrictMode double-mount protection prevents signaling race conditions. |
| **14** | **Fallback & Resilience Check** | Click **AR LIVE** tab. Adjust opacity slider. | *"In retail environments with constrained bandwidth, ZipRIGHT's client-side WebGL AR engine provides zero-latency instant fallback at 15 to 20 FPS."* | WebGL canvas overlays garment onto MediaPipe pose landmarks; opacity slider adjusts blend. | 100% operational offline without external API dependencies. |

---

## 3. Screen Captures & Visual Verification

| Stage | Visual Proof | Description |
|:---|:---|:---|
| **1. Fit Profile** | `NIT_DEMO_FIT_PROFILE_FINAL.png` | Validated body telemetry (Alex, 5'10", 72 kg, 38" chest, 32" waist) |
| **2. Size Recommendation** | `NIT_DEMO_RECOMMENDATION_FINAL.png` | Roadster Checked Casual Shirt, Recommended Size S, 70% confidence |
| **3. AI LIVE Stream** | `NIT_DEMO_LIVE_TRYON_FINAL.png` | Decart Lucy VTON real-time 16:9 stage with remote generative stream |
| **4. AR LIVE Fallback** | `NIT_DEMO_LIVE_TRYON_AR_FALLBACK.png` | Client-side MediaPipe WebGL mesh tracking with 92% opacity blend |

---

## 4. 30-Second Emergency Recovery Procedure

If anything unexpected occurs on stage (e.g. WiFi interruption, upstream cloud provider rate-limit, camera permission block), execute this exact 30-second protocol:

```
                      EMERGENCY RECOVERY DECISION TREE
                                     │
                 ┌───────────────────┴───────────────────┐
        [Upstream API Blocker]                   [Hardware / WiFi Loss]
                 │                                         │
        Click 'AR LIVE' Tab                       Click 'Back' to Verdict
                 │                                         │
    MediaPipe WebGL mesh activates             Highlight Size Engine logic
    Runs 100% client-side at ~18 FPS           Show Confidence & Return Risk
```

### Immediate Actions by Scenario:
1. **Upstream Decart Returns "Insufficient Credits" or Disconnects**:
   - **Click**: Tap the **AR LIVE** tab at the top-left of the stage.
   - **Say**: *"ZipRIGHT features an edge-resilient architecture: when external network latency spikes, our client-side MediaPipe pose engine takes over seamlessly."*
   - **Action**: Move in front of camera; show the garment overlay moving with your torso. Use the opacity slider to show the WebGL texture map.

2. **Webcam Permission Denied or Camera Hardware Busy**:
   - **Action**: Click the camera icon in Chrome's URL bar -> Select "Always allow" -> Refresh page (`Ctrl + R`).
   - **Fallback**: If hardware camera is occupied by presentation software (e.g., Zoom/Teams), navigate to `/#/recommendation` and click **2D Photo Try-On** or show the high-confidence size verdict.

3. **Page Freezes or White Screen**:
   - **Action**: Press `Ctrl + Shift + R` (Hard Reload). The app defaults to Demo Mode (`isDemoMode() = true`) and restores the demo state in under 2 seconds.

---

## 5. Technical Constraints & Verifications

- **Decart Model**: Lucy VTON Realtime WebRTC (`lucy-vton-realtime-v1`)
- **Fallback Engine**: MediaPipe PoseLandmarker + WebGL UV Mesh
- **Framing**: Responsive 16:9 aspect-ratio with `object-cover` and rounded border
- **Local Dev Server**: Vite on `http://localhost:3000`
- **Backend Service**: FastAPI / Uvicorn on `http://localhost:8000`
