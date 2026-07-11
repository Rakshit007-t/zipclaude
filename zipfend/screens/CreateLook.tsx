import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { addDoc, collection, doc, getDoc, increment, updateDoc } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import app, { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { demoProducts } from '../services/demoProducts';
import { listCloset, ClosetItem } from '../services/closet';
import { compressImage, toDraftDataUrl, dataUrlToBlob } from '../utils/media';
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

type MediaKind = 'image' | 'video';

interface MediaItem {
  id: string;
  kind: MediaKind;
  /** Local preview (object URL for fresh files, data URL for drafts). */
  previewUrl: string;
  /** Upload source. */
  blob: Blob;
}

type Audience = 'public' | 'followers';

const storage = getStorage(app);
const DRAFT_KEY = 'zr_look_draft';
const MAX_IMAGES = 5;
const MAX_VIDEO_MB = 60;

interface Draft {
  media: { dataUrl: string }[];
  caption: string;
  taggedProducts: TaggedProduct[];
  audience: Audience;
  savedAt: number;
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d?.media?.length || d?.caption ? d : null;
  } catch { return null; }
}

/** Everything taggable: the demo catalog + whatever the user has saved. */
function searchCatalog(term: string): TaggedProduct[] {
  const q = term.toLowerCase();
  const closet: ClosetItem[] = [...listCloset('likes'), ...listCloset('cart'), ...listCloset('wardrobe')];
  const seen = new Set<string>();
  const out: TaggedProduct[] = [];
  for (const p of [...closet, ...demoProducts]) {
    if (seen.has(p.id)) continue;
    if (`${p.brand} ${p.title}`.toLowerCase().includes(q)) {
      seen.add(p.id);
      out.push({
        id: p.id, title: p.title, brand: p.brand, price: p.price,
        image: p.image, url: p.url,
        affiliateLink: (p as ClosetItem).affiliateLink || (p as typeof demoProducts[0]).affiliateLink || p.url,
      });
    }
    if (out.length >= 8) break;
  }
  return out;
}

export function parseHashtags(caption: string): string[] {
  return [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(t => t.slice(1).toLowerCase()))];
}

