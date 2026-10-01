# ZipRIGHT — Final NIT Demo Runbook & Presentation Guide

> **Event**: NIT Demonstration  
> **Status**: Systems Frozen & Field-Validated  
> **Target Time**: 90 Seconds  

---

## 1. Flow Diagram

```
      [ 1. PROBLEM ]
      Buying friction: size uncertainty + drape doubt
            │
            ▼
     [ 2. FIT PROFILE ]
     Physical anthropometric telemetry (Alex)
            │
            ▼
  [ 3. SIZE RECOMMENDATION ]
  Size Engine maps body to garment spec (Size S, 70% Confidence)
            │
            ▼
     [ 4. TRY THIS ON ]
     Single-click bridge from prediction to visual confirmation
            │
            ▼
       [ 5. AI LIVE ]
       Decart Lucy VTON real-time 16:9 stage
            │
            ▼
       [ 6. RED SHIRT ]
       Active target garment rendered over user's clothing
            │
            ▼
     [ 7. LIVE MOVEMENT ]
     Torso turns, shoulder alignment, continuous dynamic drape
            │
            ▼
   [ 8. BACKUP VIDEO (IF FAILS) ]
   Instant transparent pivot to NIT_AI_LIVE_BACKUP.mp4 if cloud latency occurs
```

---

## 2. Ultra-Short Presenter Instructions (Step-by-Step)

| Step | Action | UI Target | Backup Trigger |
| :--- | :--- | :--- | :--- |
| **1. Intro** | Start on Home screen (`#/home`). | `#/home` | If logged out, click "Continue as Demo". |
| **2. Fit Profile** | Click **Fit Profile** -> click **Quick-Fill** (Alex) -> click **Save**. | `#/fit-profile` | Values persist in `localStorage`. |
| **3. Size Verdict** | Review **Recommended Size: S**, Confidence: **70%**. | `#/recommendation` | Built-in offline deterministic fallback. |
| **4. Launch VTO** | Click **TRY THIS ON** button. | CTA at bottom | Passes size metadata into `#/live-tryon`. |
| **5. AI LIVE** | Stand 1.5m back inside 16:9 guide. | Webcam feed | If > 4s to connect, switch to **Backup Video**. |
| **6. Red Shirt** | Select Red Shirt / target garment in tray. | Lower tray | Instant cached asset switch. |
| **7. Movement** | Rotate torso 15°, raise arms gently. | Center frame | Show drape contouring without jitter. |
| **8. Conclusion** | Conclude with value statement. | App screen | Keep to 90 seconds total. |

---

## 3. The 90-Second Spoken Script

### [00:00 – 00:10] The Core Problem
> *"Buying clothes online gives us two questions: What size should I buy, and how will it actually look on me?"*
> 
> *(Presenter points to phone or screen showing the catalog item).*

---

### [00:10 – 00:30] Fit Profile & Anthropometric Telemetry
> *"ZipRIGHT solves this by replacing generic size charts with true body telemetry. Here in Alex's Fit Profile, we capture exact physical measurements: 5 foot 10, 72 kilograms, a 38-inch chest, and balanced fit preference. No guesswork—pure physical dimensions."*
> 
> *(Presenter clicks Quick-Fill, showing verified physical fields populate, then clicks 'Get My Size').*

---

### [00:30 – 00:45] Size Recommendation Engine
> *"Our Size Engine cross-references Alex's measurements directly with the manufacturer's garment specifications. The verdict: **Recommended Size: S** with **70% Confidence**. It gives the customer a clear explanation of shoulder and chest ease before they add to cart."*
> 
> *(Presenter points to the clean S recommendation card, then taps 'TRY THIS ON').*

---

### [00:45 – 00:75] AI LIVE: Real-Time Garment Try-On
> *"Now we bridge prediction to visual proof. With one click, ZipRIGHT opens AI LIVE. Using Decart's Lucy VTON model, our pipeline replaces the current top with the target garment in real time at over 20 frames per second.*
> 
> *Notice how the red shirt drapes naturally over the shoulders, collar, and torso as I move, twist, and step back. The fabric moves with natural body mechanics rather than a static 2D sticker."*
> 
> *(Presenter stands in frame, turns slightly to show fabric drape and realistic fit).*  
> *(If cloud latency occurs: Presenter immediately switches to `NIT_AI_LIVE_BACKUP.mp4` and states: "Here is the exact recorded stream from our field validation showing the same real-time drape.")*

---

### [00:75 – 00:90] Value & Closing
> *"ZipRIGHT connects fit intelligence with virtual try-on, so the customer can decide before buying. Sizing certainty cuts return rates; live visualization converts browsers into buyers."*
> 
> *(Presenter smiles and concludes).*

---

## 4. Hardware & Setup Checklist

1. **Laptop Display Resolution**: 1920x1080 (16:9).
2. **Webcam**: Clean lens, positioned at chest height, 1.5 to 2.0 meters back.
3. **Lighting**: Frontal light source; avoid bright backlighting behind the presenter.
4. **Browser**: Google Chrome with hardware acceleration enabled.
5. **Local Services**:
   - Frontend: `npm run dev` running on `http://localhost:3000`
   - Backend: `uvicorn main:app --port 8000` running
6. **Pre-Loaded Backup**: Keep `NIT_AI_LIVE_BACKUP.mp4` minimized in VLC media player ready with `Alt + Tab`.
