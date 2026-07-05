import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import {
  startTryOn,
  waitForTryOn,
  TryOnAvatarMissingError,
  type ClothType,
  type TryOnEngine,
  type TryOnQuality,
} from '../services/tryonService';

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

  const personInputRef = useRef<HTMLInputElement>(null);
  const garmentInputRef = useRef<HTMLInputElement>(null);

  const trackJob = async (jobId: string) => {
    setGenerating(true);
    try {
      const result = await waitForTryOn(jobId, (pct, stageLabel) => {
        setProgress(pct);
        if (stageLabel) setStage(stageLabel);
      });
      setResultUrl(result.imageUrl);
      setEngine(result.engine);
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

  const inputCard = (
    label: string,
    preview: string | null,
    onPick: () => void,
    icon: string,
    hint: string
  ) => (
    <button
      onClick={onPick}
      className="relative flex-1 aspect-[3/4] rounded-3xl border border-white/10 bg-white/5 overflow-hidden active:scale-[0.98] transition-transform"
    >
      {preview ? (
        <img src={preview} className="absolute inset-0 h-full w-full object-cover" alt={label} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
          <span className="material-symbols-outlined text-[32px] text-[#C9A06C]">{icon}</span>
          <span className="text-[10px] text-white/50 text-center leading-relaxed">{hint}</span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 py-2 bg-black/60 backdrop-blur-sm">
        <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-[#C9A06C]">{label}</span>
      </div>
    </button>
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#111111] text-white font-display">
      <input ref={personInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, 'person')} />
      <input ref={garmentInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, 'garment')} />

      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate(-1)} className="h-11 w-11 flex items-center justify-center rounded-full active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[22px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-xs font-bold tracking-[0.3em] uppercase text-[#C9A06C]">Try-On Studio</h1>
        <div className="w-11"></div>
      </div>

      <div className="flex-1 px-6 py-6 pb-28 space-y-6 overflow-y-auto no-scrollbar">
        {/* Result */}
        {(resultUrl || generating) && (
          <div className="relative rounded-3xl overflow-hidden border border-[#C9A06C]/30 bg-black aspect-[3/4] max-w-sm mx-auto">
            {resultUrl && !generating && (
              <>
                <img src={resultUrl} className="h-full w-full object-contain" alt="Try-on result" />
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#C9A06C]">
                    {engine === 'overlay' ? 'Preview' : engine === 'catvton_cloud' ? 'AI Render · Cloud' : 'AI Render · Local'}
                  </span>
                </div>
                <a
                  href={resultUrl}
                  download="zipright-tryon.png"
                  className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#C9A06C]">download</span>
                </a>
              </>
            )}
            {generating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 px-8">
                <span className="text-3xl font-black text-[#C9A06C]">{progress}%</span>
                <div className="w-full max-w-[240px] h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#C9A06C] rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${Math.max(progress, 2)}%` }}
                  ></div>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A06C] text-center">
                  {stage}
                </span>
                <span className="text-[9px] text-white/40 text-center">
                  Keeps rendering even if you minimize or close the app
                </span>
              </div>
            )}
          </div>
        )}

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
          <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/40 mb-2">Garment Type</p>
          <div className="flex gap-2">
            {CLOTH_TYPES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setClothType(value)}
                className={`flex-1 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ${
                  clothType === value
                    ? 'bg-[#C9A06C] text-black border-[#C9A06C]'
                    : 'bg-white/5 text-white/60 border-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div className="max-w-sm mx-auto">
          <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/40 mb-2">Quality</p>
          <div className="flex gap-2">
            {QUALITIES.map(({ value, label, hint }) => (
              <button
                key={value}
                onClick={() => setQuality(value)}
                className={`flex-1 py-2.5 rounded-2xl border transition-all flex flex-col items-center gap-0.5 ${
                  quality === value
                    ? 'bg-[#C9A06C] text-black border-[#C9A06C]'
                    : 'bg-white/5 text-white/60 border-white/10'
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
                <span className={`text-[8px] ${quality === value ? 'text-black/60' : 'text-white/30'}`}>{hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Generate */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#111111] via-[#111111]/90 to-transparent">
        <button
          onClick={generate}
          disabled={generating || !garmentPreview}
          className="w-full max-w-sm mx-auto h-14 rounded-2xl bg-[#C9A06C] text-black font-bold text-xs uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:active:scale-100"
        >
          {generating ? 'Rendering…' : resultUrl ? 'Try Again' : 'Generate Try-On'}
          <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
        </button>
      </div>
    </div>
  );
};

export default TryOnStudio;
