import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { auth } from '../firebase';
import { getUserRole, UserRole } from '../utils/subscription';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import type { UserMeasurements, UserProfile } from '../contexts/UserProfileContext';
import {
  extractProduct,
  isValidUrl,
  normalizeUrl,
  predictSize,
  recommendSize,
  validateProductUrl,
} from '../services/ziprightApi';
import {
  buildSizeEngineProfileFromUserProfile,
  hasBodyMeasurements,
} from '../utils/sizeProfile';
import {
  extractAvailableProductSizes,
  normalizeProductSizeChart,
  refineProductRecommendation,
} from '../utils/productSizingIntelligence';
import {
  createRecommendationId,
  trackRecommendationAccepted,
  trackRecommendationGenerated,
  trackRecommendationRejected,
  trackRecommendationViewed,
} from '../services/recommendationAnalytics';
import { AppBar, Button, Chip, Eyebrow, Sheet, SegmentedControl, Spinner } from '../components/ui';

interface Member {
  id: string;
  name: string;
  isPrimary: boolean;
}

interface UnifiedProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  category: string;
  url?: string;
  [key: string]: any;
}

const SESSION_HISTORY_KEY = 'zr_session_history';
const ADD_PRODUCT_DRAFT_KEY = 'zr_add_product_draft';
const ACTIVE_RECOMMENDATION_KEY = 'zr_active_recommendation';
const DEMO_AUTH_KEY = 'zipright_demo_user';

interface AddProductDraft {
  link: string;
  activeTab: 'link' | 'image';
}

function hasDemoSession() {
  return Boolean(localStorage.getItem(DEMO_AUTH_KEY));
}

function readAddProductDraft(): AddProductDraft {
  try {
    const raw = sessionStorage.getItem(ADD_PRODUCT_DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      link: typeof parsed?.link === 'string' ? parsed.link : '',
      activeTab: parsed?.activeTab === 'image' ? 'image' : 'link',
    };
  } catch {
    return { link: '', activeTab: 'link' };
  }
}

