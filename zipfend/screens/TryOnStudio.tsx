import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../contexts/ToastContext';
import { AppBar, Button, IconButton, Chip, Eyebrow, ProgressRing, springs } from '../components/ui';
import {
  startTryOn,
  waitForTryOn,
  TryOnAvatarMissingError,
  TryOnPollingCancelledError,
  type ClothType,
  type TryOnEngine,
  type TryOnQuality,
} from '../services/tryonService';
import { recordJourneyEvent } from '../services/styleJourney';
import { toImageDataUrl } from '../utils/media';

// Persist the running job id so the generation survives page refresh,
// minimize, or the phone locking — the server keeps rendering meanwhile.
const ACTIVE_JOB_KEY = 'zipright_active_tryon_job';

const CLOTH_TYPES: { value: ClothType; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'upper_body', label: 'Top' },
  { value: 'lower_body', label: 'Bottom' },
  { value: 'dress', label: 'Dress' },
];

const QUALITIES: { value: TryOnQuality; label: string; hint: string }[] = [
  { value: 'fast', label: 'Fast', hint: '~1 min' },
  { value: 'hd', label: 'HD', hint: '~2 min' },
  { value: '2k', label: 'Max', hint: '~3 min' },
];

// Rotating anticipation copy while the AI renders.
const WAIT_HINTS = [
  'Fitting the garment to your pose…',
  'Matching fabric drape and lighting…',
  'Preserving your face and hands…',
  'Sharpening fabric details…',
  'Almost there — final compositing…',
];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const VTO_UPLOAD_MAX_DIMENSION = 2048;
const VTO_UPLOAD_QUALITY = 0.9;

async function fileToDataUrl(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large (max 10 MB).');
  }

  // Preserve 2K-quality source detail while avoiding a full-resolution base64
  // copy in React state and the try-on request body.
  return toImageDataUrl(file, VTO_UPLOAD_MAX_DIMENSION, VTO_UPLOAD_QUALITY);
}

