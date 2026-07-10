import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { recommendSize } from '../services/ziprightApi';
import { useUserProfile } from '../contexts/UserProfileContext';
import { buildSizeEngineProfileFromUserProfile } from '../utils/sizeProfile';
import { demoProducts } from '../services/demoProducts';
import { AppBar, Button } from '../components/ui';

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

  const riskTone = (risk: string) => {
    const r = risk.toLowerCase();
    if (r.includes('low')) return 'text-success bg-success-soft border-success/25';
    if (r.includes('medium')) return 'text-warning bg-warning-soft border-warning/25';
    return 'text-danger bg-danger-soft border-danger/25';
  };

  return (
    <div className="relative flex h-full min-h-screen min-h-dvh w-full flex-col bg-surface-0 text-ink">
      <AppBar title="Product Feed" />

      {/* Feed */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-6 pb-24">
        <div className="flex flex-col gap-6">
          {demoProducts.map((product) => (
            <div key={product.id} className="bg-surface-1 rounded-card border border-line overflow-hidden">
              <div className="aspect-[4/5] bg-surface-2">
                <img
                  src={product.image}
                  alt={product.title}
                  loading="lazy"
                  className="h-full w-full object-cover opacity-0 transition-opacity duration-500"
                  onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-[19px] font-medium text-ink leading-tight">{product.brand}</p>
                    <p className="text-ink-soft text-[12.5px] mt-1">{product.title}</p>
                    <p className="text-ink font-semibold text-[14px] mt-2">{product.price}</p>
                  </div>
                  <span className={`text-[9.5px] font-semibold uppercase tracking-[0.1em] rounded-full px-3 py-1.5 border shrink-0 ${results[product.id] ? riskTone(results[product.id].risk || 'low') : 'text-ink-faint border-line'}`}>
                    {results[product.id]?.risk || product.category}
                  </span>
                </div>
                <AnimatePresence>
                  {results[product.id] ? (
                    <motion.p
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 text-[13px] text-ink-soft"
                    >
                      Recommended size <span className="font-display text-[16px] font-semibold text-ink">{results[product.id].size}</span> with{' '}
                      {Math.round(results[product.id].confidence)}% confidence.
                    </motion.p>
                  ) : null}
                </AnimatePresence>
                {errors[product.id] ? (
                  <p role="alert" className="mt-4 text-[12px] text-danger">{errors[product.id]}</p>
                ) : null}
                <Button
                  fullWidth
                  className="mt-4"
                  loading={loadingId === product.id}
                  disabled={loadingId === product.id}
                  onClick={() => handleGetSize(product)}
                >
                  Get my size
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProductFeed;
