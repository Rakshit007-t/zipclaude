import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import app, { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';

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

  return (
    <div className="min-h-screen bg-[#111111] text-white font-body flex flex-col">

      {/* HEADER */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-5
        bg-[#111111]/90 backdrop-blur-xl border-b border-white/5">
        <button
          onClick={() => step > 1 ? setStep((step - 1) as 1 | 2 | 3) : navigate(-1)}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-white/5 active:scale-90"
        >
          <span className="material-symbols-outlined text-[20px] text-[#C9A06C]">arrow_back</span>
        </button>

        <div className="flex flex-col items-center">
          <h1 className="text-xs font-bold tracking-[0.35em] uppercase text-[#C9A06C]">
            {step === 1 ? 'Choose Photo' : step === 2 ? 'Tag Products' : 'Add Caption'}
          </h1>
          {/* Step dots */}
          <div className="flex items-center gap-1.5 mt-2">
            {[1, 2, 3].map(s => (
              <div key={s} className={`h-1 rounded-full transition-all ${
                s === step ? 'w-6 bg-[#C9A06C]' : s < step ? 'w-3 bg-[#C9A06C]/50' : 'w-3 bg-white/10'
              }`} />
            ))}
          </div>
        </div>

        {step < 3 ? (
          <button
            onClick={() => step === 1 && canProceedStep1 ? setStep(2) : step === 2 && canProceedStep2 ? setStep(3) : null}
            className={`text-xs font-black uppercase tracking-wider ${
              (step === 1 && canProceedStep1) || step === 2 ? 'text-[#C9A06C] active:opacity-70' : 'text-white/20'
            }`}
          >
            Next
          </button>
        ) : (
          <button
            onClick={handlePublish}
            disabled={!canPublish || publishing}
            className={`text-xs font-black uppercase tracking-wider ${
              canPublish && !publishing ? 'text-[#C9A06C] active:opacity-70' : 'text-white/20'
            }`}
          >
            {publishing ? '...' : 'Post'}
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
                  <img src={previewUrl} alt="Preview"
                    className="w-full h-full object-cover" />
                  <button
                    onClick={() => { setSelectedFile(null); setPreviewUrl(null); }}
                    className="absolute top-4 right-4 h-9 w-9 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center active:scale-90"
                  >
                    <span className="material-symbols-outlined text-white text-lg">close</span>
                  </button>
                </div>
                <div className="p-5 flex flex-col gap-4">
                  <p className="text-white/40 text-xs text-center">Looking good! Tap Next to tag products.</p>
                  <button
                    onClick={() => setStep(2)}
                    className="w-full bg-[#B5853F] text-white py-4 rounded-2xl font-black text-sm uppercase tracking-[0.2em] active:scale-95"
                  >
                    Next — Tag Products
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border border-white/10 text-white/50 py-3.5 rounded-2xl text-xs font-bold active:scale-95"
                  >
                    Change Photo
                  </button>
                </div>
              </div>
            ) : (
              /* Photo picker options */
              <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5">
                <div className="h-28 w-28 rounded-full bg-[#0D9488]/10 border border-[#0D9488]/20 flex items-center justify-center mb-2">
                  <span className="material-symbols-outlined text-[#0D9488] text-5xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}>add_a_photo</span>
                </div>
                <div className="text-center mb-4">
                  <h2 className="text-white font-display text-2xl font-bold mb-2">Share your look</h2>
                  <p className="text-white/40 text-sm leading-relaxed max-w-[240px]">
                    Post your outfit and let others shop your exact style
                  </p>
                </div>

                {/* Camera — opens rear camera directly */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-[#0D9488] text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest active:scale-95 flex items-center justify-center gap-3"
                >
                  <span className="material-symbols-outlined text-xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}>camera_alt</span>
                  Take Photo
                </button>

                {/* Gallery */}
                <button
                  onClick={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                    }
                  }}
                  className="w-full border border-white/10 bg-white/5 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest active:scale-95 flex items-center justify-center gap-3"
                >
                  <span className="material-symbols-outlined text-xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}>photo_library</span>
                  Upload from Gallery
                </button>

                <p className="text-white/20 text-[10px] text-center mt-2">
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
              <div className="h-48 w-full bg-black overflow-hidden relative">
                <img src={previewUrl} alt="Look" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#111111]/80" />
                <div className="absolute bottom-3 left-4">
                  <p className="text-white text-xs font-bold opacity-70">Your look</p>
                </div>
              </div>
            )}

            <div className="px-5 pt-5">
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.25em] mb-3">
                Tag products in this look
                <span className="text-white/20 normal-case tracking-normal font-normal ml-1">(optional, max 5)</span>
              </p>

              {catalogUnavailable && (
                <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200 mb-1">Tagging Unavailable</p>
                  <p className="text-xs text-amber-50/80 leading-relaxed">Product search is unavailable right now, so look posts can be published without tagged items.</p>
                </div>
              )}

              {/* Search bar */}
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 mb-3">
                <span className="material-symbols-outlined text-white/30 text-xl">search</span>
                <input
                  type="text"
                  placeholder="Search brand or product name..."
                  value={productSearch}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  className="flex-1 bg-transparent text-white text-sm placeholder-white/20 outline-none"
                />
                {searching && (
                  <div className="h-4 w-4 rounded-full border-2 border-[#0D9488] border-t-transparent animate-spin" />
                )}
              </div>

              {/* Search results */}
              <AnimatePresence>
                {searchResults.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mb-5"
                  >
                    {searchResults.map((p, i) => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className={`w-full flex items-center gap-3 p-3 active:bg-white/10 text-left ${
                          i < searchResults.length - 1 ? 'border-b border-white/5' : ''
                        }`}
                      >
                        <div className="h-12 w-12 rounded-xl overflow-hidden flex-shrink-0 bg-black/30">
                          <img src={p.image} alt={p.title}
                            className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[#C9A06C] text-[9px] font-bold uppercase tracking-wider">{p.brand}</p>
                          <p className="text-white text-xs font-bold truncate">{p.title}</p>
                          <p className="text-white/50 text-xs">{p.price}</p>
                        </div>
                        <span className="material-symbols-outlined text-[#0D9488] text-xl">add_circle</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Tagged products */}
              {taggedProducts.length > 0 && (
                <div className="mb-4">
                  <p className="text-white/30 text-[10px] font-bold uppercase tracking-wider mb-3">
                    Tagged ({taggedProducts.length}/5)
                  </p>
                  <div className="flex flex-col gap-2">
                    {taggedProducts.map(p => (
                      <div key={p.id} className="flex items-center gap-3 bg-[#0D9488]/10 border border-[#0D9488]/20 rounded-2xl p-3">
                        <div className="h-12 w-12 rounded-xl overflow-hidden flex-shrink-0 bg-black/30">
                          <img src={p.image} alt={p.title}
                            className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[#C9A06C] text-[9px] font-bold uppercase tracking-wider">{p.brand}</p>
                          <p className="text-white text-xs font-bold truncate">{p.title}</p>
                        </div>
                        <button onClick={() => removeProduct(p.id)} className="active:scale-90">
                          <span className="material-symbols-outlined text-white/30 text-xl">remove_circle</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {taggedProducts.length === 0 && !productSearch && (
                <div className="text-center py-8 opacity-40">
                  <span className="material-symbols-outlined text-4xl text-white/20 mb-2">sell</span>
                  <p className="text-white/30 text-xs">Tag products so others can shop your exact look</p>
                </div>
              )}

              <button
                onClick={() => setStep(3)}
                className="w-full mt-6 bg-[#B5853F] text-white py-4 rounded-2xl font-black text-sm uppercase tracking-[0.2em] active:scale-95"
              >
                Next — Write Caption
              </button>
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
            <div className="flex gap-4 px-5 pt-5 mb-6">
              {previewUrl && (
                <div className="h-24 w-24 rounded-2xl overflow-hidden flex-shrink-0 bg-black/30">
                  <img src={previewUrl} alt="Look" className="h-full w-full object-cover" />
                </div>
              )}
              <div className="flex flex-col justify-center">
                <p className="text-white font-bold text-sm">Your look is ready</p>
                <p className="text-white/40 text-xs mt-1">
                  {taggedProducts.length > 0
                    ? `${taggedProducts.length} product${taggedProducts.length > 1 ? 's' : ''} tagged`
                    : 'No products tagged'}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="material-symbols-outlined text-[#C9A06C] text-sm"
                    style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
                  <span className="text-[#C9A06C] text-xs font-bold">+20 ZipCoins on publish</span>
                </div>
              </div>
            </div>

            <div className="px-5">
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.25em] mb-3">Caption</p>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Describe your look, the occasion, where you're wearing it..."
                rows={4}
                maxLength={200}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-white text-sm placeholder-white/20 outline-none resize-none"
              />
              <p className="text-right text-white/20 text-[10px] mt-1">{caption.length}/200</p>

              {/* Quick caption suggestions */}
              <p className="text-white/30 text-[10px] font-bold uppercase tracking-wider mt-4 mb-2">Quick captions</p>
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
                    className={`text-xs px-4 py-2 rounded-full border active:scale-95 ${
                      caption === s
                        ? 'bg-[#B5853F] border-[#B5853F] text-white font-bold'
                        : 'border-white/10 text-white/40 bg-white/5'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Publish */}
              <button
                onClick={handlePublish}
                disabled={!canPublish || publishing}
                className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] flex items-center justify-center gap-3 ${
                  canPublish && !publishing
                    ? 'bg-[#0D9488] text-white active:scale-95 shadow-lg shadow-[#0D9488]/20'
                    : 'bg-white/5 text-white/20'
                }`}
              >
                {publishing ? (
                  <>
                    <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Publishing...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-xl"
                      style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                    Publish Look
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default CreateLook;
