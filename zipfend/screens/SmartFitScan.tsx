import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc } from 'firebase/firestore';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { AppBar, Button, Eyebrow, Spinner } from '../components/ui';


import { auth, db } from '../firebase';
import { processSmartFitScan, SmartFitMeasurements, SmartFitScanResult } from '../services/ziprightApi';

type ScanMeasurementKey = 'chest' | 'waist' | 'shoulders' | 'arms' | 'legs' | 'torso' | 'hips' | 'bust';
type CoreMeasurementKey = 'chest' | 'waist' | 'shoulders';

const PROFILE_MEASUREMENT_KEYS: ScanMeasurementKey[] = [
  'chest',
  'waist',
  'shoulders',
  'arms',
  'legs',
  'torso',
  'hips',
  'bust',
];
const CORE_MEASUREMENT_KEYS: CoreMeasurementKey[] = ['chest', 'waist', 'shoulders'];
const SCAN_GUIDANCE_MESSAGE = 'Stand straight, full body visible, good lighting';
const SAVE_SYNC_TIMEOUT_MS = 8000;

function hasCapturedImage(image: string | File | null) {
  if (image instanceof File) {
    return image.size > 0;
  }
  return typeof image === 'string' && image.trim().length > 0;
}

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDimension = 1200;

        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } else {
          resolve(reader.result as string);
        }
      };
      img.onerror = () => resolve(reader.result as string);
      img.src = reader.result as string;
    };
    reader.onerror = (error) => reject(error);
  });

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasMeasurementValues(measurements: SmartFitMeasurements | null | undefined) {
  if (!measurements) {
    return false;
  }

  return PROFILE_MEASUREMENT_KEYS.some((key) => isFinitePositiveNumber(measurements[key]));
}

function hasValidCoreMeasurements(measurements: SmartFitMeasurements | null | undefined) {
  if (!measurements) {
    return false;
  }

  const chest = measurements.chest;
  const waist = measurements.waist;
  const shoulders = measurements.shoulders;
  return (
    isFinitePositiveNumber(chest) &&
    isFinitePositiveNumber(waist) &&
    isFinitePositiveNumber(shoulders)
  );
}

