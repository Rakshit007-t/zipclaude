import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { getUserPlan } from '../utils/subscription';
import { auth } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { predictSize } from '../services/ziprightApi';
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
    console.log("PROFILE SWITCH:", selectedProfile?.id);
    console.log("INPUT:", input);
    console.log("CACHE HIT:", !!cacheRef.current[key]);

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

  // Confidence Ring Colors
  const getConfidenceColor = (conf: number) => {
    if (conf >= 80) return '#22c55e'; // green-500
    if (conf >= 60) return '#eab308'; // yellow-500
    return '#ef4444'; // red-500
  };

  const getDirectionColor = (dir: string) => {
    const d = dir.toLowerCase();
    if (d.includes('up')) return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
    if (d.includes('down')) return 'text-purple-500 bg-purple-500/10 border-purple-500/20';
    return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
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

  return (
    <div className="bg-[#111111] text-white font-sans min-h-screen flex flex-col antialiased relative overflow-x-hidden">
      
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#111111]/60 backdrop-blur-xl border-b border-white/5">
        <button onClick={handleBack} className="h-10 w-10 flex items-center justify-center rounded-full bg-[#111111]/40 border border-white/5 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-[10px] font-bold tracking-[0.4em] uppercase text-[#C9A06C] bg-[#111111]/40 px-4 py-1.5 rounded-full border border-white/5">Recommendation</h1>
        <button onClick={() => navigate('/wishlist')} className="relative h-10 w-10 flex items-center justify-center rounded-full bg-[#111111]/40 border border-white/5 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">{wishlistCount > 0 ? 'favorite' : 'favorite'}</span>
          <span className={`material-symbols-outlined text-[20px] text-[#C9A06C] ${wishlistCount > 0 ? 'filled' : ''}`} style={{ fontVariationSettings: wishlistCount > 0 ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
          {wishlistCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#FF4D6D] text-[8px] font-bold text-white ring-2 ring-[#111111]">
                    {wishlistCount}
                </span>
            )}
        </button>
      </div>

      {/* Member Selector */}
      {isClothing && (
          <div className="px-6 py-4 flex items-center justify-center">
              <button 
                onClick={() => {
                  if (members.length > 0) {
                    setShowMemberSelector(!showMemberSelector);
                  }
                }}
                className="flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-[#C9A06C]/20 shadow-xl active:scale-95 transition-all"
              >
                  <div className="h-6 w-6 rounded-full bg-[#C9A06C] flex items-center justify-center">
                      <span className="material-symbols-outlined text-[14px] text-[#111111]">person</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      Fit for: {fitTargetLabel}
                  </span>
                  {members.length > 0 && (
                    <motion.span 
                      animate={{ rotate: showMemberSelector ? 180 : 0 }}
                      className="material-symbols-outlined text-sm text-[#C9A06C]"
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
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute top-32 left-0 right-0 z-[60] px-6"
            >
                <div className="bg-[#1A1A1A] rounded-[2rem] shadow-2xl border border-[#C9A06C]/20 p-3 flex flex-col gap-1">
                    {members.map(member => (
                        <button 
                            key={member.id}
                            onClick={() => {
                                handleProfileChange(member);
                                setShowMemberSelector(false);
                            }}
                            className={`flex items-center justify-between p-4 rounded-2xl active:scale-95 transition-all ${selectedMemberId === member.id ? 'bg-[#C9A06C]/10' : ''}`}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${member.isPrimary ? 'bg-[#C9A06C] text-[#111111]' : 'bg-white/5 text-white'}`}>
                                    <span className="material-symbols-outlined text-lg">{member.isPrimary ? 'person' : 'group'}</span>
                                </div>
                                <span className="font-bold text-base text-white">{member.name}</span>
                            </div>
                            {selectedMemberId === member.id && <span className="material-symbols-outlined text-[#C9A06C] text-lg">check</span>}
                        </button>
                    ))}
                    <div className="h-[1px] bg-white/5 my-2"></div>
                    <button 
                        onClick={() => navigate('/settings')}
                        className="flex items-center justify-center p-4 text-[#C9A06C] font-bold text-sm uppercase tracking-widest active:scale-95"
                    >
                        Manage Profiles
                    </button>
                </div>
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[-1] bg-black/60 backdrop-blur-sm" 
                    onClick={() => setShowMemberSelector(false)}
                ></motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Scroll Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-48" onClick={() => setShowMemberSelector(false)}>
             {isClothing ? (
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col"
            >
                {/* Editorial Product Header */}
                <div className="p-6">
                    <div className="flex flex-col gap-4 rounded-[2.5rem] bg-gradient-to-br from-[#1A1A1A] to-[#111111] p-8 border border-white/5 shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-[#C9A06C]/10 blur-[60px] rounded-full -mr-16 -mt-16"></div>
                        
                        <div className="flex gap-6 items-center">
                            <motion.img 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                src={displayProduct.image}
                                alt={displayProduct.title}
                                className="w-24 h-32 object-cover rounded-2xl flex-shrink-0 border border-white/10 shadow-2xl"
                            />
                            <div className="flex flex-col flex-1">
                                <h3 className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.3em] mb-2">{displayProduct.brand}</h3>
                                <p className="text-2xl font-serif font-medium text-white leading-tight line-clamp-2 italic">{displayProduct.title}</p>
                                <div className="flex items-center gap-3 mt-4">
                                    <span className="text-xl font-bold text-white">{displayProduct.price}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Error Banner */}
                {engineError && (
                    <div className="px-6 pb-2">
                        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
                            <span className="material-symbols-outlined text-red-400 text-lg mt-0.5">error</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Engine Error</p>
                                <p className="text-sm text-red-300/80 break-words">{engineError}</p>
                            </div>
                            <button onClick={() => setEngineError(null)} className="text-red-400/50 hover:text-red-400 transition-colors flex-shrink-0">
                                <span className="material-symbols-outlined text-base">close</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Main Recommendation Panel */}
                <div className="px-6 pb-6">
                    <div className="flex flex-col gap-8 rounded-[3rem] bg-[#1A1A1A] p-10 shadow-2xl border border-[#C9A06C]/30 relative overflow-hidden">
                        
                        {loadingStage > 0 && !visibleAiResult ? (
                            <div className="flex flex-col gap-6 py-16 animate-pulse">
                                <div className="flex flex-col items-center text-center gap-5">
                                    <div className="w-14 h-14 rounded-full border-2 border-[#C9A06C]/20 border-t-[#C9A06C] animate-spin"></div>
                                    <p className="text-sm font-bold uppercase tracking-[0.3em] text-[#C9A06C]">Analyzing product…</p>
                                </div>

                                {/* Skeleton: size badge */}
                                <div className="flex flex-col items-center gap-4 mt-4">
                                    <div className="h-4 w-32 rounded-full bg-white/5"></div>
                                    <div className="h-28 w-28 rounded-3xl bg-white/5"></div>
                                    <div className="h-4 w-24 rounded-full bg-white/5"></div>
                                </div>

                                {/* Skeleton: confidence bar */}
                                <div className="flex flex-col gap-3 mt-4">
                                    <div className="flex justify-between">
                                        <div className="h-3 w-28 rounded-full bg-white/5"></div>
                                        <div className="h-3 w-10 rounded-full bg-white/5"></div>
                                    </div>
                                    <div className="h-3 w-full rounded-full bg-white/5"></div>
                                </div>

                                {/* Skeleton: detail block */}
                                <div className="rounded-[2rem] bg-white/[0.02] border border-white/5 p-8 mt-2 flex flex-col gap-3">
                                    <div className="h-4 w-full rounded-full bg-white/5"></div>
                                    <div className="h-4 w-3/4 rounded-full bg-white/5"></div>
                                    <div className="h-4 w-1/2 rounded-full bg-white/5 mt-2"></div>
                                </div>
                            </div>
                        ) : visibleAiResult ? (
                            <motion.div 
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex flex-col items-center text-center gap-8 relative z-10 w-full"
                            >
                                
                                {/* Size Badge */}
                                <div className="flex flex-col items-center">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.5em] text-[#C9A06C] mb-4">Recommended Size</span>
                                    <div className="relative">
                                        <motion.h2 
                                            initial={{ scale: 0.5, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            transition={{ type: "spring", damping: 12 }}
                                            className="text-[12rem] font-serif font-light text-white leading-none tracking-tighter"
                                        >
                                            {visibleAiResult.recommendedSize}
                                        </motion.h2>
                                        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap">
                                            <div className={`px-6 py-2 rounded-full border bg-[#111111] text-[10px] font-bold uppercase tracking-[0.3em] ${getDirectionColor(visibleAiResult.sizeDirection)}`}>
                                                {visibleAiResult.sizeDirection.replace(/-/g, ' ')}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Confidence Bar */}
                                <div className="w-full flex flex-col gap-3 mt-8">
                                    <div className="flex justify-between items-center px-2">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Confidence Level</span>
                                        <span className="text-sm font-bold text-[#C9A06C]">{visibleAiResult.confidence}%</span>
                                    </div>
                                    <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden p-[2px] border border-white/10">
                                        <motion.div 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${visibleAiResult.confidence}%` }}
                                            transition={{ duration: 1.5, ease: "easeOut" }}
                                            className="h-full rounded-full bg-gradient-to-r from-[#B5853F] to-[#C9A06C]"
                                        ></motion.div>
                                    </div>
                                </div>

                                {/* Details from API */}
                                <div className="w-full bg-white/5 rounded-[2rem] p-8 text-left border border-white/10 mt-4">
                                    <p className="text-sm text-white/70 leading-relaxed mb-5">
                                        {visibleAiResult.reasoning}
                                    </p>
                                    <div className="flex flex-wrap gap-3">
                                        <div className="flex items-center gap-2 px-4 py-2 bg-[#FF4D6D]/10 rounded-full border border-[#FF4D6D]/20">
                                            <span className="text-[10px] font-bold text-[#FF4D6D] uppercase tracking-widest">Return Risk:</span>
                                            <span className="text-xs font-bold text-white">{visibleAiResult.fitNotes}</span>
                                        </div>
                                        {visibleAiResult.alternativeSize && (
                                            <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
                                                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Engine:</span>
                                                <span className="text-xs font-bold text-white">{visibleAiResult.alternativeSize}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {visibleAiResult.isOffline && (
                                    <p className="text-xs font-medium text-amber-400/70 tracking-wide max-w-[80%] flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">cloud_off</span>
                                        Offline estimate — results may be less accurate
                                    </p>
                                )}

                                <div className="w-full rounded-[2rem] bg-white/[0.03] border border-white/10 p-6 text-left">
                                    <div className="flex items-center justify-between gap-4 mb-4">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#C9A06C]">Fit Feedback</span>
                                        {hasSubmittedFeedback && (
                                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">Saved</span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {FEEDBACK_OPTIONS.map(option => {
                                            const isSelected = feedbackForRecommendation === option.type;
                                            return (
                                                <button
                                                    key={option.type}
                                                    type="button"
                                                    onClick={() => handleRecommendationFeedback(option.type)}
                                                    disabled={hasSubmittedFeedback}
                                                    className={`min-h-12 rounded-2xl border px-3 text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95 ${
                                                        isSelected
                                                            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                                                            : hasSubmittedFeedback
                                                                ? 'border-white/5 bg-white/[0.02] text-white/25 cursor-not-allowed'
                                                                : 'border-white/10 bg-white/5 text-white/70 hover:border-[#C9A06C]/30 hover:text-white'
                                                    }`}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="w-full rounded-[2rem] bg-white/[0.03] border border-white/10 p-6 text-left">
                                    <div className="flex items-center justify-between gap-4 mb-4">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#C9A06C]">Outcome</span>
                                        {(hasPurchasedOutcome || hasExchangedOutcome || hasReturnedOutcome) && (
                                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">Tracked</span>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <button
                                            type="button"
                                            onClick={handleProductPurchased}
                                            disabled={hasPurchasedOutcome}
                                            className={`min-h-12 rounded-2xl border px-2 text-[9px] font-bold uppercase tracking-widest transition-all active:scale-95 ${
                                                hasPurchasedOutcome
                                                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 cursor-not-allowed'
                                                    : 'border-white/10 bg-white/5 text-white/70 hover:border-[#C9A06C]/30 hover:text-white'
                                            }`}
                                        >
                                            Purchased
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveOutcomeForm(activeOutcomeForm === 'exchange' ? null : 'exchange')}
                                            disabled={hasExchangedOutcome}
                                            className={`min-h-12 rounded-2xl border px-2 text-[9px] font-bold uppercase tracking-widest transition-all active:scale-95 ${
                                                hasExchangedOutcome
                                                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 cursor-not-allowed'
                                                    : activeOutcomeForm === 'exchange'
                                                        ? 'border-[#C9A06C]/40 bg-[#C9A06C]/10 text-[#C9A06C]'
                                                        : 'border-white/10 bg-white/5 text-white/70 hover:border-[#C9A06C]/30 hover:text-white'
                                            }`}
                                        >
                                            Exchanged
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setActiveOutcomeForm(activeOutcomeForm === 'return' ? null : 'return')}
                                            disabled={hasReturnedOutcome}
                                            className={`min-h-12 rounded-2xl border px-2 text-[9px] font-bold uppercase tracking-widest transition-all active:scale-95 ${
                                                hasReturnedOutcome
                                                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300 cursor-not-allowed'
                                                    : activeOutcomeForm === 'return'
                                                        ? 'border-[#C9A06C]/40 bg-[#C9A06C]/10 text-[#C9A06C]'
                                                        : 'border-white/10 bg-white/5 text-white/70 hover:border-[#C9A06C]/30 hover:text-white'
                                            }`}
                                        >
                                            Returned
                                        </button>
                                    </div>

                                    {activeOutcomeForm === 'exchange' && !hasExchangedOutcome && (
                                        <div className="grid grid-cols-2 gap-3 mt-4">
                                            <input
                                                value={exchangeOriginalSize}
                                                onChange={(event) => setExchangeOriginalSize(event.target.value)}
                                                placeholder={`Original ${visibleAiResult.recommendedSize}`}
                                                className="h-12 rounded-2xl border border-white/10 bg-[#111111] px-4 text-xs font-bold text-white outline-none placeholder:text-white/25 focus:border-[#C9A06C]/40"
                                            />
                                            <input
                                                value={exchangeNewSize}
                                                onChange={(event) => setExchangeNewSize(event.target.value)}
                                                placeholder="New size"
                                                className="h-12 rounded-2xl border border-white/10 bg-[#111111] px-4 text-xs font-bold text-white outline-none placeholder:text-white/25 focus:border-[#C9A06C]/40"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleSizeExchanged}
                                                className="col-span-2 h-12 rounded-2xl bg-[#C9A06C] text-[#111111] text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
                                            >
                                                Save Exchange
                                            </button>
                                        </div>
                                    )}

                                    {activeOutcomeForm === 'return' && !hasReturnedOutcome && (
                                        <div className="grid grid-cols-2 gap-3 mt-4">
                                            <input
                                                value={returnedSize}
                                                onChange={(event) => setReturnedSize(event.target.value)}
                                                placeholder={`Returned ${visibleAiResult.recommendedSize}`}
                                                className="h-12 rounded-2xl border border-white/10 bg-[#111111] px-4 text-xs font-bold text-white outline-none placeholder:text-white/25 focus:border-[#C9A06C]/40"
                                            />
                                            <select
                                                value={returnReason}
                                                onChange={(event) => setReturnReason(event.target.value)}
                                                className="h-12 rounded-2xl border border-white/10 bg-[#111111] px-4 text-xs font-bold text-white outline-none focus:border-[#C9A06C]/40"
                                            >
                                                <option value="">Reason</option>
                                                <option value="too_tight">Too tight</option>
                                                <option value="too_loose">Too loose</option>
                                                <option value="wrong_size">Wrong size</option>
                                                <option value="other">Other</option>
                                            </select>
                                            <button
                                                type="button"
                                                onClick={handleSizeReturned}
                                                className="col-span-2 h-12 rounded-2xl bg-[#C9A06C] text-[#111111] text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
                                            >
                                                Save Return
                                            </button>
                                        </div>
                                    )}
                                </div>

                            </motion.div>
                        ) : (
                            <div className="flex flex-col items-center text-center gap-5 py-16 opacity-60">
                                <span className="material-symbols-outlined text-4xl text-[#C9A06C]">info</span>
                                <p className="text-sm font-bold uppercase tracking-[0.3em] text-[#C9A06C]">No data yet</p>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>
        ) : (
             /* --- LAYOUT 2: Standard E-Commerce (Accessories, etc) --- */
             <div className="flex flex-col">
                 <div className="w-full aspect-[4/5] bg-[#1A1A1A] relative overflow-hidden">
                     <motion.div 
                        initial={{ scale: 1.1 }}
                        animate={{ scale: 1 }}
                        className="absolute inset-0 bg-center bg-cover"
                        style={{ backgroundImage: `url("${displayProduct.image}")` }}
                     ></motion.div>
                     <div className="absolute inset-0 bg-gradient-to-t from-[#111111] to-transparent"></div>
                 </div>

                 <div className="flex flex-col p-8 gap-8 -mt-20 relative z-10">
                     <div className="bg-[#1A1A1A] p-8 rounded-[3rem] border border-white/5 shadow-2xl">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex-1 pr-4">
                                <h3 className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.3em] mb-3">{displayProduct.brand}</h3>
                                <h1 className="text-4xl font-serif text-white leading-tight italic">{displayProduct.title}</h1>
                            </div>
                             <div className="flex flex-col items-end">
                                <span className="text-3xl font-bold text-white">{displayProduct.price}</span>
                             </div>
                        </div>
                        <div className="h-[1px] w-full bg-white/5 mb-6"></div>
                        <div>
                            <h4 className="text-xs font-bold text-[#C9A06C] uppercase tracking-[0.2em] mb-4">The Details</h4>
                            <p className="text-white/60 leading-relaxed text-sm font-light">
                                This {displayProduct.title.toLowerCase()} from {displayProduct.brand} combines timeless elegance with modern durability. Crafted from high-quality materials, it is designed to last and elevate your style for any occasion.
                            </p>
                        </div>
                     </div>
                 </div>
             </div>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-8 bg-gradient-to-t from-[#111111] via-[#111111]/90 to-transparent">
        <div className="max-w-md mx-auto flex flex-col gap-4">
          <motion.button 
            whileTap={{ scale: 0.95 }}
            onClick={source === 'marketplace' ? handleBuyNow : handleExternalBuy}
            disabled={loadingStage > 0}
            className={`w-full h-18 rounded-[2rem] font-bold text-sm uppercase tracking-[0.3em] flex items-center justify-center gap-3 transition-all ${
              loadingStage > 0
                ? 'bg-white/10 text-white/30 cursor-not-allowed'
                : 'bg-[#FF4D6D] text-white shadow-[0_10px_30px_rgba(255,77,109,0.3)] active:scale-95'
            }`}
          >
            {loadingStage > 0 ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white/70 rounded-full animate-spin"></div>
                Analyzing…
              </>
            ) : (
              <>
                OPEN PRODUCT
                <span className="material-symbols-outlined text-[20px]">open_in_new</span>
              </>
            )}
          </motion.button>
          
          <div className="flex gap-4">
            <button 
                onClick={toggleWishlist} 
                className="flex-1 h-14 rounded-2xl bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] active:scale-95 transition-all flex items-center justify-center gap-2"
            >
                <span className={`material-symbols-outlined text-sm ${likedMap[displayProduct.id || displayProduct.title.replace(/\s+/g, '-').toLowerCase()] ? 'text-[#FF4D6D] filled' : ''}`} style={{ fontVariationSettings: likedMap[displayProduct.id || displayProduct.title.replace(/\s+/g, '-').toLowerCase()] ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
                {likedMap[displayProduct.id || displayProduct.title.replace(/\s+/g, '-').toLowerCase()] ? 'In Wishlist' : 'Add to Wishlist'}
            </button>
            <button 
                onClick={handleExploreMore} 
                className="flex-1 h-14 rounded-2xl bg-white/5 border border-white/10 text-white/50 font-bold uppercase tracking-widest text-[10px] active:scale-95 transition-all"
            >
                Explore More
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Recommendation;
