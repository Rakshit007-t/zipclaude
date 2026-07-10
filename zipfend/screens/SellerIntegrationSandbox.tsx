import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useToast } from '../contexts/ToastContext';
import {
  getSellerIntegrationStatus,
  getPublicProduct,
  getPublicRecommendation,
  SellerProduct,
} from '../services/ziprightApi';
import { startTryOn, getTryOnJob, TryOnJobStatus } from '../services/tryonService';
import { AppBar, Button, Input, Field, Eyebrow, Divider, Sheet, Spinner } from '../components/ui';

const SellerIntegrationSandbox: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadingText, setLoadingText] = useState('Resolving storefront info...');

  // Store & Product details
  const [storeUrl, setStoreUrl] = useState('');
  const [productTitle, setProductTitle] = useState('');
  const [product, setProduct] = useState<SellerProduct | null>(null);

  // Widget Modal State
  const [showWidget, setShowWidget] = useState(false);
  const [widgetStep, setWidgetStep] = useState<'input' | 'result' | 'tryon'>('input');

  // Shopper Input State
  const [height, setHeight] = useState<number>(175);
  const [weight, setWeight] = useState<number>(70);
  const [baseSize, setBaseSize] = useState<string>('M');
  const [fitPreference, setFitPreference] = useState<string>('regular');
  const [chest, setChest] = useState<number>(98);
  const [waist, setWaist] = useState<number>(84);

  // Sizing Recommendation Result
  const [recommendation, setRecommendation] = useState<any>(null);

  // Try-on State
  const [personImage, setPersonImage] = useState<string | null>(null);
  const [tryonJobId, setTryonJobId] = useState<string | null>(null);
  const [tryonStatus, setTryonStatus] = useState<string>('');
  const [tryonProgress, setTryonProgress] = useState<number>(0);
  const [tryonResultUrl, setTryonResultUrl] = useState<string | null>(null);

  const initStoreInfo = async () => {
    try {
      setLoading(true);
      const statusRes = await getSellerIntegrationStatus();
      if (statusRes) {
        setStoreUrl(statusRes.store_url);
        // Default product title for Shopify/WooCommerce mocks
        setProductTitle(statusRes.platform === 'shopify' ? 'Shopify Tee' : 'Woo Hood');
      } else {
        // Safe fallbacks
        setStoreUrl('https://test-crown.myshopify.com');
        setProductTitle('Shopify Tee');
      }
    } catch (err) {
      console.error(err);
      setStoreUrl('https://test-crown.myshopify.com');
      setProductTitle('Shopify Tee');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initStoreInfo();
  }, []);

  const loadPDPProduct = async () => {
    if (!storeUrl.trim() || !productTitle.trim()) {
      showToast('Storefront domain URL and Product Title are required.', 'error');
      return;
    }
    try {
      setLoading(true);
      setLoadingText('Querying storefront public APIs...');
      const prod = await getPublicProduct(storeUrl.trim(), productTitle.trim());
      setProduct(prod);
      showToast('Product detail page loaded successfully!', 'success');
    } catch (err: any) {
      console.error(err);
      // Fallback local UI mockup if not connected/seeded yet
      setProduct({
        id: 'mock_sandbox_prod',
        title: productTitle.trim(),
        brand: 'ZipRIGHT Mock Brand',
        category: 'clothing',
        price: '₹1,999.00',
        images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800'],
        size_chart: {
          XS: { chest: 88, waist: 72 },
          S: { chest: 94, waist: 78 },
          M: { chest: 100, waist: 84 },
          L: { chest: 106, waist: 90 },
          XL: { chest: 112, waist: 96 },
        } as any,
        status: 'active',
        gender: 'unisex',
        tags: [],
        description: 'Premium quality designer apparel built for elite sizing matches.',
      } as any);
      showToast('No seeded backend product matched. Initialized sandbox mockup.', 'info');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchRecommendation = async () => {
    if (!product) return;
    try {
      setLoading(true);
      setLoadingText('Running size engine algorithms...');
      const payload: any = {
        store_url: storeUrl.trim(),
        product_title: product.title,
        height,
        weight,
        base_size: baseSize,
        fit_preference: fitPreference,
        chest,
        waist,
      };
      const rec = await getPublicRecommendation(payload);
      setRecommendation(rec);
      setWidgetStep('result');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to resolve sizing suggestion.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePersonImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPersonImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStartTryon = async () => {
    if (!product || !personImage) return;
    try {
      setTryonStatus('starting');
      setTryonProgress(5);
      const productImageUrl = product.images?.[0] || '';

      const jobId = await startTryOn({
        productImageUrl,
        clothType: 'upper_body',
        quality: 'hd',
        personImage,
      });
      setTryonJobId(jobId);
      setTryonStatus('queued');
      pollTryonJob(jobId);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Try-on initialization failed.', 'error');
      setTryonStatus('failed');
    }
  };

  const pollTryonJob = async (jobId: string) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        clearInterval(interval);
        setTryonStatus('failed');
        showToast('Try-on process timed out.', 'error');
        return;
      }
      try {
        const job: TryOnJobStatus = await getTryOnJob(jobId);
        setTryonProgress(job.progress || 10);
        setTryonStatus(job.status);
        if (job.status === 'done' && job.imageUrl) {
          clearInterval(interval);
          setTryonResultUrl(job.imageUrl);
          setTryonStatus('success');
        } else if (job.status === 'failed') {
          clearInterval(interval);
          showToast(job.error || 'Diffusion failure.', 'error');
        }
      } catch (err) {
        console.error(err);
      }
    }, 2500);
  };

  const selectClass =
    'w-full h-12 rounded-ctl bg-surface-1 text-ink border border-line px-3 text-[15px] ' +
    'transition-[border-color,box-shadow] duration-200 focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10';

  return (
    <div className="relative flex flex-col min-h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-x-hidden">

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-[1000] bg-scrim backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-surface-1 border border-line rounded-card shadow-float p-8 flex flex-col items-center text-center max-w-sm gap-5">
            <Spinner size={40} className="text-brand" />
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Resolving</span>
              <p className="font-display text-[18px] font-light text-ink leading-snug">{loadingText}</p>
            </div>
          </div>
        </div>
      )}

      <AppBar title="Storefront Sandbox" onBack={() => navigate('/seller/integration')} />

      <div className="flex-1 overflow-y-auto no-scrollbar">

        {/* Sandbox Controller — Handshake settings */}
        {!product && (
          <div className="px-6 pt-8 pb-32">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <Eyebrow className="mb-3">Integration</Eyebrow>
              <h1 className="font-display text-[32px] leading-[1.05] font-light text-ink">
                Storefront <em className="font-medium">sandbox.</em>
              </h1>
              <p className="text-ink-soft text-[14px] leading-relaxed max-w-[90%] mt-4">
                Simulate a live product page and preview the ZipRIGHT widget handshake end-to-end.
              </p>
            </motion.div>

            <div className="mt-9 rounded-card border border-line bg-surface-1 p-6 flex flex-col gap-5">
              <Eyebrow>Handshake settings</Eyebrow>
              <Input
                label="Store domain"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                placeholder="E-commerce store domain"
                icon="storefront"
              />
              <Input
                label="Product title"
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                placeholder="Catalog product title"
                icon="sell"
              />
              <Button fullWidth onClick={loadPDPProduct} trailingIcon="arrow_forward">
                Simulate storefront PDP
              </Button>
            </div>
          </div>
        )}

        {/* PDP Simulated Page */}
        {product && (
          <div className="px-6 pt-6 pb-32 flex flex-col gap-6">

            {/* Breadcrumb Reset */}
            <div className="flex items-center justify-between">
              <Eyebrow>Simulated PDP</Eyebrow>
              <button
                onClick={() => { setProduct(null); setRecommendation(null); }}
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint underline underline-offset-4 hover:text-ink transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">settings</span>
                Change product
              </button>
            </div>

            <div className="rounded-card border border-line bg-surface-1 overflow-hidden">

              {/* Image Gallery */}
              <div className="relative aspect-square w-full bg-surface-2">
                <img
                  src={tryonResultUrl || product.images?.[0]}
                  alt={product.title}
                  className="h-full w-full object-cover"
                />
                {tryonResultUrl && (
                  <div className="absolute top-4 left-4 bg-success-soft text-success text-[10px] font-semibold uppercase tracking-[0.12em] px-3 py-1.5 rounded-full flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">auto_awesome</span>
                    VTON active
                  </div>
                )}
              </div>

              <div className="p-6 flex flex-col gap-5">

                {/* Info Row */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{product.brand}</span>
                  <h2 className="font-display text-[24px] font-light leading-tight text-ink">{product.title}</h2>
                  <p className="font-display text-[20px] font-medium text-ink">{product.price || '₹1,499.00'}</p>
                </div>

                <p className="text-[13px] text-ink-soft leading-relaxed">{product.description}</p>

                {/* Store standard Sizes selector */}
                <div className="flex flex-col gap-3">
                  <Eyebrow>Select size</Eyebrow>
                  <div className="flex gap-2 flex-wrap">
                    {Object.keys(product.size_chart || {}).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        className="h-11 min-w-11 px-4 rounded-full border border-line text-[13px] font-medium text-ink hover:border-line-strong transition-colors"
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                <Divider />

                {/* Embedded ZipRIGHT Widget Action Row */}
                <div className="flex flex-col gap-3">
                  <Button
                    variant="accent"
                    fullWidth
                    icon="view_in_ar"
                    onClick={() => { setShowWidget(true); setWidgetStep('input'); }}
                  >
                    Find my size & try on
                  </Button>
                  <Button variant="primary" fullWidth>
                    Add to cart
                  </Button>
                </div>

              </div>
            </div>
          </div>
        )}

      </div>

      {/* Shopper Sizing Widget Sheet */}
      <Sheet open={showWidget} onClose={() => setShowWidget(false)} title="Size Assistant">

        {/* STEP 1: INPUT WIDGET */}
        {widgetStep === 'input' && (
          <div className="flex flex-col gap-5">
            <div>
              <Eyebrow>Your dimensions</Eyebrow>
              <h3 className="font-display text-[22px] font-light leading-tight text-ink mt-2">
                Find your <em className="font-medium">fit.</em>
              </h3>
              <p className="text-[13px] text-ink-soft leading-relaxed mt-2">
                Let's find the correct fit for this '{product?.title}' garment.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Height (cm)"
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
              <Input
                label="Weight (kg)"
                type="number"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
              />
              <Input
                label="Chest (cm)"
                type="number"
                value={chest}
                onChange={(e) => setChest(Number(e.target.value))}
              />
              <Input
                label="Waist (cm)"
                type="number"
                value={waist}
                onChange={(e) => setWaist(Number(e.target.value))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Base size">
                {({ inputId }) => (
                  <select
                    id={inputId}
                    value={baseSize}
                    onChange={(e) => setBaseSize(e.target.value)}
                    className={selectClass}
                  >
                    {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((sz) => (
                      <option key={sz} value={sz}>{sz}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Fit preference">
                {({ inputId }) => (
                  <select
                    id={inputId}
                    value={fitPreference}
                    onChange={(e) => setFitPreference(e.target.value)}
                    className={selectClass}
                  >
                    {['slim', 'regular', 'relaxed', 'loose', 'baggy'].map((fp) => (
                      <option key={fp} value={fp}>{fp}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            <Button fullWidth onClick={handleFetchRecommendation} trailingIcon="straighten">
              Find recommended size
            </Button>
          </div>
        )}

        {/* STEP 2: RECOMMENDATION RESULT */}
        {widgetStep === 'result' && recommendation && (
          <div className="flex flex-col gap-5">
            <div>
              <Eyebrow>Recommendation</Eyebrow>
              <h3 className="font-display text-[22px] font-light leading-tight text-ink mt-2">
                Your perfect <em className="font-medium">fit.</em>
              </h3>
              <p className="text-[13px] text-ink-soft leading-relaxed mt-2">
                ZipRIGHT sizing algorithms computed the following suggestion.
              </p>
            </div>

            {/* Sizing Indicator */}
            <div className="rounded-card border border-line bg-surface-2 p-6 flex flex-col items-center text-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">Recommended size</span>
              <span className="font-display text-[56px] font-light leading-none text-ink">{recommendation.size}</span>
              <div className="flex items-center gap-1.5 bg-success-soft text-success px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em]">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">done_all</span>
                {(recommendation.confidence * 100).toFixed(0)}% match
              </div>
            </div>

            {/* Fit Explanation */}
            <div className="rounded-2xl border border-line bg-surface-1 p-4 flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Sizing details</span>
              <p className="text-[13px] text-ink-soft leading-relaxed">{recommendation.reason}</p>
            </div>

            {/* Navigation */}
            <div className="flex gap-3">
              <Button variant="accent" fullWidth icon="view_in_ar" onClick={() => setWidgetStep('tryon')}>
                Virtual try-on
              </Button>
              <Button variant="outline" onClick={() => setWidgetStep('input')}>
                Edit
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: VIRTUAL TRY-ON */}
        {widgetStep === 'tryon' && (
          <div className="flex flex-col gap-5">
            <div>
              <Eyebrow>Virtual try-on</Eyebrow>
              <h3 className="font-display text-[22px] font-light leading-tight text-ink mt-2">
                See it <em className="font-medium">on.</em>
              </h3>
              <p className="text-[13px] text-ink-soft leading-relaxed mt-2">
                Upload a photo to see the '{product?.title}' on your body.
              </p>
            </div>

            {/* Upload */}
            {personImage ? (
              <div className="relative aspect-[3/4] w-full max-w-[200px] mx-auto rounded-card overflow-hidden bg-surface-2 border border-line">
                <img src={personImage} className="h-full w-full object-cover" alt="Shopper preview" />
                <button
                  onClick={() => setPersonImage(null)}
                  aria-label="Remove photo"
                  className="absolute bottom-2 right-2 h-8 w-8 bg-scrim rounded-full flex items-center justify-center text-ink-invert"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">delete</span>
                </button>
              </div>
            ) : (
              <label className="border border-dashed border-line-strong bg-surface-1 hover:bg-surface-2 rounded-card p-8 flex flex-col items-center justify-center gap-3 cursor-pointer max-w-[240px] mx-auto w-full transition-colors">
                <div className="w-14 h-14 rounded-full border border-line-strong flex items-center justify-center">
                  <span className="material-symbols-outlined text-[26px] text-ink-faint" aria-hidden="true">add_a_photo</span>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Select body photo</span>
                <input type="file" accept="image/*" className="hidden" onChange={handlePersonImageUpload} />
              </label>
            )}

            {/* Demo Avatar Option */}
            {!personImage && (
              <button
                onClick={() => setPersonImage('https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500')}
                className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand text-center underline underline-offset-4"
              >
                Use demo model avatar
              </button>
            )}

            {/* Processing State */}
            {tryonStatus && tryonStatus !== 'success' && (
              <div className="rounded-2xl border border-line bg-surface-1 p-4 flex flex-col gap-2.5 items-center text-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft capitalize">{tryonStatus} tryon job…</span>
                <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div className="h-full bg-brand transition-all duration-500" style={{ width: `${tryonProgress}%` }}></div>
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="flex gap-3">
              {personImage && tryonStatus !== 'success' && tryonStatus !== 'queued' && tryonStatus !== 'running' && (
                <Button fullWidth onClick={handleStartTryon}>
                  Generate VTON image
                </Button>
              )}
              <Button variant="outline" onClick={() => setWidgetStep('result')}>
                Back
              </Button>
            </div>
          </div>
        )}

      </Sheet>

    </div>
  );
};

export default SellerIntegrationSandbox;
