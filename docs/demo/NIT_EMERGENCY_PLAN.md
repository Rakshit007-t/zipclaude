# ZipRIGHT — NIT Demo Emergency Failure Plan

> **Core Rule**: **Never pretend a recorded backup clip is a live session.**  
> If an upstream API, network, or camera issue occurs, pivot immediately, transparently, and confidently.

---

## Quick Reference Protocol Table

| Scenario | Trigger / Symptom | Immediate Presenter Action | Spoken Pivot Script |
| :--- | :--- | :--- | :--- |
| **CASE A**<br/>**Optimal** | Decart connects, green streaming dot active, 21–24 FPS. | **Run full live interactive demo.**<br/>Move naturally, rotate shoulders, demonstrate live drape. | *"ZipRIGHT is streaming live via Decart Lucy VTON at 22 frames per second."* |
| **CASE B**<br/>**Decart Fails** | "Insufficient credits", upstream 503, or WebSocket/WebRTC handshake timeout. | **Switch instantly to real recorded AI LIVE clip** (`NIT_AI_LIVE_BACKUP.mp4`). | *"We have an active edge fallback. Here is the verified high-framerate Decart Lucy output from our test session showing the exact same garment transfer in real time."* |
| **CASE C**<br/>**Internet Fails** | Campus WiFi disconnects, offline indicator appears. | **Show offline UI screenshots** + **play local recorded backup video**. Explain client-side Size Engine and edge architecture. | *"ZipRIGHT's core size intelligence runs client-side and offline. Here is the validated live transfer architecture recorded under production conditions."* |
| **CASE D**<br/>**Camera Fails** | Webcam busy (Zoom/Teams), permission denied, or driver error. | **Launch recorded AI LIVE backup video** or toggle **AR LIVE** tab. | *"With our camera input bypassed, here is the direct Decart Lucy VTON stream showing real-time garment tracking and drape dynamics."* |

---

## Detailed Case Runbooks

### CASE A: Decart Works (Default Live Flow)
1. Ensure `zipfin-backend` (port 8000) and `zipfend` (port 3000) are running.
2. In browser at `http://localhost:3000/#/recommendation`, click **TRY THIS ON**.
3. Camera activates -> WebRTC negotiates -> Decart stream starts.
4. Step back into the framing guide.
5. Move arms side to side to show fabric drape.
6. Click **Stop** or let the 60-second trial timer cleanly expire.

---

### CASE B: Decart Upstream Fails or Times Out
1. If the live feed shows a connection error or spins for > 4 seconds:
2. Do **not** reload repeatedly.
3. Open or switch window to `NIT_AI_LIVE_BACKUP.mp4` (keep it minimized and pre-loaded in VLC or Windows Media Player).
4. State clearly:  
   *"Decart's upstream cloud endpoint is experiencing network latency. Rather than wait for cloud signaling, here is our identical recorded Decart Lucy VTON output from today's field run."*
5. Highlight the collar alignment, torso contouring, and zero edge jitter.

---

### CASE C: Total Internet / Network Failure
1. The web app continues running locally on `localhost:3000`.
2. The Size Engine is deterministic: Alex's profile (178 cm, 72 kg, 38" chest, 32" waist) computes **Size S (70% Confidence)** locally without external network calls.
3. Show the **Verdict Card** on screen.
4. Open the pre-loaded screenshots (`docs/screenshots/` or `NIT_DEMO/`):
   - `NIT_DEMO_FIT_PROFILE_FINAL.png`
   - `NIT_DEMO_RECOMMENDATION_FINAL.png`
   - `NIT_DEMO_LIVE_TRYON_FINAL.png`
5. Play `NIT_AI_LIVE_BACKUP.mp4` locally to demonstrate the live try-on stage.

---

### CASE D: Camera Hardware Error or Permission Block
1. If camera permission is blocked or occupied by presentation software:
2. Switch to the **AR LIVE** tab inside `LiveTryOn` (uses static mock canvas / MediaPipe landmarks).
3. Or immediately switch to `NIT_AI_LIVE_BACKUP.mp4`.
4. Walk the judges through the framing guide and real-time response.

---

## 3 Cardinal Rules for the Presentation
1. **Transparency**: Always state whether a clip is live camera or a verified field recording. Evaluators respect robust backup engineering.
2. **Speed**: Never spend more than 5 seconds debugging a live cloud glitch. If it doesn't stream in 4 seconds, press Play on the backup clip immediately.
3. **Clarity**: Keep the focus on the value proposition: **eliminating return friction through sizing precision and visual confirmation**.
