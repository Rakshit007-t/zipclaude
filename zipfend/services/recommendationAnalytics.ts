import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { hasCategoryConsent } from './cookieConsent';

export type RecommendationAnalyticsEventName =
  | 'recommendation_generated'
  | 'recommendation_viewed'
  | 'recommendation_accepted'
  | 'recommendation_rejected'
  | 'recommendation_feedback'
  | 'product_purchased'
  | 'size_exchanged'
  | 'size_returned';

export type RecommendationOutcomeEventName =
  | 'product_purchased'
  | 'size_exchanged'
  | 'size_returned';

export type RecommendationFeedbackType =
  | 'perfect_fit'
  | 'slightly_tight'
  | 'slightly_loose'
  | 'wrong_size';

export type RecommendationScreenSource = 'add-product' | 'recommendation' | 'marketplace' | 'home' | string;

interface RecommendationAnalyticsPayload {
  recommendationId?: string | null;
  userId?: string | null;
  product?: Record<string, unknown> | null;
  productTitle?: string | null;
  brand?: string | null;
  garmentFamily?: string | null;
  fitType?: string | null;
  backendSize?: string | null;
  finalSize?: string | null;
  recommendedSize?: string | null;
  originalSize?: string | null;
  newSize?: string | null;
  returnedSize?: string | null;
  returnReason?: string | null;
  confidence?: number | string | null;
  feedbackType?: RecommendationFeedbackType | null;
  screenSource?: RecommendationScreenSource | null;
}

export const RECOMMENDATION_RULE_VERSION = 'product-aware-v1-confidence-v2';

const EVENT_COLLECTIONS: Record<RecommendationAnalyticsEventName, string> = {
  recommendation_generated: 'recommendation_generated_events',
  recommendation_viewed: 'recommendation_viewed_events',
  recommendation_accepted: 'recommendation_accepted_events',
  recommendation_rejected: 'recommendation_rejected_events',
  recommendation_feedback: 'recommendation_feedback_events',
  product_purchased: 'product_purchased_events',
  size_exchanged: 'size_exchanged_events',
  size_returned: 'size_returned_events',
};

const TERMINAL_EVENT_KEYS: Partial<Record<RecommendationAnalyticsEventName, string>> = {
  recommendation_accepted: 'zr_tracked_recommendation_accepted_ids',
  recommendation_rejected: 'zr_tracked_recommendation_rejected_ids',
  recommendation_feedback: 'zr_tracked_recommendation_feedback_ids',
  product_purchased: 'zr_tracked_product_purchased_ids',
  size_exchanged: 'zr_tracked_size_exchanged_ids',
  size_returned: 'zr_tracked_size_returned_ids',
};

function textFrom(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function productText(product?: Record<string, unknown> | null): string {
  if (!product) return '';
  return [
    product.title,
    product.subtitle,
    product.description,
    product.category,
    product.type,
    product.fit_hint,
  ].map(textFrom).join(' ').toLowerCase();
}

function inferGarmentFamily(product?: Record<string, unknown> | null): string {
  const text = productText(product);
  const title = textFrom(product?.title).toLowerCase();

  if (/\b(polo|polo shirt|collared tee)\b/.test(text)) return 'POLO';
  if (/\b(t-shirt|tshirt|tee|graphic tee|crew neck tee|v-neck tee)\b/.test(text)) return 'T_SHIRT';
  if (/\b(hoodie|hooded sweatshirt|hooded pullover|zip hoodie)\b/.test(text)) return 'HOODIE';
  if (/\b(sweatshirt|sweat shirt|crewneck sweatshirt|fleece pullover)\b/.test(text)) return 'SWEATSHIRT';
  if (/\b(blazer|sport coat|suit jacket)\b/.test(text)) return 'BLAZER';
  if (/\b(overcoat|trench coat|pea coat|topcoat|winter coat)\b/.test(text) || /\bcoat\b/.test(title)) return 'COAT';
  if (/\b(jacket|puffer|bomber|windbreaker|parka|shacket|outerwear)\b/.test(text)) return 'JACKET';
  if (/\b(kurta|kurti|anarkali)\b/.test(text)) return 'KURTA';
  if (/\b(dress|gown|midi dress|mini dress|maxi dress|bodycon dress|slip dress|shirt dress)\b/.test(text)) return 'DRESS';
  if (/\b(jeans|denim jeans|skinny jeans|straight jeans|bootcut jeans)\b/.test(text)) return 'JEANS';
  if (/\b(shorts|bermuda|cargo shorts|denim shorts)\b/.test(text)) return 'SHORTS';
  if (/\b(leggings|tights|yoga pants|active tights)\b/.test(text)) return 'LEGGINGS';
  if (/\b(skirt|mini skirt|midi skirt|maxi skirt|pencil skirt)\b/.test(text)) return 'SKIRT';
  if (/\b(trousers|pants|chinos|slacks|cargo pants|joggers|track pants)\b/.test(text)) return 'TROUSERS';
  if (/\b(shirt|formal shirt|casual shirt|button down|button-down|button up|button-up|oxford)\b/.test(text)) return 'SHIRT';

  return 'UNKNOWN';
}

function inferFitType(product?: Record<string, unknown> | null): string {
  const text = productText(product);

  if (/\b(compression|bodycon|skinny|muscle fit)\b/.test(text)) return 'compression';
  if (/\b(slim fit|slim-fit|slim|tailored fit|fitted)\b/.test(text)) return 'slim';
  if (/\b(oversized|oversize|boxy|baggy)\b/.test(text)) return 'oversized';
  if (/\b(relaxed fit|relaxed|loose fit|loose)\b/.test(text)) return 'relaxed';
  if (/\b(regular fit|classic fit|standard fit)\b/.test(text)) return 'regular';

  return 'unknown';
}

function normalizeConfidence(confidence: RecommendationAnalyticsPayload['confidence']): number | null {
  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    return confidence > 1 ? Math.round(confidence) : Math.round(confidence * 100);
  }

  const parsed = Number.parseFloat(String(confidence || '').replace('%', ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function cleanString(value: unknown): string {
  return String(value || '').trim();
}

export function createRecommendationId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}

  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeBrandKey(brand: unknown): string {
  return cleanString(brand).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readTrackedRecommendationIds(storageKey: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(cleanString).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeTrackedRecommendationIds(storageKey: string, ids: Set<string>) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...ids].slice(-250)));
  } catch {}
}

