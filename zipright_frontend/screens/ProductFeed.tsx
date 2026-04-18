import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

// --- Backend helpers (same pattern as Recommendation.tsx) ---

const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:8000';

function getBackendBaseUrl() {
  const envBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  return (envBaseUrl || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '');
}

interface SizeResult {
  size: string;
  confidence: number;
  risk: string;
}

async function callSizeEngine(
  chest: number,
  waist: number,
  hip: number,
  fit: string,
  brand: string,
  range: string,
): Promise<SizeResult> {
  const apiUrl = `${getBackendBaseUrl()}/size-engine`;
  const body = {
    chest: Math.max(1, chest),
    waist_cm: waist > 0 ? waist : null,
    hip_cm: hip > 0 ? hip : null,
    fit,
    brand,
    range,
  };
  console.log('[ProductFeed] POST', apiUrl, body);

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    console.error('[ProductFeed] Network error:', networkErr);
    throw new Error(`Cannot reach backend. Is the server running?`);
  }

  const payload = await response.json().catch(() => null);
  console.log('[ProductFeed] /size-engine', response.status, payload);

  if (!response.ok || !payload?.data) {
    const msg = payload?.error?.message || payload?.detail || `Server returned ${response.status}`;
    console.error('[ProductFeed] /size-engine FAILED:', { status: response.status, payload });
    throw new Error(msg);
  }

  console.log('[ProductFeed] Result:', payload.data);
  return payload.data as SizeResult;
}

// --- Mock product data ---

interface MockProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  category: string;
  image: string;
  defaultRange: string;
}

const MOCK_PRODUCTS: MockProduct[] = [
  {
    id: 'p1',
    title: 'Classic Oxford Shirt',
    brand: 'Zara',
    price: '₹2,990',
    category: 'Tops',
    image: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&h=500&fit=crop',
    defaultRange: 'S-XL',
  },
  {
    id: 'p2',
    title: 'Slim Fit Chinos',
    brand: 'H&M',
    price: '₹1,999',
    category: 'Bottoms',
    image: 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=400&h=500&fit=crop',
    defaultRange: '30-36',
  },
  {
    id: 'p3',
    title: 'Oversized Hoodie',
    brand: 'Nike',
    price: '₹4,495',
    category: 'Tops',
    image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=500&fit=crop',
    defaultRange: 'M-XXL',
  },
  {
    id: 'p4',
    title: 'Tailored Blazer',
    brand: 'Mango',
    price: '₹6,990',
    category: 'Tops',
    image: 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=400&h=500&fit=crop',
    defaultRange: 'S-L',
  },
  {
    id: 'p5',
    title: 'Denim Jacket',
    brand: 'Levi\'s',
    price: '₹3,999',
    category: 'Tops',
    image: 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400&h=500&fit=crop',
    defaultRange: 'S-XL',
  },
  {
    id: 'p6',
    title: 'Linen Kurta',
    brand: 'FabIndia',
    price: '₹2,490',
    category: 'Tops',
    image: 'https://images.unsplash.com/photo-1610030469668-8e4c41652d7c?w=400&h=500&fit=crop',
    defaultRange: 'M-XXL',
  },
  {
    id: 'p7',
    title: 'Track Pants',
    brand: 'Adidas',
    price: '₹2,799',
    category: 'Bottoms',
    image: 'https://images.unsplash.com/photo-1515586838455-8f8f940d6853?w=400&h=500&fit=crop',
    defaultRange: 'S-XXL',
  },
  {
    id: 'p8',
    title: 'Polo T-Shirt',
    brand: 'Ralph Lauren',
    price: '₹5,500',
    category: 'Tops',
    image: 'https://images.unsplash.com/photo-1625910513413-5fc44e252e3e?w=400&h=500&fit=crop',
    defaultRange: 'S-XL',
  },
  {
    id: 'p9',
    title: 'Cargo Shorts',
    brand: 'GAP',
    price: '₹1,799',
    category: 'Bottoms',
    image: 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=400&h=500&fit=crop',
    defaultRange: '28-38',
  },
  {
    id: 'p10',
    title: 'Cashmere Sweater',
    brand: 'Uniqlo',
    price: '₹3,490',
    category: 'Tops',
    image: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400&h=500&fit=crop',
    defaultRange: 'S-XL',
  },
];

// Default user profile for sizing (used when no Firebase profile is available)
const DEFAULT_PROFILE = {
  chest: 96,
  waist: 82,
  hip: 94,
  fit: 'regular',
  range: 'M',
};

// --- Component ---

