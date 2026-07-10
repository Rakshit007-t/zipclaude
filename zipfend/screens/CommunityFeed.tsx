import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { Spinner } from '../components/ui';

interface Look {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorUsername: string;
  creatorAvatar: string | null;
  mediaUrl: string;
  caption: string;
  taggedProducts: {
    id: string; title: string; brand: string;
    price: string; image: string; url: string; affiliateLink: string;
  }[];
  likesCount: number;
  viewsCount: number;
  createdAt: any;
}

const CommunityFeed: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [looks, setLooks] = useState<Look[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLookIndex, setActiveLookIndex] = useState(0);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [productsOpen, setProductsOpen] = useState(false);

  // Fetch looks
  useEffect(() => {
    const fetchLooks = async () => {
      try {
        const q = query(
          collection(db, 'looks'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const snap = await getDocs(q);
        const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Look[];
        setLooks(fetched);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchLooks();

    // Liked map listener
    const user = auth.currentUser;
    if (user) {
      const likesRef = collection(db, 'users', user.uid, 'lookLikes');
      return onSnapshot(likesRef, snap => {
        const map: Record<string, boolean> = {};
        snap.docs.forEach(d => { map[d.id] = true; });
        setLikedMap(map);
      });
    }
  }, []);

  // Intersection observer for active look
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-index'));
            setActiveLookIndex(index);
            setProductsOpen(false);
            // Increment view count
            const look = looks[index];
            if (look) {
              updateDoc(doc(db, 'looks', look.id), { viewsCount: increment(1) }).catch(() => {});
            }
          }
        });
      },
      { threshold: 0.7 }
    );
    cardRefs.current.forEach(card => { if (card) observer.observe(card); });
    return () => observer.disconnect();
  }, [looks]);

  const toggleLike = async (look: Look) => {
    const user = auth.currentUser;
    if (!user) return;
    const likeRef = doc(db, 'users', user.uid, 'lookLikes', look.id);
    const isLiked = likedMap[look.id];
    try {
      if (isLiked) {
        await deleteDoc(likeRef);
        await updateDoc(doc(db, 'looks', look.id), { likesCount: increment(-1) });
      } else {
        await setDoc(likeRef, { createdAt: new Date() });
        await updateDoc(doc(db, 'looks', look.id), { likesCount: increment(1) });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCartProduct = async (product: Look['taggedProducts'][0]) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'cart'), {
        productRefId: product.id,
        productUrl: product.affiliateLink || product.url,
        addedAt: new Date(),
        source: 'community_look',
      });
      showToast(`${product.brand} added to cart 🛒`, 'success');
    } catch {
      showToast('Failed to add to cart', 'error');
    }
  };

  const currentLook = looks[activeLookIndex];

  if (loading) {
    return (
      <div className="h-dvh bg-surface-0 flex items-center justify-center text-ink-faint">
        <Spinner size={28} />
      </div>
    );
  }

  if (looks.length === 0) {
    return (
      <div className="h-dvh bg-surface-0 flex flex-col items-center justify-center px-8 text-center">
        <div className="h-16 w-16 rounded-full border border-line-strong flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-ink-faint text-[28px]" aria-hidden="true">photo_camera</span>
        </div>
        <p className="eyebrow mb-3">The Salon</p>
        <h2 className="text-ink font-display text-[28px] font-light mb-3">Be the <em className="font-medium">first.</em></h2>
        <p className="text-ink-soft text-[14px] mb-8 max-w-[260px] leading-relaxed">No community looks yet. Post yours and inspire the circle.</p>
        <button onClick={() => navigate('/create-look')} className="h-12 px-7 bg-ink text-ink-invert rounded-full font-semibold text-[12px] uppercase tracking-[0.12em] active:scale-95 transition-transform">
          Post a look
        </button>
        <button onClick={() => navigate(-1)} className="mt-4 text-ink-faint text-[12px] active:opacity-70">← Back</button>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full bg-black overflow-hidden relative">

      {/* TOP HEADER — overlaid */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-5 pt-[22px] pt-safe pb-10 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
        <button aria-label="Go back"
          onClick={() => navigate(-1)}
          className="h-10 w-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center pointer-events-auto active:scale-90 border border-white/15"
        >
          <span className="material-symbols-outlined text-white text-[20px]" aria-hidden="true">arrow_back</span>
        </button>

        <div className="flex flex-col items-center pointer-events-none">
          <span className="text-white text-[10px] font-semibold uppercase tracking-[0.2em]">The Salon</span>
          <span className="text-white/60 text-[11px] mt-0.5">Real looks, real people</span>
        </div>

        <button
          onClick={() => navigate('/create-look')}
          aria-label="Post a look"
          className="h-10 w-10 rounded-full bg-[#e89b6b] backdrop-blur-md flex items-center justify-center pointer-events-auto active:scale-90"
        >
          <span className="material-symbols-outlined text-black text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">add</span>
        </button>
      </div>

      {/* REEL FEED */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-scroll no-scrollbar snap-y snap-mandatory"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {looks.map((look, index) => (
          <div
            key={look.id}
            data-index={index}
            ref={el => {
              cardRefs.current[index] = el;
            }}
            className="h-dvh w-full flex-shrink-0 relative bg-black snap-start snap-always"
          >
            {/* Look photo */}
            <img
              src={look.mediaUrl}
              alt={look.caption}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />

            {/* Gradient overlays */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 45%, transparent 65%, rgba(0,0,0,0.3) 100%)' }} />

            {/* RIGHT ACTION BAR */}
            <div className="absolute right-4 bottom-44 z-40 flex flex-col items-center gap-5">

              {/* Creator avatar */}
              <div className="relative">
                <div className="h-12 w-12 rounded-full border-2 border-white overflow-hidden">
                  {look.creatorAvatar ? (
                    <img src={look.creatorAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-black/50 flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-xl" aria-hidden="true">person</span>
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-5 w-5 rounded-full bg-[#e89b6b] flex items-center justify-center border border-black">
                  <span className="material-symbols-outlined text-black text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">add</span>
                </div>
              </div>

              {/* Like */}
              <button onClick={() => toggleLike(look)} className="flex flex-col items-center gap-1 active:scale-90">
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/15">
                  <span
                    className="material-symbols-outlined text-[24px]"
                    style={{ color: likedMap[look.id] ? '#e89b6b' : 'white', fontVariationSettings: likedMap[look.id] ? "'FILL' 1" : "'FILL' 0" }}
                    aria-hidden="true"
                  >favorite</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">
                  {look.likesCount > 0 ? look.likesCount : 'Like'}
                </span>
              </button>

              {/* Products sheet toggle */}
              <button onClick={() => setProductsOpen(o => !o)} className="flex flex-col items-center gap-1 active:scale-90">
                <div className={`h-12 w-12 rounded-full backdrop-blur-md flex items-center justify-center border ${productsOpen ? 'bg-[#e89b6b] border-[#e89b6b]' : 'bg-black/40 border-white/15'}`}>
                  <span className={`material-symbols-outlined text-[24px] ${productsOpen ? 'text-black' : 'text-white'}`} style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">sell</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">
                  {look.taggedProducts.length > 0 ? `Shop (${look.taggedProducts.length})` : 'Shop'}
                </span>
              </button>

              {/* Share */}
              <button
                onClick={async () => {
                  try {
                    if (navigator.share) {
                      await navigator.share({ title: look.caption, url: window.location.href });
                    }
                  } catch {}
                }}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/15">
                  <span className="material-symbols-outlined text-white text-[24px]" aria-hidden="true">ios_share</span>
                </div>
                <span className="text-white text-[10px] font-semibold uppercase tracking-[0.1em]">Share</span>
              </button>
            </div>

            {/* BOTTOM INFO — creator + caption */}
            <div className="absolute bottom-24 left-0 right-20 z-40 pl-4">
              <div className="bg-black/50 backdrop-blur-xl rounded-2xl px-5 py-4 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-full overflow-hidden flex-shrink-0 border border-white/20">
                    {look.creatorAvatar ? (
                      <img src={look.creatorAvatar} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="h-full w-full bg-black/40 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white text-xs" aria-hidden="true">person</span>
                      </div>
                    )}
                  </div>
                  <span className="text-white text-[12px] font-medium">@{look.creatorUsername}</span>
                  {look.taggedProducts.length > 0 && (
                    <span className="ml-auto text-[#e89b6b] text-[9px] font-semibold uppercase tracking-[0.1em]">
                      {look.taggedProducts.length} shoppable
                    </span>
                  )}
                </div>
                <p className="text-white text-[13.5px] leading-snug line-clamp-2">{look.caption}</p>
              </div>
            </div>

            {/* SHOPPABLE PRODUCTS DRAWER — slides up */}
            <AnimatePresence>
              {productsOpen && activeLookIndex === index && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[55] bg-black/40"
                    onClick={() => setProductsOpen(false)}
                  />
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                    className="absolute inset-x-0 bottom-0 z-[60] bg-surface-1 rounded-t-sheet border-t border-line pb-16"
                  >
                    <div className="flex justify-center pt-4 pb-2">
                      <div className="w-10 h-1 bg-line-strong rounded-full" />
                    </div>
                    <div className="px-6 pb-2">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-display text-[19px] font-medium text-ink">Shop this look</h3>
                        <span className="text-ink-faint text-[11px] uppercase tracking-[0.1em]">{look.taggedProducts.length} items</span>
                      </div>

                      {look.taggedProducts.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-ink-faint text-[13px]">No products tagged in this look</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto no-scrollbar">
                          {look.taggedProducts.map(product => (
                            <div key={product.id} className="flex items-center gap-4 bg-surface-2 rounded-2xl p-3">
                              <button
                                className="h-16 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-surface-3"
                                onClick={() => window.open(product.affiliateLink || product.url, '_blank')}
                                aria-label={`Open ${product.title}`}
                              >
                                <img src={product.image} alt={product.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                              </button>
                              <div className="flex-1 min-w-0">
                                <p className="font-display text-[15px] font-medium text-ink leading-tight truncate">{product.brand}</p>
                                <p className="text-ink-faint text-[11px] leading-tight truncate mt-0.5">{product.title}</p>
                                <p className="text-ink font-semibold text-[13px] mt-0.5">{product.price}</p>
                              </div>
                              <button
                                onClick={() => handleCartProduct(product)}
                                aria-label={`Add ${product.brand} to cart`}
                                className="h-10 w-10 rounded-full border border-line flex items-center justify-center text-ink active:scale-90 flex-shrink-0"
                              >
                                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">add_shopping_cart</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CommunityFeed;