const TryOnStudio: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const incomingProduct = location.state?.product;

  const [personPreview, setPersonPreview] = useState<string | null>(null);
  const [garmentPreview, setGarmentPreview] = useState<string | null>(
    incomingProduct?.image || null
  );
  const [garmentIsUpload, setGarmentIsUpload] = useState(false);
  const [clothType, setClothType] = useState<ClothType>('auto');
  const [quality, setQuality] = useState<TryOnQuality>('hd');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('Starting');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [engine, setEngine] = useState<TryOnEngine | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [selectedSize, setSelectedSize] = useState('M');
  const passedProduct = incomingProduct;

  const loadDemoPresets = async () => {
    setLoadingPresets(true);
    try {
      const demoModelUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop';
      const demoGarmentUrl = 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop';

      const modelRes = await fetch(demoModelUrl);
      const modelBlob = await modelRes.blob();
      const modelDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not encode demo model'));
        reader.readAsDataURL(modelBlob);
      });

      setPersonPreview(modelDataUrl);
      setGarmentPreview(demoGarmentUrl);
      setGarmentIsUpload(false);
      setResultUrl(null);
      showToast('Demo presets loaded successfully', 'success');
    } catch (err: any) {
      console.error('Failed to load demo presets:', err);
      showToast('Failed to load demo presets. Please try uploading manually.', 'error');
    } finally {
      setLoadingPresets(false);
    }
  };

  const personInputRef = useRef<HTMLInputElement>(null);
  const garmentInputRef = useRef<HTMLInputElement>(null);
  const activePollRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activePollRef.current?.abort();
    };
  }, []);

  // Rotate anticipation hints during generation
  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => setHintIndex((i) => (i + 1) % WAIT_HINTS.length), 4000);
    return () => clearInterval(id);
  }, [generating]);

  const trackJob = async (jobId: string) => {
    activePollRef.current?.abort();
    const controller = new AbortController();
    activePollRef.current = controller;
    if (mountedRef.current) setGenerating(true);
    try {
      const result = await waitForTryOn(jobId, (pct, stageLabel) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setProgress(pct);
        if (stageLabel) setStage(stageLabel);
      }, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setResultUrl(result.imageUrl);
      setEngine(result.engine);
      recordJourneyEvent('tryon_generated');
    } catch (error: any) {
      if (error instanceof TryOnPollingCancelledError || controller.signal.aborted) {
        return;
      }
      if (!mountedRef.current) return;
      if (error instanceof TryOnAvatarMissingError) {
        showToast('Upload a photo of yourself first', 'error');
      } else {
        console.error('Try-on failed:', error);
        showToast(error?.message || 'Try-on failed. Please try again.', 'error');
      }
    } finally {
      if (activePollRef.current === controller) {
        activePollRef.current = null;
        if (!controller.signal.aborted) {
          localStorage.removeItem(ACTIVE_JOB_KEY);
          if (mountedRef.current) setGenerating(false);
        }
      }
    }
  };

  const cancelGeneration = () => {
    activePollRef.current?.abort();
    activePollRef.current = null;
    localStorage.removeItem(ACTIVE_JOB_KEY);
    if (mountedRef.current) {
      setGenerating(false);
      setProgress(0);
      showToast('Try-on cancelled', 'info');
    }
  };

  // Resume a job that was running when the app was closed/minimized.
  useEffect(() => {
    const pendingJob = localStorage.getItem(ACTIVE_JOB_KEY);
    if (pendingJob) {
      setProgress(0);
      setStage('Reconnecting to your render');
      trackJob(pendingJob);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickImage = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'person' | 'garment'
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (target === 'person') {
        setPersonPreview(dataUrl);
      } else {
        setGarmentPreview(dataUrl);
        setGarmentIsUpload(true);
      }
      setResultUrl(null);
    } catch (error: any) {
      showToast(error?.message || 'Could not load the image', 'error');
    }
  };

  const generate = async () => {
    if (generating) return;
    if (!garmentPreview) {
      showToast('Add a garment photo first', 'error');
      return;
    }
    setProgress(0);
    setStage('Starting');
    setGenerating(true);
    try {
      const jobId = await startTryOn({
        // person: uploaded photo wins; otherwise backend uses the saved avatar
        personImage: personPreview || undefined,
        garmentImage: garmentIsUpload ? garmentPreview : undefined,
        productImageUrl: garmentIsUpload ? undefined : garmentPreview,
        clothType,
        quality,
      }, activePollRef.current?.signal);
      localStorage.setItem(ACTIVE_JOB_KEY, jobId);
      if (!mountedRef.current) return;
      await trackJob(jobId);
    } catch (error: any) {
      if (!mountedRef.current) return;
      setGenerating(false);
      if (error instanceof TryOnAvatarMissingError) {
        showToast('Upload a photo of yourself first', 'error');
        return;
      }
      console.error('Try-on failed to start:', error);
      showToast(error?.message || 'Could not start try-on.', 'error');
    }
  };

  const shareResult = async () => {
    if (!resultUrl) return;
    try {
      if (navigator.share) {
        // Share the rendered look; falls back to copying the link.
        const response = await fetch(resultUrl);
        const blob = await response.blob();
        const file = new File([blob], 'zipright-tryon.png', { type: blob.type || 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'My ZipRIGHT look' });
          return;
        }
        await navigator.share({ title: 'My ZipRIGHT look', url: resultUrl });
      } else {
        await navigator.clipboard.writeText(resultUrl);
        showToast('Link copied to clipboard!', 'success');
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        showToast('Could not share the image.', 'error');
      }
    }
  };

  const inputCard = (
    label: string,
    preview: string | null,
    onPick: () => void,
    icon: string,
    hint: string
  ) => (
    <button
      onClick={onPick}
      aria-label={preview ? `${label} photo added. Tap to replace` : `Add ${label.toLowerCase()} photo`}
      className="relative flex-1 aspect-[3/4] rounded-card border border-line bg-surface-2 overflow-hidden active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {preview ? (
        <img src={preview} decoding="async" className="absolute inset-0 h-full w-full object-cover" alt="" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4">
          <div className="h-12 w-12 rounded-full bg-brand/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px] text-brand" aria-hidden="true">{icon}</span>
          </div>
          <span className="text-[12px] text-ink-soft text-center leading-relaxed">{hint}</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 py-2 bg-black/60 backdrop-blur-sm">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-invert">{label}</span>
      </div>
      {preview && (
        <div className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center">
          <span className="material-symbols-outlined text-[14px] text-ink-invert" aria-hidden="true">edit</span>
        </div>
      )}
    </button>
  );

  return (
    <div className="flex flex-col min-h-screen min-h-dvh bg-surface-0 text-ink font-sans">
      <input ref={personInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, 'person')} />
      <input ref={garmentInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, 'garment')} />

      <AppBar title="Try-On Studio" onBack={() => navigate(-1)} />

      <div className="flex-1 px-6 py-6 pb-40 space-y-8 overflow-y-auto no-scrollbar">
        {/* Canvas: result or live generation */}
        <AnimatePresence mode="wait">
          {(resultUrl || generating) && (
            <motion.div
              key={generating ? 'generating' : 'result'}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={springs.gentle}
              className="relative h-[72dvh] min-h-[470px] max-h-[660px] w-full overflow-hidden bg-black mx-auto shadow-elev-float flex flex-col"
            >
              {resultUrl && !generating && (
                <>
                  <button
                    onClick={() => setViewerOpen(true)}
                    className="relative flex-1 w-full overflow-hidden bg-black"
                    aria-label="View result full screen"
                  >
                    <motion.img
                      initial={{ opacity: 0, scale: 1.04 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      src={resultUrl}
                      decoding="async"
                      className="h-full w-full object-cover"
                      alt="Try-on result"
                    />
                    <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-success" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white">
                        98% Fit Match
                      </span>
                    </div>
                  </button>

                  {/* Clean Result Information Card */}
                  <div className="absolute inset-x-0 bottom-0 p-4 pt-12 bg-gradient-to-t from-black via-black/95 to-transparent flex flex-col gap-3 text-white">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-on-media">Recommended size · M</p>
                        <h3 className="font-display text-[19px] font-medium text-white line-clamp-1">
                          {passedProduct?.title || passedProduct?.brand || 'Luxury Tailored Piece'}
                        </h3>
                        <p className="text-[14px] font-medium text-white/75">{passedProduct?.brand || 'ZipRIGHT edit'} · {passedProduct?.price || '₹3,990'}</p>
                      </div>
                      <button
                        onClick={() => showToast('Saved to Wishlist', 'success')}
                        className="h-9 w-9 rounded-full border border-white/35 flex items-center justify-center text-white active:scale-90 transition-transform"
                      >
                        <span className="material-symbols-outlined text-[18px]">favorite_border</span>
                      </button>
                    </div>

                    {/* Size Selector */}
                    <div className="flex gap-2">
                      {['S', 'M', 'L', 'XL'].map((s) => (
                        <button
                          key={s}
                          onClick={() => setSelectedSize(s)}
                          className={`flex-1 py-1.5 rounded-xl text-[12px] font-semibold transition-colors ${selectedSize === s ? 'bg-white text-black' : 'bg-white/15 text-white hover:bg-white/25'}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>

                    {/* CTAs: Buy Now + Try Again */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        fullWidth
                        size="sm"
                        onClick={generate}
                        loading={generating}
                      >
                        Try Again
                      </Button>
                      <Button
                        variant="primary"
                        fullWidth
                        size="sm"
                        icon="shopping_bag"
                        onClick={() => {
                          showToast('Added to Cart', 'success');
                          navigate('/cart');
                        }}
                      >
                        Buy Now
                      </Button>
                    </div>
                  </div>
                </>
              )}
              {generating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-surface-0/95 backdrop-blur-md px-8">
                  <motion.div
                    aria-hidden="true"
                    className="absolute h-56 w-56 rounded-full bg-brand/20 blur-3xl"
                    animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <ProgressRing value={progress} size={132} strokeWidth={6} color="var(--brand)" aria-label="Render progress">
                    <div className="text-center">
                      <span className="block font-display text-[30px] font-medium text-ink leading-none">{progress}%</span>
                    </div>
                  </ProgressRing>
                  <div className="text-center relative z-10">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">
                      AI Fitting Engine
                    </span>
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={hintIndex}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.4 }}
                        className="block mt-2 text-[13px] text-ink font-medium"
                      >
                        {WAIT_HINTS[hintIndex]}
                      </motion.span>
                    </AnimatePresence>
                    <button
                      type="button"
                      onClick={cancelGeneration}
                      className="mt-4 px-4 py-1.5 rounded-full border border-line bg-surface-1 text-ink text-[12px] font-semibold hover:bg-surface-2 transition-colors shadow-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inputs */}
        <div className="flex gap-4 max-w-sm mx-auto">
          {inputCard(
            'You',
            personPreview,
            () => personInputRef.current?.click(),
            'person',
            'Tap to upload a full-body photo (or leave empty to use your avatar)'
          )}
          {inputCard(
            'Garment',
            garmentPreview,
            () => garmentInputRef.current?.click(),
            'checkroom',
            'Tap to upload the garment photo'
          )}
        </div>

        {/* Demo Presets Trigger */}
        <div className="flex justify-center max-w-sm mx-auto">
          <button
            onClick={loadDemoPresets}
            disabled={loadingPresets}
            className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand hover:text-brand-strong disabled:opacity-40 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">{loadingPresets ? 'sync' : 'auto_awesome'}</span>
            {loadingPresets ? 'Loading presets...' : 'Use Demo Presets'}
          </button>
        </div>

        {/* Cloth type */}
        <div className="max-w-sm mx-auto">
          <Eyebrow className="mb-2.5" id="cloth-type-label">Garment Type</Eyebrow>
          <div className="flex gap-2" role="group" aria-labelledby="cloth-type-label">
            {CLOTH_TYPES.map(({ value, label }) => (
              <Chip
                key={value}
                selected={clothType === value}
                onClick={() => setClothType(value)}
                className="flex-1"
              >
                {label}
              </Chip>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div className="max-w-sm mx-auto">
          <Eyebrow className="mb-2.5" id="quality-label">Quality</Eyebrow>
          <div className="flex gap-2" role="group" aria-labelledby="quality-label">
            {QUALITIES.map(({ value, label, hint }) => (
              <button
                key={value}
                onClick={() => setQuality(value)}
                aria-pressed={quality === value}
                className={`flex-1 py-2.5 rounded-ctl border transition-[transform,background-color,border-color,color] flex flex-col items-center gap-0.5 active:scale-[0.96] ${
                  quality === value
                    ? 'bg-brand text-on-brand border-brand'
                    : 'bg-surface-2 text-ink-soft border-line'
                }`}
              >
                <span className="text-[12px] font-semibold">{label}</span>
                <span className={`text-[11px] ${quality === value ? 'text-on-brand/70' : 'text-ink-faint'}`}>{hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Fullscreen viewer: the render is ~2K, let people actually see it */}
      <AnimatePresence>
        {viewerOpen && resultUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black flex items-center justify-center"
            onClick={() => setViewerOpen(false)}
          >
            <motion.img
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              transition={springs.gentle}
              src={resultUrl}
              decoding="async"
              className="max-h-full max-w-full object-contain"
              alt="Try-on result full screen"
            />
            <IconButton
              icon="close"
              aria-label="Close full screen"
              variant="overlay"
              className="absolute top-5 right-5"
              onClick={() => setViewerOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generate */}
      <div className="fixed bottom-0 inset-x-0 w-full px-6 pb-8 pt-5 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent z-50 phone-fixed-bottom">
        <Button
          variant="accent"
          size="lg"
          fullWidth
          onClick={generate}
          disabled={generating || !garmentPreview}
          loading={generating}
          trailingIcon="auto_awesome"
        >
          {resultUrl ? 'Try Again' : 'Generate Try-On'}
        </Button>
      </div>
    </div>
  );
};

export default TryOnStudio;
