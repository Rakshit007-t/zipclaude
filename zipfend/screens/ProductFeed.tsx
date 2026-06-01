import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { recommendSize } from '../services/ziprightApi';
import { useUserProfile } from '../contexts/UserProfileContext';
import { buildSizeEngineProfileFromUserProfile } from '../utils/sizeProfile';
import { demoProducts } from '../services/demoProducts';

interface SizeResult {
  size: string;
  confidence: number;
  risk: string;
}

async function callSizeEngine(product: any, profile: ReturnType<typeof buildSizeEngineProfileFromUserProfile>): Promise<SizeResult> {
  const payload = await recommendSize({
    product: {
      id: product.id,
      title: product.title,
      brand: product.brand,
      category: product.category,
      price: product.price,
      image: product.image,
      url: 'https://mvp.local/product-feed',
      source: 'link',
      confidence: 0.7,
      fit_hint: product.fit_hint,
      size_chart: product.size_chart ?? product.sizeChart,
      available_sizes: product.available_sizes ?? product.availableSizes,
      size_format: product.size_format,
    },
    profile,
  });
  return payload;
}

// --- Component ---

const ProductFeed: React.FC = () => {
  const navigate = useNavigate();
  const { userProfile } = useUserProfile();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SizeResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleGetSize = async (product: any) => {
    if (loadingId) return; // don't allow concurrent requests
    setLoadingId(product.id);
    // clear previous result/error for this product
    setErrors(prev => { const n = { ...prev }; delete n[product.id]; return n; });

    try {
      const profile = buildSizeEngineProfileFromUserProfile(userProfile);
      const result = await callSizeEngine(product, profile);
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
          {demoProducts.map((product) => (
            <div key={product.id} className="bg-white/5 rounded-[1.5rem] border border-white/10 overflow-hidden">
              <div className="aspect-[4/5] bg-white/5">
                <img src={product.image} alt={product.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-bold text-base">{product.brand}</p>
                    <p className="text-white/60 text-xs mt-1">{product.title}</p>
                    <p className="text-[#C9A06C] font-black text-sm mt-2">{product.price}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.2em] rounded-full px-3 py-1 border ${riskColor(results[product.id]?.risk || 'low')}`}>
                    {results[product.id]?.risk || product.category}
                  </span>
                </div>
                {results[product.id] ? (
                  <p className="mt-4 text-xs text-white/70">
                    Recommended size {results[product.id].size} with {Math.round(results[product.id].confidence)}% confidence.
                  </p>
                ) : null}
                {errors[product.id] ? (
                  <p className="mt-4 text-xs text-red-300">{errors[product.id]}</p>
                ) : null}
                <button
                  onClick={() => handleGetSize(product)}
                  className="mt-4 w-full bg-[#C9A06C] text-black rounded-full py-3 text-[11px] font-black uppercase tracking-[0.2em] active:scale-95"
                >
                  {loadingId === product.id ? 'Checking...' : 'Get My Size'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProductFeed;
