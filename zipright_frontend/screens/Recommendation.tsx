import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { getUserPlan } from '../utils/subscription';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, onSnapshot, updateDoc, doc, addDoc } from 'firebase/firestore';
import { useToast } from '../contexts/ToastContext';

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
  autoBuild: string;
  fitBias: number;
  fitPreferenceLabel: string;
}

// --- Backend helpers ---

const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:8000';

function getBackendBaseUrl() {
  const envBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  return (envBaseUrl || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '');
}

interface SizeEngineBackendResult {
  size: string;
  confidence: number;
  risk: string;
  reason: string;
}

async function callSizeEngine(
  chestCm: number,
  waistCm: number,
  hipCm: number,
  fit: string,
  brand: string,
  topSize: string,
): Promise<SizeEngineBackendResult> {
  const apiUrl = `${getBackendBaseUrl()}/size-engine`;
  const requestBody = {
    chest: Math.max(1, chestCm),
    waist_cm: waistCm > 0 ? waistCm : null,
    hip_cm: hipCm > 0 ? hipCm : null,
    fit,
    brand,
    range: topSize || 'M',
  };
  console.log('[SizeEngine] POST', apiUrl, requestBody);

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (networkErr) {
    console.error('[SizeEngine] Network error reaching', apiUrl, networkErr);
    throw new Error(`Cannot reach backend at ${getBackendBaseUrl()}. Is the server running?`);
  }

  const payload = await response.json().catch(() => null);
  console.log('[SizeEngine] /size-engine', response.status, payload);

  if (!response.ok || !payload?.data) {
    const errMsg =
      payload?.error?.message ||
      payload?.detail ||
      `Server returned ${response.status}`;
    console.error('[SizeEngine] /size-engine FAILED:', { status: response.status, payload });
    throw new Error(errMsg);
  }

  console.log('[SizeEngine] Result:', payload.data);
  return payload.data as SizeEngineBackendResult;
}

// --- Pure Engine Functions ---

