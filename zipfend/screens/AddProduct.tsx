import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
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
    <div className="relative flex h-full min-h-screen w-full flex-col overflow-x-hidden bg-[#111111] text-white font-sans">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload}/>

      {/* Top App Bar */}
      <div className="sticky top-0 z-50 flex items-center bg-[#111111]/80 backdrop-blur-xl p-6 justify-between border-b border-white/5">
        <button onClick={handleBack} className="text-[#C9A06C] flex size-12 shrink-0 items-center justify-start cursor-pointer active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </button>
        <h2 className="text-[#C9A06C] text-xs font-bold uppercase tracking-[0.3em] flex-1 text-center pr-12">AI Sizing Engine</h2>
      </div>

      <div className="flex-1 flex flex-col px-6 pt-8 pb-32">
        
        {/* Toggle Tabs */}
        <div className="flex p-1 bg-white/5 rounded-2xl mb-10 border border-white/5">
            <button 
                onClick={() => setActiveTab('link')}
                className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'link' ? 'bg-[#C9A06C] text-[#111111] shadow-xl' : 'text-white/40'}`}
            >
                Paste Link
            </button>
            <button 
                onClick={() => setActiveTab('image')}
                className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'image' ? 'bg-[#C9A06C] text-[#111111] shadow-xl' : 'text-white/40'}`}
            >
                Upload Photo
            </button>
        </div>

        {/* Content Area */}
        <div className="flex flex-col gap-8 mb-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2"
          >
            <h1 className="text-4xl font-serif italic font-medium tracking-tight text-white">
                {activeTab === 'link' ? 'Find Your Fit' : 'Scan Your Style'}
            </h1>
            <p className="text-white/40 text-sm font-light leading-relaxed max-w-[80%]">
                {activeTab === 'link' ? 'Paste the URL of the item you desire, and we\'ll reveal your perfect size.' : 'Capture a clear image of the garment to begin the analysis.'}
            </p>
          </motion.div>

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
                        className={`w-full bg-transparent border-b-2 py-6 text-2xl font-serif italic text-white placeholder:text-white/20 focus:outline-none transition-all ${isLoading ? 'border-white/5 opacity-50' : 'border-white/10 focus:border-[#C9A06C]'}`} 
                        placeholder="Paste or share link..." 
                        type="url" 
                        autoFocus
                    />
                    <div className="absolute right-0 bottom-6 flex items-center gap-4">
                        {link && !isLoading && (
                            <button 
                                onClick={() => setLink('')}
                                className="text-white/20 hover:text-white transition-colors"
                            >
                                <span className="material-symbols-outlined text-xl">close</span>
                            </button>
                        )}
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-[#C9A06C] border-t-transparent rounded-full animate-spin mb-1"></div>
                        ) : (
                            <span className={`material-symbols-outlined mb-1 transition-colors ${isValid ? 'text-[#C9A06C]' : 'text-white/10'}`}>
                                {isValid ? 'check_circle' : 'link'}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <p className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.3em]">Quick Access</p>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                        {quickLinks.map((ql, idx) => (
                            <button 
                                key={idx}
                                onClick={() => setLink(ql.url)}
                                className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/5 border border-white/10 active:scale-95 transition-all whitespace-nowrap"
                            >
                                <span className="text-xs font-bold text-white/60">{ql.name}</span>
                                <span className="material-symbols-outlined text-[14px] text-[#C9A06C]">arrow_outward</span>
                            </button>
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
                    className={`relative w-full aspect-[4/5] rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${selectedImage ? 'border-transparent' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  >
                      {selectedImage ? (
                          <>
                            <img src={selectedImage} alt="Selected" className="w-full h-full object-cover rounded-[3rem]" />
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center rounded-[3rem] opacity-0 hover:opacity-100 transition-opacity">
                                <span className="text-white text-xs font-bold uppercase tracking-widest bg-black/50 px-6 py-3 rounded-full border border-white/20">Change Photo</span>
                            </div>
                          </>
                      ) : (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-20 h-20 rounded-full bg-[#C9A06C]/10 flex items-center justify-center border border-[#C9A06C]/20">
                                <span className="material-symbols-outlined text-4xl text-[#C9A06C]">add_a_photo</span>
                            </div>
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Tap to capture</span>
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
                className="flex flex-col gap-6 mb-12"
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.3em]">Recent Scans</h3>
                    <button className="text-[10px] font-bold text-white/30 uppercase tracking-widest">View All</button>
                </div>
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                    {history.map((item, idx) => (
                        <button 
                            key={idx}
                            onClick={() => navigate('/recommendation', { state: { product: item } })}
                            className="flex flex-col gap-3 min-w-[120px] active:scale-95 transition-transform"
                        >
                            <div 
                                className="w-full aspect-[3/4] rounded-2xl bg-white/5 border border-white/10 bg-center bg-cover"
                                style={{ backgroundImage: `url("${item.image}")` }}
                            ></div>
                            <div className="flex flex-col items-start px-1">
                                <span className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-tighter truncate w-full text-left">{item.brand}</span>
                                <span className="text-xs font-medium text-white/60 truncate w-full text-left">{item.title}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </motion.div>
        )}

        {requestError && (
          <div className="mb-6 rounded-[2rem] border border-red-500/20 bg-red-500/10 p-5">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-red-400 text-lg">error</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-red-300 mb-1">Request Failed</p>
                <p className="text-sm text-red-100/80 break-words">{requestError}</p>
              </div>
            </div>
          </div>
        )}

        {requestSuccess && !requestError && (
          <div className="mb-6 rounded-[2rem] border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-emerald-400 text-lg">check_circle</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-300 mb-1">Ready</p>
                <p className="text-sm text-emerald-100/80 break-words">{requestSuccess}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'link' && eligibilityLabel && (
          <div className="mb-6 rounded-[2rem] border border-emerald-500/20 bg-emerald-500/10 p-5">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-emerald-300 text-lg">verified</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-200 mb-1">Profile Source</p>
                <p className="text-sm text-emerald-50/80">{eligibilityLabel}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'link' && (
          <div className="mb-6 rounded-[1rem] border border-white/10 bg-white/5 p-4 text-[11px] text-white/70">
            <p>Height: {profile?.height ?? '-'}</p>
            <p>Weight: {profile?.weight ?? '-'}</p>
            <p>Body: {profile?.bodyShape || '-'}</p>
          </div>
        )}

        {activeTab === 'link' && !hasSavedMeasurements && (
          <div className="mb-6 rounded-[2rem] border border-amber-500/20 bg-amber-500/10 p-5">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-300 text-lg">straighten</span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-200 mb-1">Smart Fit Required</p>
                <p className="text-sm text-amber-50/80">Complete Smart Fit Scan OR fill your Fit Profile.</p>
              </div>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="p-8 rounded-[2.5rem] bg-gradient-to-br from-[#1A1A1A] to-[#111111] border border-white/5 flex items-start gap-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#C9A06C]/5 blur-[40px] rounded-full -mr-12 -mt-12"></div>
          <div className="h-12 w-12 rounded-full bg-[#C9A06C]/10 flex items-center justify-center shrink-0 border border-[#C9A06C]/20">
             <span className="material-symbols-outlined text-[#C9A06C] text-2xl">auto_awesome</span>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-bold text-[#C9A06C] uppercase tracking-[0.2em]">Neural Sizing</p>
            <p className="text-sm text-white/40 leading-relaxed font-light">
              Our AI analyzes fabric drape, brand-specific patterns, and your unique geometry to ensure a flawless fit.
            </p>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Button */}
      <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#111111] via-[#111111]/90 to-transparent z-50 pointer-events-none">
        <div className="max-w-md mx-auto pointer-events-auto">
            <motion.button 
                whileTap={{ scale: 0.95 }}
                onClick={handleRevealSize}
                disabled={isActionDisabled}
                className={`flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-[2rem] h-18 px-5 transition-all ${!isActionDisabled ? 'bg-white text-[#111111] shadow-[0_10px_30px_rgba(255,255,255,0.1)]' : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'}`}
            >
                {isLoading ? (
                    <div className="flex items-center gap-4">
                        <div className="w-5 h-5 border-2 border-[#111111] border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-xs font-bold uppercase tracking-[0.3em]">Analyzing...</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold uppercase tracking-[0.3em]">
                            {activeTab === 'image' ? 'Analyze Garment' : 'Reveal My Size'}
                        </span>
                        <span className="material-symbols-outlined text-[20px]">straighten</span>
                    </div>
                )}
            </motion.button>
        </div>
      </div>

      {/* Profile Selection Modal */}
      <AnimatePresence>
        {isModalOpen && (
            <>
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md" 
                onClick={handleDismissRecommendationModal}
            ></motion.div>
            <motion.div 
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed bottom-0 left-0 right-0 z-[70] bg-[#1A1A1A] rounded-t-[3rem] p-10 pb-12 shadow-2xl max-w-md mx-auto border-t border-white/10"
            >
                <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto mb-10"></div>
                
                <div className="flex items-center justify-between mb-4">
                <h3 className="text-3xl font-serif italic font-medium text-white">Select Profile</h3>
                <button 
                    onClick={handleDismissRecommendationModal} 
                    className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center active:scale-90 transition-transform"
                >
                    <span className="material-symbols-outlined text-white text-lg">close</span>
                </button>
                </div>
                
                <p className="text-sm text-white/40 font-light mb-10">Who are we styling today? We'll match the garment to their unique profile.</p>
                {analyzedProduct && recommendedSize && (
                    <div className="mb-8 p-5 rounded-[1.5rem] bg-white/5 border border-white/10">
                        <p className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.3em] mb-2">MVP Size Engine</p>
                        <p className="text-white font-bold text-lg">Recommended Size: {recommendedSize}</p>
                        <p className="text-white/50 text-xs mt-1">Confidence: {confidence || 'Medium'}</p>
                        {recommendationReason && (
                            <p className="text-white/60 text-xs mt-3 leading-relaxed">{recommendationReason}</p>
                        )}
                    </div>
                )}

                {userRole === 'seller' && (
                    <div className="mb-10 p-6 rounded-[2.5rem] bg-emerald-500/5 border border-emerald-500/20">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="material-symbols-outlined text-emerald-500 text-xl">storefront</span>
                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.3em]">Seller Dashboard</span>
                        </div>
                        <button 
                            onClick={handleListForSale}
                            disabled={isListing}
                            className="w-full h-14 rounded-2xl bg-emerald-500 text-white font-bold text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-emerald-500/10 active:scale-95 flex items-center justify-center gap-3 transition-all"
                        >
                            {isListing ? (
                                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined text-lg">publish</span>
                                    List for Sale
                                </>
                            )}
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-4 max-h-[40vh] overflow-y-auto no-scrollbar">
                {members.map(member => (
                    <button 
                        key={member.id}
                        onClick={() => handleProfileSelect()}
                        className="group flex items-center justify-between p-5 rounded-[2rem] bg-white/5 border border-white/5 active:scale-[0.98] transition-all hover:bg-white/10"
                    >
                    <div className="flex items-center gap-5">
                        <div className={`h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold shadow-2xl ${member.isPrimary ? 'bg-gradient-to-tr from-[#B5853F] to-[#C9A06C] text-white' : 'bg-white/10 text-white'}`}>
                            {member.isPrimary ? <span className="material-symbols-outlined">person</span> : member.name.charAt(0)}
                        </div>
                        <div className="flex flex-col items-start">
                            <span className="text-lg font-bold text-white">{member.name}</span>
                            {member.isPrimary && <span className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-widest">Primary Fit</span>}
                        </div>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white/20 group-hover:text-[#C9A06C] transition-colors">chevron_right</span>
                    </div>
                    </button>
                ))}

                {members.length === 0 && (
                    <button
                        onClick={() => handleProfileSelect()}
                        className="group flex items-center justify-between p-5 rounded-[2rem] bg-white/5 border border-white/5 active:scale-[0.98] transition-all hover:bg-white/10"
                    >
                    <div className="flex items-center gap-5">
                        <div className="h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold shadow-2xl bg-gradient-to-tr from-[#B5853F] to-[#C9A06C] text-white">
                            <span className="material-symbols-outlined">straighten</span>
                        </div>
                        <div className="flex flex-col items-start">
                            <span className="text-lg font-bold text-white">Current Fit Profile</span>
                            <span className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-widest">Live Smart Fit Data</span>
                        </div>
                    </div>
                    <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white/20 group-hover:text-[#C9A06C] transition-colors">chevron_right</span>
                    </div>
                    </button>
                )}
                
                <button 
                    onClick={() => navigate('/fit-profile', { state: { mode: 'add', returnTo: '/add-product' } })} 
                    className="flex items-center justify-center p-6 mt-4 rounded-[2rem] border-2 border-dashed border-white/10 text-white/30 font-bold text-xs uppercase tracking-widest gap-3 active:scale-[0.98] transition-all hover:bg-white/5"
                >
                    <span className="material-symbols-outlined">add_circle</span>
                    <span>Create New Profile</span>
                </button>
                </div>
            </motion.div>
            </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AddProduct;

