import type {
  SizeEngineBaseSize,
  SizeEngineFitPreference,
} from '../utils/sizeProfile';
import { getAuth, signInAnonymously } from 'firebase/auth';

const DEMO_AUTH_KEY = 'zipright_demo_user';

function hasDemoSession() {
  return Boolean(localStorage.getItem(DEMO_AUTH_KEY));
}

export interface BackendProduct {
  id: string;
  title: string;
  brand: string;
  category: string;
  price?: string;
  image?: string;
  url: string;
  source: 'link' | 'amazon' | 'flipkart';
  confidence: number;
  fit_hint?: string | null;
  size_chart?: Record<string, number> | null;
  available_sizes?: string[] | null;
  size_format?: string | null;
}

export interface BackendSizeResult {
  size: string;
  confidence: number;
  risk: string;
  reason: string;
}

export interface PredictSizeMeasurements {
  chest?: number;
  waist?: number;
  shoulders?: number;
  arms?: number;
  legs?: number;
  torso?: number;
  hips?: number;
  bust?: number;
}

export interface PredictSizeResult {
  size: string;
  confidence: number;
  risk?: string;
  reason?: string;
}

export interface SmartFitMeasurements extends PredictSizeMeasurements {
  confidence: number;
}

export interface SmartFitScanResult {
  isValid: boolean;
  message?: string | null;
  measurements?: SmartFitMeasurements | null;
}

const configuredApiBase = (import.meta.env.VITE_API_URL || '').trim();
function stripTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function getDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return configuredApiBase;
  }

  return `${window.location.protocol}//${window.location.hostname}:8000`;
}

export const API_BASE = stripTrailingSlashes(configuredApiBase || getDefaultApiBaseUrl());

export function getBackendBaseUrl() {
  return API_BASE;
}

const auth = getAuth();

async function ensureAuthUser() {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  // If we have a demo session but no Firebase user, try anonymous sign-in
  // to get a real Firebase token for API calls
  if (hasDemoSession()) {
    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (err) {
      console.warn('[ziprightApi] Anonymous auth failed, proceeding without token:', err);
      return null;
    }
  }

  return null;
}

async function authorizedFetch(url: string, options: any = {}) {
  const user = await ensureAuthUser();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (user) {
    const token = await user.getIdToken(true);
    headers['Authorization'] = `Bearer ${token}`;
  } else if (!hasDemoSession()) {
    throw new Error('User not authenticated');
  }
  // If demo session but no Firebase user, proceed without auth header
  // The backend will need to handle this case

  return fetch(url, {
    ...options,
    headers,
  });
}

export function normalizeUrl(input: string): string {
  let url = input.trim();

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  return url;
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function validateProductUrl(input: string): string {
  const normalizedUrl = normalizeUrl(input);

  if (!isValidUrl(normalizedUrl)) {
    throw new Error('Enter a valid product URL.');
  }

  const parsed = new URL(normalizedUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS links are supported.');
  }

  const finalUrl = parsed.toString();
  console.log('FINAL PRODUCT URL:', finalUrl);
  return finalUrl;
}

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }) {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await authorizedFetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    console.error('[ziprightApi] request failed:', { url, error });
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    if (error instanceof TypeError) {
      throw new Error(`Network error: ${error.message}`);
    }
    throw error;
  }
}

async function postRecommendationWithTimeout(
  url: string,
  payload: unknown,
  headers: HeadersInit,
  timeoutMs = 2000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await authorizedFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error?.name === 'AbortError') {
      console.log('TIMEOUT -> request aborted');
      throw new Error('timeout');
    }

    console.error('[ziprightApi] recommendation request failed:', { url, error });
    if (error instanceof TypeError) {
      throw new Error(`Network error: ${error.message}`);
    }
    throw error;
  }
}

function readApiErrorMessage(response: Response, payload: any, defaultMessage: string) {
  if (payload?.isValid === false && typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  const details = payload?.details ?? payload?.error?.details ?? payload?.detail;
  const detailMessage = Array.isArray(details)
    ? details
        .map((item) => {
          const field = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : null;
          const msg = typeof item?.msg === 'string' ? item.msg : null;
          if (field && msg) {
            return `${field}: ${msg}`;
          }
          return msg || null;
        })
        .filter(Boolean)
        .join(', ')
    : typeof details === 'string'
    ? details
    : null;
  const message = payload?.message || payload?.error?.message || detailMessage || defaultMessage;
  if (response.status >= 500) {
    return payload?.message || payload?.error?.message || defaultMessage;
  }
  const code = payload?.details?.code || payload?.error?.details?.code;
  if (code === 'extraction_unavailable') {
    return 'Data unavailable';
  }
  return message;
}

async function parseJsonResponse(response: Response) {
  return response.json().catch(() => null);
}

const toBase64 = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });

function ensureScanImageDataUrl(value: string, label: 'Front' | 'Side') {
  const normalizedValue = value.trim();
  if (!normalizedValue.startsWith('data:image/')) {
    throw new Error(`${label} image must be a valid base64 image.`);
  }
  return normalizedValue;
}

