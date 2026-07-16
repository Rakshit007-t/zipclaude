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
let anonymousAuthFailed = false;

async function ensureAuthUser() {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  // If we have a demo session but no Firebase user, try anonymous sign-in
  // to get a real Firebase token for API calls
  if (hasDemoSession() && !anonymousAuthFailed) {
    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (err) {
      anonymousAuthFailed = true;
      console.warn('[ziprightApi] Anonymous auth failed, proceeding without token:', err);
      return null;
    }
  }

  return null;
}

export function getCurrentUserId(): string {
  return auth.currentUser?.uid || 'demo-anonymous';
}

export async function authorizedFetch(url: string, options: any = {}) {
  const user = await ensureAuthUser();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

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
      timeout: 180000,
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

export type SizeFeedbackOutcome = 'kept' | 'returned_too_small' | 'returned_too_large' | 'returned_other';

/** Log whether a size recommendation worked out. This is the ground truth
 * that makes recommendation accuracy measurable over time. */
export async function submitSizeFeedback(input: {
  productId: string;
  productTitle?: string;
  brand?: string;
  category?: string;
  recommendedSize: string;
  recommendationConfidence?: number;
  purchasedSize?: string;
  outcome: SizeFeedbackOutcome;
}): Promise<boolean> {
  try {
    const response = await authorizedFetch(`${getBackendBaseUrl()}/size-feedback`, {
      method: 'POST',
      body: JSON.stringify({
        product_id: input.productId,
        product_title: input.productTitle || '',
        brand: input.brand || '',
        category: input.category || '',
        recommended_size: input.recommendedSize,
        recommendation_confidence: input.recommendationConfidence ?? null,
        purchased_size: input.purchasedSize || '',
        outcome: input.outcome,
      }),
    });
    return response.ok;
  } catch (error) {
    console.warn('[ziprightApi] submitSizeFeedback failed:', error);
    return false;
  }
}

export interface SellerProfile {
  uid: string;
  status: 'pending' | 'active' | 'rejected' | 'suspended';
  store_name: string;
  contact_name: string;
  email: string;
  phone: string;
  website?: string | null;
  gst?: string | null;
  brand_logo_url?: string | null;
  brand_description?: string | null;
  terms_accepted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SellerMeResponse {
  is_seller: boolean;
  status: 'pending' | 'active' | 'rejected' | 'suspended' | null;
  profile: SellerProfile | null;
}

export async function getSellerMe(): Promise<SellerMeResponse> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/me`);
  if (!response.ok) {
    throw new Error('Failed to retrieve seller status.');
  }
  const payload = await parseJsonResponse(response);
  return payload.data as SellerMeResponse;
}

export async function onboardSeller(input: {
  store_name: string;
  contact_name: string;
  email: string;
  phone: string;
  website?: string;
  gst?: string;
  brand_description?: string;
  terms_accepted: boolean;
}): Promise<SellerProfile> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/onboard`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, payload, 'Failed to submit onboarding application.'));
  }
  return payload.data as SellerProfile;
}

export async function getSellerProfile(): Promise<SellerProfile> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/profile`);
  if (!response.ok) {
    throw new Error('Failed to fetch seller profile.');
  }
  const payload = await parseJsonResponse(response);
  return payload.data as SellerProfile;
}

export async function updateSellerProfile(input: {
  store_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  gst?: string;
  brand_description?: string;
}): Promise<SellerProfile> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/profile`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, payload, 'Failed to update seller profile.'));
  }
  return payload.data as SellerProfile;
}

export async function uploadSellerLogo(file: File): Promise<SellerProfile> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/profile/logo`, {
    method: 'POST',
    body: formData,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, payload, 'Failed to upload seller logo.'));
  }
  return payload.data as SellerProfile;
}

export async function adminListSellers(status?: string): Promise<SellerProfile[]> {
  const url = new URL(`${getBackendBaseUrl()}/seller`);
  if (status) {
    url.searchParams.append('status', status);
  }
  const response = await authorizedFetch(url.toString());
  if (!response.ok) {
    throw new Error('Failed to fetch sellers list.');
  }
  const payload = await parseJsonResponse(response);
  return payload.data as SellerProfile[];
}

export async function adminSetSellerStatus(
  uid: string,
  status: 'active' | 'rejected' | 'suspended',
  reason?: string,
): Promise<SellerProfile> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/${uid}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, payload, 'Failed to update seller status.'));
  }
  return payload.data as SellerProfile;
}

export interface ProductImportRequest {
  url?: string;
  images?: string[];
}

export interface ProductDraft {
  title: string;
  description: string;
  brand: string;
  category: string;
  gender: string;
  fabric: string;
  colors: string[];
  images: string[];
  size_chart?: Record<string, number> | null;
  fit_type: string;
  sleeve_type: string;
  neck_type: string;
  pattern: string;
  tags: string[];
  price?: string | null;
  source_url?: string | null;
}

export interface ProductPreview {
  product: ProductDraft;
  generated_fields: string[];
}

export async function importProduct(payload: ProductImportRequest): Promise<ProductPreview> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to import product details.'));
  }
  return data.data as ProductPreview;
}

export async function createProduct(payload: ProductDraft & { generated_fields: string[]; status?: 'active' | 'draft' }): Promise<any> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to save product.'));
  }
  return data.data;
}

export interface SellerProduct extends ProductDraft {
  id: string;
  seller_uid: string;
  generated_fields: string[];
  status: 'active' | 'draft' | 'archived';
  created_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

export async function listProducts(params?: {
  query?: string;
  category?: string;
  brand?: string;
  status_filter?: string;
}): Promise<SellerProduct[]> {
  const url = new URL(`${getBackendBaseUrl()}/seller/products`);
  if (params) {
    if (params.query) url.searchParams.append('query', params.query);
    if (params.category) url.searchParams.append('category', params.category);
    if (params.brand) url.searchParams.append('brand', params.brand);
    if (params.status_filter) url.searchParams.append('status_filter', params.status_filter);
  }

  const response = await authorizedFetch(url.toString());
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to retrieve products.'));
  }
  return data.data as SellerProduct[];
}

export async function getProduct(productId: string): Promise<SellerProduct> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products/${productId}`);
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to retrieve product details.'));
  }
  return data.data as SellerProduct;
}

