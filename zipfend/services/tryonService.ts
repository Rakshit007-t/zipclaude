import { authorizedFetch, getBackendBaseUrl, getCurrentUserId } from './ziprightApi';

export type ClothType = 'upper_body' | 'lower_body' | 'dress' | 'auto';
export type TryOnQuality = 'fast' | 'hd' | '2k';
export type TryOnEngine = 'catvton' | 'catvton_cloud' | 'overlay';

export interface TryOnResult {
  imageUrl: string;
  engine: TryOnEngine;
}

const UPPER_CATEGORIES = ['tshirt', 't-shirt', 'shirt', 'jacket', 'hoodie', 'top', 'sweater', 'kurta', 'blazer', 'coat'];
const LOWER_CATEGORIES = ['pants', 'jeans', 'trousers', 'shorts', 'skirt', 'joggers', 'chinos'];
const DRESS_CATEGORIES = ['dress', 'gown', 'saree', 'jumpsuit', 'one-piece'];

export function categoryToClothType(category?: string | null): ClothType {
  const value = (category || '').trim().toLowerCase();
  if (!value) return 'auto';
  if (UPPER_CATEGORIES.some(c => value.includes(c))) return 'upper_body';
  if (LOWER_CATEGORIES.some(c => value.includes(c))) return 'lower_body';
  if (DRESS_CATEGORIES.some(c => value.includes(c))) return 'dress';
  return 'auto';
}

export interface TryOnJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number; // 0-100
  stage: string;
  engine: TryOnEngine | null;
  imageUrl: string | null;
  error: string | null;
}

export interface TryOnParams {
  productImageUrl?: string;
  clothType?: ClothType;
  quality?: TryOnQuality;
  personImage?: string;
  garmentImage?: string;
}

// Generation runs server-side as a job: it keeps going even if the app is
// minimized or the page closed — reconnecting with the job id resumes it.
const POLL_INTERVAL_MS = 2500;
const MAX_WAIT_MS = 15 * 60 * 1000;

function resolveImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.startsWith('/') ? `${getBackendBaseUrl()}${raw}` : raw;
}

export async function startTryOn({
  productImageUrl,
  clothType = 'auto',
  quality = 'hd',
  personImage,
  garmentImage,
}: TryOnParams): Promise<string> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/tryon-job`, {
    method: 'POST',
    body: JSON.stringify({
      user_id: getCurrentUserId(),
      product_image_url: productImageUrl || '',
      cloth_type: clothType,
      quality,
      ...(personImage ? { person_image: personImage } : {}),
      ...(garmentImage ? { garment_image: garmentImage } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data?.job_id) {
    const message: string = payload?.message || 'Could not start try-on.';
    if (/avatar/i.test(message)) throw new TryOnAvatarMissingError();
    throw new Error(message);
  }
  return payload.data.job_id as string;
}

export async function getTryOnJob(jobId: string): Promise<TryOnJobStatus> {
  const response = await authorizedFetch(
    `${getBackendBaseUrl()}/tryon-job/${encodeURIComponent(jobId)}`,
    { method: 'GET' }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message || 'Try-on job not found.');
  }
  const data = payload.data;
  return {
    jobId: data.job_id,
    status: data.status,
    progress: typeof data.progress === 'number' ? data.progress : 0,
    stage: data.stage || '',
    engine:
      data.engine === 'catvton' || data.engine === 'catvton_cloud' || data.engine === 'overlay'
        ? data.engine
        : null,
    imageUrl: resolveImageUrl(data.tryon_image),
    error: data.error || null,
  };
}

export async function waitForTryOn(
  jobId: string,
  onProgress?: (progress: number, stage: string) => void
): Promise<TryOnResult> {
  const startedAt = Date.now();
  for (;;) {
    const job = await getTryOnJob(jobId);
    onProgress?.(job.progress, job.stage);
    if (job.status === 'done' && job.imageUrl) {
      return { imageUrl: job.imageUrl, engine: job.engine || 'overlay' };
    }
    if (job.status === 'failed') {
      if (/avatar/i.test(job.error || '')) throw new TryOnAvatarMissingError();
      throw new Error(job.error || 'Try-on failed.');
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error('Try-on is taking too long. Check back later — it may still finish.');
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function generateTryOnImage(
  params: TryOnParams,
  onProgress?: (progress: number, stage: string) => void
): Promise<TryOnResult> {
  const jobId = await startTryOn(params);
  return waitForTryOn(jobId, onProgress);
}

export class TryOnAvatarMissingError extends Error {
  constructor() {
    super('No avatar photo found. Create your avatar first.');
    this.name = 'TryOnAvatarMissingError';
  }
}