function isEmptyScanImage(image: string | File | Blob | null | undefined) {
  if (!image) {
    return true;
  }
  if (typeof image === 'string') {
    return image.trim().length === 0;
  }
  return image.size === 0;
}

export async function processSmartFitScan({
  frontImage,
  sideImage,
  height,
}: {
  height: number;
  frontImage: string | File | Blob;
  sideImage: string | File | Blob;
}): Promise<SmartFitScanResult> {
  if (isEmptyScanImage(frontImage) || isEmptyScanImage(sideImage)) {
    return {
      isValid: false,
      message: 'No image detected',
      measurements: null,
    };
  }

  const apiUrl = `${getBackendBaseUrl()}/smart-fit/measurements`;
  const frontBase64 =
    typeof frontImage === 'string'
      ? frontImage
      : await toBase64(frontImage);
  const sideBase64 =
    typeof sideImage === 'string'
      ? sideImage
      : await toBase64(sideImage);
  const normalizedHeight = Number(height);
  const scanPayload = {
    front_image: ensureScanImageDataUrl(frontBase64, 'Front'),
    side_image: ensureScanImageDataUrl(sideBase64, 'Side'),
    height: normalizedHeight,
  };

  if (!scanPayload.front_image || !scanPayload.side_image) {
    throw new Error('Please capture front and side images.');
  }
  if (!Number.isFinite(scanPayload.height) || scanPayload.height <= 0) {
    throw new Error('Please enter a valid height.');
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      body: JSON.stringify(scanPayload),
      timeout: 60000,
    });
  } catch (error: any) {
    throw new Error(error?.message || 'We could not analyze your photos. Please try again.');
  }

  const data = await parseJsonResponse(res);

  if (!res.ok || !data?.data) {
    throw new Error(
      readApiErrorMessage(
        res,
        data,
        'We could not analyze your photos. Retake both pictures in good lighting and try again.',
      ),
    );
  }

  const scanResult = data.data as SmartFitScanResult;
  if (typeof scanResult?.isValid !== 'boolean') {
    throw new Error('Invalid scan response.');
  }

  if (
    scanResult.isValid &&
    (!scanResult.measurements || Object.keys(scanResult.measurements).length === 0)
  ) {
    throw new Error('Invalid scan response.');
  }

  return scanResult;
}

export async function extractProduct(url: string): Promise<BackendProduct> {
  const apiUrl = `${getBackendBaseUrl()}/extract-product`;
  let response: Response;
  const normalizedUrl = validateProductUrl(url);

  try {
    response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      body: JSON.stringify({ url: normalizedUrl }),
      timeout: 10000,
    });
  } catch (error: any) {
    console.error('[ziprightApi] extractProduct failed:', error);
    throw new Error(error?.message || 'Data unavailable');
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok || !payload?.data) {
    throw new Error(readApiErrorMessage(response, payload, 'Data unavailable'));
  }
  return payload.data as BackendProduct;
}

export async function recommendSize(input: {
  product: BackendProduct;
  profile: {
    base_size: SizeEngineBaseSize;
    fit_preference: SizeEngineFitPreference;
  };
}): Promise<BackendSizeResult> {
  const apiUrl = `${getBackendBaseUrl()}/size-engine`;
  let response: Response;

  try {
    response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      body: JSON.stringify(input),
      timeout: 10000,
    });
  } catch (error: any) {
    console.error('[ziprightApi] recommendSize failed:', error);
    throw new Error(error?.message || 'Processing unavailable');
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok || !payload?.data) {
    throw new Error(readApiErrorMessage(response, payload, 'Processing unavailable'));
  }
  return payload.data as BackendSizeResult;
}

export async function predictSize(input: {
  link: string;
  height: number;
  measurements: PredictSizeMeasurements;
  product?: BackendProduct;
  baseSize?: SizeEngineBaseSize;
  fitPreference?: SizeEngineFitPreference;
  timeoutMs?: number;
}): Promise<PredictSizeResult> {
  const apiUrl = `${getBackendBaseUrl()}/predict-size`;
  let response: Response;
  const normalizedUrl = validateProductUrl(input.link);
  const requestPayload = {
    link: normalizedUrl,
    height: input.height,
    measurements: input.measurements,
    product: input.product,
    base_size: input.baseSize,
    fit_preference: input.fitPreference || 'regular',
  };

  try {
    response = await postRecommendationWithTimeout(
      apiUrl,
      requestPayload,
      {},
      input.timeoutMs ?? 10000,
    );
  } catch (error: any) {
    console.error('[ziprightApi] predictSize failed:', error);
    throw new Error(error?.message || 'Processing unavailable');
  }

  const responsePayload = await parseJsonResponse(response);
  if (!response.ok || !responsePayload?.data) {
    throw new Error(readApiErrorMessage(response, responsePayload, 'Processing unavailable'));
  }
  return responsePayload.data as PredictSizeResult;
}