function normalizeMeasurements(fitData: any): NormalizedMetrics {
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

  let chestCm = parseFloat(fitData.chestSize || fitData.bustSize || '0');
  if (!chestCm && heightCm > 0) {
    chestCm = fitData.gender === 'Female' ? heightCm * 0.53 : heightCm * 0.55;
  }

  let waistCm = parseFloat(fitData.waistSize || '0');
  if (!waistCm && heightCm > 0) {
    waistCm = fitData.gender === 'Female' ? heightCm * 0.42 : heightCm * 0.45;
  }

  let hipCm = parseFloat(fitData.hipsSize || '0');
  if (!hipCm && heightCm > 0) {
    hipCm = fitData.gender === 'Female' ? heightCm * 0.56 : heightCm * 0.52;
  }

  let fitBias = 0;
  if (fitData.fitPreference) {
    if (fitData.fitPreference < 3) fitBias = -1;
    else if (fitData.fitPreference > 3) fitBias = 1;
  }

  return {
    heightCm: Math.round(heightCm),
    weightKg: weightKg,
    bmi: Math.round(bmi * 10) / 10,
    chestCm: Math.round(chestCm),
    waistCm: Math.round(waistCm),
    hipCm: Math.round(hipCm),
    autoBuild,
    fitBias,
    fitPreferenceLabel: fitBias === -1 ? 'slim' : fitBias === 1 ? 'relaxed' : 'regular'
  };
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

function buildFallbackRecommendation(fitData: any) {
  return {
    recommendedSize: fitData.topSize || 'M',
    confidence: 0,
    reasoning: '',
    alternativeSize: '',
    fitNotes: 'Offline estimate — connect to the server for accurate sizing.',
    returnRisk: 0,
    sizeDirection: 'true-to-size',
    isOffline: true,
  };
}

// --- Component ---

const Recommendation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [showMemberSelector, setShowMemberSelector] = useState(false);
  
  const [wishlistCount, setWishlistCount] = useState(0);
  const [userPlan, setUserPlan] = useState(getUserPlan());
  
  // Multi-stage loading state
  const [loadingStage, setLoadingStage] = useState<number>(0);
  
  const [aiResult, setAiResult] = useState<{
    recommendedSize: string;
    confidence: number;
    reasoning: string;
    alternativeSize: string;
    fitNotes: string;
    returnRisk: number;
    sizeDirection: string;
    isOffline?: boolean;
  } | null>(null);

  const [engineError, setEngineError] = useState<string | null>(null);

  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});

  const product = location.state?.product;
  const source = location.state?.source;
  
  useEffect(() => {
    if (!product) {
      showToast("No product data found.", "error");
      navigate('/home');
    }
  }, [product, navigate, showToast]);

  const displayProduct = product;
  const productUrl = location.state?.productUrl || product?.url;

  const isClothing = displayProduct?.type === 'clothing' || 
                     ['Men', 'Women', 'Kids', 'Tops', 'Bottoms', 'Dresses', 'Apparel', 'Clothing'].includes(displayProduct?.category) ||
                     !['Accessories', 'Shoes', 'Bags', 'Jewelry'].includes(displayProduct?.category);

  useEffect(() => {
    const fetchMembers = async () => {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const q = query(collection(db, 'members'), where('uid', '==', user.uid));
            const querySnapshot = await getDocs(q);
            const membersList: Member[] = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                membersList.push({
                    id: doc.id,
                    name: data.name,
                    isPrimary: data.isPrimary,
                    fitData: data.fitData
                });
            });
            
            if (membersList.length > 0) {
                setMembers(membersList);
                if (location.state && location.state.memberId) {
                    setSelectedMemberId(location.state.memberId);
                } else {
                    const primary = membersList.find((m: Member) => m.isPrimary);
                    setSelectedMemberId(primary ? primary.id : membersList[0]?.id);
                }
            } else {
                const dummy: Member = { 
                    id: '1', 
                    name: 'My Fits', 
                    isPrimary: true, 
                    fitData: { 
                        gender: 'Male',
                        brand: 'Nike',
                        topSize: 'L',
                        heightFt: '5',
                        heightIn: '10',
                        heightCm: '178',
                        heightUnit: 'ft',
                        weight: '75',
                        bodyShape: 'average',
                        fitPreference: 2
                    }
                };
                setMembers([dummy]);
                setSelectedMemberId('1');
            }
        } catch (e) {
            console.error("Error fetching members:", e);
        }
    };

    fetchMembers();

    let unsubscribeWishlist: () => void = () => {};
    if (auth.currentUser) {
        const likesRef = collection(db, 'users', auth.currentUser.uid, 'likes');
        unsubscribeWishlist = onSnapshot(likesRef, (snapshot) => {
            setWishlistCount(snapshot.size);
            const likes: Record<string, boolean> = {};
            snapshot.docs.forEach(doc => {
              likes[doc.id] = true;
            });
            setLikedMap(likes);
        });
    }

    setUserPlan(getUserPlan());

    return () => unsubscribeWishlist();
  }, [location.state]);

  const selectedMember = members.find(m => m.id === selectedMemberId);

  // --- Engine Execution (calls backend /size-engine) ---
  useEffect(() => {
    let isMounted = true;

    const runEngine = async () => {
      if (!selectedMember || !displayProduct || !isClothing) return;
      
      setAiResult(null);
      setEngineError(null);
      setLoadingStage(1); // Stage 1: Reading measurements
      
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!isMounted) return;
      
      const normalized = normalizeMeasurements(selectedMember.fitData);
      const brand = displayProduct.brand || selectedMember.fitData.brand || 'generic';

      console.log('[SizeEngine] Normalized measurements:', normalized);
      console.log('[SizeEngine] Brand:', brand, '| TopSize:', selectedMember.fitData.topSize);
      
      setLoadingStage(2); // Stage 2: Connecting to size engine
      
      try {
        const backendResult = await callSizeEngine(
          normalized.chestCm,
          normalized.waistCm,
          normalized.hipCm,
          normalized.fitPreferenceLabel,
          brand,
          selectedMember.fitData.topSize || 'M',
        );

        if (!isMounted) return;

        setLoadingStage(3); // Stage 3: Processing result
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!isMounted) return;

        setLoadingStage(4); // Stage 4: Finalizing
        await new Promise(resolve => setTimeout(resolve, 300));
        if (!isMounted) return;

        const returnRiskNum = riskToNumeric(backendResult.risk);

        const mappedResult = {
          recommendedSize: backendResult.size,
          confidence: Math.round(backendResult.confidence),
          reasoning: backendResult.reason || '',
          alternativeSize: '',
          fitNotes: `Return risk: ${backendResult.risk}`,
          returnRisk: returnRiskNum,
          sizeDirection: confidenceToDirection(backendResult.confidence),
          isOffline: false,
        };
        console.log('[SizeEngine] Mapped UI result:', mappedResult);

        setAiResult(mappedResult);
        setLoadingStage(0);

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[SizeEngine] Error:', errorMsg, err);
        if (!isMounted) return;

        setEngineError(errorMsg);
        showToast('Size engine unavailable — using profile estimate.', 'error');

        setLoadingStage(3);
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!isMounted) return;

        setLoadingStage(4);
        await new Promise(resolve => setTimeout(resolve, 300));
        if (!isMounted) return;

        setAiResult(buildFallbackRecommendation(selectedMember.fitData));
        setLoadingStage(0);
      }
    };

    runEngine();

    return () => { isMounted = false; };
  }, [selectedMemberId, displayProduct, isClothing, showToast]);


  const handleExternalBuy = () => {
    if (productUrl) {
      window.open(productUrl, '_blank');
    } else {
      showToast("No product link provided to redirect to.", "error");
    }
  };

  const toggleWishlist = async () => {
    if (!auth.currentUser || !displayProduct) return;
    
    const productId = displayProduct.id || displayProduct.title.replace(/\s+/g, '-').toLowerCase();
    const isLiked = likedMap[productId];
    const likeDocRef = doc(db, 'users', auth.currentUser.uid, 'likes', productId);

    try {
      if (isLiked) {
        await deleteDoc(likeDocRef);
        showToast("Removed from Wishlist", "success");
      } else {
        await setDoc(likeDocRef, {
          productId: productId,
          brand: displayProduct.brand,
          title: displayProduct.title,
          price: displayProduct.price,
          image: displayProduct.image,
          url: productUrl,
          timestamp: new Date()
        });
        showToast("Added to Wishlist", "success");
      }
    } catch (e) {
      console.error("Error toggling wishlist", e);
      showToast("Failed to update wishlist", "error");
    }
  };

  const handleBuyNow = () => {
    if (productUrl) {
        window.open(productUrl, '_blank');
    } else {
        showToast("Product link unavailable.", "error");
    }
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
                onClick={() => setShowMemberSelector(!showMemberSelector)}
                className="flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-[#C9A06C]/20 shadow-xl active:scale-95 transition-all"
              >
                  <div className="h-6 w-6 rounded-full bg-[#C9A06C] flex items-center justify-center">
                      <span className="material-symbols-outlined text-[14px] text-[#111111]">person</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      Fit for: {selectedMember?.name}
                  </span>
                  <motion.span 
                    animate={{ rotate: showMemberSelector ? 180 : 0 }}
                    className="material-symbols-outlined text-sm text-[#C9A06C]"
                  >
                    expand_more
                  </motion.span>
              </button>
          </div>
      )}

      <AnimatePresence>
        {showMemberSelector && isClothing && (
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
                                setSelectedMemberId(member.id);
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
                                src={displayProduct.image || "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&h=500&fit=crop"}
                                alt={displayProduct.title}
                                className="w-24 h-32 object-cover rounded-2xl flex-shrink-0 border border-white/10 shadow-2xl"
                                onError={(e: any) => {
                                    e.target.onerror = null;
                                    e.target.src = "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&h=500&fit=crop";
                                }}
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
                        
                        {loadingStage > 0 ? (
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
                        ) : aiResult ? (
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
                                            {aiResult.recommendedSize}
                                        </motion.h2>
                                        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap">
                                            <div className={`px-6 py-2 rounded-full border bg-[#111111] text-[10px] font-bold uppercase tracking-[0.3em] ${getDirectionColor(aiResult.sizeDirection)}`}>
                                                {aiResult.sizeDirection.replace(/-/g, ' ')}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Confidence Bar */}
                                <div className="w-full flex flex-col gap-3 mt-8">
                                    <div className="flex justify-between items-center px-2">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Confidence Level</span>
                                        <span className="text-sm font-bold text-[#C9A06C]">{aiResult.confidence}%</span>
                                    </div>
                                    <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden p-[2px] border border-white/10">
                                        <motion.div 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${aiResult.confidence}%` }}
                                            transition={{ duration: 1.5, ease: "easeOut" }}
                                            className="h-full rounded-full bg-gradient-to-r from-[#B5853F] to-[#C9A06C]"
                                        ></motion.div>
                                    </div>
                                </div>

                                {/* Details from API */}
                                <div className="w-full bg-white/5 rounded-[2rem] p-8 text-left border border-white/10 mt-4">
                                    <div className="flex flex-wrap gap-3">
                                        <div className="flex items-center gap-2 px-4 py-2 bg-[#FF4D6D]/10 rounded-full border border-[#FF4D6D]/20">
                                            <span className="text-[10px] font-bold text-[#FF4D6D] uppercase tracking-widest">Return Risk:</span>
                                            <span className="text-xs font-bold text-white">{aiResult.fitNotes}</span>
                                        </div>
                                    </div>
                                </div>

                                {aiResult.isOffline && (
                                    <p className="text-xs font-medium text-amber-400/70 tracking-wide max-w-[80%] flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">cloud_off</span>
                                        Offline estimate — results may be less accurate
                                    </p>
                                )}

                            </motion.div>
                        ) : null}
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
                onClick={() => navigate('/home')} 
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