export async function updateProduct(
  productId: string,
  payload: Partial<ProductDraft> & { expected_updated_at?: string | null; status?: string }
): Promise<SellerProduct> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to update product.'));
  }
  return data.data as SellerProduct;
}

export async function deleteProduct(productId: string): Promise<void> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products/${productId}`, {
    method: 'DELETE',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to delete product.'));
  }
}

export async function bulkOperation(
  ids: string[],
  operation: 'delete' | 'archive' | 'restore'
): Promise<number> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products/bulk`, {
    method: 'POST',
    body: JSON.stringify({ ids, operation }),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, `Failed to perform bulk ${operation}.`));
  }
  return (data.data as { count: number }).count;
}

export async function duplicateProduct(productId: string): Promise<SellerProduct> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products/${productId}/duplicate`, {
    method: 'POST',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to duplicate product.'));
  }
  return data.data as SellerProduct;
}

export async function uploadProductImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/products/upload-image`, {
    method: 'POST',
    body: formData,
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to upload product image.'));
  }
  return data.data as { url: string };
}

export interface PopularProductMetric {
  id: string;
  title: string;
  tryon_count: number;
  recommendation_count: number;
  feedback_count: number;
  accuracy: number | null;
}

export interface ActivityEvent {
  id: string;
  type: 'product_created' | 'product_edited' | 'product_archived' | 'feedback_received';
  text: string;
  timestamp: string;
}

export interface SellerDashboardResponse {
  total_products: number;
  active_products: number;
  archived_products: number;
  total_tryons: number;
  total_recs: number;
  feedback_count: number;
  popular_products: PopularProductMetric[];
  recent_activity: ActivityEvent[];
}

export async function getSellerDashboard(): Promise<SellerDashboardResponse> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/dashboard`, {
    method: 'GET',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to retrieve dashboard analytics.'));
  }
  return data.data as SellerDashboardResponse;
}

export interface SellerIntegrationResponse {
  platform: string;
  store_url: string;
  connected_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

export interface SyncHistoryEvent {
  event_id: string;
  platform: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  products_synced_count: number;
  error_message: string | null;
}

export async function connectSellerIntegration(payload: {
  platform: string;
  store_url: string;
  credentials: Record<string, string>;
}): Promise<SellerIntegrationResponse> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/integration/connect`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to connect e-commerce integration.'));
  }
  return data.data as SellerIntegrationResponse;
}

export async function disconnectSellerIntegration(): Promise<void> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/integration/disconnect`, {
    method: 'POST',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to disconnect integration.'));
  }
}

export async function getSellerIntegrationStatus(): Promise<SellerIntegrationResponse | null> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/integration/status`, {
    method: 'GET',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to retrieve integration status.'));
  }
  return data.data as SellerIntegrationResponse | null;
}

export async function triggerSellerIntegrationSync(): Promise<{ synced_count: number }> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/integration/sync`, {
    method: 'POST',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Catalog synchronization failed.'));
  }
  return data.data as { synced_count: number };
}

export async function getSellerIntegrationHistory(): Promise<SyncHistoryEvent[]> {
  const response = await authorizedFetch(`${getBackendBaseUrl()}/seller/integration/history`, {
    method: 'GET',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to retrieve synchronization history.'));
  }
  return data.data as SyncHistoryEvent[];
}

export async function getPublicProduct(storeUrl: string, productTitle: string): Promise<SellerProduct> {
  const response = await fetch(`${getBackendBaseUrl()}/public/integration/product?store_url=${encodeURIComponent(storeUrl)}&product_title=${encodeURIComponent(productTitle)}`, {
    method: 'GET',
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to retrieve storefront product.'));
  }
  return data.data as SellerProduct;
}

export async function getPublicRecommendation(payload: {
  store_url: string;
  product_title?: string;
  product_id?: string;
  height: number;
  weight: number;
  base_size: string;
  fit_preference: string;
  chest?: number;
  waist?: number;
  shoulders?: number;
  hips?: number;
  legs?: number;
  bust?: number;
}): Promise<BackendSizeResult> {
  const response = await fetch(`${getBackendBaseUrl()}/public/integration/recommendation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(response, data, 'Failed to calculate size recommendation.'));
  }
  return data.data as BackendSizeResult;
}




