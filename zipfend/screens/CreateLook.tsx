import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import app, { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { Button, Eyebrow, Spinner } from '../components/ui';

interface TaggedProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  url: string;
  affiliateLink: string;
}

interface GlobalProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  url: string;
  affiliateLink?: string;
}

const storage = getStorage(app);

const CreateLook: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [taggedProducts, setTaggedProducts] = useState<TaggedProduct[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<GlobalProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [catalogUnavailable] = useState(true);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // STEP 1 — Photo picker
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image must be under 10MB', 'error');
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  // STEP 2 — Product search (session catalog by brand or title)
  const handleProductSearch = (val: string) => {
    setProductSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(() => {
      setSearching(true);
      setSearchResults([]);
      setSearching(false);
    }, 400);
  };

  const addProduct = (p: GlobalProduct) => {
    if (taggedProducts.length >= 5) {
      showToast('Max 5 products per look', 'error');
      return;
    }
    if (taggedProducts.find(t => t.id === p.id)) {
      showToast('Already tagged', 'error');
      return;
    }
    setTaggedProducts(prev => [...prev, {
      id: p.id, title: p.title, brand: p.brand,
      price: p.price, image: p.image, url: p.url,
      affiliateLink: p.affiliateLink || p.url,
    }]);
    setProductSearch('');
    setSearchResults([]);
  };

  const removeProduct = (id: string) => {
    setTaggedProducts(prev => prev.filter(p => p.id !== id));
  };

  // STEP 3 — Publish
  const handlePublish = async () => {
    if (!selectedFile || !auth.currentUser) return;
    if (!caption.trim() && taggedProducts.length === 0) {
      showToast('Add a caption or tag at least one product', 'error');
      return;
    }
    setPublishing(true);
    try {
      const user = auth.currentUser;

      // Upload image to Firebase Storage
      const filename = `${Date.now()}_${selectedFile.name.replace(/[^a-z0-9.]/gi, '_')}`;
      const storageRef = ref(storage, `looks/${user.uid}/${filename}`);
      await uploadBytes(storageRef, selectedFile);
      const mediaUrl = await getDownloadURL(storageRef);

      // Get creator info from Firestore
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const userData = userSnap.data() || {};
      const creatorUsername = userData.username ||
        (user.displayName || 'user').toLowerCase().replace(/\s+/g, '_') + '_zr';

      // Write look to Firestore
      await addDoc(collection(db, 'looks'), {
        creatorId: user.uid,
        creatorName: user.displayName || creatorUsername,
        creatorUsername,
        creatorAvatar: user.photoURL || userData.photoURL || null,
        mediaUrl,
        caption: caption.trim(),
        taggedProducts,
        likesCount: 0,
        viewsCount: 0,
        createdAt: new Date(),
        status: 'active',
      });

      // Award ZipCoins to creator
      const currentPoints = userData.zipPoints || 0;
      await updateDoc(doc(db, 'users', user.uid), {
        zipPoints: currentPoints + 20,
        username: creatorUsername,
      });

      showToast('Look posted! +20 ZipCoins ✦', 'success');
      navigate('/community');
    } catch (err) {
      console.error(err);
      showToast('Failed to publish. Try again.', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const canProceedStep1 = !!selectedFile;
  const canProceedStep2 = true; // products are optional
  const canPublish = !!selectedFile && !!caption.trim();

  const stepTitle = step === 1 ? 'Choose photo' : step === 2 ? 'Tag products' : 'Add caption';

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink flex flex-col">

      {/* HEADER */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-5 py-4 pt-safe bg-surface-0/90 backdrop-blur-xl border-b border-line">
        <button aria-label="Go back"
          onClick={() => step > 1 ? setStep((step - 1) as 1 | 2 | 3) : navigate(-1)}
          className="h-10 w-10 flex items-center justify-center rounded-full text-ink-soft active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">arrow_back</span>
        </button>

        <div className="flex flex-col items-center">
          <h1 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">{stepTitle}</h1>
          {/* Step dots */}
          <div className="flex items-center gap-1.5 mt-2" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map(s => (
              <div key={s} className={`h-[3px] rounded-full transition-all ${s === step ? 'w-6 bg-brand' : s < step ? 'w-3 bg-brand/50' : 'w-3 bg-surface-3'}`} />
            ))}
          </div>
        </div>

        {step < 3 ? (
          <button
            onClick={() => step === 1 && canProceedStep1 ? setStep(2) : step === 2 && canProceedStep2 ? setStep(3) : null}
            className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${(step === 1 && canProceedStep1) || step === 2 ? 'text-ink active:opacity-70' : 'text-ink-faint'}`}
          >
            Next
          </button>
        ) : (
          <button
            onClick={handlePublish}
            disabled={!canPublish || publishing}
            className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${canPublish && !publishing ? 'text-brand active:opacity-70' : 'text-ink-faint'}`}
          >
            {publishing ? '…' : 'Post'}
          </button>
        )}
      </div>

      {/* STEP CONTENT */}
      <AnimatePresence mode="wait">

        {/* ── STEP 1: PHOTO PICKER ── */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="flex-1 flex flex-col"
          >
            {previewUrl ? (
              /* Preview selected photo */
              <div className="flex-1 flex flex-col">
                <div className="relative flex-1 max-h-[65vh] bg-black overflow-hidden">
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    onClick={() => { setSelectedFile(null); setPreviewUrl(null); }}
                    aria-label="Remove photo"
                    className="absolute top-4 right-4 h-9 w-9 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center active:scale-90 border border-white/15"
                  >
                    <span className="material-symbols-outlined text-white text-[18px]" aria-hidden="true">close</span>
                  </button>
                </div>
                <div className="p-6 flex flex-col gap-3">
                  <p className="text-ink-soft text-[13px] text-center">Looking good — tag products next.</p>
                  <Button size="lg" fullWidth onClick={() => setStep(2)}>Next — tag products</Button>
                  <Button variant="outline" fullWidth onClick={() => fileInputRef.current?.click()}>Change photo</Button>
                </div>
              </div>
            ) : (
              /* Photo picker options */
              <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5">
                <div className="h-16 w-16 rounded-full border border-line-strong flex items-center justify-center mb-2">
                  <span className="material-symbols-outlined text-ink-faint text-[28px]" aria-hidden="true">add_a_photo</span>
                </div>
                <div className="text-center mb-4">
                  <Eyebrow className="mb-3">The Salon</Eyebrow>
                  <h2 className="text-ink font-display text-[28px] font-light mb-2">Share your <em className="font-medium">look.</em></h2>
                  <p className="text-ink-soft text-[14px] leading-relaxed max-w-[250px]">
                    Post your outfit and let others shop your exact style.
                  </p>
                </div>

                {/* Camera — opens rear camera directly */}
                <Button size="lg" fullWidth icon="camera_alt" onClick={() => fileInputRef.current?.click()}>
                  Take photo
                </Button>

                {/* Gallery */}
                <Button
                  size="lg"
                  fullWidth
                  variant="outline"
                  icon="photo_library"
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                    }
                  }}
                >
                  Upload from gallery
                </Button>

                <p className="text-ink-faint text-[11px] text-center mt-2">
                  JPG, PNG up to 10MB · Your look, your style
                </p>
              </div>
            )}

            {/* Hidden file input — camera mode */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileSelect}
            />
          </motion.div>
        )}

        {/* ── STEP 2: TAG PRODUCTS ── */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="flex-1 overflow-y-auto pb-8"
          >
            {/* Mini photo preview */}
            {previewUrl && (
              <div className="h-44 w-full bg-black overflow-hidden relative">
                <img src={previewUrl} alt="Look" className="w-full h-full object-cover" />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent, rgba(15,12,8,0.85))' }} />
                <div className="absolute bottom-3 left-5">
                  <p className="text-white/70 text-[9px] font-semibold uppercase tracking-[0.18em]">Your look</p>
                </div>
              </div>
            )}

            <div className="px-6 pt-5">
              <Eyebrow className="mb-3">
                Tag products <span className="text-ink-faint normal-case tracking-normal font-normal lowercase">(optional, max 5)</span>
              </Eyebrow>

              {catalogUnavailable && (
                <div className="mb-4 rounded-2xl border border-warning/25 bg-warning-soft px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warning mb-1">Tagging unavailable</p>
                  <p className="text-[12.5px] text-ink-soft leading-relaxed">Product search is unavailable right now, so look posts can be published without tagged items.</p>
                </div>
              )}

              {/* Search bar */}
              <div className="flex items-center gap-3 bg-surface-1 border border-line rounded-full px-4 h-12 mb-3 focus-within:border-ink transition-colors">
                <span className="material-symbols-outlined text-ink-faint text-[19px]" aria-hidden="true">search</span>
                <input
                  type="text"
                  placeholder="Search brand or product…"
                  value={productSearch}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  className="flex-1 bg-transparent text-ink text-[14px] placeholder:text-ink-faint outline-none"
                />
                {searching && <Spinner size={16} className="text-brand" />}
              </div>

              {/* Search results */}
              <AnimatePresence>
                {searchResults.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-surface-1 border border-line rounded-card overflow-hidden mb-5"
                  >
                    {searchResults.map((p, i) => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className={`w-full flex items-center gap-3 p-3 text-left ${i < searchResults.length - 1 ? 'border-b border-line' : ''}`}
                      >
                        <div className="h-12 w-12 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2">
                          <img src={p.image} alt={p.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-display text-[14px] font-medium text-ink truncate">{p.brand}</p>
                          <p className="text-ink-faint text-[11px] truncate">{p.title}</p>
                          <p className="text-ink-soft text-[12px]">{p.price}</p>
                        </div>
                        <span className="material-symbols-outlined text-ink text-[20px]" aria-hidden="true">add_circle</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tagged products */}
              {taggedProducts.length > 0 && (
                <div className="mb-4">
                  <Eyebrow className="mb-3">Tagged ({taggedProducts.length}/5)</Eyebrow>
                  <div className="flex flex-col gap-2">
                    {taggedProducts.map(p => (
                      <div key={p.id} className="flex items-center gap-3 bg-surface-1 border border-line rounded-card p-3">
                        <div className="h-12 w-12 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2">
                          <img src={p.image} alt={p.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-display text-[14px] font-medium text-ink truncate">{p.brand}</p>
                          <p className="text-ink-faint text-[11px] truncate">{p.title}</p>
                        </div>
                        <button onClick={() => removeProduct(p.id)} aria-label={`Remove ${p.brand}`} className="active:scale-90">
                          <span className="material-symbols-outlined text-ink-faint text-[20px]" aria-hidden="true">remove_circle</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {taggedProducts.length === 0 && !productSearch && (
                <div className="text-center py-8 opacity-50">
                  <span className="material-symbols-outlined text-[36px] text-ink-faint mb-2" aria-hidden="true">sell</span>
                  <p className="text-ink-faint text-[12px]">Tag products so others can shop your exact look</p>
                </div>
              )}

              <Button size="lg" fullWidth className="mt-6" onClick={() => setStep(3)}>Next — write caption</Button>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3: CAPTION & PUBLISH ── */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="flex-1 overflow-y-auto pb-12"
          >
            {/* Photo + product tag count summary */}
            <div className="flex gap-4 px-6 pt-6 mb-6">
              {previewUrl && (
                <div className="h-24 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2 border border-line">
                  <img src={previewUrl} alt="Look" className="h-full w-full object-cover" />
                </div>
              )}
              <div className="flex flex-col justify-center">
                <p className="font-display text-[18px] font-medium text-ink">Your look is ready</p>
                <p className="text-ink-soft text-[12px] mt-1">
                  {taggedProducts.length > 0
                    ? `${taggedProducts.length} product${taggedProducts.length > 1 ? 's' : ''} tagged`
                    : 'No products tagged'}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="material-symbols-outlined text-brass text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
                  <span className="text-brass text-[11px] font-semibold uppercase tracking-[0.08em]">+20 ZipCoins on publish</span>
                </div>
              </div>
            </div>

            <div className="px-6">
              <Eyebrow className="mb-3">Caption</Eyebrow>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Describe your look, the occasion, where you're wearing it…"
                rows={4}
                maxLength={200}
                className="w-full bg-surface-1 border border-line rounded-card px-4 py-3.5 text-ink text-[14px] placeholder:text-ink-faint outline-none resize-none focus:border-ink transition-colors"
              />
              <p className="text-right text-ink-faint text-[11px] mt-1">{caption.length}/200</p>

              {/* Quick caption suggestions */}
              <Eyebrow className="mt-4 mb-2">Quick captions</Eyebrow>
              <div className="flex flex-wrap gap-2 mb-6">
                {[
                  'Date night look 🌙',
                  'Office fit ✨',
                  'Weekend casual 🏙️',
                  'Festive vibes 🪔',
                  'My everyday style',
                  'Summer haul 🌞',
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => setCaption(s)}
                    className={`text-[12px] px-4 py-2 rounded-full border active:scale-95 transition-[transform,border-color,background-color,color] ${caption === s ? 'bg-ink border-ink text-ink-invert' : 'border-line text-ink-soft hover:border-line-strong'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Publish */}
              <Button
                variant="accent"
                size="lg"
                fullWidth
                icon="send"
                loading={publishing}
                disabled={!canPublish || publishing}
                onClick={handlePublish}
              >
                Publish look
              </Button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default CreateLook;
