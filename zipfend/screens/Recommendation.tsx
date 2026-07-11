import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { getUserPlan } from '../utils/subscription';
import { auth } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { predictSize } from '../services/ziprightApi';
import { recordJourneyEvent } from '../services/styleJourney';
import { buildMeasurementsForSizing, type SizeEngineBaseSize } from '../utils/sizeProfile';
import {
  extractAvailableProductSizes,
  normalizeProductSizeChart,
  refineProductRecommendation,
} from '../utils/productSizingIntelligence';
import {
  createRecommendationId,
  hasSubmittedRecommendationFeedback,
  hasTrackedRecommendationOutcome,
  type RecommendationFeedbackType,
  type RecommendationOutcomeEventName,
  trackRecommendationAccepted,
  trackRecommendationFeedback,
  trackRecommendationGenerated,
  trackProductPurchased,
  trackRecommendationRejected,
  trackRecommendationViewed,
  trackSizeExchanged,
  trackSizeReturned,
} from '../services/recommendationAnalytics';
import { AppBar, Button, IconButton, Eyebrow, Skeleton, Spinner } from '../components/ui';

interface Member {
  id: string;
  name: string;
  isPrimary: boolean;
  fitData: {
    gender: 'Male' | 'Female' | 'Other';
    brand: string;
    topSize: string;
    heightFt: string;
    heightIn: string;
    heightCm: string;
    heightUnit: 'ft' | 'cm';
    weight: string;
    bodyShape: string;
    fitPreference: number;
    chestSize?: string;
    bustSize?: string;
    waistSize?: string;
    hipsSize?: string;
    shoulderSize?: string;
    autoBuild?: string;
    braCup?: string;
  };
}

interface NormalizedMetrics {
  heightCm: number;
  weightKg: number;
  bmi: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  shoulderCm: number;
  autoBuild: string;
  fitBias: number;
  fitPreferenceLabel: string;
}

interface ActiveMeasurementProfile {
  id: string;
  height: number;
  bodyType?: string;
  measurements: {
    chest?: number;
    waist?: number;
    shoulders?: number;
    hips?: number;
  };
  fitPreference: 'slim' | 'regular' | 'relaxed' | 'loose';
}

interface RecommendationInput {
  profileId: string;
  productSignature: string;
  height: number;
  chest: number;
  waist: number;
  shoulders: number;
  bodyType?: string;
  url: string;
  hips?: number;
  fitPreference: 'slim' | 'regular' | 'relaxed' | 'loose';
}

interface RecommendationUiResult {
  recommendationId: string;
  recommendedSize: string;
  confidence: number;
  reasoning: string;
  alternativeSize: string;
  backendSize?: string;
  fitNotes: string;
  returnRisk: number;
  sizeDirection: string;
  isOffline?: boolean;
}

const FEEDBACK_OPTIONS: Array<{ type: RecommendationFeedbackType; label: string }> = [
  { type: 'perfect_fit', label: 'Perfect Fit' },
  { type: 'slightly_tight', label: 'Slightly Tight' },
  { type: 'slightly_loose', label: 'Slightly Loose' },
  { type: 'wrong_size', label: 'Wrong Size' },
];

// --- Pure Engine Functions ---

function normalizeMeasurements(fitData: any): NormalizedMetrics {
  const inchesToCm = (value: unknown) => {
    const parsed = parseFloat(String(value || '0'));
    return parsed > 0 ? parsed * 2.54 : 0;
  };

  let heightCm = 0;
  if (fitData.heightUnit === 'ft') {
    heightCm = (parseInt(fitData.heightFt || '0') * 30.48) + (parseInt(fitData.heightIn || '0') * 2.54);
  } else {
    heightCm = parseFloat(fitData.heightCm || '0');
  }

  const weightKg = parseFloat(fitData.weight || '0');
  const bmi = (heightCm > 0 && weightKg > 0) ? (weightKg / Math.pow(heightCm / 100, 2)) : 0;

  let autoBuild = 'Average';
  if (bmi > 0) {
    if (bmi < 18.5) autoBuild = 'Slim';
    else if (bmi < 25) autoBuild = 'Average';
    else if (bmi < 30) autoBuild = 'Athletic';
    else autoBuild = 'Broad';
  }

  const chestCm = inchesToCm(fitData.chestSize || fitData.bustSize);
  const waistCm = inchesToCm(fitData.waistSize);
  const hipCm = inchesToCm(fitData.hipsSize);
  const shoulderCm = inchesToCm(fitData.shoulderSize);

  const fitBias = fitData.fitPreference === 1 ? -1 : fitData.fitPreference === 3 ? 1 : 0;

  return {
    heightCm: Math.round(heightCm),
    weightKg: weightKg,
    bmi: Math.round(bmi * 10) / 10,
    chestCm: Math.round(chestCm),
    waistCm: Math.round(waistCm),
    hipCm: Math.round(hipCm),
    shoulderCm: Math.round(shoulderCm),
    autoBuild,
    fitBias,
    fitPreferenceLabel: fitBias === -1 ? 'slim' : fitBias === 1 ? 'relaxed' : 'regular'
  };
}

function cmToFeetAndInches(heightCm: number) {
  const totalInches = heightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return { feet, inches };
}

function cmToInchesString(value?: number) {
  return value ? Number((value / 2.54).toFixed(1)).toString() : '';
}

const ENGINE_BASE_SIZES: SizeEngineBaseSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function normalizeBaseSize(value: unknown): SizeEngineBaseSize | undefined {
  const normalized = String(value || '').toUpperCase() as SizeEngineBaseSize;
  return ENGINE_BASE_SIZES.includes(normalized) ? normalized : undefined;
}

function toPositiveNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function fitPreferenceToSlider(value: unknown) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'slim') return 1;
  if (normalized === 'relaxed' || normalized === 'loose' || normalized === 'baggy') return 3;
  return 2;
}

function normalizeGender(value: unknown): 'Male' | 'Female' | 'Other' {
  const gender = String(value || '');
  return gender === 'Male' || gender === 'Female' || gender === 'Other' ? gender : 'Other';
}