function reserveTerminalEvent(eventName: RecommendationAnalyticsEventName, recommendationId: string): boolean {
  const storageKey = TERMINAL_EVENT_KEYS[eventName];
  if (!storageKey || !recommendationId) return true;

  const trackedIds = readTrackedRecommendationIds(storageKey);
  if (trackedIds.has(recommendationId)) return false;

  trackedIds.add(recommendationId);
  writeTrackedRecommendationIds(storageKey, trackedIds);
  return true;
}

export function hasSubmittedRecommendationFeedback(recommendationId: string): boolean {
  return readTrackedRecommendationIds(TERMINAL_EVENT_KEYS.recommendation_feedback || '').has(cleanString(recommendationId));
}

export function hasTrackedRecommendationOutcome(
  recommendationId: string,
  eventName: RecommendationOutcomeEventName,
): boolean {
  return readTrackedRecommendationIds(TERMINAL_EVENT_KEYS[eventName] || '').has(cleanString(recommendationId));
}

export async function trackRecommendationEvent(
  eventName: RecommendationAnalyticsEventName,
  payload: RecommendationAnalyticsPayload,
): Promise<void> {
  try {
    if (!hasCategoryConsent('analytics')) return;

    const userId = cleanString(payload.userId || auth.currentUser?.uid);
    if (!userId) return;

    const product = payload.product || {};
    const recommendationId = cleanString(payload.recommendationId || product.recommendationId) || createRecommendationId();
    if (!reserveTerminalEvent(eventName, recommendationId)) return;

    const brand = cleanString(payload.brand || product.brand);
    const event = {
      eventName,
      recommendationId,
      recommendationRuleVersion: RECOMMENDATION_RULE_VERSION,
      userId,
      productTitle: cleanString(payload.productTitle || product.title),
      brand,
      normalizedBrand: normalizeBrandKey(brand),
      garmentFamily: cleanString(payload.garmentFamily) || inferGarmentFamily(product),
      fitType: cleanString(payload.fitType) || inferFitType(product),
      backendSize: cleanString(payload.backendSize),
      finalSize: cleanString(payload.finalSize),
      recommendedSize: cleanString(payload.recommendedSize || payload.finalSize),
      originalSize: cleanString(payload.originalSize),
      newSize: cleanString(payload.newSize),
      returnedSize: cleanString(payload.returnedSize),
      returnReason: cleanString(payload.returnReason),
      confidence: normalizeConfidence(payload.confidence),
      feedbackType: cleanString(payload.feedbackType),
      screenSource: cleanString(payload.screenSource),
      timestamp: serverTimestamp(),
      clientTimestamp: new Date().toISOString(),
    };

    await addDoc(collection(db, EVENT_COLLECTIONS[eventName]), event);
  } catch (error) {
    console.warn('[RecommendationAnalytics] Event tracking failed:', error);
  }
}

export function trackRecommendationGenerated(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('recommendation_generated', payload);
}

export function trackRecommendationViewed(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('recommendation_viewed', payload);
}

export function trackRecommendationAccepted(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('recommendation_accepted', payload);
}

export function trackRecommendationRejected(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('recommendation_rejected', payload);
}

export function trackRecommendationFeedback(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('recommendation_feedback', payload);
}

export function trackProductPurchased(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('product_purchased', payload);
}

export function trackSizeExchanged(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('size_exchanged', payload);
}

export function trackSizeReturned(payload: RecommendationAnalyticsPayload): Promise<void> {
  return trackRecommendationEvent('size_returned', payload);
}