const ProductFeed: React.FC = () => {
  const navigate = useNavigate();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SizeResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleGetSize = async (product: MockProduct) => {
    if (loadingId) return; // don't allow concurrent requests
    setLoadingId(product.id);
    // clear previous result/error for this product
    setErrors(prev => { const n = { ...prev }; delete n[product.id]; return n; });

    try {
      const result = await callSizeEngine(
        DEFAULT_PROFILE.chest,
        DEFAULT_PROFILE.waist,
        DEFAULT_PROFILE.hip,
        DEFAULT_PROFILE.fit,
        product.brand,
        DEFAULT_PROFILE.range,
      );
      setResults(prev => ({ ...prev, [product.id]: result }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors(prev => ({ ...prev, [product.id]: msg }));
    } finally {
      setLoadingId(null);
    }
  };

  const riskColor = (risk: string) => {
    const r = risk.toLowerCase();
    if (r.includes('very low')) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    if (r.includes('low')) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    if (r.includes('medium')) return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    return 'text-red-400 bg-red-400/10 border-red-400/20';
  };

  return (
    <div className="relative flex h-full min-h-screen w-full flex-col bg-[#111111] text-white font-sans">

      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#111111]/80 backdrop-blur-xl border-b border-white/5">
        <button onClick={() => navigate(-1)} className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 border border-white/5 active:scale-90 transition-transform">
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span>
        </button>
        <h1 className="text-[10px] font-bold tracking-[0.4em] uppercase text-[#C9A06C]">Product Feed</h1>
        <div className="w-10"></div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-6 pb-24">
        <div className="flex flex-col gap-5">
          {MOCK_PRODUCTS.map((product, idx) => {
            const result = results[product.id];
            const error = errors[product.id];
            const isLoading = loadingId === product.id;

            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="rounded-[2rem] bg-[#1A1A1A] border border-white/5 overflow-hidden shadow-xl"
              >
                {/* Product card */}
                <div className="flex gap-5 p-5">
                  {/* Image */}
                  <img
                    src={product.image || "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&h=500&fit=crop"}
                    alt={product.title}
                    className="w-24 h-32 rounded-2xl object-cover flex-shrink-0 border border-white/10"
                    onError={(e: any) => {
                      e.target.onerror = null;
                      e.target.src = "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&h=500&fit=crop";
                    }}
                  />

                  {/* Info */}
                  <div className="flex flex-col flex-1 justify-between min-w-0">
                    <div>
                      <p className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-[0.25em] mb-1">{product.brand}</p>
                      <h3 className="text-base font-bold text-white leading-snug truncate">{product.title}</h3>
                      <p className="text-sm text-white/50 mt-1">{product.price}</p>
                    </div>

                    {/* Action / Result */}
                    <div className="mt-3">
                      {result ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-4 py-1.5 rounded-full bg-[#C9A06C]/15 border border-[#C9A06C]/30 text-sm font-bold text-[#C9A06C]">
                            {result.size}
                          </span>
                          <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">
                            {Math.round(result.confidence)}%
                          </span>
                          <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${riskColor(result.risk)}`}>
                            {result.risk}
                          </span>
                        </div>
                      ) : error ? (
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-red-400 text-sm">error</span>
                          <span className="text-xs text-red-400/80 truncate">{error}</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleGetSize(product)}
                          disabled={!!loadingId}
                          className={`flex items-center gap-2 px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${
                            isLoading
                              ? 'bg-white/5 text-white/30 cursor-wait'
                              : loadingId
                                ? 'bg-white/5 text-white/20 cursor-not-allowed'
                                : 'bg-white text-[#111111] active:scale-95 shadow-lg shadow-white/5'
                          }`}
                        >
                          {isLoading ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
                              Sizing…
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-[14px]">straighten</span>
                              Get My Size
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded result detail strip */}
                <AnimatePresence>
                  {result && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 pt-0">
                        <div className="h-[1px] bg-white/5 mb-4"></div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-[#C9A06C]/10 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[#C9A06C] text-sm">checkroom</span>
                            </div>
                            <div>
                              <p className="text-xs font-bold text-white">
                                Size <span className="text-[#C9A06C]">{result.size}</span> recommended
                              </p>
                              <p className="text-[10px] text-white/40 mt-0.5">
                                {Math.round(result.confidence)}% confidence · {result.risk} return risk
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => navigate('/recommendation', {
                              state: {
                                product: {
                                  title: product.title,
                                  brand: product.brand,
                                  price: product.price,
                                  category: product.category,
                                  image: product.image,
                                },
                                source: 'feed',
                              }
                            })}
                            className="text-[10px] font-bold text-[#C9A06C] uppercase tracking-widest active:scale-95"
                          >
                            Details →
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ProductFeed;
