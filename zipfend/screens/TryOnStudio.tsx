import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../contexts/ToastContext';
import { ProgressRing, Chip, springs } from '../components/ui';
import {
  startTryOn,
  waitForTryOn,
  TryOnAvatarMissingError,
  type ClothType,
  type TryOnEngine,
  type TryOnQuality,
} from '../services/tryonService';
import { recordJourneyEvent } from '../services/styleJourney';

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('Image is too large (max 10 MB).'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
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

  const personInputRef = useRef<HTMLInputElement>(null);
  const garmentInputRef = useRef<HTMLInputElement>(null);

  // Rotate anticipation hints during generation
  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => setHintIndex((i) => (i + 1) % WAIT_HINTS.length), 4000);
    return () => clearInterval(id);
  }, [generating]);

  const trackJob = async (jobId: string) => {
    setGenerating(true);
    try {
      const result = await waitForTryOn(jobId, (pct, stageLabel) => {
        setProgress(pct);
        if (stageLabel) setStage(stageLabel);
      });
      setResultUrl(result.imageUrl);
      setEngine(result.engine);
      recordJourneyEvent('tryon_generated');
      if (result.engine === 'overlay') {
        showToast('Quick preview shown — AI engine busy, try again', 'success');
      }
    } catch (error: any) {
      if (error instanceof TryOnAvatarMissingError) {
        showToast('Upload a photo of yourself first', 'error');
      } else {
        console.error('Try-on failed:', error);
        showToast(error?.message || 'Try-on failed. Please try again.', 'error');
      }
    } finally {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      setGenerating(false);
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
      });
      localStorage.setItem(ACTIVE_JOB_KEY, jobId);
      await trackJob(jobId);
    } catch (error: any) {
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
      className="relative flex-1 aspect-[3/4] rounded-3xl border border-line bg-surface-2 overflow-hidden active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6157FF]"
    >
      {preview ? (
        <img src={preview} className="absolute inset-0 h-full w-full object-cover" alt="" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
          <div className="h-12 w-12 rounded-full bg-[#6157FF]/15 flex items-center justify-center">
            <span className="material-symbols-outlined text-[26px] text-[#6157FF]" aria-hidden="true">{icon}</span>
          </div>
          <span className="text-[12px] text-ink-soft text-center leading-relaxed">{hint}</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 py-2 bg-black/60 backdrop-blur-sm">
        <span className="text-[11px] font-bold text-[#6157FF]">{label}</span>
      </div>
      {preview && (
        <div className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center">
          <span className="material-symbols-outlined text-[14px] text-ink" aria-hidden="true">edit</span>
        </div>
      )}
    </button>
  );

  return (
    <div className="flex flex-col min-h-screen bg-surface-0 text-ink font-sans">
      <input ref={personInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, 'person')} />
      <input ref={garmentInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, 'garment')} />

      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5 bg-surface-0/80 backdrop-blur-xl border-b border-line">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="h-11 w-11 flex items-center justify-center rounded-full active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-[22px] text-[#6157FF]" aria-hidden="true">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold text-[#6157FF]">Try-On Studio</h1>
        <div className="w-11"></div>
      </div>

      <div className="flex-1 px-6 py-6 pb-28 space-y-6 overflow-y-auto no-scrollbar">
        {/* Canvas: result or live generation */}
        <AnimatePresence mode="wait">
          {(resultUrl || generating) && (
            <motion.div
              key={generating ? 'generating' : 'result'}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={springs.gentle}
              className="relative rounded-3xl overflow-hidden border border-[#6157FF]/30 bg-black aspect-[3/4] max-w-sm mx-auto"
            >
              {resultUrl && !generating && (
                <>
                  <button
                    onClick={() => setViewerOpen(true)}
                    className="absolute inset-0 h-full w-full"
                    aria-label="View result full screen"
                  >
                    <motion.img
                      initial={{ opacity: 0, scale: 1.04 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      src={resultUrl}
                      className="h-full w-full object-contain"
                      alt="Try-on result"
                    />
                  </button>
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-line pointer-events-none">
                    <span className="text-[11px] font-bold text-[#6157FF]">
                      {engine === 'overlay' ? 'Preview' : engine === 'catvton_cloud' ? 'AI Render · Cloud' : 'AI Render · Local'}
                    </span>
                  </div>
                  <div className="absolute top-3 right-3 flex gap-2">
                    <button
                      onClick={shareResult}
                      aria-label="Share result"
                      className="h-9 w-9 rounded-full bg-black/60 backdrop-blur-md border border-line flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[18px] text-[#6157FF]" aria-hidden="true">ios_share</span>
                    </button>
                    <a
                      href={resultUrl}
                      download="zipright-tryon.png"
                      aria-label="Download result"
                      className="h-9 w-9 rounded-full bg-black/60 backdrop-blur-md border border-line flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[18px] text-[#6157FF]" aria-hidden="true">download</span>
                    </a>
                  </div>
                  <div className="absolute bottom-3 right-3 px-2 py-1 rounded-full bg-black/50 pointer-events-none">
                    <span className="text-[12px] text-ink-soft">Tap to zoom</span>
                  </div>
                </>
              )}
              {generating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/80 px-8">
                  {/* Ambient pulse behind the ring */}
                  <motion.div
                    aria-hidden="true"
                    className="absolute h-56 w-56 rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(97,87,255,0.16), transparent 70%)' }}
                    animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <ProgressRing value={progress} size={132} strokeWidth={6} color="#6157FF" aria-label="Render progress">
                    <div className="text-center">
                      <span className="block text-[28px] font-bold text-[#6157FF] leading-none">{progress}%</span>
                    </div>
                  </ProgressRing>
                  <div className="text-center relative z-10">
                    <span className="block text-[11px] font-bold text-[#6157FF]">
                      {stage}
                    </span>
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={hintIndex}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.4 }}
                        className="block mt-2 text-[11px] text-ink-soft"
                      >
                        {WAIT_HINTS[hintIndex]}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <span className="text-[11px] text-ink-faint text-center relative z-10">
                    Keeps rendering even if you minimize or close the app
                  </span>
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

        {/* Cloth type */}
        <div className="max-w-sm mx-auto">
          <p className="text-[11px] font-bold text-ink-soft mb-2" id="cloth-type-label">Garment Type</p>
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
          <p className="text-[11px] font-bold text-ink-soft mb-2" id="quality-label">Quality</p>
          <div className="flex gap-2" role="group" aria-labelledby="quality-label">
            {QUALITIES.map(({ value, label, hint }) => (
              <button
                key={value}
                onClick={() => setQuality(value)}
                aria-pressed={quality === value}
                className={`flex-1 py-2.5 rounded-2xl border transition-all flex flex-col items-center gap-0.5 active:scale-[0.96] ${
                  quality === value
                    ? 'bg-[#6157FF] text-ink border-[#6157FF]'
                    : 'bg-surface-2 text-ink-soft border-line'
                }`}
              >
                <span className="text-[12px] font-bold">{label}</span>
                <span className={`text-[12px] ${quality === value ? 'text-black/60' : 'text-ink-faint'}`}>{hint}</span>
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
              className="max-h-full max-w-full object-contain"
              alt="Try-on result full screen"
            />
            <button
              onClick={() => setViewerOpen(false)}
              className="absolute top-5 right-5 h-11 w-11 rounded-full bg-surface-2 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform"
              aria-label="Close full screen"
            >
              <span className="material-symbols-outlined text-[22px] text-ink" aria-hidden="true">close</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generate */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-surface-0 via-surface-0/90 to-transparent">
        <button
          onClick={generate}
          disabled={generating || !garmentPreview}
          aria-busy={generating}
          className="w-full max-w-sm mx-auto h-14 rounded-full bg-[#6157FF] text-ink font-bold text-xs shadow-[0_8px_32px_rgba(97,87,255,0.25)] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:active:scale-100 disabled:shadow-none"
        >
          {generating ? 'Rendering…' : resultUrl ? 'Try Again' : 'Generate Try-On'}
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">auto_awesome</span>
        </button>
      </div>
    </div>
  );
};

export default TryOnStudio;
