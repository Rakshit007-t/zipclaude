import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { demoProducts } from '../services/demoProducts';
import {
  addToCloset,
  addToCloset as addPass,
  closetCount,
  inCloset,
  listCloset,
  onClosetChange,
  removeFromCloset,
  toggleCloset,
} from '../services/closet';

interface Product {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  category: string;
  type: string;
  url: string;
  affiliateLink?: string;
}

const toClosetItem = (p: Product) => ({
  id: p.id,
  title: p.title,
  brand: p.brand,
  price: p.price,
  image: p.image,
  url: p.url,
  affiliateLink: p.affiliateLink,
  category: p.category,
});

/** Glass action on the reel's right rail. */
const RailAction: React.FC<{ icon: string; label: string; onClick: () => void; filled?: boolean; tint?: string }> = ({ icon, label, onClick, filled, tint }) => (
  <button onClick={onClick} className="flex flex-col items-center gap-1.5 active:scale-90 transition-transform" aria-label={label}>
    <div className="h-12 w-12 rounded-full bg-black/35 backdrop-blur-md flex items-center justify-center border border-white/15">
      <span className="material-symbols-outlined text-[22px]" style={{ color: tint || '#ffffff', fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0" }} aria-hidden="true">{icon}</span>
    </div>
    <span className="text-white/90 text-[9px] font-semibold uppercase tracking-[0.14em]">{label}</span>
  </button>
);

/**
 * The Reel — a vertical runway of pieces with Tinder mechanics.
 * Scroll = browse · swipe right = to bag · swipe left = pass · double-tap = wishlist.
 * Every action is real (closet service → localStorage + Firestore mirror).
 */
const SwipeReel: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [deck, setDeck] = useState<Product[]>([]);
  const [likedTick, setLikedTick] = useState(0); // re-render hearts on closet change
  const [bagCount, setBagCount] = useState(() => closetCount('cart'));
  const [heartBurst, setHeartBurst] = useState<Record<string, boolean>>({});
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('zr_reel_hint'));

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastTapRef = useRef<Record<string, number>>({});
  const dragRef = useRef<{
    startX: number; startY: number; currentX: number;
    productId: string | null; isDragging: boolean; isHorizontal: boolean | null;
  }>({ startX: 0, startY: 0, currentX: 0, productId: null, isDragging: false, isHorizontal: null });

  // Build the deck: everything not previously passed
  useEffect(() => {
    const passed = new Set(listCloset('passed').map(i => i.id));
    setDeck((demoProducts as Product[]).filter(p => !passed.has(p.id)));
  }, []);

  useEffect(() => onClosetChange(() => {
    setBagCount(closetCount('cart'));
    setLikedTick(t => t + 1);
  }), []);

  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(() => {
      setShowHint(false);
      localStorage.setItem('zr_reel_hint', '1');
    }, 3200);
    return () => clearTimeout(t);
  }, [showHint]);

  const removeFromDeck = (id: string) => setDeck(prev => prev.filter(p => p.id !== id));

  const handleBag = (product: Product) => {
    const added = addToCloset('cart', toClosetItem(product));
    showToast(added ? `${product.brand} added to bag` : 'Already in your bag', added ? 'success' : 'info');
  };

  const handlePass = (product: Product) => {
    addPass('passed', toClosetItem(product));
  };

  // Reel hearts are LIKES (taste signal) — wishlist saving lives in the Marketplace.
  const handleLike = (product: Product) => {
    const liked = toggleCloset('liked', toClosetItem(product));
    showToast(liked ? 'Liked ♥' : 'Like removed', 'success');
    return liked;
  };

  // ── Gesture handling (pointer-based, vertical scroll stays native) ──
  const handleDragStart = (e: React.PointerEvent, productId: string) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, currentX: 0, productId, isDragging: false, isHorizontal: null };
  };

  const handleDragMove = (e: React.PointerEvent, productId: string, index: number) => {
    const d = dragRef.current;
    if (d.productId !== productId) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.isHorizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 10)) {
      d.isHorizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (d.isHorizontal !== true) return;

    d.isDragging = true;
    d.currentX = dx;
    e.preventDefault();

    const card = cardRefs.current[index];
    if (card) {
      const rotate = Math.min(Math.max(dx / 18, -9), 9);
      card.style.transition = 'none';
      card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;
    }
    const bagStamp = document.getElementById(`stamp-bag-${productId}`);
    const passStamp = document.getElementById(`stamp-pass-${productId}`);
    if (bagStamp) bagStamp.style.opacity = dx > 0 ? String(Math.min(1, dx / 90)) : '0';
    if (passStamp) passStamp.style.opacity = dx < 0 ? String(Math.min(1, -dx / 90)) : '0';
  };

  const handleDragEnd = (e: React.PointerEvent, product: Product, index: number) => {
    const d = dragRef.current;
    if (d.productId !== product.id) return;

    const card = cardRefs.current[index];
    const resetStamps = () => {
      const b = document.getElementById(`stamp-bag-${product.id}`);
      const p = document.getElementById(`stamp-pass-${product.id}`);
      if (b) b.style.opacity = '0';
      if (p) p.style.opacity = '0';
    };

    if (!d.isDragging) {
      // Tap — detect double-tap → wishlist
      const now = Date.now();
      if (now - (lastTapRef.current[product.id] || 0) < 300) {
        const saved = handleLike(product);
        if (saved) {
          setHeartBurst(prev => ({ ...prev, [product.id]: true }));
          setTimeout(() => setHeartBurst(prev => ({ ...prev, [product.id]: false })), 650);
        }
      }
      lastTapRef.current[product.id] = now;
      d.productId = null;
      return;
    }

    const dx = d.currentX;
    d.isDragging = false;
    d.productId = null;

    if (dx > 90) {
      // RIGHT → TO BAG, card exits right
      if (card) {
        card.style.transition = 'transform 0.28s ease';
        card.style.transform = 'translateX(115vw) rotate(16deg)';
      }
      handleBag(product);
      setTimeout(() => { removeFromDeck(product.id); resetStamps(); }, 260);
    } else if (dx < -90) {
      // LEFT → PASS, card exits left
      if (card) {
        card.style.transition = 'transform 0.28s ease';
        card.style.transform = 'translateX(-115vw) rotate(-16deg)';
      }
      handlePass(product);
      setTimeout(() => { removeFromDeck(product.id); resetStamps(); }, 260);
    } else {
      // Snap back
      if (card) {
        card.style.transition = 'transform 0.3s ease';
        card.style.transform = '';
        setTimeout(() => { if (card) card.style.transition = 'none'; }, 300);
      }
      resetStamps();
    }
  };

  const resetPasses = () => {
    listCloset('passed').forEach(i => removeFromCloset('passed', i.id));
    setDeck(demoProducts as Product[]);
    showToast('Deck refreshed — everything is back', 'success');
  };

  return (
    <div className="h-dvh w-full bg-black overflow-hidden relative">
      <style>{`
        @keyframes heartPop {
          0% { transform: scale(0); opacity: 1; }
          50% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(0); opacity: 0; }
        }
      `}</style>

      {/* First-run hint */}
      {showHint && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center pointer-events-none">
          <div className="bg-black/75 backdrop-blur-xl rounded-[1.75rem] px-8 py-7 border border-white/10 text-center mx-8">
            <p className="text-white/40 text-[9px] font-semibold uppercase tracking-[0.2em] mb-5">How the reel works</p>
            <div className="flex items-center justify-center gap-7 mb-5">
              <div className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[#f2705c] text-[22px]" aria-hidden="true">swipe_left</span>
                <span className="text-[#f2705c] text-[10px] font-semibold uppercase tracking-[0.1em]">Pass</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-white/40 text-[22px]" aria-hidden="true">swipe_vertical</span>
                <span className="text-white/40 text-[10px] uppercase tracking-[0.1em]">Scroll</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[#5fce8f] text-[22px]" aria-hidden="true">swipe_right</span>
                <span className="text-[#5fce8f] text-[10px] font-semibold uppercase tracking-[0.1em]">To bag</span>
              </div>
            </div>
            <p className="text-white/40 text-[11px]">Double-tap to like ♥</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-5 pt-5 pt-safe pb-10 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)' }}>
        <button
          aria-label="Go back"
          onClick={() => navigate(-1)}
          className="h-10 w-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 flex items-center justify-center pointer-events-auto active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-white text-[19px]" aria-hidden="true">arrow_back</span>
        </button>
        <div className="flex flex-col items-center">
          <span className="text-white text-[10px] font-semibold uppercase tracking-[0.22em]">The Reel</span>
          <span className="text-white/50 text-[10px] mt-0.5">{deck.length} pieces on the runway</span>
        </div>
        <button
          aria-label={`Bag, ${bagCount} items`}
          onClick={() => navigate('/cart')}
          className="relative h-10 w-10 rounded-full bg-black/40 backdrop-blur-md border border-white/15 flex items-center justify-center pointer-events-auto active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-white text-[19px]" aria-hidden="true">shopping_bag</span>
          {bagCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-[#5fce8f] text-black text-[9px] font-bold flex items-center justify-center">{bagCount}</span>
          )}
        </button>
      </div>

      {/* Empty deck */}
      {deck.length === 0 ? (
        <div className="h-full w-full flex flex-col items-center justify-center px-10 text-center">
          <div className="h-16 w-16 rounded-full border border-white/20 flex items-center justify-center mb-6">
            <span className="material-symbols-outlined text-white/40 text-[28px]" aria-hidden="true">styler</span>
          </div>
          <p className="text-white/40 text-[9px] font-semibold uppercase tracking-[0.2em] mb-3">Runway cleared</p>
          <h2 className="text-white font-display text-[26px] font-light mb-3">You've seen it <em className="font-medium">all.</em></h2>
          <p className="text-white/55 text-[13px] leading-relaxed mb-8">Bring back the pieces you passed on, or check what's in your bag.</p>
          <div className="flex flex-col gap-3 w-full max-w-[240px]">
            <button onClick={resetPasses} className="h-12 rounded-full bg-[#f1ede3] text-[#14120f] font-semibold text-[11px] uppercase tracking-[0.12em] active:scale-95 transition-transform">
              Refresh the deck
            </button>
            <button onClick={() => navigate('/cart')} className="h-12 rounded-full border border-white/20 text-white/80 font-semibold text-[11px] uppercase tracking-[0.12em] active:scale-95 transition-transform">
              View bag
            </button>
          </div>
        </div>
      ) : (
        /* REEL */
        <div className="h-full w-full overflow-y-scroll no-scrollbar snap-y snap-mandatory" style={{ WebkitOverflowScrolling: 'touch' }}>
          {deck.map((product, index) => (
            <div key={product.id} className="h-dvh w-full flex-shrink-0 relative bg-black snap-start snap-always overflow-hidden">
              {/* Swipeable card */}
              <div
                ref={el => { cardRefs.current[index] = el; }}
                className="absolute inset-0"
                onPointerDown={(e) => handleDragStart(e, product.id)}
                onPointerMove={(e) => handleDragMove(e, product.id, index)}
                onPointerUp={(e) => handleDragEnd(e, product, index)}
                onPointerCancel={(e) => handleDragEnd(e, product, index)}
                style={{ touchAction: 'pan-y' }}
              >
                <img
                  src={product.image}
                  alt={product.title}
                  className="h-full w-full object-cover opacity-0 transition-opacity duration-500"
                  onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
                  loading={index > 1 ? 'lazy' : 'eager'}
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 40%, transparent 62%, rgba(0,0,0,0.45) 100%)' }} />

                {/* Tinder stamps */}
                <div id={`stamp-bag-${product.id}`} className="absolute top-24 left-6 z-30 pointer-events-none" style={{ opacity: 0, transform: 'rotate(-12deg)' }}>
                  <div className="border-[3px] border-[#5fce8f] rounded-xl px-4 py-1.5">
                    <span className="text-[#5fce8f] font-display font-semibold text-[26px] tracking-wide">TO BAG</span>
                  </div>
                </div>
                <div id={`stamp-pass-${product.id}`} className="absolute top-24 right-6 z-30 pointer-events-none" style={{ opacity: 0, transform: 'rotate(12deg)' }}>
                  <div className="border-[3px] border-[#f2705c] rounded-xl px-4 py-1.5">
                    <span className="text-[#f2705c] font-display font-semibold text-[26px] tracking-wide">PASS</span>
                  </div>
                </div>

                {/* Heart burst */}
                {heartBurst[product.id] && (
                  <div className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none">
                    <span className="material-symbols-outlined text-[#e89b6b] text-[92px]" style={{ fontVariationSettings: "'FILL' 1", animation: 'heartPop 0.6s ease forwards' }}>favorite</span>
                  </div>
                )}

                {/* Caption */}
                <div className="absolute bottom-10 left-0 right-20 pl-5 pb-safe">
                  <p className="text-white/50 text-[9px] font-semibold uppercase tracking-[0.2em] mb-1.5">{product.category || 'The Edit'}</p>
                  <p className="text-white font-display text-[30px] font-medium leading-tight">{product.brand}</p>
                  <p className="text-white/75 text-[13px] mt-1 line-clamp-1">{product.title}</p>
                  <p className="text-white font-semibold text-[16px] mt-1.5">{product.price}</p>
                  <button
                    onClick={() => navigate('/recommendation', { state: { product, productUrl: product.affiliateLink || product.url, source: 'reel' } })}
                    className="mt-3.5 h-10 px-5 rounded-full border border-white/30 text-white text-[10px] font-semibold uppercase tracking-[0.14em] active:scale-95 transition-transform"
                  >
                    My size in this
                  </button>
                </div>
              </div>

              {/* Right rail (outside the swipe transform so it stays put) */}
              <div className="absolute right-4 bottom-36 z-40 flex flex-col items-center gap-4">
                <RailAction
                  icon="favorite"
                  label="Like"
                  filled={inCloset('liked', product.id)}
                  tint={inCloset('liked', product.id) ? '#e89b6b' : undefined}
                  onClick={() => handleLike(product)}
                />
                <RailAction icon="shopping_bag" label="Bag" tint="#5fce8f" onClick={() => { handleBag(product); }} />
                <RailAction icon="view_in_ar" label="Try-on" onClick={() => navigate('/tryon-studio', { state: { product } })} />
                <RailAction icon="featured_seasonal_and_gifts" label="Gift" tint="#d6ae5f" onClick={() => navigate('/gift-look', { state: { product } })} />
                <RailAction
                  icon="ios_share"
                  label="Share"
                  onClick={async () => {
                    try {
                      if (navigator.share) await navigator.share({ title: `${product.brand} — ${product.title}`, url: product.url });
                      else { await navigator.clipboard.writeText(product.url); showToast('Link copied to clipboard!', 'success'); }
                    } catch {}
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SwipeReel;
