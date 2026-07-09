import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import {
  getSellerIntegrationStatus,
  getPublicProduct,
  getPublicRecommendation,
  SellerProduct,
} from '../services/ziprightApi';
import { startTryOn, getTryOnJob, TryOnJobStatus } from '../services/tryonService';

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

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden relative">
      
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-[1000] flex flex-col items-center justify-center p-6">
          <div className="bg-white dark:bg-surface-1 p-8 rounded-[2.5rem] border border-black/5 dark:border-line flex flex-col items-center max-w-sm text-center shadow-2xl">
            <div className="h-16 w-16 border-4 border-[#6157FF] dark:border-[#6157FF] border-t-transparent rounded-full animate-spin mb-6"></div>
            <h3 className="text-lg font-bold mb-2">Resolving</h3>
            <p className="text-xs text-[#555555] dark:text-ink-soft font-medium leading-relaxed">{loadingText}</p>
          </div>
        </div>
      )}

      {/* Header Panel */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line shrink-0">
        <button 
          onClick={() => navigate('/seller/integration')} 
          aria-label="Go back" className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"
        >
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_back</span>
        </button>
        <h2 className="text-lg font-bold text-[#6157FF]">Storefront Sandbox</h2>
        <div className="w-8"></div>
      </div>

      {/* Sandbox Controller Banner */}
      {!product && (
        <div className="bg-[#6157FF]/10 dark:bg-[#6157FF]/10 border-b border-[#6157FF]/10 p-4 shrink-0 flex flex-col gap-4 max-w-md mx-auto w-full my-4 rounded-3xl">
          <h3 className="text-xs font-bold text-[#6157FF]">Handshake Settings</h3>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
              placeholder="E-commerce Store Domain"
              className="w-full h-10 bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-xl px-3 font-bold text-xs"
            />
            <input
              type="text"
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
              placeholder="Catalog Product Title"
              className="w-full h-10 bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-xl px-3 font-bold text-xs"
            />
            <button
              onClick={loadPDPProduct}
              className="h-10 bg-[#6157FF] dark:bg-[#6157FF] text-ink rounded-xl text-xs font-bold transition-all"
            >
              Simulate Storefront PDP
            </button>
          </div>
        </div>
      )}

      {/* PDP Simulated Page */}
      {product && (
        <div className="flex-1 overflow-y-auto no-scrollbar p-6 flex flex-col gap-6">
          
          {/* Breadcrumb Reset */}
          <div className="flex justify-between items-center max-w-md mx-auto w-full">
            <span className="text-[12px] text-gray-400 font-bold">Simulated Brand Storefront PDP</span>
            <button
              onClick={() => { setProduct(null); setRecommendation(null); }}
              className="text-[12px] text-[#6157FF] font-bold flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[12px]">settings</span>
              Change Target Product
            </button>
          </div>

          <div className="max-w-md mx-auto w-full bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-[2.5rem] p-6 shadow-md flex flex-col gap-6">
            
            {/* Upper Images Gallery */}
            <div className="relative aspect-square w-full rounded-3xl overflow-hidden bg-gray-100 dark:bg-surface-0 border border-black/5 dark:border-line">
              <img
                src={tryonResultUrl || product.images?.[0]}
                alt="Product"
                className="h-full w-full object-cover"
              />
              {tryonResultUrl && (
                <div className="absolute top-4 left-4 bg-green-500 text-ink font-bold text-[11px] px-2.5 py-1 rounded-full shadow-md animate-pulse">
                  ✨ VTON Active
                </div>
              )}
            </div>

            {/* Info Row */}
            <div className="flex flex-col gap-2">
              <span className="text-[12px] text-gray-400 font-bold">{product.brand}</span>
              <h3 className="text-xl font-bold leading-tight">{product.title}</h3>
              <p className="text-lg font-bold text-[#6157FF] dark:text-[#6157FF]">{product.price || '₹1,499.00'}</p>
            </div>

            <p className="text-xs text-gray-400 font-medium leading-relaxed">{product.description}</p>

            {/* Simulated Store standard Sizes selector */}
            <div className="flex flex-col gap-3">
              <span className="text-[12px] text-gray-400 font-bold">Select Size</span>
              <div className="flex gap-2 flex-wrap">
                {Object.keys(product.size_chart || {}).map((sz) => (
                  <button
                    key={sz}
                    className="h-10 px-4 border border-black/10 dark:border-line rounded-xl text-xs font-bold"
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[1px] bg-black/5 dark:bg-surface-2 my-1"></div>

            {/* Embedded ZipRIGHT Widget Sizing Action Row */}
            <div className="flex flex-col gap-3">
              
              <button
                onClick={() => { setShowWidget(true); setWidgetStep('input'); }}
                className="h-12 border-2 border-[#6157FF] hover:bg-[#6157FF]/5 text-[#6157FF] font-bold text-xs rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm"
              >
                <span className="material-symbols-outlined text-[16px]">view_in_ar</span>
                ✨ Find My Size & Try On
              </button>

              <button className="h-12 bg-black text-ink dark:bg-white dark:text-black font-bold text-xs rounded-2xl">
                Add to Cart
              </button>

            </div>

          </div>
        </div>
      )}

      {/* Shopper Sizing Modal Overlay */}
      {showWidget && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[200] flex flex-col justify-end">
          
          <div className="bg-white dark:bg-surface-1 rounded-t-[3rem] p-6 max-h-[85vh] overflow-y-auto no-scrollbar flex flex-col gap-6 relative border-t border-black/5 dark:border-line max-w-md mx-auto w-full">
            
            {/* Modal Exit */}
            <button
              onClick={() => setShowWidget(false)}
              className="absolute top-4 right-4 h-8 w-8 bg-black/5 dark:bg-surface-2 rounded-full flex items-center justify-center text-gray-400"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>

            {/* Widget Brand Title */}
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-lg bg-[#6157FF] flex items-center justify-center text-ink font-bold text-[12px]">Z</span>
              <h4 className="text-xs font-bold text-[#6157FF]">ZipRIGHT Size Assistant</h4>
            </div>

            {/* STEP 1: INPUT WIDGET */}
            {widgetStep === 'input' && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-base font-bold">Enter Your Dimensions</h3>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Let's find the correct fit for this '{product?.title}' garment.</p>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] font-bold text-gray-400 block mb-1">Height (cm)</label>
                      <input
                        type="number"
                        value={height}
                        onChange={(e) => setHeight(Number(e.target.value))}
                        className="w-full h-11 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl px-3 font-bold text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] font-bold text-gray-400 block mb-1">Weight (kg)</label>
                      <input
                        type="number"
                        value={weight}
                        onChange={(e) => setWeight(Number(e.target.value))}
                        className="w-full h-11 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl px-3 font-bold text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] font-bold text-gray-400 block mb-1">Standard Chest (cm)</label>
                      <input
                        type="number"
                        value={chest}
                        onChange={(e) => setChest(Number(e.target.value))}
                        className="w-full h-11 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl px-3 font-bold text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] font-bold text-gray-400 block mb-1">Waist (cm)</label>
                      <input
                        type="number"
                        value={waist}
                        onChange={(e) => setWaist(Number(e.target.value))}
                        className="w-full h-11 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl px-3 font-bold text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] font-bold text-gray-400 block mb-1">Base Size Option</label>
                      <select
                        value={baseSize}
                        onChange={(e) => setBaseSize(e.target.value)}
                        className="w-full h-11 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl px-2 font-bold text-xs"
                      >
                        {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((sz) => (
                          <option key={sz} value={sz}>{sz}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[12px] font-bold text-gray-400 block mb-1">Fit Preference</label>
                      <select
                        value={fitPreference}
                        onChange={(e) => setFitPreference(e.target.value)}
                        className="w-full h-11 bg-[#FAF9F6] dark:bg-surface-0 rounded-xl px-2 font-bold text-xs"
                      >
                        {['slim', 'regular', 'relaxed', 'loose', 'baggy'].map((fp) => (
                          <option key={fp} value={fp}>{fp}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleFetchRecommendation}
                  className="h-12 bg-[#6157FF] dark:bg-[#6157FF] text-ink font-bold text-xs rounded-2xl mt-2 active:scale-95 transition-all"
                >
                  Find Recommended Size
                </button>
              </div>
            )}

            {/* STEP 2: RECOMMENDATION RESOLVED RESULT */}
            {widgetStep === 'result' && recommendation && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-base font-bold">Your Perfect Fit</h3>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">ZipRIGHT sizing algorithms computed the following suggest.</p>
                </div>

                {/* Sizing Indicator Badge */}
                <div className="bg-[#FAF9F6] dark:bg-surface-0 rounded-3xl p-6 flex flex-col gap-4 border border-black/5 dark:border-line items-center justify-center text-center shadow-inner">
                  <span className="text-[12px] font-bold text-[#6157FF]">Recommended size</span>
                  <h2 className="text-5xl font-bold text-[#6157FF] dark:text-[#6157FF]">{recommendation.size}</h2>
                  
                  <div className="flex items-center gap-1.5 mt-2 bg-green-500/10 text-green-600 px-3 py-1 rounded-full text-[12px] font-bold">
                    <span className="material-symbols-outlined text-xs">done_all</span>
                    {(recommendation.confidence * 100).toFixed(0)}% accuracy kept ratio
                  </div>
                </div>

                {/* Fit Explanation Description */}
                <div className="bg-black/5 dark:bg-surface-2 rounded-2xl p-4 flex flex-col gap-1.5 text-xs">
                  <span className="font-bold text-gray-400 block text-[11px]">Sizing Details</span>
                  <p className="font-medium leading-relaxed">{recommendation.reason}</p>
                </div>

                {/* Navigation links */}
                <div className="flex gap-3 mt-2">
                  <button
                    onClick={() => setWidgetStep('tryon')}
                    className="flex-1 h-12 bg-[#6157FF] dark:bg-[#6157FF] text-ink font-bold text-xs rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined text-sm">view_in_ar</span>
                    Virtual Try-On
                  </button>
                  <button
                    onClick={() => setWidgetStep('input')}
                    className="h-12 px-4 bg-black/5 dark:bg-surface-2 text-gray-400 font-bold text-xs rounded-2xl"
                  >
                    Edit Info
                  </button>
                </div>

              </div>
            )}

            {/* STEP 3: VIRTUAL TRY-ON OVERLAY */}
            {widgetStep === 'tryon' && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-base font-bold">Virtual Try-On</h3>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">Upload a photo to see the '{product?.title}' on your body.</p>
                </div>

                {/* Upload Section */}
                <div className="flex flex-col gap-3">
                  
                  {personImage ? (
                    <div className="relative aspect-[3/4] w-full max-w-[200px] mx-auto rounded-2xl overflow-hidden bg-gray-100 dark:bg-surface-0 border border-black/5 dark:border-line">
                      <img src={personImage} className="h-full w-full object-cover" alt="Shopper Preview" />
                      <button
                        onClick={() => setPersonImage(null)}
                        className="absolute bottom-2 right-2 h-7 w-7 bg-black/60 rounded-full flex items-center justify-center text-ink"
                      >
                        <span className="material-symbols-outlined text-xs">delete</span>
                      </button>
                    </div>
                  ) : (
                    <label className="border-2 border-dashed border-[#6157FF]/40 bg-[#6157FF]/5 rounded-3xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer max-w-[240px] mx-auto w-full">
                      <span className="material-symbols-outlined text-3xl text-[#6157FF]">add_a_photo</span>
                      <span className="text-[12px] font-bold text-[#6157FF]">Select Body Photo</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handlePersonImageUpload} />
                    </label>
                  )}

                  {/* Preset Quick Demo Avatar Option */}
                  {!personImage && (
                    <button
                      onClick={() => setPersonImage('https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500')}
                      className="text-[12px] text-[#6157FF] font-bold text-center underline"
                    >
                      Use Demo Model Avatar
                    </button>
                  )}

                </div>

                {/* Processing State */}
                {tryonStatus && tryonStatus !== 'success' && (
                  <div className="bg-black/5 dark:bg-surface-2 rounded-2xl p-4 flex flex-col gap-2 items-center text-center">
                    <span className="text-[12px] font-bold text-gray-400 capitalize">{tryonStatus} tryon job...</span>
                    <div className="w-full bg-black/10 dark:bg-surface-2 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-[#6157FF] h-full transition-all duration-500" style={{ width: `${tryonProgress}%` }}></div>
                    </div>
                  </div>
                )}

                {/* Controls */}
                <div className="flex gap-3 mt-2">
                  {personImage && tryonStatus !== 'success' && tryonStatus !== 'queued' && tryonStatus !== 'running' && (
                    <button
                      onClick={handleStartTryon}
                      className="flex-1 h-12 bg-green-600 text-ink font-bold text-xs rounded-2xl active:scale-95 transition-all"
                    >
                      Generate VTON Image
                    </button>
                  )}
                  
                  <button
                    onClick={() => setWidgetStep('result')}
                    className="h-12 px-4 bg-black/5 dark:bg-surface-2 text-gray-400 font-bold text-xs rounded-2xl"
                  >
                    Back
                  </button>
                </div>

              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
};

export default SellerIntegrationSandbox;
