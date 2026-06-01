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
      <div className="h-dvh bg-[#111111] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-[#0D9488]" />
      </div>
    );
  }

  if (looks.length === 0) {
    return (
      <div className="h-dvh bg-[#111111] flex flex-col items-center justify-center px-8 text-center">
        <div className="h-24 w-24 rounded-full bg-[#0D9488]/10 border border-[#0D9488]/20 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-[#0D9488] text-5xl"
            style={{ fontVariationSettings: "'FILL' 1" }}>photo_camera</span>
        </div>
        <h2 className="text-white font-display text-2xl font-bold mb-3">Be the first</h2>
        <p className="text-white/40 text-sm mb-8">No community looks yet. Post yours and inspire others.</p>
        <button
          onClick={() => navigate('/create-look')}
          className="bg-[#0D9488] text-white px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest active:scale-95"
        >
          Post a Look
        </button>
        <button onClick={() => navigate(-1)} className="mt-4 text-white/30 text-sm active:opacity-70">← Back</button>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full bg-black overflow-hidden relative font-body">

      {/* TOP HEADER — overlaid */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between
        px-5 pt-[22px] pb-10 pointer-events-none
        bg-gradient-to-b from-black/70 via-black/30 to-transparent">
        <button
          onClick={() => navigate(-1)}
          className="h-10 w-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center pointer-events-auto active:scale-90 border border-white/10"
        >
          <span className="material-symbols-outlined text-white text-[20px]">arrow_back</span>
        </button>

        <div className="flex flex-col items-center pointer-events-none">
          <span className="text-white text-[10px] font-black uppercase tracking-[0.3em] opacity-80">Community</span>
          <span className="text-white/40 text-[9px] mt-0.5">Real looks, real people</span>
        </div>

        <button
          onClick={() => navigate('/create-look')}
          className="h-10 w-10 rounded-full bg-[#0D9488]/80 backdrop-blur-md flex items-center justify-center pointer-events-auto active:scale-90 border border-[#0D9488]/40"
        >
          <span className="material-symbols-outlined text-white text-[20px]"
            style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
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
            />

            {/* Gradient overlays */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 45%, transparent 65%, rgba(0,0,0,0.3) 100%)' }} />

            {/* RIGHT ACTION BAR */}
            <div className="absolute right-4 bottom-44 z-40 flex flex-col items-center gap-5">

              {/* Creator avatar */}
              <div className="relative">
                <div className="h-12 w-12 rounded-full bg-white/10 border-2 border-white overflow-hidden">
                  {look.creatorAvatar ? (
                    <img src={look.creatorAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-[#0D9488]/30 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[#0D9488] text-xl">person</span>
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-5 w-5 rounded-full bg-[#0D9488] flex items-center justify-center border border-black">
                  <span className="material-symbols-outlined text-white text-[10px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
                </div>
              </div>

              {/* Like */}
              <button
                onClick={() => toggleLike(look)}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <span
                    className="material-symbols-outlined text-[26px]"
                    style={{
                      color: likedMap[look.id] ? '#FF4D6D' : 'white',
                      fontVariationSettings: likedMap[look.id] ? "'FILL' 1" : "'FILL' 0"
                    }}
                  >favorite</span>
                </div>
                <span className="text-white text-[10px] font-bold">
                  {look.likesCount > 0 ? look.likesCount : 'Like'}
                </span>
              </button>

              {/* Products sheet toggle */}
              <button
                onClick={() => setProductsOpen(o => !o)}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className={`h-12 w-12 rounded-full backdrop-blur-md flex items-center justify-center border ${
                  productsOpen ? 'bg-[#B5853F] border-[#B5853F]' : 'bg-black/40 border-white/10'
                }`}>
                  <span className="material-symbols-outlined text-white text-[26px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}>sell</span>
                </div>
                <span className="text-white text-[10px] font-bold">
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
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <span className="material-symbols-outlined text-white text-[26px]">ios_share</span>
                </div>
                <span className="text-white text-[10px] font-bold">Share</span>
              </button>
            </div>

            {/* BOTTOM INFO — creator + caption */}
            <div className="absolute bottom-20 left-0 right-20 z-40 pl-4">
              <div className="bg-black/50 backdrop-blur-xl rounded-[1.5rem] px-5 py-4 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
                    {look.creatorAvatar ? (
                      <img src={look.creatorAvatar} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="h-full w-full bg-[#0D9488]/30 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[#0D9488] text-xs">person</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[#0D9488] text-xs font-black">@{look.creatorUsername}</span>
                  {look.taggedProducts.length > 0 && (
                    <span className="ml-auto text-[#C9A06C] text-[9px] font-bold uppercase tracking-wider">
                      {look.taggedProducts.length} items · shoppable
                    </span>
                  )}
                </div>
                <p className="text-white text-sm leading-snug line-clamp-2">{look.caption}</p>
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
                    className="absolute inset-x-0 bottom-0 z-[60] bg-[#111111] rounded-t-[2.5rem] border-t border-white/10 pb-16"
                  >
                    <div className="flex justify-center pt-4 pb-2">
                      <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                    </div>
                    <div className="px-5 pb-2">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-white font-bold text-sm">Shop this look</h3>
                        <span className="text-white/30 text-xs">{look.taggedProducts.length} items</span>
                      </div>

                      {look.taggedProducts.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-white/30 text-sm">No products tagged in this look</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto no-scrollbar">
                          {look.taggedProducts.map(product => (
                            <div key={product.id}
                              className="flex items-center gap-4 bg-white/5 rounded-2xl p-3 border border-white/5">
                              <div
                                className="h-16 w-16 rounded-xl overflow-hidden flex-shrink-0 bg-black/20 cursor-pointer"
                                onClick={() => window.open(product.affiliateLink || product.url, '_blank')}
                              >
                                <img src={product.image} alt={product.title}
                                  className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[#C9A06C] text-[9px] font-bold uppercase tracking-wider">{product.brand}</p>
                                <p className="text-white font-bold text-xs leading-tight truncate">{product.title}</p>
                                <p className="text-white/70 font-black text-sm mt-0.5">{product.price}</p>
                              </div>
                              <button
                                onClick={() => handleCartProduct(product)}
                                className="h-10 w-10 rounded-full bg-[#22c55e]/15 border border-[#22c55e]/25 flex items-center justify-center active:scale-90 flex-shrink-0"
                              >
                                <span className="material-symbols-outlined text-[#22c55e] text-xl"
                                  style={{ fontVariationSettings: "'FILL' 1" }}>add_shopping_cart</span>
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
