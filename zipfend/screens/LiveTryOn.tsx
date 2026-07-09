import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { categoryToClothType, type ClothType } from '../services/tryonService';

// Landmark indices (MediaPipe Pose)
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_ANKLE = 27;
const R_ANKLE = 28;

const SMOOTHING = 0.35; // EMA factor: higher = snappier, lower = smoother

interface Anchor {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
}

/** Remove a near-white studio background so the garment composites cleanly. */
function prepareGarmentSprite(image: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return image;
  ctx.drawImage(image, 0, 0);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (min > 232 && max - min < 18) {
        px[i + 3] = 0;
      }
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  } catch {
    // Canvas tainted by a non-CORS product image; use it as-is.
    return image;
  }
}

const LiveTryOn: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const product = location.state?.product;
  const garmentUrl: string | undefined = product?.image;
  const clothType: ClothType = categoryToClothType(product?.category);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const anchorRef = useRef<Anchor | null>(null);
  const opacityRef = useRef(0.92);

  const [status, setStatus] = useState<'loading' | 'tracking' | 'no-person' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [opacity, setOpacity] = useState(0.92);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);

  useEffect(() => {
    if (!garmentUrl) {
      setStatus('error');
      setErrorMessage('No garment selected. Open a product first.');
      return;
    }

    let landmarker: PoseLandmarker | null = null;
    let stream: MediaStream | null = null;
    let sprite: HTMLCanvasElement | HTMLImageElement | null = null;
    let spriteRatio = 1.3; // height / width fallback
    let cancelled = false;
    let lastVideoTime = -1;
    let lastLandmarks: any[] | null = null;
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    const loadGarment = () =>
      new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          sprite = prepareGarmentSprite(img);
          spriteRatio = img.naturalHeight / Math.max(img.naturalWidth, 1);
          resolve();
        };
        img.onerror = () => {
          // Retry without CORS (sprite will be tainted but still drawable).
          const plain = new Image();
          plain.onload = () => {
            sprite = plain;
            spriteRatio = plain.naturalHeight / Math.max(plain.naturalWidth, 1);
            resolve();
          };
          plain.onerror = () => reject(new Error('Could not load the garment image.'));
          plain.src = garmentUrl;
        };
        img.src = garmentUrl;
      });

    const setup = async () => {
      try {
        await loadGarment();

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        );
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        setStatus('tracking');
        rafRef.current = requestAnimationFrame(renderLoop);
      } catch (error: any) {
        console.error('Live try-on setup failed:', error);
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(
            error?.name === 'NotAllowedError'
              ? 'Camera access was denied. Allow camera permission and retry.'
              : error?.message || 'Could not start the live try-on.'
          );
        }
      }
    };

    const mirrored = (x: number) => 1 - x;

    const computeAnchor = (lm: any[], w: number, h: number): Anchor | null => {
      const visible = (i: number) => lm[i] && (lm[i].visibility ?? 1) > 0.4;
      if (!visible(L_SHOULDER) || !visible(R_SHOULDER)) return null;

      const ls = { x: mirrored(lm[L_SHOULDER].x) * w, y: lm[L_SHOULDER].y * h };
      const rs = { x: mirrored(lm[R_SHOULDER].x) * w, y: lm[R_SHOULDER].y * h };
      const shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y);
      const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x);
      const midX = (ls.x + rs.x) / 2;
      const midY = (ls.y + rs.y) / 2;

      if (clothType === 'lower_body') {
        if (!visible(L_HIP) || !visible(R_HIP)) return null;
        const lh = { x: mirrored(lm[L_HIP].x) * w, y: lm[L_HIP].y * h };
        const rh = { x: mirrored(lm[R_HIP].x) * w, y: lm[R_HIP].y * h };
        const hipY = (lh.y + rh.y) / 2;
        const hipX = (lh.x + rh.x) / 2;
        const ankleY = visible(L_ANKLE) && visible(R_ANKLE)
          ? (lm[L_ANKLE].y * h + lm[R_ANKLE].y * h) / 2
          : hipY + shoulderWidth * 2.6;
        const height = Math.max(ankleY - hipY, 1) * 1.08;
        const width = Math.hypot(rh.x - lh.x, rh.y - lh.y) * 2.4;
        return { cx: hipX, cy: hipY + height * 0.48, width, height, angle };
      }

      if (clothType === 'dress') {
        const ankleY = visible(L_ANKLE) && visible(R_ANKLE)
          ? (lm[L_ANKLE].y * h + lm[R_ANKLE].y * h) / 2
          : midY + shoulderWidth * 4;
        const height = Math.max(ankleY - midY, 1) * 1.05;
        return { cx: midX, cy: midY + height * 0.46, width: shoulderWidth * 2.3, height, angle };
      }

      // upper_body / auto: hang from the shoulders
      const width = shoulderWidth * 2.25;
      const height = width * spriteRatio;
      return { cx: midX, cy: midY + height * 0.38, width, height, angle };
    };

    const smooth = (next: Anchor): Anchor => {
      const prev = anchorRef.current;
      if (!prev) return next;
      const mix = (a: number, b: number) => a + (b - a) * SMOOTHING;
      let angleDelta = next.angle - prev.angle;
      if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
      if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;
      return {
        cx: mix(prev.cx, next.cx),
        cy: mix(prev.cy, next.cy),
        width: mix(prev.width, next.width),
        height: mix(prev.height, next.height),
        angle: prev.angle + angleDelta * SMOOTHING,
      };
    };

    const renderLoop = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!video || !canvas || !ctx || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(renderLoop);
        return;
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      // Mirrored selfie view
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      if (landmarker && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = landmarker.detectForVideo(video, performance.now());
        lastLandmarks = result.landmarks?.[0] ?? null;
      }

      if (lastLandmarks && sprite) {
        const target = computeAnchor(lastLandmarks, canvas.width, canvas.height);
        if (target) {
          const anchor = smooth(target);
          anchorRef.current = anchor;
          ctx.save();
          ctx.globalAlpha = opacityRef.current;
          ctx.translate(anchor.cx, anchor.cy);
          ctx.rotate(anchor.angle);
          ctx.drawImage(sprite, -anchor.width / 2, -anchor.height / 2, anchor.width, anchor.height);
          ctx.restore();
          setStatus(prev => (prev === 'tracking' ? prev : 'tracking'));
        } else {
          anchorRef.current = null;
          setStatus(prev => (prev === 'no-person' ? prev : 'no-person'));
        }
      } else if (!lastLandmarks) {
        anchorRef.current = null;
        setStatus(prev => (prev === 'no-person' ? prev : 'no-person'));
      }

      frameCount += 1;
      const now = performance.now();
      if (now - fpsWindowStart >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - fpsWindowStart)));
        frameCount = 0;
        fpsWindowStart = now;
      }

      rafRef.current = requestAnimationFrame(renderLoop);
    };

    setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach(track => track.stop());
      landmarker?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garmentUrl, clothType]);

  return (
    <div className="relative h-screen w-full bg-black text-white overflow-hidden font-sans select-none">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/70 to-transparent">
        <button aria-label="Go back"
          onClick={() => navigate(-1)}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-black/40 border border-white/10 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px] text-[#6157FF]">arrow_back</span>
        </button>
        <div className="flex flex-col items-center">
          <span className="text-[11px] font-bold text-gray-300">{product?.brand || 'Live'}</span>
          <span className="text-[11px] font-bold tracking-tight text-white">Live Try-On</span>
        </div>
        <div className="h-10 px-3 flex items-center justify-center rounded-full bg-black/40 border border-white/10">
          <span className="text-[12px] font-bold text-[#6157FF]">{fps} FPS</span>
        </div>
      </div>

      {/* Status overlays */}
      {status === 'loading' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/80">
          <div className="h-12 w-12 rounded-full border-2 border-[#6157FF] border-t-transparent animate-spin"></div>
          <span className="text-[12px] font-bold text-[#6157FF]">Starting camera & tracker</span>
        </div>
      )}
      {status === 'no-person' && (
        <div className="absolute top-24 left-0 right-0 z-40 flex justify-center">
          <div className="px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
            <span className="text-[12px] font-bold text-white/80">Step back so your upper body is visible</span>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/90 p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-red-500">videocam_off</span>
          <p className="text-sm text-white/80 max-w-xs">{errorMessage}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-2 px-8 py-3 bg-[#6157FF] text-white font-bold text-xs rounded-xl active:scale-95 transition-all"
          >
            Go Back
          </button>
        </div>
      )}

      {/* Bottom controls */}
      {status === 'tracking' || status === 'no-person' ? (
        <div className="absolute bottom-0 left-0 right-0 z-50 p-6 bg-gradient-to-t from-black/80 to-transparent">
          <div className="max-w-md mx-auto flex items-center gap-4">
            <span className="material-symbols-outlined text-[18px] text-[#6157FF]">opacity</span>
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.02}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="flex-1 accent-[#6157FF]"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LiveTryOn;