const CreateLook: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<Audience>('public');
  const [taggedProducts, setTaggedProducts] = useState<TaggedProduct[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<TaggedProduct[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => readDraft());
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasVideo = media.some(m => m.kind === 'video');

  useEffect(() => () => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    media.forEach(m => { if (m.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- STEP 1: media -------------------------------------------------------

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    for (const file of files) {
      if (file.type.startsWith('video/')) {
        if (media.length > 0) { showToast('A reel is one video — remove photos first', 'error'); return; }
        if (file.size > MAX_VIDEO_MB * 1024 * 1024) { showToast(`Video must be under ${MAX_VIDEO_MB}MB`, 'error'); return; }
        setMedia([{ id: `v-${Date.now()}`, kind: 'video', previewUrl: URL.createObjectURL(file), blob: file }]);
        return;
      }
      if (!file.type.startsWith('image/')) { showToast('Images or one video only', 'error'); continue; }
      if (file.size > 10 * 1024 * 1024) { showToast('Each image must be under 10MB', 'error'); continue; }
      setMedia(prev => {
        if (prev.some(m => m.kind === 'video')) return prev;
        if (prev.length >= MAX_IMAGES) { return prev; }
        return [...prev, { id: `i-${Date.now()}-${prev.length}`, kind: 'image', previewUrl: URL.createObjectURL(file), blob: file }];
      });
    }
  };

  const removeMedia = (id: string) => {
    setMedia(prev => {
      const item = prev.find(m => m.id === id);
      if (item?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(m => m.id !== id);
    });
  };

  // ---- Drafts ---------------------------------------------------------------

  const restoreDraft = () => {
    if (!draft) return;
    setMedia(draft.media.map((m, i) => ({
      id: `d-${i}`, kind: 'image', previewUrl: m.dataUrl, blob: dataUrlToBlob(m.dataUrl),
    })));
    setCaption(draft.caption || '');
    setTaggedProducts(draft.taggedProducts || []);
    setAudience(draft.audience || 'public');
    setDraft(null);
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setDraft(null);
  };

  const saveDraft = async () => {
    if (hasVideo) { showToast('Video posts can\'t be drafted yet', 'error'); return; }
    try {
      const dataUrls = await Promise.all(media.map(m => toDraftDataUrl(m.blob)));
      const d: Draft = {
        media: dataUrls.map(dataUrl => ({ dataUrl })),
        caption, taggedProducts, audience, savedAt: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      showToast('Draft saved', 'success');
      navigate(-1);
    } catch {
      showToast('Could not save draft', 'error');
    }
  };

  // ---- STEP 2: product tagging (demo catalog + closet) -----------------------

  const handleProductSearch = (val: string) => {
    setProductSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length < 2) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(() => {
      setSearchResults(searchCatalog(val));
    }, 250);
  };

  const addProduct = (p: TaggedProduct) => {
    if (taggedProducts.length >= 5) { showToast('Max 5 products per look', 'error'); return; }
    if (taggedProducts.find(t => t.id === p.id)) return;
    setTaggedProducts(prev => [...prev, p]);
    setProductSearch('');
    setSearchResults([]);
  };

  const removeProduct = (id: string) => {
    setTaggedProducts(prev => prev.filter(p => p.id !== id));
  };

  // ---- STEP 3: publish --------------------------------------------------------

  const handlePublish = async () => {
    if (!media.length) return;
    if (!auth.currentUser) {
      // Demo sessions have no Firebase auth — say so instead of a dead button
      showToast('Sign in with Google to post to The Salon', 'error');
      return;
    }
    if (!caption.trim()) { showToast('Add a caption first', 'error'); return; }
    setPublishing(true);
    try {
      const user = auth.currentUser;

      // Upload every media item (images are compressed first)
      const mediaUrls: string[] = [];
      for (let i = 0; i < media.length; i++) {
        const m = media[i];
        const blob = m.kind === 'image' ? await compressImage(m.blob) : m.blob;
        const ext = m.kind === 'video' ? 'mp4' : 'jpg';
        const storageRef = ref(storage, `looks/${user.uid}/${Date.now()}_${i}.${ext}`);
        await uploadBytes(storageRef, blob);
        mediaUrls.push(await getDownloadURL(storageRef));
      }

      const userSnap = await getDoc(doc(db, 'users', user.uid));
      const userData = userSnap.data() || {};
      const creatorUsername = userData.username ||
        (user.displayName || 'user').toLowerCase().replace(/\s+/g, '_') + '_zr';

      await addDoc(collection(db, 'looks'), {
        creatorId: user.uid,
        creatorName: user.displayName || creatorUsername,
        creatorUsername,
        creatorAvatar: user.photoURL || userData.photoURL || null,
        mediaUrl: mediaUrls[0],           // back-compat with existing feed docs
        mediaUrls,
        mediaType: hasVideo ? 'video' : 'image',
        caption: caption.trim(),
        hashtags: parseHashtags(caption),
        audience,
        taggedProducts,
        likesCount: 0,
        viewsCount: 0,
        createdAt: new Date(),
        status: 'active',
      });

      updateDoc(doc(db, 'users', user.uid), {
        zipPoints: increment(20),
        postsCount: increment(1),
        username: creatorUsername,
      }).catch(() => {});

      localStorage.removeItem(DRAFT_KEY);
      showToast('Look posted! +20 ZipCoins ✦', 'success');
      navigate('/community');
    } catch (err) {
      console.error(err);
      showToast('Failed to publish. Try again.', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const canProceedStep1 = media.length > 0;
  const canPublish = media.length > 0 && !!caption.trim();

  const stepTitle = step === 1 ? 'Choose media' : step === 2 ? 'Tag products' : 'Caption & share';

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
          <div className="flex items-center gap-1.5 mt-2" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map(s => (
              <div key={s} className={`h-[3px] rounded-full transition-all ${s === step ? 'w-6 bg-brand' : s < step ? 'w-3 bg-brand/50' : 'w-3 bg-surface-3'}`} />
            ))}
          </div>
        </div>

        {step < 3 ? (
          <button
            onClick={() => step === 1 && canProceedStep1 ? setStep(2) : step === 2 ? setStep(3) : null}
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

        {/* ── STEP 1: MEDIA PICKER ── */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="flex-1 flex flex-col"
          >
            {/* Draft banner */}
            {draft && media.length === 0 && (
              <div className="mx-6 mt-5 rounded-card border border-brass/30 bg-brass-soft px-4 py-3.5 flex items-center gap-3">
                <span className="material-symbols-outlined text-brass text-[20px]" aria-hidden="true">draft</span>
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-semibold text-[13px]">You have a draft</p>
                  <p className="text-ink-faint text-[11.5px] truncate">{draft.caption || `${draft.media.length} photo${draft.media.length > 1 ? 's' : ''}`}</p>
                </div>
                <button onClick={restoreDraft} className="text-brand text-[11px] font-semibold uppercase tracking-[0.1em] active:opacity-70">Resume</button>
                <button onClick={discardDraft} aria-label="Discard draft" className="text-ink-faint active:opacity-70">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                </button>
              </div>
            )}

            {media.length > 0 ? (
              <div className="flex-1 flex flex-col">
                {/* Selected media grid */}
                <div className="px-6 pt-5">
                  <Eyebrow className="mb-3">{hasVideo ? 'Your reel' : `Photos (${media.length}/${MAX_IMAGES})`}</Eyebrow>
                  <div className="grid grid-cols-3 gap-2">
                    {media.map((m, i) => (
                      <div key={m.id} className={`relative rounded-xl overflow-hidden bg-surface-2 ${hasVideo ? 'col-span-3 aspect-[9/12]' : 'aspect-[3/4]'}`}>
                        {m.kind === 'video' ? (
                          <video src={m.previewUrl} className="h-full w-full object-cover" muted loop autoPlay playsInline />
                        ) : (
                          <img src={m.previewUrl} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                        )}
                        {i === 0 && !hasVideo && media.length > 1 && (
                          <span className="absolute bottom-1.5 left-1.5 text-white text-[9px] font-semibold uppercase tracking-[0.1em] bg-black/50 rounded-full px-2 py-0.5">Cover</span>
                        )}
                        <button
                          onClick={() => removeMedia(m.id)}
                          aria-label="Remove"
                          className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center active:scale-90"
                        >
                          <span className="material-symbols-outlined text-white text-[15px]" aria-hidden="true">close</span>
                        </button>
                      </div>
                    ))}
                    {!hasVideo && media.length < MAX_IMAGES && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Add another photo"
                        className="aspect-[3/4] rounded-xl border border-dashed border-line-strong flex items-center justify-center text-ink-faint active:scale-95 transition-transform"
                      >
                        <span className="material-symbols-outlined text-[24px]" aria-hidden="true">add</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="p-6 flex flex-col gap-3 mt-auto">
                  <Button size="lg" fullWidth onClick={() => setStep(2)}>Next — tag products</Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5">
                <div className="h-16 w-16 rounded-full border border-line-strong flex items-center justify-center mb-2">
                  <span className="material-symbols-outlined text-ink-faint text-[28px]" aria-hidden="true">add_a_photo</span>
                </div>
                <div className="text-center mb-4">
                  <Eyebrow className="mb-3">The Salon</Eyebrow>
                  <h2 className="text-ink font-display text-[28px] font-light mb-2">Share your <em className="font-medium">look.</em></h2>
                  <p className="text-ink-soft text-[14px] leading-relaxed max-w-[260px]">
                    Photos, a carousel, or a reel — tag the pieces so others can shop your exact style.
                  </p>
                </div>

                <Button size="lg" fullWidth icon="camera_alt" onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.setAttribute('capture', 'environment');
                    fileInputRef.current.setAttribute('accept', 'image/*');
                    fileInputRef.current.click();
                  }
                }}>
                  Take photo
                </Button>

                <Button size="lg" fullWidth variant="outline" icon="photo_library" onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.removeAttribute('capture');
                    fileInputRef.current.setAttribute('accept', 'image/*,video/*');
                    fileInputRef.current.click();
                  }
                }}>
                  Photos or video
                </Button>

                <p className="text-ink-faint text-[11px] text-center mt-2">
                  Up to {MAX_IMAGES} photos or one video · JPG, PNG, MP4
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
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
            {media[0] && (
              <div className="h-44 w-full bg-black overflow-hidden relative">
                {media[0].kind === 'video' ? (
                  <video src={media[0].previewUrl} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                ) : (
                  <img src={media[0].previewUrl} alt="Look" className="w-full h-full object-cover" />
                )}
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

              {/* Search bar — searches the catalog and your closet */}
              <div className="flex items-center gap-3 bg-surface-1 border border-line rounded-full px-4 h-12 mb-3 focus-within:border-ink transition-colors">
                <span className="material-symbols-outlined text-ink-faint text-[19px]" aria-hidden="true">search</span>
                <input
                  type="text"
                  placeholder="Search brand or product…"
                  aria-label="Search products to tag"
                  value={productSearch}
                  onChange={(e) => handleProductSearch(e.target.value)}
                  className="flex-1 bg-transparent text-ink text-[14px] placeholder:text-ink-faint outline-none"
                />
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
                  <p className="text-ink-faint text-[12px]">Search the catalog or your saved pieces to tag them</p>
                </div>
              )}

              <Button size="lg" fullWidth className="mt-6" onClick={() => setStep(3)}>Next — write caption</Button>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3: CAPTION, AUDIENCE, PUBLISH ── */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="flex-1 overflow-y-auto pb-12"
          >
            <div className="flex gap-4 px-6 pt-6 mb-6">
              {media[0] && (
                <div className="h-24 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-surface-2 border border-line">
                  {media[0].kind === 'video' ? (
                    <video src={media[0].previewUrl} className="h-full w-full object-cover" muted playsInline />
                  ) : (
                    <img src={media[0].previewUrl} alt="Look" className="h-full w-full object-cover" />
                  )}
                </div>
              )}
              <div className="flex flex-col justify-center">
                <p className="font-display text-[18px] font-medium text-ink">Your look is ready</p>
                <p className="text-ink-soft text-[12px] mt-1">
                  {hasVideo ? 'Reel' : media.length > 1 ? `${media.length}-photo carousel` : 'Photo'}
                  {taggedProducts.length > 0 ? ` · ${taggedProducts.length} tagged` : ''}
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
                placeholder="Describe your look… use #hashtags so people find it"
                aria-label="Caption"
                rows={4}
                maxLength={300}
                className="w-full bg-surface-1 border border-line rounded-card px-4 py-3.5 text-ink text-[14px] placeholder:text-ink-faint outline-none resize-none focus:border-ink transition-colors"
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-ink-faint text-[11px]">
                  {parseHashtags(caption).length > 0 && (
                    <span className="text-brand">{parseHashtags(caption).map(h => `#${h}`).join(' ')}</span>
                  )}
                </p>
                <p className="text-ink-faint text-[11px]">{caption.length}/300</p>
              </div>

              {/* Quick caption suggestions */}
              <Eyebrow className="mt-4 mb-2">Quick captions</Eyebrow>
              <div className="flex flex-wrap gap-2 mb-6">
                {[
                  'Date night look 🌙 #datenight',
                  'Office fit ✨ #workwear',
                  'Weekend casual 🏙️ #ootd',
                  'Festive vibes 🪔 #festive',
                  'My everyday style #ootd',
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

              {/* Audience */}
              <Eyebrow className="mb-2">Who can see this</Eyebrow>
              <div className="grid grid-cols-2 gap-2.5 mb-7">
                {([
                  { key: 'public', icon: 'public', label: 'Everyone', desc: 'Visible in The Salon' },
                  { key: 'followers', icon: 'group', label: 'Followers', desc: 'Only people who follow you' },
                ] as const).map(a => (
                  <button
                    key={a.key}
                    onClick={() => setAudience(a.key)}
                    aria-pressed={audience === a.key}
                    className={`flex flex-col items-start p-4 rounded-2xl border text-left active:scale-[0.98] transition-[transform,border-color] ${audience === a.key ? 'border-ink' : 'border-line'}`}
                  >
                    <span className={`material-symbols-outlined text-[20px] mb-2 ${audience === a.key ? 'text-brand' : 'text-ink-faint'}`} aria-hidden="true">{a.icon}</span>
                    <span className="text-ink font-semibold text-[13px]">{a.label}</span>
                    <span className="text-ink-faint text-[11px] mt-0.5">{a.desc}</span>
                  </button>
                ))}
              </div>

              {/* Publish + draft */}
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
              {!hasVideo && (
                <Button variant="ghost" fullWidth className="mt-2" icon="draft" onClick={saveDraft}>
                  Save as draft
                </Button>
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default CreateLook;