function sanitizeMeasurements(measurements: SmartFitMeasurements): SmartFitMeasurements | null {
  if (!hasValidCoreMeasurements(measurements)) {
    return null;
  }

  const cleaned: SmartFitMeasurements = {
    chest: measurements.chest,
    waist: measurements.waist,
    shoulders: measurements.shoulders,
    confidence: measurements.confidence,
  };

  PROFILE_MEASUREMENT_KEYS.forEach((key) => {
    const value = measurements[key];
    if (isFinitePositiveNumber(value)) {
      cleaned[key] = value;
    }
  });

  return cleaned;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function buildFirestoreMeasurements(measurements: SmartFitMeasurements) {
  const firestoreMeasurements: Record<string, number> = {
    chest: measurements.chest,
    waist: measurements.waist,
    shoulders: measurements.shoulders,
  };

  PROFILE_MEASUREMENT_KEYS.forEach((key) => {
    const value = measurements[key];
    if (isFinitePositiveNumber(value)) {
      firestoreMeasurements[key] = value;
    }
  });

  if (isFiniteNumber(measurements.confidence)) {
    firestoreMeasurements.confidence = measurements.confidence;
  }

  return firestoreMeasurements;
}

/** Glass pill button used over the camera/preview surface. */
const overlayPillCls =
  'bg-black/60 backdrop-blur-md px-5 py-3 rounded-full flex items-center gap-2 press border border-white/15 cursor-pointer';

const SmartFitScan: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { userProfile, setUserProfile, updateHeight } = useUserProfile();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [heightCm, setHeightCm] = useState<string>(userProfile.height > 0 ? String(userProfile.height) : '');
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [sideImage, setSideImage] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [sidePreview, setSidePreview] = useState<string | null>(null);
  const [capturedFrontImage, setCapturedFrontImage] = useState<string | null>(null);
  const [capturedSideImage, setCapturedSideImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [measurements, setMeasurementsState] = useState<SmartFitMeasurements | null>(null);
  const [scanResult, setScanResult] = useState<SmartFitScanResult | null>(null);

  // Camera State
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanInFlightRef = useRef(false);
  const currentUploadType = step === 2 ? 'front' : 'side';

  const clearMeasurements = () => {
    setMeasurementsState(null);
    setScanResult(null);
  };

  const clearError = () => {
    setErrorMsg(null);
  };

  const failScan = (message: string) => {
    clearMeasurements();
    setErrorMsg(message);
  };

  useEffect(() => {
    if (isCameraOn && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(err => console.error("Video play failed", err));
    }
  }, [isCameraOn, stream]);

  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (frontPreview?.startsWith('blob:')) URL.revokeObjectURL(frontPreview);
      if (sidePreview?.startsWith('blob:')) URL.revokeObjectURL(sidePreview);
    };
  }, [frontPreview, sidePreview]);

  useEffect(() => {
    if (step !== 1) {
      return;
    }

    const nextHeight = userProfile.height > 0 ? String(userProfile.height) : '';
    if (nextHeight !== heightCm) {
      setHeightCm(nextHeight);
    }
  }, [heightCm, step, userProfile.height]);

  const startCamera = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (cameraError) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      setStream(mediaStream);
      setIsCameraOn(true);
      setCameraError(false);
    } catch (err) {
      console.error("Camera access denied or unavailable", err);
      setCameraError(true);
      fileInputRef.current?.click();
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCameraOn(false);
  };

  const handleCapture = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const imageBase64 = canvas.toDataURL("image/jpeg");

        if (step === 2) {
          setCapturedFrontImage(imageBase64);
          setFrontImage(null);
          setFrontPreview(null);
        } else if (step === 3) {
          setCapturedSideImage(imageBase64);
          setSideImage(null);
          setSidePreview(null);
        }
        clearError();
        clearMeasurements();
        stopCamera();
      }
    }
  };

  const handleRetake = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopCamera();
    setFrontImage(null);
    setSideImage(null);
    setFrontPreview(null);
    setSidePreview(null);
    setCapturedFrontImage(null);
    setCapturedSideImage(null);
    if (step !== 2) {
      setStep(2);
    }
    clearError();
    clearMeasurements();
    setTimeout(() => startCamera(), 100);
  };

  const handleFileUpload = (type: "front" | "side", file?: File) => {
    if (!file) return;

    const url = URL.createObjectURL(file);

    if (type === "front") {
      if (frontPreview?.startsWith('blob:')) URL.revokeObjectURL(frontPreview);
      setFrontImage(file);
      setFrontPreview(url);
      setCapturedFrontImage(null);
    } else {
      if (sidePreview?.startsWith('blob:')) URL.revokeObjectURL(sidePreview);
      setSideImage(file);
      setSidePreview(url);
      setCapturedSideImage(null);
    }

    clearError();
    clearMeasurements();
    stopCamera();
  };

  const handleImageUpload = (type: "front" | "side", e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (type === 'side' && !hasCapturedImage(frontImage || capturedFrontImage)) {
        failScan('Capture the front image first.');
        return;
      }
      handleFileUpload(type, file);
    }
    e.target.value = '';
  };

  const handleProcessMeasurements = async () => {
    if (loading || scanInFlightRef.current) {
      return;
    }

    if (!auth.currentUser) {
      showToast('Please sign in again.', 'error');
      return;
    }

    const parsedHeight = parseFloat(heightCm);
    if (!Number.isFinite(parsedHeight) || parsedHeight <= 0) {
      setErrorMsg('Please enter a valid height.');
      return;
    }

    clearMeasurements();
    clearError();

    const finalFront = frontImage || capturedFrontImage;
    const finalSide = sideImage || capturedSideImage;

    if (!finalFront || !finalSide) {
      failScan('Upload or capture both front and side images');
      return;
    }

    scanInFlightRef.current = true;
    setLoading(true);

    try {
      updateHeight(parsedHeight);
      const frontBase64 = finalFront instanceof File ? await toBase64(finalFront) : finalFront;
      const sideBase64 = finalSide instanceof File ? await toBase64(finalSide) : finalSide;
      const result = await processSmartFitScan({
        height: parsedHeight,
        frontImage: frontBase64,
        sideImage: sideBase64,
      });

      if (!result || !result.measurements || Object.keys(result.measurements).length === 0) {
        failScan(result?.message || SCAN_GUIDANCE_MESSAGE);
        return;
      }

      const validMeasurements = sanitizeMeasurements(result.measurements);
      if (!validMeasurements) {
        failScan(SCAN_GUIDANCE_MESSAGE);
        return;
      }

      const m = validMeasurements;
      const hasCore = m.chest && m.waist && m.shoulders;
      if (!hasCore) {
        failScan(SCAN_GUIDANCE_MESSAGE);
        return;
      }

      const nextMeasurements = PROFILE_MEASUREMENT_KEYS.reduce<Record<string, number>>((acc, key) => {
        const value = validMeasurements[key];
        if (isFinitePositiveNumber(value)) {
          acc[key] = value;
        }
        return acc;
      }, {});

      setUserProfile(prev => ({
        ...prev,
        height: parsedHeight,
        measurements: nextMeasurements,
      }));

      setScanResult(result);
      setMeasurementsState(validMeasurements);
      setStep(4);
    } catch (err: any) {
      console.error(err);
      failScan(err?.message || SCAN_GUIDANCE_MESSAGE);
    } finally {
      scanInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleNextStep = () => {
    if (loading || scanInFlightRef.current) {
      return;
    }

    if (step === 1) {
      const heightNum = parseFloat(heightCm);
      if (!Number.isFinite(heightNum) || heightNum <= 0) {
        showToast('Please enter a valid height.', 'error');
        return;
      }

      updateHeight(heightNum);
      setStep(2);
      if (!cameraError) setTimeout(() => startCamera(), 100);
      return;
    }

    if (step === 2 && hasCapturedImage(frontImage || capturedFrontImage)) {
      setStep(3);
      if (!cameraError && !frontImage) setTimeout(() => startCamera(), 100);
      return;
    }

    if (
      step === 3 &&
      hasCapturedImage(frontImage || capturedFrontImage) &&
      hasCapturedImage(sideImage || capturedSideImage)
    ) {
      handleProcessMeasurements();
    }
  };

  const handleBack = () => {
    stopCamera();
    navigate(-1);
  };

  const [savingMeasurements, setSavingMeasurements] = useState(false);

  const handleUseMeasurements = async () => {
    if (savingMeasurements) {
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      showToast('Please sign in first.', 'error');
      navigate('/login');
      return;
    }

    const hasCompleteScan =
      hasCapturedImage(frontImage || capturedFrontImage) &&
      hasCapturedImage(sideImage || capturedSideImage) &&
      hasMeasurementValues(measurements);
    if (!hasCompleteScan) {
      setErrorMsg('Complete both photos and wait for a valid scan result before continuing.');
      showToast('Complete both photos and wait for a valid scan result before continuing.', 'error');
      return;
    }

    const sanitizedMeasurements = measurements ? sanitizeMeasurements(measurements) : null;
    if (
      !sanitizedMeasurements ||
      !sanitizedMeasurements.chest ||
      !sanitizedMeasurements.waist ||
      !sanitizedMeasurements.shoulders
    ) {
      setErrorMsg('Invalid scan. Please retake both images.');
      showToast('Invalid scan. Please retake both images.', 'error');
      return;
    }

    setSavingMeasurements(true);
    const firestoreMeasurements = buildFirestoreMeasurements(sanitizedMeasurements);

    setUserProfile(prev => ({
      ...prev,
      smartFit: firestoreMeasurements,
      measurements: sanitizedMeasurements,
    }));

    // Only sync to Firestore if we have a real Firebase user (not demo-only)
    if (user) {
      void withTimeout(
        setDoc(doc(db, 'users', user.uid), {
          smartFit: firestoreMeasurements,
          measurements: firestoreMeasurements,
        }, { merge: true }),
        SAVE_SYNC_TIMEOUT_MS,
        'Profile sync is taking longer than expected.',
      ).catch((error) => {
        console.error('Failed to sync Smart Fit measurements:', error);
        showToast('Measurements filled locally. Profile sync is still pending.', 'info');
      });
    }

    showToast('Measurements auto-filled using AI!', 'success');
    navigate('/fit-profile', {
      state: {
        smartFitCompleted: true,
        measurements: sanitizedMeasurements,
      },
      replace: true,
    });
  };

  const currentImage = step === 2 ? (frontPreview || capturedFrontImage) : step === 3 ? (sidePreview || capturedSideImage) : null;
  const hasCompleteScan =
    hasCapturedImage(frontImage || capturedFrontImage) &&
    hasCapturedImage(sideImage || capturedSideImage) &&
    hasMeasurementValues(measurements);
  const showApproximateFitBadge = isFiniteNumber(measurements?.confidence) && measurements.confidence < 0.7;
  const isReadyToProceed =
    (step === 1 && Boolean(heightCm)) ||
    (step === 2 && hasCapturedImage(frontImage || capturedFrontImage)) ||
    (step === 3 && hasCapturedImage(frontImage || capturedFrontImage) && hasCapturedImage(sideImage || capturedSideImage));

  if (step === 4) {
    return (
      <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
        <AppBar title="Your measurements" hideBack trailing={
          <button onClick={handleBack} aria-label="Close" className="h-9 w-9 rounded-full border border-line flex items-center justify-center text-ink-soft press-icon">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        } />
        <div className="flex-1 overflow-y-auto px-6 py-8 pb-36">
          <Eyebrow className="text-center mb-3">Estimated via AI</Eyebrow>
          <h2 className="display-1 text-center mb-8">
            Body <em className="font-medium">measurements.</em>
          </h2>
          {showApproximateFitBadge && (
            <div className="mb-6 rounded-2xl border border-warning/25 bg-warning-soft px-4 py-3 text-center text-[13px] text-warning">
              Approximate fit — improve posture for better accuracy
            </div>
          )}
          <div className="flex flex-col rounded-card border border-line bg-surface-1 px-5">
            {measurements ? (
              Object.entries({
                Chest: measurements.chest,
                Waist: measurements.waist,
                Shoulders: measurements.shoulders,
                Arms: measurements.arms ?? '--',
                Legs: measurements.legs ?? '--',
                Torso: measurements.torso ?? '--'
              }).map(([label, val]) => (
                <div key={label} className="py-4 flex items-baseline justify-between border-b border-line last:border-none">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">{label}</span>
                  <span className="font-display text-[24px] font-medium text-ink">
                    {val} <span className="text-[12px] font-sans font-normal text-ink-faint">cm</span>
                  </span>
                </div>
              ))
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-16 opacity-70">
                <Spinner size={28} className="text-ink-faint mb-4" />
                <p className="eyebrow">Processing…</p>
              </div>
            )}
          </div>
          <p className="text-center text-[11px] text-ink-faint mt-6 px-4 leading-relaxed">
            Measurements are estimated based on your input and images. Accuracy may vary depending on clothing and camera angle.
          </p>
        </div>
        <div className="fixed bottom-0 inset-x-0 z-50 w-full px-6 pb-8 pt-5 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent phone-fixed-bottom">
          <Button
            size="lg"
            fullWidth
            loading={savingMeasurements}
            disabled={!hasCompleteScan || savingMeasurements}
            onClick={handleUseMeasurements}
          >
            Use these measurements
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink">
      <AppBar title="Smart Fit Scan" onBack={handleBack} />

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-6 text-center">
          <Spinner size={36} className="text-brand mb-7" />
          <Eyebrow className="mb-3">The scan</Eyebrow>
          <h2 className="display-2 mb-2">Reading your <em className="font-medium">geometry.</em></h2>
          <p className="text-ink-soft text-[13.5px]">Extracting keypoints and dimensions</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col px-6 py-6">
          <div className="mb-6">
            {/* Segmented progress — forward motion, one bar per step */}
            <div className="flex gap-1.5 mb-3" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3} aria-label={`Step ${step} of 3`}>
              {[1, 2, 3].map(s => (
                <div key={s} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${s <= step ? 'bg-brand' : 'bg-surface-3'}`} />
              ))}
            </div>
            <div className="flex items-center gap-2 mb-3">
              <Eyebrow>Step {step} of 3</Eyebrow>
              {step > 1 && <span className="material-symbols-outlined filled text-success text-[15px]" aria-hidden="true">check_circle</span>}
            </div>
            <h2 className="display-2 mb-2">
              {step === 1 ? <>What is your <em className="font-medium">height?</em></> : <>Capture your <em className="font-medium">{step === 2 ? 'front.' : 'profile.'}</em></>}
            </h2>
            <p className="text-ink-soft text-[13.5px]">
              {step === 1 && 'We use this to scale your measurements accurately.'}
              {step === 2 && 'Stand straight and capture your front view.'}
              {step === 3 && 'Turn to the side and capture your side view.'}
            </p>
          </div>

          {errorMsg && (
            <div className="bg-danger-soft border border-danger/25 rounded-2xl p-4 mb-6" role="alert">
              <p className="text-danger text-[13px] text-center font-medium">{errorMsg}</p>
            </div>
          )}

          {step === 1 ? (
            <div className="flex-1 flex flex-col justify-center">
              <div className="relative mb-8">
                <input
                  type="number"
                  inputMode="numeric"
                  enterKeyHint="next"
                  min={50}
                  max={250}
                  aria-label="Height in centimetres"
                  value={heightCm}
                  onChange={(e) => {
                    const nextHeight = e.target.value;
                    setHeightCm(nextHeight);

                    const parsedHeight = parseFloat(nextHeight);
                    updateHeight(Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : 0);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && heightCm) handleNextStep(); }}
                  placeholder="175"
                  className="w-full h-20 bg-surface-1 border border-line rounded-card px-5 pr-16 text-ink font-display font-medium text-[34px] placeholder:text-ink-faint focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow] text-center"
                />
                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-ink-faint text-[13px] font-semibold uppercase tracking-[0.1em]">cm</span>
              </div>
            </div>
          ) : (
            <div
              onClick={!isCameraOn && !currentImage ? startCamera : undefined}
              className={`flex-1 bg-surface-1 border border-dashed rounded-card flex flex-col items-center justify-center relative overflow-hidden mb-8 transition-all ${
                !isCameraOn && !currentImage ? 'border-line-strong press-soft cursor-pointer' : 'border-transparent'
              }`}
            >
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                id="upload-front"
                ref={currentUploadType === 'front' ? fileInputRef : undefined}
                onChange={(e) => handleImageUpload("front", e)}
              />
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                id="upload-side"
                ref={currentUploadType === 'side' ? fileInputRef : undefined}
                onChange={(e) => handleImageUpload("side", e)}
              />

              {isCameraOn ? (
                <div className="absolute inset-0 w-full h-full bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100" />
                  <div className="absolute inset-0 flex justify-center items-center pointer-events-none opacity-[0.4]">
                    <svg width="150" height="400" viewBox="0 0 150 400" fill="none" stroke="white" strokeWidth="2" strokeDasharray="8 8">
                      <path d="M75 20 C 50 20, 50 70, 75 70 C 100 70, 100 20, 75 20" />
                      <path d="M50 70 L 20 150 L 30 150 L 50 100 L 50 200 L 75 250 L 100 200 L 100 100 L 120 150 L 130 150 L 100 70 Z" />
                      <path d="M50 200 L 40 380 L 60 380 L 75 250 L 90 380 L 110 380 L 100 200" />
                    </svg>
                  </div>
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
                    <button onClick={handleCapture} aria-label="Capture photo" className="h-16 w-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border-2 border-white shadow-xl press-icon cursor-pointer z-20">
                      <div className="h-12 w-12 rounded-full bg-white shadow-inner"></div>
                    </button>
                    <label htmlFor={step === 2 ? "upload-front" : "upload-side"} onClick={(e) => e.stopPropagation()} className={`${overlayPillCls} z-20`}>
                      <span className="material-symbols-outlined text-white text-[15px]" aria-hidden="true">upload</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white">{step === 2 ? 'Upload front photo' : 'Upload side photo'}</span>
                    </label>
                  </div>
                </div>
              ) : currentImage ? (
                <div className="absolute inset-0 w-full h-full">
                  <img src={currentImage} alt="Preview" className="w-full h-full object-cover transform -scale-x-100" />
                  <div className="absolute inset-0 bg-black/20 pointer-events-none"></div>
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-20">
                    <button onClick={handleRetake} className={overlayPillCls}>
                      <span className="material-symbols-outlined text-white text-[15px]" aria-hidden="true">refresh</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white">Retake photo</span>
                    </button>
                    <label htmlFor={step === 2 ? "upload-front" : "upload-side"} onClick={(e) => e.stopPropagation()} className={overlayPillCls}>
                      <span className="material-symbols-outlined text-white text-[15px]" aria-hidden="true">upload</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white">{step === 2 ? 'Upload front photo' : 'Upload side photo'}</span>
                    </label>
                  </div>
                </div>
              ) : (
                <>
                  <div className="z-10 flex flex-col items-center">
                    <div className="h-16 w-16 rounded-full border border-line-strong flex items-center justify-center mb-4">
                      <span className="material-symbols-outlined text-[28px] text-ink-faint" aria-hidden="true">videocam</span>
                    </div>
                    <p className="text-ink font-semibold text-[15px] mb-1">Tap to open camera</p>
                    <p className="text-ink-faint text-[12px]">Allow access when prompted</p>
                    {cameraError && (
                      <p className="text-danger text-[12px] mt-3 bg-danger-soft px-3 py-1 rounded-full border border-danger/25">
                        Camera blocked. Tap to upload instead.
                      </p>
                    )}
                    <label htmlFor={step === 2 ? "upload-front" : "upload-side"} onClick={(e) => e.stopPropagation()} className="mt-5 border border-line-strong px-5 py-3 rounded-full flex items-center gap-2 press cursor-pointer">
                      <span className="material-symbols-outlined text-ink-soft text-[15px]" aria-hidden="true">upload</span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">{step === 2 ? 'Upload front photo' : 'Upload side photo'}</span>
                    </label>
                  </div>
                  <div className="absolute inset-0 flex justify-center items-center pointer-events-none opacity-[0.08]">
                    <svg width="150" height="400" viewBox="0 0 150 400" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="8 8">
                      <path d="M75 20 C 50 20, 50 70, 75 70 C 100 70, 100 20, 75 20" />
                      <path d="M50 70 L 20 150 L 30 150 L 50 100 L 50 200 L 75 250 L 100 200 L 100 100 L 120 150 L 130 150 L 100 70 Z" />
                      <path d="M50 200 L 40 380 L 60 380 L 75 250 L 90 380 L 110 380 L 100 200" />
                    </svg>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {!isCameraOn && (
              <Button
                size="lg"
                fullWidth
                variant={isReadyToProceed ? 'primary' : 'outline'}
                trailingIcon={isReadyToProceed ? 'arrow_forward' : undefined}
                disabled={step === 1 && !heightCm}
                onClick={isReadyToProceed ? handleNextStep : (step > 1 ? startCamera : undefined)}
              >
                {isReadyToProceed ? 'Continue' : (step === 1 ? 'Next' : step === 2 ? 'Capture front view' : 'Capture side view')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartFitScan;