function getRecordMeasurements(record: Record<string, unknown>, fallback: any) {
  const measurements = record.measurements && typeof record.measurements === 'object'
    ? record.measurements as Record<string, unknown>
    : {};
  const smartFit = record.smartFit && typeof record.smartFit === 'object'
    ? record.smartFit as Record<string, unknown>
    : {};
  return {
    ...(fallback.measurements || {}),
    ...measurements,
    ...smartFit,
  };
}

function buildRecommendationMembers(profile: any): Member[] {
  const profileRecords = Array.isArray(profile.fitProfiles) ? profile.fitProfiles : [];
  const records = profileRecords.length
    ? profileRecords
    : profile.profileName
      ? [profile as Record<string, unknown>]
      : [];

  return records.map((rawRecord, index) => {
    const record = rawRecord as Record<string, unknown>;
    const profileId = String(
      record.profileId ||
      record.id ||
      profile.profileId ||
      profile.selectedProfileId ||
      auth.currentUser?.uid ||
      `profile-${index + 1}`,
    );
    const measurements = getRecordMeasurements(record, profile);
    const heightCm = toPositiveNumber(record.height) || toPositiveNumber(profile.height);
    const { feet, inches } = cmToFeetAndInches(heightCm || 0);
    const chestCm = toPositiveNumber(measurements.chest ?? measurements.bust);
    const bustCm = toPositiveNumber(measurements.bust);
    const waistCm = toPositiveNumber(measurements.waist);
    const hipsCm = toPositiveNumber(measurements.hips);
    const shoulderCm = toPositiveNumber(measurements.shoulders);
    const weightKg = toPositiveNumber(record.weight) || toPositiveNumber(profile.weight);

    return {
      id: profileId,
      name: String(record.profileName || record.name || profile.profileName || `Fit Profile ${index + 1}`),
      isPrimary: record.isPrimary === true || profileId === profile.selectedProfileId || index === 0,
      fitData: {
        gender: normalizeGender(record.gender || profile.gender),
        brand: String(record.preferredBrand || record.brand || profile.preferredBrand || ''),
        topSize: String(record.usualSize || record.baseSize || profile.usualSize || profile.baseSize || ''),
        heightFt: feet ? String(feet) : '',
        heightIn: inches ? String(inches) : '',
        heightCm: heightCm > 0 ? String(heightCm) : '',
        heightUnit: 'cm',
        weight: weightKg > 0 ? String(weightKg) : '',
        bodyShape: String(record.bodyShape || profile.bodyShape || ''),
        fitPreference: fitPreferenceToSlider(record.fitPreference || profile.fitPreference),
        chestSize: cmToInchesString(chestCm),
        bustSize: cmToInchesString(bustCm),
        waistSize: cmToInchesString(waistCm),
        hipsSize: cmToInchesString(hipsCm),
        shoulderSize: cmToInchesString(shoulderCm),
      },
    };
  });
}

function parseNumericConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1 ? Math.round(value) : Math.round(value * 100);
  }

  const parsed = parseFloat(String(value || '').replace('%', ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 70;
}

function normalizeBrand(brand?: string) {
  return brand?.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeCategory(category?: string) {
  const c = category?.toLowerCase() || '';

  if (c.includes('shirt')) return 'tshirt';
  if (c.includes('tshirt')) return 'tshirt';
  if (c.includes('coat') || c.includes('jacket')) return 'jacket';

  return '';
}

function normalizeSizeChart(sizeChart: unknown): Record<string, number> | undefined {
  return normalizeProductSizeChart(sizeChart);
}

function confidenceLabelToNumeric(confidence: string): number {
  const label = String(confidence || '').toLowerCase();
  if (label === 'high') return 88;
  if (label === 'medium') return 70;
  if (label === 'low') return 55;
  return 70;
}

function riskFromConfidence(confidence: number): string {
  if (confidence >= 80) return 'low';
  if (confidence >= 60) return 'medium';
  return 'high';
}

function riskToNumeric(risk: string): number {
  const r = risk.toLowerCase();
  if (r.includes('very low')) return 8;
  if (r.includes('low')) return 15;
  if (r.includes('medium')) return 35;
  if (r.includes('high')) return 60;
  return 40;
}

function confidenceToDirection(confidence: number): string {
  if (confidence > 85) return 'true-to-size';
  if (confidence > 70) return 'true-to-size';
  return 'size-up';
}

function getCacheKey(input: RecommendationInput): string {
  return [
    input.profileId,
    input.productSignature,
    input.url,
    input.height,
    input.chest,
    input.waist,
    input.shoulders,
    input.hips || 0,
    input.fitPreference,
  ].join('::');
}

function stringifyMetadata(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifyMetadata).filter(Boolean).join('|');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${key}:${stringifyMetadata(child)}`)
      .filter(Boolean)
      .join('|');
  }
  return '';
}

function getProductRecommendationSignature(product: any): string {
  return [
    product?.id,
    product?.url,
    product?.title,
    product?.category,
    product?.type,
    product?.fit_hint,
    product?.description,
    stringifyMetadata(product?.tags),
    stringifyMetadata(product?.metadata),
    stringifyMetadata(product?.product_metadata),
    stringifyMetadata(product?.available_sizes ?? product?.availableSizes),
    stringifyMetadata(product?.size_chart ?? product?.sizeChart),
  ].map(value => String(value || '').trim().toLowerCase()).join('::');
}

const ACTIVE_RECOMMENDATION_KEY = 'zr_active_recommendation';
const SELECTED_PROFILE_KEY = 'zr_selected_profile_id';

function readActiveRecommendation(): {
  product?: any;
  productUrl?: string;
  selectedProfileId?: string;
  source?: string;
} | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_RECOMMENDATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeActiveRecommendation(payload: unknown) {
  try {
    sessionStorage.setItem(ACTIVE_RECOMMENDATION_KEY, JSON.stringify(payload));
  } catch {}
}

function readSelectedProfileId() {
  try {
    return sessionStorage.getItem(SELECTED_PROFILE_KEY) || '';
  } catch {
    return '';
  }
}

function writeSelectedProfileId(profileId: string) {
  try {
    sessionStorage.setItem(SELECTED_PROFILE_KEY, profileId);
  } catch {}
}

// --- Component ---

const Recommendation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { userProfile, isHydrated } = useUserProfile();
  const storedRecommendationRef = useRef(readActiveRecommendation());
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>(() => (
    (location.state?.selectedProfileId as string | undefined) ||
    storedRecommendationRef.current?.selectedProfileId ||
    readSelectedProfileId()
  ));
  const [showMemberSelector, setShowMemberSelector] = useState(false);

  const [wishlistCount, setWishlistCount] = useState(0);
  const [userPlan, setUserPlan] = useState(getUserPlan());

  // Multi-stage loading state
  const [loadingStage, setLoadingStage] = useState<number>(0);

  const [aiResult, setAiResult] = useState<RecommendationUiResult | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);

  const [engineError, setEngineError] = useState<string | null>(null);

  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const hasShownMissingProductToastRef = useRef(false);
  const lastEngineToastRef = useRef<string | null>(null);
  const cacheRef = useRef<Record<string, RecommendationUiResult>>({});
  const viewedAnalyticsKeysRef = useRef<Set<string>>(new Set());
  const [submittedFeedback, setSubmittedFeedback] = useState<Record<string, RecommendationFeedbackType>>({});
  const [submittedOutcomes, setSubmittedOutcomes] = useState<Record<string, Partial<Record<RecommendationOutcomeEventName, true>>>>({});
  const [activeOutcomeForm, setActiveOutcomeForm] = useState<'exchange' | 'return' | null>(null);
  const [exchangeOriginalSize, setExchangeOriginalSize] = useState('');
  const [exchangeNewSize, setExchangeNewSize] = useState('');
  const [returnedSize, setReturnedSize] = useState('');
  const [returnReason, setReturnReason] = useState('');

  const product = location.state?.product || storedRecommendationRef.current?.product;
  const source = location.state?.source || storedRecommendationRef.current?.source;

  useEffect(() => {
    if (!product && !hasShownMissingProductToastRef.current) {
      hasShownMissingProductToastRef.current = true;
      showToast("No product data found.", "error");
      navigate('/home');
    }
  }, [product, navigate, showToast]);

  const displayProduct = product;
  const productUrl = location.state?.productUrl || storedRecommendationRef.current?.productUrl || product?.url;

  const isClothing = displayProduct?.type === 'clothing' ||
                     ['Men', 'Women', 'Kids', 'Tops', 'Bottoms', 'Dresses', 'Apparel', 'Clothing'].includes(displayProduct?.category) ||
                     !['Accessories', 'Shoes', 'Bags', 'Jewelry'].includes(displayProduct?.category);

  useEffect(() => {
    const nextMembers = buildRecommendationMembers(userProfile);
    if (nextMembers.length) {
      setMembers(nextMembers);
      setSelectedMemberId(prev => {
        if (nextMembers.some(member => member.id === prev)) return prev;
        const preferredId =
          storedRecommendationRef.current?.selectedProfileId ||
          userProfile.selectedProfileId ||
          userProfile.profileId;
        return nextMembers.find(member => member.id === preferredId)?.id || nextMembers[0].id;
      });
    } else {
      setMembers([]);
      setSelectedMemberId('');
    }

    setWishlistCount(0);
    setLikedMap({});
    setUserPlan(getUserPlan());
  }, [userProfile]);

  useEffect(() => {
    if (!displayProduct) {
      return;
    }

    writeActiveRecommendation({
      product: displayProduct,
      productUrl,
      selectedProfileId: selectedMemberId || userProfile.selectedProfileId || userProfile.profileId,
      source,
    });
  }, [displayProduct, productUrl, selectedMemberId, source, userProfile.profileId, userProfile.selectedProfileId]);

  useEffect(() => {
    if (selectedMemberId) {
      writeSelectedProfileId(selectedMemberId);
    }
  }, [selectedMemberId]);

  const selectedMember = members.find(m => m.id === selectedMemberId);
  const liveMeasurements = buildMeasurementsForSizing(userProfile.measurements);
  const hasLiveFitProfile = Boolean(userProfile.height > 0 && liveMeasurements);
  const fitTargetLabel = selectedMember?.name || userProfile.profileName || 'Complete Fit Profile';
  const selectedProfile = useMemo<ActiveMeasurementProfile | null>(() => {
    const normalized = selectedMember ? normalizeMeasurements(selectedMember.fitData) : null;
    if (
      normalized &&
      normalized.heightCm > 0 &&
      normalized.chestCm > 0 &&
      normalized.waistCm > 0
    ) {
      const shoulders = normalized.shoulderCm || Number(userProfile.measurements.shoulders || 0) || Math.round(normalized.chestCm * 0.45);
      return {
        id: selectedMember.id,
        height: normalized.heightCm,
        bodyType: selectedMember.fitData.bodyShape || normalized.autoBuild,
        measurements: {
          chest: normalized.chestCm,
          waist: normalized.waistCm,
          shoulders,
          hips: normalized.hipCm > 0 ? normalized.hipCm : undefined,
        },
        fitPreference: normalized.fitPreferenceLabel as 'slim' | 'regular' | 'relaxed',
      };
    }

    const liveChest = Number(liveMeasurements?.chest ?? liveMeasurements?.bust ?? 0);
    const liveWaist = Number(liveMeasurements?.waist ?? 0);
    const liveShoulders = Number(liveMeasurements?.shoulders ?? 0);
    if (hasLiveFitProfile && liveChest > 0 && liveWaist > 0 && liveShoulders > 0) {
      return {
        id: 'live-profile',
        height: userProfile.height,
        bodyType: userProfile.bodyShape,
        measurements: {
          chest: liveChest,
          waist: liveWaist,
          shoulders: liveShoulders,
          hips: Number(liveMeasurements?.hips ?? 0) || undefined,
        },
        fitPreference: (userProfile.fitPreference || 'regular') as 'slim' | 'regular' | 'relaxed' | 'loose',
      };
    }

    return null;
  }, [hasLiveFitProfile, liveMeasurements, selectedMember, userProfile.bodyShape, userProfile.fitPreference, userProfile.height]);

  const input = useMemo<RecommendationInput | null>(() => {
    if (!selectedProfile || !product) return null;
    const chest = Number(selectedProfile.measurements.chest ?? 0);
    const waist = Number(selectedProfile.measurements.waist ?? 0);
    const shoulders = Number(selectedProfile.measurements.shoulders ?? (chest * 0.45));
    if (chest <= 0 || waist <= 0 || shoulders <= 0 || !selectedProfile.height) return null;

    return {
      profileId: selectedProfile.id,
      productSignature: getProductRecommendationSignature(product),
      height: selectedProfile.height,
      chest,
      waist,
      shoulders,
      bodyType: selectedProfile.bodyType,
      url: String(product.url || ''),
      hips: selectedProfile.measurements.hips,
      fitPreference: selectedProfile.fitPreference,
    };
  }, [selectedProfile, product]);

  const currentInputKey = input ? getCacheKey(input) : null;
  const visibleAiResult = currentInputKey && resultKey === currentInputKey ? aiResult : null;

  // --- Engine Execution ---
  useEffect(() => {
    if (!displayProduct || !isClothing) return;

    // PROFILE REQUIREMENT GATE: Never run engine without a real profile
    if (!input) {
      setAiResult(null);
      setResultKey(null);
      setEngineError('Create your Fit Profile for accurate size recommendation.');
      setLoadingStage(0);
      return;
    }

    const key = getCacheKey(input);

    if (cacheRef.current[key]) {
      setAiResult(cacheRef.current[key]);
      setResultKey(key);
      setEngineError(null);
      setLoadingStage(0);
      return;
    }

    let cancelled = false;
    setAiResult(null);
    setResultKey(null);
    setEngineError(null);
    setLoadingStage(1);

    (async () => {
      try {
        setLoadingStage(2);
        const normalizedCategory = normalizeCategory(displayProduct.category);
        if (!displayProduct.title || !displayProduct.brand || !input.url || !normalizedCategory) {
          throw new Error('Product data is incomplete. Please try another product.');
        }
        const selectedBaseSize = normalizeBaseSize(
          selectedMember?.fitData.topSize || userProfile.baseSize || userProfile.usualSize,
        );

        const productForEngine = {
          id: String(displayProduct.id || displayProduct.title),
          title: String(displayProduct.title),
          brand: String(displayProduct.brand),
          price: displayProduct.price ? String(displayProduct.price) : undefined,
          image: displayProduct.image ? String(displayProduct.image) : undefined,
          category: normalizedCategory,
          url: input.url,
          source: 'link' as const,
          confidence: 0.7,
          fit_hint: typeof displayProduct.fit_hint === 'string' ? displayProduct.fit_hint : undefined,
          size_chart: normalizeSizeChart(displayProduct.size_chart ?? displayProduct.sizeChart),
          available_sizes: extractAvailableProductSizes(displayProduct),
          size_format: typeof displayProduct.size_format === 'string' ? displayProduct.size_format : undefined,
        };

        const engineResult = await predictSize({
          link: input.url,
          height: input.height,
          measurements: {
            chest: input.chest,
            waist: input.waist,
            shoulders: input.shoulders,
            hips: input.hips,
          },
          product: productForEngine,
          baseSize: selectedBaseSize,
          fitPreference: input.fitPreference,
          timeoutMs: 15000,
        });

        if (cancelled) return;

        const refined = refineProductRecommendation({
          product: {
            ...displayProduct,
            size_chart: productForEngine.size_chart,
            available_sizes: productForEngine.available_sizes,
            size_format: productForEngine.size_format,
          },
          engineResult,
          profile: {
            baseSize: selectedBaseSize,
            fitPreference: input.fitPreference,
            measurements: {
              chest: input.chest,
              waist: input.waist,
              shoulders: input.shoulders,
              hips: input.hips,
            },
          },
        });
        const confidence = refined.confidence;
        const recommendationId = String(displayProduct.recommendationId || '').trim() || createRecommendationId();
        const returnRiskLabel = riskFromConfidence(confidence);
        const returnRiskNum = riskToNumeric(returnRiskLabel);
        const mappedResult: RecommendationUiResult = {
          recommendationId,
          recommendedSize: refined.size,
          confidence,
          reasoning: refined.reason,
          alternativeSize: refined.mappedFromEngine !== refined.size ? refined.mappedFromEngine : '',
          backendSize: refined.mappedFromEngine,
          fitNotes: returnRiskLabel,
          returnRisk: returnRiskNum,
          sizeDirection: refined.sizeDirection || confidenceToDirection(confidence),
          isOffline: false,
        };

        void trackRecommendationGenerated({
          recommendationId,
          userId: auth.currentUser?.uid,
          product: displayProduct,
          backendSize: refined.mappedFromEngine,
          finalSize: refined.size,
          confidence,
          screenSource: 'recommendation',
        });

        if (!displayProduct.recommendationId) {
          writeActiveRecommendation({
            product: { ...displayProduct, recommendationId },
            productUrl,
            selectedProfileId: selectedMemberId || userProfile.selectedProfileId || userProfile.profileId,
            source,
          });
        }

        setAiResult(mappedResult);
        setResultKey(key);
        setEngineError(null);
        cacheRef.current[key] = mappedResult;
      } catch (err) {
        if (cancelled) return;

        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[SizeEngine] Error:', errorMsg, err);

        // FAILSAFE: Do NOT hallucinate a size on error.
        // Show the error and let the user retry or complete their profile.
        setAiResult(null);
        setResultKey(null);
        setEngineError(
          errorMsg === 'timeout'
            ? 'Size engine timed out. Please try again.'
            : `Could not generate recommendation: ${errorMsg}`,
        );
      } finally {
        if (!cancelled) setLoadingStage(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input, displayProduct, isClothing, userProfile.baseSize, userProfile.usualSize]);

  useEffect(() => {
    if (!visibleAiResult || !displayProduct || !currentInputKey) return;
    if (viewedAnalyticsKeysRef.current.has(currentInputKey)) return;

    viewedAnalyticsKeysRef.current.add(currentInputKey);
    void trackRecommendationViewed({
      recommendationId: visibleAiResult.recommendationId,
      userId: auth.currentUser?.uid,
      product: displayProduct,
      backendSize: visibleAiResult.backendSize || visibleAiResult.alternativeSize || visibleAiResult.recommendedSize,
      finalSize: visibleAiResult.recommendedSize,
      confidence: visibleAiResult.confidence,
      screenSource: 'recommendation',
    });
  }, [currentInputKey, displayProduct, visibleAiResult]);

  const handleProfileChange = (member: Member) => {
    setSelectedMemberId(member.id);
    writeSelectedProfileId(member.id);
    setAiResult(null);
    setResultKey(null);
    setEngineError(null);
    setLoadingStage(1);
  };

  const handleExternalBuy = () => {
    if (visibleAiResult && displayProduct) {
      void trackRecommendationAccepted({
        recommendationId: visibleAiResult.recommendationId,
        userId: auth.currentUser?.uid,
        product: displayProduct,
        backendSize: visibleAiResult.backendSize || visibleAiResult.alternativeSize || visibleAiResult.recommendedSize,
        finalSize: visibleAiResult.recommendedSize,
        confidence: visibleAiResult.confidence,
        screenSource: 'recommendation',
      });
    }

    if (productUrl) {
      window.open(productUrl, '_blank');
    } else {
      showToast("No product link provided to redirect to.", "error");
    }
  };

  const toggleWishlist = async () => {
    if (!displayProduct) return;
    showToast("Wishlist syncing is unavailable right now.", "error");
  };

  const handleBuyNow = () => {
    if (visibleAiResult && displayProduct) {
      void trackRecommendationAccepted({
        recommendationId: visibleAiResult.recommendationId,
        userId: auth.currentUser?.uid,
        product: displayProduct,
        backendSize: visibleAiResult.backendSize || visibleAiResult.alternativeSize || visibleAiResult.recommendedSize,
        finalSize: visibleAiResult.recommendedSize,
        confidence: visibleAiResult.confidence,
        screenSource: 'recommendation',
      });
    }

    if (productUrl) {
        window.open(productUrl, '_blank');
    } else {
        showToast("Product link unavailable.", "error");
    }
  };

  const handleExploreMore = () => {
    if (visibleAiResult && displayProduct) {
      void trackRecommendationRejected({
        recommendationId: visibleAiResult.recommendationId,
        userId: auth.currentUser?.uid,
        product: displayProduct,
        backendSize: visibleAiResult.backendSize || visibleAiResult.alternativeSize || visibleAiResult.recommendedSize,
        finalSize: visibleAiResult.recommendedSize,
        confidence: visibleAiResult.confidence,
        screenSource: 'recommendation',
      });
    }

    navigate('/add-product', { replace: true, state: { mode: 'new-link' } });
  };

  const handleRecommendationFeedback = (feedbackType: RecommendationFeedbackType) => {
    if (!visibleAiResult || !displayProduct) return;

    const recommendationId = visibleAiResult.recommendationId;
    if (!recommendationId || submittedFeedback[recommendationId] || hasSubmittedRecommendationFeedback(recommendationId)) {
      return;
    }

    setSubmittedFeedback(prev => ({
      ...prev,
      [recommendationId]: feedbackType,
    }));

    recordJourneyEvent('fit_feedback_given');

    void trackRecommendationFeedback({
      recommendationId,
      userId: auth.currentUser?.uid,
      product: displayProduct,
      recommendedSize: visibleAiResult.recommendedSize,
      finalSize: visibleAiResult.recommendedSize,
      confidence: visibleAiResult.confidence,
      feedbackType,
      screenSource: 'recommendation',
    });
  };

  const hasOutcomeBeenSubmitted = (recommendationId: string, eventName: RecommendationOutcomeEventName) => (
    Boolean(submittedOutcomes[recommendationId]?.[eventName]) ||
    hasTrackedRecommendationOutcome(recommendationId, eventName)
  );

  const markOutcomeSubmitted = (recommendationId: string, eventName: RecommendationOutcomeEventName) => {
    setSubmittedOutcomes(prev => ({
      ...prev,
      [recommendationId]: {
        ...prev[recommendationId],
        [eventName]: true,
      },
    }));
  };

  const handleProductPurchased = () => {
    if (!visibleAiResult || !displayProduct) return;

    const recommendationId = visibleAiResult.recommendationId;
    if (!recommendationId || hasOutcomeBeenSubmitted(recommendationId, 'product_purchased')) return;

    markOutcomeSubmitted(recommendationId, 'product_purchased');
    void trackProductPurchased({
      recommendationId,
      userId: auth.currentUser?.uid,
      product: displayProduct,
      recommendedSize: visibleAiResult.recommendedSize,
      finalSize: visibleAiResult.recommendedSize,
      confidence: visibleAiResult.confidence,
      screenSource: 'recommendation',
    });
  };

  const handleSizeExchanged = () => {
    if (!visibleAiResult || !displayProduct) return;

    const recommendationId = visibleAiResult.recommendationId;
    if (!recommendationId || hasOutcomeBeenSubmitted(recommendationId, 'size_exchanged')) return;

    const originalSize = exchangeOriginalSize.trim() || visibleAiResult.recommendedSize;
    const newSize = exchangeNewSize.trim();
    if (!newSize) {
      showToast('Enter the new size.', 'error');
      return;
    }

    markOutcomeSubmitted(recommendationId, 'size_exchanged');
    setActiveOutcomeForm(null);
    void trackSizeExchanged({
      recommendationId,
      userId: auth.currentUser?.uid,
      product: displayProduct,
      recommendedSize: visibleAiResult.recommendedSize,
      finalSize: visibleAiResult.recommendedSize,
      originalSize,
      newSize,
      confidence: visibleAiResult.confidence,
      screenSource: 'recommendation',
    });
  };

  const handleSizeReturned = () => {
    if (!visibleAiResult || !displayProduct) return;

    const recommendationId = visibleAiResult.recommendationId;
    if (!recommendationId || hasOutcomeBeenSubmitted(recommendationId, 'size_returned')) return;

    const finalReturnedSize = returnedSize.trim() || visibleAiResult.recommendedSize;
    const finalReturnReason = returnReason.trim() || 'unspecified';

    markOutcomeSubmitted(recommendationId, 'size_returned');
    setActiveOutcomeForm(null);
    void trackSizeReturned({
      recommendationId,
      userId: auth.currentUser?.uid,
      product: displayProduct,
      recommendedSize: visibleAiResult.recommendedSize,
      finalSize: visibleAiResult.recommendedSize,
      returnedSize: finalReturnedSize,
      returnReason: finalReturnReason,
      confidence: visibleAiResult.confidence,
      screenSource: 'recommendation',
    });
  };

  const handleBack = () => {
    if (source === 'marketplace') {
      navigate('/marketplace');
    } else if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/home');
    }
  };

  if (!displayProduct) return null;

  const getDirectionTone = (dir: string) => {
    const d = dir.toLowerCase();
    if (d.includes('up')) return 'text-info border-info/30 bg-info-soft';
    if (d.includes('down')) return 'text-brand border-brand/30 bg-brand-soft';
    return 'text-success border-success/30 bg-success-soft';
  };

  const feedbackForRecommendation = visibleAiResult?.recommendationId
    ? submittedFeedback[visibleAiResult.recommendationId]
    : undefined;
  const hasSubmittedFeedback = Boolean(
    visibleAiResult?.recommendationId &&
    (feedbackForRecommendation || hasSubmittedRecommendationFeedback(visibleAiResult.recommendationId)),
  );
  const currentRecommendationId = visibleAiResult?.recommendationId || '';
  const hasPurchasedOutcome = currentRecommendationId
    ? hasOutcomeBeenSubmitted(currentRecommendationId, 'product_purchased')
    : false;
  const hasExchangedOutcome = currentRecommendationId
    ? hasOutcomeBeenSubmitted(currentRecommendationId, 'size_exchanged')
    : false;
  const hasReturnedOutcome = currentRecommendationId
    ? hasOutcomeBeenSubmitted(currentRecommendationId, 'size_returned')
    : false;

  const outcomeInputClasses =
    'h-12 rounded-ctl border border-line bg-surface-1 px-4 text-[13px] font-medium text-ink outline-none placeholder:text-ink-faint focus:border-ink transition-colors';

  return (
    <div className="bg-surface-0 text-ink min-h-screen min-h-dvh flex flex-col antialiased relative overflow-x-hidden">
      <AppBar
        title="The Verdict"
        onBack={handleBack}
        trailing={
          <IconButton
            icon="favorite"
            aria-label={`Wishlist${wishlistCount > 0 ? `, ${wishlistCount} items` : ''}`}
            variant="ghost"
            size="sm"
            filled={wishlistCount > 0}
            onClick={() => navigate('/wishlist')}
          />
        }
      />

      {/* Member Selector */}
      {isClothing && (
          <div className="px-6 py-4 flex items-center justify-center">
              <button
                onClick={() => {
                  if (members.length > 0) {
                    setShowMemberSelector(!showMemberSelector);
                  }
                }}
                className="flex items-center gap-3 px-5 h-11 rounded-full bg-surface-1 border border-line hover:border-line-strong active:scale-95 transition-[transform,border-color]"
              >
                  <span className="eyebrow !text-[9px]">Fit for</span>
                  <span className="text-[13px] font-semibold text-ink">{fitTargetLabel}</span>
                  {members.length > 0 && (
                    <motion.span
                      animate={{ rotate: showMemberSelector ? 180 : 0 }}
                      className="material-symbols-outlined text-[16px] text-ink-faint"
                      aria-hidden="true"
                    >
                      expand_more
                    </motion.span>
                  )}
              </button>
          </div>
      )}

      <AnimatePresence>
        {showMemberSelector && isClothing && members.length > 0 && (
            <motion.div
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="absolute top-32 left-0 right-0 z-[60] px-6"
            >
                <div className="bg-surface-1 rounded-card shadow-float border border-line p-2 flex flex-col gap-0.5">
                    {members.map(member => (
                        <button
                            key={member.id}
                            onClick={() => {
                                handleProfileChange(member);
                                setShowMemberSelector(false);
                            }}
                            className={`flex items-center justify-between p-3.5 rounded-xl active:scale-[0.98] transition-[transform,background-color] ${selectedMemberId === member.id ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}
                        >
                            <div className="flex items-center gap-3.5">
                                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${member.isPrimary ? 'bg-ink text-ink-invert' : 'border border-line text-ink'}`}>
                                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{member.isPrimary ? 'person' : 'group'}</span>
                                </div>
                                <span className="font-semibold text-[15px] text-ink">{member.name}</span>
                            </div>
                            {selectedMemberId === member.id && <span className="material-symbols-outlined text-brand text-[18px]" aria-hidden="true">check</span>}
                        </button>
                    ))}
                    <div className="h-px bg-line my-1.5 mx-3"></div>
                    <button
                        onClick={() => navigate('/settings')}
                        className="flex items-center justify-center p-3.5 text-ink text-[11px] font-semibold uppercase tracking-[0.12em] active:scale-95 transition-transform"
                    >
                        Manage profiles
                    </button>
                </div>
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[-1] bg-scrim backdrop-blur-sm"
                    onClick={() => setShowMemberSelector(false)}
                ></motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Scroll Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-52" onClick={() => setShowMemberSelector(false)}>
             {isClothing ? (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col"
            >
                {/* Garment identity */}
                <div className="px-6 pt-2">
                    <div className="flex gap-5 items-center rounded-card bg-surface-1 border border-line p-5">
                        <motion.img
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            src={displayProduct.image}
                            alt={displayProduct.title}
                            className="w-20 h-28 object-cover rounded-xl flex-shrink-0 border border-line"
                        />
                        <div className="flex flex-col flex-1 min-w-0">
                            <p className="eyebrow !text-[9px] mb-1.5">{displayProduct.brand}</p>
                            <p className="font-display text-[19px] font-medium text-ink leading-snug line-clamp-2">{displayProduct.title}</p>
                            {displayProduct.price && (
                              <span className="text-[15px] font-semibold text-ink mt-2.5">{displayProduct.price}</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Error Banner */}
                {engineError && (
                    <div className="px-6 pt-4">
                        <div className="flex items-start gap-3 p-4 rounded-2xl bg-danger-soft border border-danger/25" role="alert">
                            <span className="material-symbols-outlined text-danger text-[18px] mt-0.5" aria-hidden="true">error</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-danger mb-1">Engine error</p>
                                <p className="text-[13px] text-ink-soft break-words leading-relaxed">{engineError}</p>
                            </div>
                            <button onClick={() => setEngineError(null)} aria-label="Dismiss" className="text-danger/60 hover:text-danger transition-colors flex-shrink-0">
                                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* The Verdict */}
                <div className="px-6 py-6">
                    <div className="flex flex-col rounded-card bg-surface-1 border border-line px-7 py-9 relative overflow-hidden">

                        {loadingStage > 0 && !visibleAiResult ? (
                            <div className="flex flex-col gap-8 py-10">
                                <div className="flex flex-col items-center text-center gap-4">
                                    <Spinner size={30} className="text-brand" />
                                    <p className="eyebrow">Reading the garment…</p>
                                </div>
                                <div className="flex flex-col items-center gap-4 mt-2">
                                    <Skeleton className="h-3.5 w-32" />
                                    <Skeleton className="h-32 w-32 rounded-2xl" />
                                    <Skeleton className="h-3.5 w-24" />
                                </div>
                                <div className="flex flex-col gap-3">
                                    <div className="flex justify-between">
                                        <Skeleton className="h-3 w-28" />
                                        <Skeleton className="h-3 w-10" />
                                    </div>
                                    <Skeleton className="h-2 w-full" />
                                </div>
                                <div className="rounded-2xl border border-line p-6 flex flex-col gap-3">
                                    <Skeleton className="h-3.5 w-full" />
                                    <Skeleton className="h-3.5 w-3/4" />
                                    <Skeleton className="h-3.5 w-1/2" />
                                </div>
                            </div>
                        ) : visibleAiResult ? (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex flex-col items-center text-center gap-8 relative z-10 w-full"
                            >
                                {/* The size — set like a cover masthead */}
                                <div className="flex flex-col items-center">
                                    <Eyebrow className="mb-2">Your size</Eyebrow>
                                    <div className="relative">
                                        <motion.h2
                                            initial={{ scale: 0.7, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            transition={{ type: 'spring', stiffness: 150, damping: 18 }}
                                            className="font-display text-[9.5rem] font-light text-ink leading-none tracking-tight"
                                        >
                                            {visibleAiResult.recommendedSize}
                                        </motion.h2>
                                        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                                            <div className={`px-5 py-1.5 rounded-full border text-[10px] font-semibold uppercase tracking-[0.12em] ${getDirectionTone(visibleAiResult.sizeDirection)}`}>
                                                {visibleAiResult.sizeDirection.replace(/-/g, ' ')}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Confidence — hairline gauge */}
                                <div className="w-full flex flex-col gap-2.5 mt-6">
                                    <div className="flex justify-between items-baseline px-0.5">
                                        <span className="eyebrow !text-[9px]">Confidence</span>
                                        <span className="font-display text-[17px] font-medium text-ink">{visibleAiResult.confidence}%</span>
                                    </div>
                                    <div className="h-px w-full bg-line relative" aria-hidden="true">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${visibleAiResult.confidence}%` }}
                                            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                                            className="absolute -top-[1.5px] left-0 h-[4px] rounded-full bg-brand"
                                        ></motion.div>
                                    </div>
                                </div>

                                {/* Reasoning */}
                                <div className="w-full rounded-2xl bg-surface-2 p-6 text-left">
                                    <p className="text-[13.5px] text-ink-soft leading-relaxed mb-5">
                                        {visibleAiResult.reasoning}
                                    </p>
                                    <div className="flex flex-wrap gap-2.5">
                                        {(() => {
                                            // Risk chip tone matches the actual risk — a low risk
                                            // should reassure, not alarm.
                                            const riskText = String(visibleAiResult.fitNotes || '').toLowerCase();
                                            const riskTone = riskText.includes('low')
                                                ? 'border-success/30 bg-success-soft text-success'
                                                : riskText.includes('medium')
                                                    ? 'border-warning/30 bg-warning-soft text-warning'
                                                    : 'border-danger/30 bg-danger-soft text-danger';
                                            return (
                                                <div className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[10px] font-semibold uppercase tracking-[0.1em] ${riskTone}`}>
                                                    Return risk · {visibleAiResult.fitNotes}
                                                </div>
                                            );
                                        })()}
                                        {visibleAiResult.alternativeSize && (
                                            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-line text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                                                Engine · {visibleAiResult.alternativeSize}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {visibleAiResult.isOffline && (
                                    <p className="text-[12px] text-warning flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[15px]" aria-hidden="true">cloud_off</span>
                                        Offline estimate — results may be less accurate
                                    </p>
                                )}

                                {/* Fit feedback */}
                                <div className="w-full rounded-2xl border border-line p-5 text-left">
                                    <div className="flex items-center justify-between gap-4 mb-4">
                                        <Eyebrow>How did it fit?</Eyebrow>
                                        {hasSubmittedFeedback && (
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-success">Saved</span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {FEEDBACK_OPTIONS.map(option => {
                                            const isSelected = feedbackForRecommendation === option.type;
                                            return (
                                                <button
                                                    key={option.type}
                                                    type="button"
                                                    onClick={() => handleRecommendationFeedback(option.type)}
                                                    disabled={hasSubmittedFeedback}
                                                    className={`min-h-11 rounded-full border px-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-[transform,border-color,background-color,color] active:scale-95 ${
                                                        isSelected
                                                            ? 'border-ink bg-ink text-ink-invert'
                                                            : hasSubmittedFeedback
                                                                ? 'border-line text-ink-faint cursor-not-allowed'
                                                                : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
                                                    }`}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Outcome */}
                                <div className="w-full rounded-2xl border border-line p-5 text-left">
                                    <div className="flex items-center justify-between gap-4 mb-4">
                                        <Eyebrow>Outcome</Eyebrow>
                                        {(hasPurchasedOutcome || hasExchangedOutcome || hasReturnedOutcome) && (
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-success">Tracked</span>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-3 gap-2.5">
                                        <button
                                            type="button"
                                            onClick={handleProductPurchased}
                                            disabled={hasPurchasedOutcome}
                                            className={`min-h-11 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition-[transform,border-color,background-color,color] active:scale-95 ${
                                                hasPurchasedOutcome
                                                    ? 'border-success/40 bg-success-soft text-success cursor-not-allowed'
                                                    : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
                                            }`}
                                        >
                                            Purchased
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveOutcomeForm(activeOutcomeForm === 'exchange' ? null : 'exchange')}
                                            disabled={hasExchangedOutcome}
                                            className={`min-h-11 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition-[transform,border-color,background-color,color] active:scale-95 ${
                                                hasExchangedOutcome
                                                    ? 'border-success/40 bg-success-soft text-success cursor-not-allowed'
                                                    : activeOutcomeForm === 'exchange'
                                                        ? 'border-ink bg-ink text-ink-invert'
                                                        : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
                                            }`}
                                        >
                                            Exchanged
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveOutcomeForm(activeOutcomeForm === 'return' ? null : 'return')}
                                            disabled={hasReturnedOutcome}
                                            className={`min-h-11 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-[0.08em] transition-[transform,border-color,background-color,color] active:scale-95 ${
                                                hasReturnedOutcome
                                                    ? 'border-success/40 bg-success-soft text-success cursor-not-allowed'
                                                    : activeOutcomeForm === 'return'
                                                        ? 'border-ink bg-ink text-ink-invert'
                                                        : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
                                            }`}
                                        >
                                            Returned
                                        </button>
                                    </div>

                                    {activeOutcomeForm === 'exchange' && !hasExchangedOutcome && (
                                        <div className="grid grid-cols-2 gap-2.5 mt-4">
                                            <input
                                                value={exchangeOriginalSize}
                                                onChange={(event) => setExchangeOriginalSize(event.target.value)}
                                                placeholder={`Original ${visibleAiResult.recommendedSize}`}
                                                className={outcomeInputClasses}
                                            />
                                            <input
                                                value={exchangeNewSize}
                                                onChange={(event) => setExchangeNewSize(event.target.value)}
                                                placeholder="New size"
                                                className={outcomeInputClasses}
                                            />
                                            <div className="col-span-2">
                                                <Button fullWidth onClick={handleSizeExchanged}>Save exchange</Button>
                                            </div>
                                        </div>
                                    )}

                                    {activeOutcomeForm === 'return' && !hasReturnedOutcome && (
                                        <div className="grid grid-cols-2 gap-2.5 mt-4">
                                            <input
                                                value={returnedSize}
                                                onChange={(event) => setReturnedSize(event.target.value)}
                                                placeholder={`Returned ${visibleAiResult.recommendedSize}`}
                                                className={outcomeInputClasses}
                                            />
                                            <select
                                                value={returnReason}
                                                onChange={(event) => setReturnReason(event.target.value)}
                                                className={outcomeInputClasses}
                                            >
                                                <option value="">Reason</option>
                                                <option value="too_tight">Too tight</option>
                                                <option value="too_loose">Too loose</option>
                                                <option value="wrong_size">Wrong size</option>
                                                <option value="other">Other</option>
                                            </select>
                                            <div className="col-span-2">
                                                <Button fullWidth onClick={handleSizeReturned}>Save return</Button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                            </motion.div>
                        ) : (
                            <div className="flex flex-col items-center text-center gap-4 py-14 opacity-70">
                                <span className="material-symbols-outlined text-[32px] text-ink-faint" aria-hidden="true">info</span>
                                <p className="eyebrow">No data yet</p>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>
        ) : (
             /* --- LAYOUT 2: Standard E-Commerce (Accessories, etc) --- */
             <div className="flex flex-col">
                 <div className="w-full aspect-[4/5] bg-surface-1 relative overflow-hidden">
                     <motion.div
                        initial={{ scale: 1.08 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 bg-center bg-cover"
                        style={{ backgroundImage: `url("${displayProduct.image}")` }}
                     ></motion.div>
                     <div className="absolute inset-0 bg-gradient-to-t from-surface-0 to-transparent"></div>
                 </div>

                 <div className="flex flex-col p-6 gap-8 -mt-20 relative z-10">
                     <div className="bg-surface-1 p-7 rounded-card border border-line shadow-lift">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex-1 pr-4">
                                <p className="eyebrow mb-2">{displayProduct.brand}</p>
                                <h1 className="display-2 leading-tight">{displayProduct.title}</h1>
                            </div>
                             <div className="flex flex-col items-end">
                                <span className="font-display text-[24px] font-medium text-ink">{displayProduct.price}</span>
                             </div>
                        </div>
                        <div className="h-px w-full bg-line mb-6"></div>
                        <div>
                            <Eyebrow className="mb-3">The details</Eyebrow>
                            <p className="text-ink-soft leading-relaxed text-[14px]">
                                This {displayProduct.title.toLowerCase()} from {displayProduct.brand} combines timeless elegance with modern durability. Crafted from high-quality materials, it is designed to last and elevate your style for any occasion.
                            </p>
                        </div>
                     </div>
                 </div>
             </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="fixed bottom-0 inset-x-0 w-full z-50 p-6 pb-8 bg-gradient-to-t from-surface-0 via-surface-0/92 to-transparent phone-fixed-bottom">
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            fullWidth
            trailingIcon="open_in_new"
            loading={loadingStage > 0}
            disabled={loadingStage > 0}
            onClick={source === 'marketplace' ? handleBuyNow : handleExternalBuy}
          >
            Open product
          </Button>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" icon="favorite" onClick={toggleWishlist}>
              {likedMap[displayProduct.id || displayProduct.title.replace(/\s+/g, '-').toLowerCase()] ? 'In wishlist' : 'Wishlist'}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={handleExploreMore}>
              Explore more
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Recommendation;