function writeAddProductDraft(draft: AddProductDraft) {
  try {
    sessionStorage.setItem(ADD_PRODUCT_DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

function writeActiveRecommendation(payload: unknown) {
  try {
    sessionStorage.setItem(ACTIVE_RECOMMENDATION_KEY, JSON.stringify(payload));
  } catch {}
}

function cleanValue(value: unknown, emptyValue = '') {
  if (!value || value === 'Not found') return emptyValue;
  return String(value);
}

function normalizeBrand(brand?: string) {
  return brand?.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeCategory(category?: string) {
  const c = category?.toLowerCase() || '';

  if (c.includes('shirt')) return 'tshirt';
  if (c.includes('tshirt')) return 'tshirt';
  if (c.includes('coat') || c.includes('jacket')) return 'jacket';

  return c || '';
}

function normalizeSizeChart(sizeChart: unknown): Record<string, number> | undefined {
  return normalizeProductSizeChart(sizeChart);
}

function getRecommendationAnalyticsKey(product: any) {
  return [
    product?.recommendationId,
    product?.id,
    product?.url,
    product?.title,
    product?.engineRecommendedSize,
    product?.recommendedSize,
  ].map(value => String(value || '').trim()).join('::');
}

/**
 * REMOVED: Previously fabricated measurements from height alone using
 * arbitrary ratios (e.g. chest = height × 0.53). This made the AI appear
 * to "know" the user's body without any real data.
 *
 * Now returns null — the sizing engine will refuse to run without real
 * measurements from Smart Fit Scan or manually entered profile data.
 */
function convertManualToMeasurements(_profile: Pick<UserProfile, 'height'>): UserMeasurements | null {
  return null;
}

/** Editorial status slip — request errors / ready states / profile notices. */
const StatusSlip: React.FC<{
  tone: 'danger' | 'success' | 'warning';
  icon: string;
  label: string;
  message: string;
}> = ({ tone, icon, label, message }) => {
  const tones = {
    danger: 'border-danger/25 bg-danger-soft text-danger',
    success: 'border-success/25 bg-success-soft text-success',
    warning: 'border-warning/25 bg-warning-soft text-warning',
  };
  return (
    <div className={`mb-5 rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-[18px] mt-0.5" aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-0.5">{label}</p>
          <p className="text-[13px] text-ink-soft break-words leading-relaxed">{message}</p>
        </div>
      </div>
    </div>
  );
};

const AddProduct: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { profile, isHydrated } = useUserProfile();
  const initialDraft = useRef(readAddProductDraft());
  const [link, setLink] = useState(initialDraft.current.link);
  const [activeTab, setActiveTab] = useState<'link' | 'image'>(initialDraft.current.activeTab);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [isListing, setIsListing] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [recommendedSize, setRecommendedSize] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [recommendationReason, setRecommendationReason] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const prefill = location.state?.prefill as Partial<UnifiedProduct> | undefined;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setHistory(Array.isArray(parsed) ? parsed.slice(0, 5) : []);
    } catch {
      setHistory([]);
    }
  }, []);

  // Image Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analyzedProduct, setAnalyzedProduct] = useState<any>(null);
  const hasAppliedPrefillRef = useRef(false);
  const viewedAnalyticsKeysRef = useRef<Set<string>>(new Set());
  const rejectedAnalyticsKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    writeAddProductDraft({ link, activeTab });
  }, [activeTab, link]);

  useEffect(() => {
    if (profile?.profileName) {
      setMembers([{
        id: auth.currentUser?.uid || 'current-user',
        name: profile.profileName,
        isPrimary: true,
      }]);
    } else {
      setMembers([]);
    }

    setUserRole(getUserRole());
  }, [profile?.profileName]);

  const normalizedProfile = {
    height: Number(profile?.height || 0),
    weight: Number(profile?.weight || 0),
    bodyShape: profile?.bodyShape || "",
  };

  useEffect(() => {
    console.log("AddProduct profile:", profile);
    console.log("Normalized profile:", normalizedProfile);
    console.log("hasManual:", hasManual);
  }, [profile]);

  const hasManual =
    normalizedProfile.height > 0 &&
    normalizedProfile.weight > 0 &&
    normalizedProfile.bodyShape !== "";
  const hasScan = Boolean(
    profile?.measurements?.shoulders ||
    profile?.measurements?.arms ||
    profile?.measurements?.legs ||
    profile?.measurements?.torso,
  ) || (hasBodyMeasurements(profile?.measurements ?? {}) && normalizedProfile.bodyShape === "");
  const hasProfileMeasurements = hasBodyMeasurements(profile?.measurements ?? {});
  const savedBaseSize = profile?.baseSize || profile?.usualSize;
  const eligibilityLabel = hasScan
    ? 'Using Smart Scan'
    : hasProfileMeasurements
      ? 'Using saved measurements'
      : hasManual
        ? 'Manual profile saved'
        : null;

  useEffect(() => {
    if (activeTab === 'link') {
        let nextIsValid = false;
        if (link.trim()) {
          const normalizedUrl = normalizeUrl(link);
          if (isValidUrl(normalizedUrl)) {
            try {
              validateProductUrl(normalizedUrl);
              nextIsValid = true;
            } catch {
              nextIsValid = false;
            }
          }
        }
        setIsValid(nextIsValid);
    } else {
        setIsValid(!!selectedImage);
    }
  }, [link, selectedImage, activeTab]);

  const handleBack = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/home');
    }
  };

  const normalizeProductData = (rawProduct: any, sourceUrl = ''): UnifiedProduct => {
    const title = cleanValue(rawProduct?.title);
    const brand = cleanValue(rawProduct?.brand);
    const rawCategory = cleanValue(rawProduct?.category);
    const category = normalizeCategory(rawCategory);
    const image = cleanValue(rawProduct?.image);
    const url = cleanValue(rawProduct?.url, sourceUrl);

    if (!title || !brand || !category || !image || !url) {
      throw new Error('Product data missing. Please try another product link.');
    }

    return {
      id: rawProduct?.id || url,
      title,
      brand,
      price: rawProduct?.price || '',
      image,
      category,
      url,
      subtitle: cleanValue(rawProduct?.subtitle),
      description: cleanValue(rawProduct?.description),
      tags: Array.isArray(rawProduct?.tags) ? rawProduct.tags : undefined,
      metadata: rawProduct?.metadata && typeof rawProduct.metadata === 'object' ? rawProduct.metadata : undefined,
      product_metadata: rawProduct?.product_metadata && typeof rawProduct.product_metadata === 'object' ? rawProduct.product_metadata : undefined,
      fit_hint: typeof rawProduct?.fit_hint === 'string' ? rawProduct.fit_hint : undefined,
      size_chart: normalizeSizeChart(rawProduct?.size_chart ?? rawProduct?.sizeChart),
      available_sizes: extractAvailableProductSizes(rawProduct),
      size_format: typeof rawProduct?.size_format === 'string' ? rawProduct.size_format : undefined,
    };
  };

  const refineEngineResult = (productData: UnifiedProduct, result: { size: string; confidence: number; reason?: string; risk?: string }) => {
    const recommendationId = String(productData.recommendationId || '').trim() || createRecommendationId();
    const refined = refineProductRecommendation({
      product: productData,
      engineResult: result,
      profile: {
        baseSize: savedBaseSize,
        fitPreference: profile?.fitPreference || 'regular',
        measurements: profile?.measurements ?? {},
      },
    });
    const formattedConfidence = `${refined.confidence}%`;
    setRecommendedSize(refined.size);
    setConfidence(formattedConfidence);
    setRecommendationReason(refined.reason);

    void trackRecommendationGenerated({
      recommendationId,
      userId: auth.currentUser?.uid,
      product: productData,
      backendSize: refined.mappedFromEngine || result.size,
      finalSize: refined.size,
      confidence: refined.confidence,
      screenSource: 'add-product',
    });

    return {
      ...productData,
      recommendationId,
      recommendedSize: refined.size,
      confidence: formattedConfidence,
      recommendationReason: refined.reason,
      sizeDirection: refined.sizeDirection,
      available_sizes: refined.availableSizes,
      size_format: refined.sizeFormat,
      engineRecommendedSize: result.size,
    };
  };

  useEffect(() => {
    if (!isModalOpen || !analyzedProduct?.recommendedSize) return;

    const key = getRecommendationAnalyticsKey(analyzedProduct);
    if (viewedAnalyticsKeysRef.current.has(key)) return;

    viewedAnalyticsKeysRef.current.add(key);
    void trackRecommendationViewed({
      recommendationId: analyzedProduct.recommendationId,
      userId: auth.currentUser?.uid,
      product: analyzedProduct,
      backendSize: analyzedProduct.engineRecommendedSize,
      finalSize: analyzedProduct.recommendedSize,
      confidence: analyzedProduct.confidence,
      screenSource: 'add-product',
    });
  }, [analyzedProduct, isModalOpen]);

  const applySizeEngine = async (productData: UnifiedProduct) => {
    const sizeProfile = buildSizeEngineProfileFromUserProfile({
      height: normalizedProfile.height,
      weight: normalizedProfile.weight,
      bodyShape: normalizedProfile.bodyShape || undefined,
      baseSize: savedBaseSize,
      fitPreference: profile?.fitPreference,
      measurements: profile?.measurements ?? {},
    });
    if (!sizeProfile) {
      throw new Error('Complete Smart Fit Scan to reveal your size.');
    }

    const result = await recommendSize({
      product: {
        id: productData.id,
        title: productData.title,
        brand: normalizeBrand(productData.brand) || productData.brand,
        category: productData.category,
        price: productData.price,
        image: productData.image,
        url: productData.url || '',
        source: 'link',
        confidence: 0.7,
        fit_hint: productData.fit_hint,
        size_chart: productData.size_chart,
        available_sizes: productData.available_sizes,
        size_format: productData.size_format,
      },
      profile: sizeProfile,
    });

    return refineEngineResult(productData, result);
  };

  const applyPredictedSize = async (productData: UnifiedProduct, productLink: string) => {
    const normalizedUrl = normalizeUrl(productLink);
    const normalizedLink = validateProductUrl(normalizedUrl);

    if (normalizedProfile.height <= 0) {
      throw new Error('Please add your height in Smart Fit Scan first.');
    }

    let finalMeasurements: UserMeasurements;
    if (hasProfileMeasurements) {
      finalMeasurements = profile?.measurements ?? {};
    } else if (hasManual) {
      const manualMeasurements = convertManualToMeasurements(normalizedProfile);
      if (!manualMeasurements) {
        throw new Error('Height and weight alone are not enough for sizing. Complete Smart Fit Scan for accurate results.');
      }
      finalMeasurements = manualMeasurements;
    } else {
      throw new Error('Complete Smart Fit Scan OR fill your Fit Profile');
    }

    console.log('Sending:', {
      link: normalizedLink,
      height: normalizedProfile.height,
      measurementSource: hasScan ? 'smart-scan' : 'manual-profile',
      measurements: finalMeasurements,
    });

    const result = await predictSize({
      link: normalizedLink,
      height: normalizedProfile.height,
      measurements: finalMeasurements,
      product: {
        id: productData.id,
        title: productData.title,
        brand: normalizeBrand(productData.brand) || productData.brand,
        category: productData.category,
        price: productData.price,
        image: productData.image,
        url: normalizedLink,
        source: 'link',
        confidence: 0.85,
        fit_hint: productData.fit_hint,
        size_chart: productData.size_chart,
        available_sizes: productData.available_sizes,
        size_format: productData.size_format,
      },
      fitPreference: profile?.fitPreference || 'regular',
    });

    return {
      ...refineEngineResult(productData, result),
      url: normalizedLink,
    };
  };

  useEffect(() => {
    if (!isHydrated || !prefill || hasAppliedPrefillRef.current) return;
    const runPrefill = async () => {
      hasAppliedPrefillRef.current = true;
      const normalizedPrefill = normalizeProductData(prefill, prefill.url || '');
      const enrichedProduct = normalizedPrefill.url
        ? await applyPredictedSize(normalizedPrefill, normalizedPrefill.url)
        : await applySizeEngine(normalizedPrefill);
      setAnalyzedProduct(enrichedProduct);
      setLink(enrichedProduct.url || '');
      setIsModalOpen(true);
    };
    runPrefill().catch(() => {
      console.error('Prefill handling failed during initial load.');
      setRequestError('Data unavailable');
      showToast('Could not preload this product. Please try again.', 'error');
    });
  }, [isHydrated, prefill, showToast]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (e) => {
              if (e.target?.result) {
                  setSelectedImage(e.target.result as string);
              }
          };
          reader.readAsDataURL(event.target.files[0]);
      }
  };

  const handleRevealSize = async () => {
    console.log("Reveal clicked");
    setRequestError(null);
    setRequestSuccess(null);
    setRecommendationReason(null);

    if (!isHydrated) {
      setRequestError('Loading profile...');
      return;
    }

    if (activeTab === 'link' && !prefill && !isValid) {
      const message = 'Enter a valid product link to continue.';
      setRequestError(message);
      showToast(message, 'error');
      return;
    }
    const user = auth.currentUser;
    if (!user && !hasDemoSession()) {
      setRequestError('Please login to analyze products');
      showToast("Please login to analyze products", "error");
      return;
    }
    setIsLoading(true);
    if (navigator.vibrate) navigator.vibrate(20);

    if (!profile?.profileName || !savedBaseSize) {
      setIsLoading(false);
      navigate('/fit-profile', { state: { mode: 'add', returnTo: '/add-product' } });
      return;
    }

    if (prefill) {
        try {
            const normalizedPrefill = normalizeProductData(prefill, prefill.url || '');
            const enrichedProduct = normalizedPrefill.url
              ? await applyPredictedSize(normalizedPrefill, normalizedPrefill.url)
              : await applySizeEngine(normalizedPrefill);
            setAnalyzedProduct(enrichedProduct);
            setIsModalOpen(true);
            setRequestSuccess('Size recommendation ready.');
            showToast("Product loaded from feed successfully.", "success");
        } catch (error) {
            console.error("Prefill handling failed", error);
            setRequestError(error instanceof Error ? error.message : 'Data unavailable');
            showToast("Could not use feed product. Please try again.", "error");
        } finally {
            setIsLoading(false);
        }
        return;
    }

    if (activeTab === 'image' && selectedImage) {
        const message = 'Image-based product analysis is unavailable for this demo. Paste a product link instead.';
        setRequestError(message);
        showToast(message, 'error');
        setIsLoading(false);
        return;
    }

    if (activeTab === 'image' && !selectedImage) {
        const message = 'Please upload a photo first.';
        setRequestError(message);
        showToast(message, 'error');
        setIsLoading(false);
        return;
    }

    try {
        const normalizedUrl = normalizeUrl(link);
        const normalizedLink = validateProductUrl(normalizedUrl);
        setLink(normalizedLink);
        if (!hasSavedMeasurements) {
            const message = 'Complete Smart Fit Scan OR fill your Fit Profile';
            setRequestError(message);
            showToast(message, 'error');
            setIsLoading(false);
            return;
        }

        console.log('[AddProduct] Calling /extract-product with URL:', normalizedLink);
        const extractedProduct = await extractProduct(normalizedLink);
        const productData = normalizeProductData(extractedProduct, normalizedLink);
        console.log('[AddProduct] Final productData:', productData);
        const enrichedProduct = hasPredictedSizingProfile
          ? await applyPredictedSize(productData, normalizedLink)
          : await applySizeEngine(productData);
        console.debug('[AddProduct] Size result:', {
            recommendedSize: enrichedProduct.recommendedSize,
            confidence: enrichedProduct.confidence,
        });
        setAnalyzedProduct(enrichedProduct);
        setIsModalOpen(true);
        setRequestSuccess('Size recommendation ready.');
        showToast("Product link analyzed successfully.", "success");
    } catch (error) {
        console.error('[AddProduct] Link analysis failed:', error);
        const msg = error instanceof Error ? error.message : 'Could not analyze link. Please try again.';
        setRequestError(msg);
        showToast(msg, "error");
    } finally {
        setIsLoading(false);
    }
  };

  const handleProfileSelect = async () => {
    if (analyzedProduct?.recommendedSize) {
      void trackRecommendationAccepted({
        recommendationId: analyzedProduct.recommendationId,
        userId: auth.currentUser?.uid,
        product: analyzedProduct,
        backendSize: analyzedProduct.engineRecommendedSize,
        finalSize: analyzedProduct.recommendedSize,
        confidence: analyzedProduct.confidence,
        screenSource: 'add-product',
      });
    }

    setIsModalOpen(false);

    // Save to history
    const historyItem = {
        title: analyzedProduct.title,
        brand: analyzedProduct.brand,
        price: analyzedProduct.price,
        image: analyzedProduct.image,
        date: new Date().toLocaleDateString(),
        recommendedSize: analyzedProduct.recommendedSize,
        confidence: analyzedProduct.confidence,
        recommendationReason: analyzedProduct.recommendationReason,
    };

    try {
      const raw = sessionStorage.getItem(SESSION_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const nextHistory = [historyItem, ...(Array.isArray(parsed) ? parsed : [])].slice(0, 5);
      sessionStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(nextHistory));
      setHistory(nextHistory);
    } catch {}

    writeActiveRecommendation({
      product: analyzedProduct,
      productUrl: analyzedProduct?.url || link,
      selectedProfileId: profile?.selectedProfileId || profile?.profileId || auth.currentUser?.uid || 'current-user',
      source: 'add-product',
    });

    navigate('/recommendation', {
        state: {
            product: analyzedProduct,
            productUrl: analyzedProduct?.url || link,
            selectedProfileId: profile?.selectedProfileId || profile?.profileId,
            source: 'add-product',
        }
    });
  };

  const handleDismissRecommendationModal = () => {
    if (analyzedProduct?.recommendedSize) {
      const key = getRecommendationAnalyticsKey(analyzedProduct);
      if (!rejectedAnalyticsKeysRef.current.has(key)) {
        rejectedAnalyticsKeysRef.current.add(key);
        void trackRecommendationRejected({
          recommendationId: analyzedProduct.recommendationId,
          userId: auth.currentUser?.uid,
          product: analyzedProduct,
          backendSize: analyzedProduct.engineRecommendedSize,
          finalSize: analyzedProduct.recommendedSize,
          confidence: analyzedProduct.confidence,
          screenSource: 'add-product',
        });
      }
    }

    setIsModalOpen(false);
  };

  const handleListForSale = async () => {
    if (!analyzedProduct || !auth.currentUser) return;
    setIsListing(true);
    try {
        showToast('Marketplace listing is disabled in MVP phase 1.', 'error');
    } catch (error) {
        console.error("Error listing product:", error);
        showToast("Failed to list product.", "error");
    } finally {
        setIsListing(false);
    }
  };

  const quickLinks = [
    { name: 'Zara', url: 'https://www.zara.com/in/' },
    { name: 'H&M', url: 'https://www2.hm.com/en_in/' },
    { name: 'Myntra', url: 'https://www.myntra.com/' },
    { name: 'Ajio', url: 'https://www.ajio.com/' },
  ];

  const hasSavedMeasurements = hasProfileMeasurements;
  const hasPredictedSizingProfile = hasProfileMeasurements;
  const isActionDisabled = isLoading;

  return (
    <div className="relative flex h-full min-h-screen min-h-dvh w-full flex-col overflow-x-hidden bg-surface-0 text-ink">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>

      <AppBar title="The Fit Engine" onBack={handleBack} />

      <div className="flex-1 flex flex-col px-6 pt-8 pb-36">
        {/* Editorial opener */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Eyebrow className="mb-3">Size Match</Eyebrow>
          <h1 className="font-display text-[38px] leading-[1.05] font-light text-ink">
            {activeTab === 'link' ? <>Find your <em className="font-medium">fit.</em></> : <>Scan your <em className="font-medium">style.</em></>}
          </h1>
          <p className="text-ink-soft text-[14px] leading-relaxed max-w-[85%] mt-4">
            {activeTab === 'link' ? 'Paste the link of the piece you desire — we\'ll reveal your perfect size.' : 'Capture a clear image of the garment to begin the analysis.'}
          </p>
        </motion.div>

        {/* Mode selector */}
        <SegmentedControl
          aria-label="Input method"
          className="mb-10"
          value={activeTab}
          onChange={(v) => setActiveTab(v)}
          options={[
            { value: 'link', label: 'Paste link', icon: 'link' },
            { value: 'image', label: 'Upload photo', icon: 'photo_camera' },
          ]}
        />

        <div className="flex flex-col gap-8 mb-12">
          {activeTab === 'link' ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-8"
              >
                <div className="flex flex-col w-full relative group">
                    <input
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        disabled={isLoading}
                        className={`w-full bg-transparent border-b py-5 pr-16 text-[19px] text-ink placeholder:text-ink-faint focus:outline-none transition-colors ${isLoading ? 'border-line opacity-50' : 'border-line-strong focus:border-ink'}`}
                        placeholder="Paste or share link…"
                        type="url"
                        autoFocus
                    />
                    <div className="absolute right-0 bottom-5 flex items-center gap-3">
                        {link && !isLoading && (
                            <button
                                onClick={() => setLink('')}
                                aria-label="Clear link"
                                className="text-ink-faint hover:text-ink transition-colors"
                            >
                                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">close</span>
                            </button>
                        )}
                        {isLoading ? (
                            <Spinner size={18} className="text-brand mb-0.5" />
                        ) : (
                            <span className={`material-symbols-outlined mb-0.5 transition-colors ${isValid ? 'text-success' : 'text-ink-faint'}`} aria-hidden="true">
                                {isValid ? 'check_circle' : 'link'}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                    <Eyebrow>Quick access</Eyebrow>
                    <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                        {quickLinks.map((ql, idx) => (
                            <Chip key={idx} size="md" onClick={() => setLink(ql.url)}>
                                {ql.name}
                                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">arrow_outward</span>
                            </Chip>
                        ))}
                    </div>
                </div>
              </motion.div>
          ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative w-full aspect-[4/5] rounded-card border border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${selectedImage ? 'border-transparent' : 'border-line-strong bg-surface-1 hover:bg-surface-2'}`}
                  >
                      {selectedImage ? (
                          <>
                            <img src={selectedImage} alt="Selected" className="w-full h-full object-cover rounded-card" />
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center rounded-card opacity-0 hover:opacity-100 transition-opacity">
                                <span className="text-white text-[11px] font-semibold uppercase tracking-[0.12em] border border-white/40 px-6 py-3 rounded-full">Change photo</span>
                            </div>
                          </>
                      ) : (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 rounded-full border border-line-strong flex items-center justify-center">
                                <span className="material-symbols-outlined text-[28px] text-ink-faint" aria-hidden="true">add_a_photo</span>
                            </div>
                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Tap to capture</span>
                          </div>
                      )}
                  </div>
              </motion.div>
          )}
        </div>

        {/* Recent Scans Section */}
        {history.length > 0 && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-5 mb-12"
            >
                <div className="flex items-baseline justify-between">
                    <Eyebrow>Recent scans</Eyebrow>
                    <button onClick={() => navigate('/recent-scans')} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint underline underline-offset-4">View all</button>
                </div>
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                    {history.map((item, idx) => (
                        <button
                            key={idx}
                            onClick={() => navigate('/recommendation', { state: { product: item } })}
                            className="flex flex-col gap-3 min-w-[124px] active:scale-95 transition-transform text-left"
                        >
                            <div
                                className="w-full aspect-[3/4] rounded-xl bg-surface-2 border border-line bg-center bg-cover"
                                style={{ backgroundImage: `url("${item.image}")` }}
                            ></div>
                            <div className="flex flex-col items-start px-0.5">
                                <span className="font-display text-[14px] font-medium text-ink truncate w-full">{item.brand}</span>
                                <span className="text-[11.5px] text-ink-faint truncate w-full">{item.title}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </motion.div>
        )}

        {requestError && (
          <StatusSlip tone="danger" icon="error" label="Request failed" message={requestError} />
        )}

        {requestSuccess && !requestError && (
          <StatusSlip tone="success" icon="check_circle" label="Ready" message={requestSuccess} />
        )}

        {activeTab === 'link' && eligibilityLabel && (
          <StatusSlip tone="success" icon="verified" label="Profile source" message={eligibilityLabel} />
        )}

        {activeTab === 'link' && (
          <div className="mb-5 rounded-2xl border border-line bg-surface-1 px-4 py-3.5 flex items-center gap-5">
            <span className="eyebrow !text-[9px] shrink-0">Profile</span>
            <div className="flex gap-5 text-[12px] text-ink-soft">
              <span>Height <span className="text-ink font-medium">{profile?.height ?? '–'}</span></span>
              <span>Weight <span className="text-ink font-medium">{profile?.weight ?? '–'}</span></span>
              <span>Body <span className="text-ink font-medium">{profile?.bodyShape || '–'}</span></span>
            </div>
          </div>
        )}

        {activeTab === 'link' && !hasSavedMeasurements && (
          <StatusSlip tone="warning" icon="straighten" label="Smart Fit required" message="Complete Smart Fit Scan OR fill your Fit Profile." />
        )}

        {/* The engine's word */}
        <div className="mt-2 p-6 rounded-card bg-ink text-ink-invert relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-[50px] -mr-10 -mt-10" style={{ background: 'var(--brand)', opacity: 0.25 }} aria-hidden="true"></div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-50 mb-2">Neural sizing</p>
          <p className="font-display text-[19px] font-medium leading-snug mb-2">Cut to your geometry.</p>
          <p className="text-[13px] opacity-70 leading-relaxed">
            Our AI reads fabric drape, brand-specific patterns, and your unique measurements to land a flawless fit.
          </p>
        </div>
      </div>

      {/* Sticky Bottom CTA */}
      <div className="fixed bottom-0 inset-x-0 w-full p-6 pb-8 bg-gradient-to-t from-surface-0 via-surface-0/92 to-transparent z-50 pointer-events-none phone-fixed-bottom">
        <div className="pointer-events-auto">
          <Button
            size="lg"
            fullWidth
            loading={isLoading}
            disabled={isActionDisabled}
            trailingIcon="straighten"
            onClick={handleRevealSize}
          >
            {activeTab === 'image' ? 'Analyze garment' : 'Reveal my size'}
          </Button>
        </div>
      </div>

      {/* Profile Selection Sheet */}
      <Sheet open={isModalOpen} onClose={handleDismissRecommendationModal} title="Select profile">
        <p className="text-[13.5px] text-ink-soft leading-relaxed mb-6 -mt-1">
          Who are we styling today? We'll match the garment to their unique profile.
        </p>

        {analyzedProduct && recommendedSize && (
          <div className="mb-6 p-5 rounded-card border border-line bg-surface-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-brand mb-3">The verdict</p>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[34px] font-semibold text-ink leading-none">{recommendedSize}</span>
              <span className="text-[11px] uppercase tracking-[0.1em] text-ink-faint">Confidence {confidence || 'Medium'}</span>
            </div>
            {recommendationReason && (
              <p className="text-ink-soft text-[12.5px] mt-3 leading-relaxed">{recommendationReason}</p>
            )}
          </div>
        )}

        {userRole === 'seller' && (
          <div className="mb-6 p-5 rounded-card border border-success/25 bg-success-soft">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="material-symbols-outlined text-success text-[18px]" aria-hidden="true">storefront</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-success">Seller</span>
            </div>
            <Button fullWidth variant="secondary" icon="publish" loading={isListing} onClick={handleListForSale}>
              List for sale
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-3 max-h-[40vh] overflow-y-auto no-scrollbar">
          {members.map(member => (
            <button
              key={member.id}
              onClick={() => handleProfileSelect()}
              className="group flex items-center justify-between p-4 rounded-card bg-surface-1 border border-line hover:border-line-strong active:scale-[0.98] transition-[transform,border-color]"
            >
              <div className="flex items-center gap-4">
                <div className={`h-12 w-12 rounded-full flex items-center justify-center ${member.isPrimary ? 'bg-ink text-ink-invert' : 'border border-line text-ink'}`}>
                  {member.isPrimary
                    ? <span className="material-symbols-outlined text-[20px]" aria-hidden="true">person</span>
                    : <span className="font-display font-medium text-[17px]">{member.name.charAt(0)}</span>}
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-[15px] font-semibold text-ink">{member.name}</span>
                  {member.isPrimary && <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand mt-0.5">Primary fit</span>}
                </div>
              </div>
              <span className="material-symbols-outlined text-ink-faint text-[18px]" aria-hidden="true">arrow_forward</span>
            </button>
          ))}

          {members.length === 0 && (
            <button
              onClick={() => handleProfileSelect()}
              className="group flex items-center justify-between p-4 rounded-card bg-surface-1 border border-line hover:border-line-strong active:scale-[0.98] transition-[transform,border-color]"
            >
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full flex items-center justify-center bg-ink text-ink-invert">
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">straighten</span>
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-[15px] font-semibold text-ink">Current fit profile</span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand mt-0.5">Live Smart Fit data</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-ink-faint text-[18px]" aria-hidden="true">arrow_forward</span>
            </button>
          )}

          <button
            onClick={() => navigate('/fit-profile', { state: { mode: 'add', returnTo: '/add-product' } })}
            className="flex items-center justify-center p-5 mt-1 rounded-card border border-dashed border-line-strong text-ink-faint text-[11px] font-semibold uppercase tracking-[0.12em] gap-2.5 active:scale-[0.98] transition-transform hover:bg-surface-2"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add_circle</span>
            <span>Create new profile</span>
          </button>
        </div>
      </Sheet>
    </div>
  );
};

export default AddProduct;
