import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, query, getDocs, onSnapshot, doc, setDoc, addDoc, updateDoc, deleteDoc, getDoc, where, orderBy, limit } from 'firebase/firestore';
import { useToast } from '../contexts/ToastContext';
import { fetchProductAvailability, fetchSizeChart } from '../services/BrandAPI';

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
  description?: string;
}

const Home: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [aiResults, setAiResults] = useState<Record<string, any>>({});
  const [communityLooks, setCommunityLooks] = useState<any[]>([]);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    currentX: number;
    productId: string | null;
    isDragging: boolean;
    isHorizontal: boolean | null;
  }>({ startX: 0, startY: 0, currentX: 0, productId: null, isDragging: false, isHorizontal: null });

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<Record<string, number>>({});

  const [heartBurst, setHeartBurst] = useState<Record<string, boolean>>({});
  const [cartCount, setCartCount] = useState(0);
  const [sizePeek, setSizePeek] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('zr_swipe_hint_seen'));
  const [friendShareProduct, setFriendShareProduct] = useState<Product | null>(null);
  const [friendsList, setFriendsList] = useState<{uid: string; name: string; avatar: string}[]>([]);

  const fallbackProducts: Product[] = [
    {
        id: '1',
        title: 'Structured Wool Coat',
        brand: 'The Row',
        price: '₹24,500',
        image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&auto=format&fit=crop',
        category: 'Women',
        type: 'clothing',
        url: 'https://www.therow.com/',
        affiliateLink: 'https://www.amazon.in/s?k=The+Row+Structured+Wool+Coat'
    },
    {
        id: '2',
        title: 'Oversized Hoodie',
        brand: 'Fear of God',
        price: '₹12,000',
        image: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop',
        category: 'Men',
        type: 'clothing',
        url: 'https://fearofgod.com/',
        affiliateLink: 'https://www.amazon.in/s?k=Fear+of+God+Oversized+Hoodie'
    },
    {
        id: '3',
        title: 'Silk Slip Dress',
        brand: 'Anine Bing',
        price: '₹3,500',
        image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800&auto=format&fit=crop',
        category: 'Women',
        type: 'clothing',
        url: 'https://www.aninebing.com/',
        affiliateLink: 'https://www.amazon.in/s?k=Anine+Bing+Silk+Slip+Dress'
    },
    {
        id: '4',
        title: 'Classic Leather Tote',
        brand: 'Cuyana',
        price: '₹18,000',
        image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=800&auto=format&fit=crop',
        category: 'Women',
        type: 'accessory',
        url: 'https://www.cuyana.com/',
        affiliateLink: 'https://www.amazon.in/s?k=Cuyana+Classic+Leather+Tote'
    },
     {
        id: '5',
        title: 'Tech Runner Sneakers',
        brand: 'Axel Arigato',
        price: '₹15,500',
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop',
        category: 'Men',
        type: 'shoes',
        url: 'https://axelarigato.com/',
        affiliateLink: 'https://www.amazon.in/s?k=Axel+Arigato+Tech+Runner+Sneakers'
    },
    {
        id: '6',
        title: 'Denim Jacket',
        brand: 'Levi\'s',
        price: '₹4,500',
        image: 'https://images.unsplash.com/photo-1543076447-215ad9ba6923?w=800&auto=format&fit=crop',
        category: 'Kids',
        type: 'clothing',
        url: 'https://www.levi.com/',
        affiliateLink: 'https://www.amazon.in/s?k=Levis+Denim+Jacket'
    }
  ];

  useEffect(() => {
    if (showHint) {
      const t = setTimeout(() => {
        setShowHint(false);
        localStorage.setItem('zr_swipe_hint_seen', '1');
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [showHint]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const q = query(collection(db, 'global_products'));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          const fetched = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Product[];
          setProducts(fetched);
        } else {
          setProducts(fallbackProducts);
        }
      } catch (error) {
        console.error("Error fetching products:", error);
        setProducts(fallbackProducts);
      }

      // Fetch community looks for interleaving
      try {
        const looksQ = query(
          collection(db, 'looks'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          limit(5)
        );
        const looksSnap = await getDocs(looksQ);
        setCommunityLooks(looksSnap.docs.map(d => ({ id: d.id, ...d.data(), _type: 'look' })));
      } catch {}
    };
    fetchProducts();

    const user = auth.currentUser;
    if (user) {
      // Wishlist Listener (using likes collection)
      const likesRef = collection(db, 'users', user.uid, 'likes');
      const unsubscribeLikes = onSnapshot(likesRef, (snapshot) => {
        const likes: Record<string, boolean> = {};
        snapshot.docs.forEach(doc => {
          likes[doc.id] = true;
        });
        setLikedMap(likes);
        setWishlistCount(snapshot.size);
      });

      const cartRef = collection(db, 'users', user.uid, 'cart');
      const unsubscribeCart = onSnapshot(cartRef, (snapshot) => {
        setCartCount(snapshot.size);
      });

      const friendsRef = collection(db, 'users', user.uid, 'friends');
      const unsubscribeFriends = onSnapshot(friendsRef, (snapshot) => {
        setFriendsList(snapshot.docs.map(d => ({ uid: d.id, ...d.data() } as any)));
      });

      return () => {
        unsubscribeLikes();
        unsubscribeCart();
        unsubscribeFriends();
      };
    }
  }, []);

  // Handle returning from Sizing Engine
  useEffect(() => {
    if (location.state?.aiResult && products[activeCardIndex]) {
      const currentProductId = products[activeCardIndex].id;
      setAiResults(prev => ({
        ...prev,
        [currentProductId]: location.state.aiResult
      }));
      // Clear state to prevent re-triggering
      window.history.replaceState({}, document.title);
    }
  }, [location.state, activeCardIndex, products]);

  // Intersection Observer for active card
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-index'));
            setActiveCardIndex(index);
          }
        });
      },
      { threshold: 0.7 }
    );

    cardRefs.current.forEach((card) => {
      if (card) observer.observe(card);
    });

    return () => observer.disconnect();
  }, [products]);

  const handleDragStart = (e: React.PointerEvent, productId: string) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      currentX: 0,
      productId,
      isDragging: false,
      isHorizontal: null,
    };
    longPressTimer.current = setTimeout(() => {
      setSizePeek(productId);
    }, 500);
  };

  const handleDragMove = (e: React.PointerEvent, productId: string, index: number) => {
    const d = dragRef.current;
    if (d.productId !== productId) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Determine swipe direction on first significant movement
    if (d.isHorizontal === null && (absDx > 8 || absDy > 10)) {
      d.isHorizontal = absDx > absDy;
    }

    // If vertical intent — cancel long press and let scroll happen
    if (d.isHorizontal === false) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      return;
    }

    // Horizontal swipe in progress
    if (d.isHorizontal === true && absDx > 8) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      d.isDragging = true;
      d.currentX = dx;
      e.preventDefault();

      const card = cardRefs.current[index];
      if (card) {
        const rotate = Math.min(Math.max(dx / 20, -8), 8);
        card.style.transition = 'none';
        card.style.transform = `translateX(${dx}px) rotate(${rotate}deg)`;
      }

      const cartBadge = document.getElementById(`cart-badge-${productId}`);
      const wishlistBadge = document.getElementById(`wishlist-badge-${productId}`);
      if (dx > 0) {
        if (cartBadge) cartBadge.style.opacity = String(Math.min(1, dx / 90));
        if (wishlistBadge) wishlistBadge.style.opacity = '0';
      } else {
        if (cartBadge) cartBadge.style.opacity = '0';
        if (wishlistBadge) wishlistBadge.style.opacity = String(Math.min(1, -dx / 90));
      }
    }
  };

  const handleDragEnd = (e: React.PointerEvent, productId: string, product: Product, index: number) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);

    const d = dragRef.current;
    if (d.productId !== productId) return;

    const card = cardRefs.current[index];
    const cartBadge = document.getElementById(`cart-badge-${productId}`);
    const wishlistBadge = document.getElementById(`wishlist-badge-${productId}`);

    const resetBadges = () => {
      if (cartBadge) cartBadge.style.opacity = '0';
      if (wishlistBadge) wishlistBadge.style.opacity = '0';
    };

    if (!d.isDragging) {
      // It's a tap — check double tap
      const now = Date.now();
      const last = lastTapRef.current[productId] || 0;
      if (now - last < 300) {
        // Double tap — like
        toggleLike(product);
        setHeartBurst(prev => ({ ...prev, [productId]: true }));
        setTimeout(() => setHeartBurst(prev => ({ ...prev, [productId]: false })), 620);
      }
      lastTapRef.current[productId] = now;
      d.productId = null;
      return;
    }

    const dx = d.currentX;
    d.isDragging = false;
    d.productId = null;

    if (dx > 90) {
      // RIGHT — ADD TO CART
      if (card) {
        card.style.transition = 'transform 0.24s ease';
        card.style.transform = `translateX(110vw) rotate(18deg)`;
        setTimeout(() => {
          if (card) { card.style.transition = 'none'; card.style.transform = ''; }
          resetBadges();
        }, 250);
      }
      const user = auth.currentUser;
      if (user) {
        addDoc(collection(db, 'users', user.uid, 'cart'), {
          productId: product.id,
          brand: product.brand,
          title: product.title,
          price: product.price,
          image: product.image,
          url: product.url,
          affiliateLink: product.affiliateLink || product.url,
          addedAt: new Date(),
        });
      }
      showToast(`${product.brand} added to cart 🛒`, 'success');

    } else if (dx < -90) {
      // LEFT — SEND TO FRIEND
      if (card) {
        card.style.transition = 'transform 0.2s ease';
        card.style.transform = `translateX(-40px) rotate(-4deg)`;
        setTimeout(() => {
          if (card) { card.style.transition = 'transform 0.3s ease'; card.style.transform = ''; }
          resetBadges();
        }, 180);
      }
      setFriendShareProduct(product);

    } else {
      // SNAP BACK — not enough drag
      if (card) {
        card.style.transition = 'transform 0.3s ease';
        card.style.transform = '';
        setTimeout(() => { if (card) card.style.transition = 'none'; }, 300);
      }
      resetBadges();
    }
  };

  const toggleLike = async (product: Product) => {
    const user = auth.currentUser;
    if (!user) return;

    const isLiked = likedMap[product.id];
    const likeDocRef = doc(db, 'users', user.uid, 'likes', product.id);

    try {
      if (isLiked) {
        await deleteDoc(likeDocRef);
      } else {
        await setDoc(likeDocRef, {
          productId: product.id,
          brand: product.brand,
          title: product.title,
          price: product.price,
          image: product.image,
          url: product.url,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error("Error toggling like:", error);
    }
  };

  const handleProductClick = async (product: Product) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const membersQ = query(collection(db, 'members'), where('uid', '==', user.uid), where('isPrimary', '==', true));
      const membersSnapshot = await getDocs(membersQ);
      const memberId = !membersSnapshot.empty ? membersSnapshot.docs[0].id : 'default';

      const [stockData, sizeChart] = await Promise.all([
        fetchProductAvailability(product.brand, product.title),
        fetchSizeChart(product.brand, product.category || 'Tops')
      ]);

      navigate('/recommendation', {
        state: {
          memberId,
          product: {
            ...product,
            stock: stockData,
            sizeChart: sizeChart
          },
          productUrl: product.affiliateLink || product.url,
          source: 'home_reel'
        }
      });
    } catch (error) {
      console.error("Error navigating to recommendation:", error);
    }
  };

  const handleShare = async (product: Product) => {
    const shareData = {
      title: `Check out this ${product.title} by ${product.brand} on ZipRIGHT!`,
      url: product.url
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(product.url);
        showToast("Link copied to clipboard!", "success");
      }
    } catch (error) {
      console.error("Error sharing:", error);
    }
  };

  const currentProduct = products[activeCardIndex];
  const currentAiResult = currentProduct ? aiResults[currentProduct.id] : null;

  return (
    <div className="h-dvh w-full bg-black overflow-hidden relative font-body">
      <style>{`
        @keyframes heartPop {
          0%   { transform: scale(0); opacity: 1; }
          50%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(0); opacity: 0; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {showHint && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center pointer-events-none">
          <div className="bg-black/70 backdrop-blur-xl rounded-[2rem] px-8 py-7 border border-white/10 text-center mx-8">
            <p className="text-white/40 text-[9px] font-bold uppercase tracking-[0.3em] mb-4">Swipe to interact</p>
            <div className="flex items-center justify-center gap-8 mb-4">
              <div className="flex flex-col items-center gap-2">
                <div className="bg-[#8B5CF6]/20 rounded-full px-3 py-1.5 border border-[#8B5CF6]/30">
                  <span className="material-symbols-outlined text-[#8B5CF6] text-sm">send</span>
                </div>
                <span className="text-[#8B5CF6] text-[10px] font-bold">Send to Friend</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="material-symbols-outlined text-white/20 text-2xl">swipe</span>
                <span className="text-white/30 text-[9px]">or double tap ♥</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="bg-[#22c55e]/20 rounded-full px-3 py-1.5 border border-[#22c55e]/30">
                  <span className="material-symbols-outlined text-[#22c55e] text-sm">arrow_forward</span>
                </div>
                <span className="text-[#22c55e] text-[10px] font-bold">Cart</span>
              </div>
            </div>
            <p className="text-white/30 text-[9px]">Hold to check your size</p>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 pt-[22px] pb-12 pointer-events-none bg-gradient-to-b from-black via-black/60 to-transparent">
        
        <span className="text-[#C9A06C] text-[23px] font-bold tracking-tight pointer-events-auto"
          style={{ fontFamily: 'system-ui', fontStyle: 'normal' }}>
          <span className="text-white">Zip</span>RIGHT
        </span>
        
        <div className="flex items-center gap-3 pointer-events-auto">
          <button onClick={() => navigate('/wishlist')} className="relative active:scale-90 p-2 rounded-full">
            <span className="material-symbols-outlined text-[#C9A06C] text-[22px]">favorite</span>
            {wishlistCount > 0 && (
              <span className="absolute top-1 right-1 h-4 w-4 bg-[#FF4D6D] rounded-full text-[8px] font-bold flex items-center justify-center text-white ring-2 ring-black/20">
                {wishlistCount}
              </span>
            )}
          </button>
          <button onClick={() => navigate('/cart')} className="relative active:scale-90 p-2 rounded-full">
            <span className="material-symbols-outlined text-[#C9A06C] text-[22px]">shopping_cart</span>
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 h-4 w-4 bg-[#22c55e] rounded-full text-[8px] font-bold flex items-center justify-center text-white ring-2 ring-black/20">
                {cartCount}
              </span>
            )}
          </button>
          <button onClick={() => navigate('/stylist')} className="active:scale-90 p-2 rounded-full">
            <span className="material-symbols-outlined text-[#C9A06C] text-[22px]">chat_bubble</span>
          </button>
          <button onClick={() => navigate('/gift-inbox')} className="relative active:scale-90 p-2 rounded-full">
            <span className="material-symbols-outlined text-[#C9A06C] text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>card_giftcard</span>
          </button>
        </div>
      </div>

      {/* REEL FEED */}
      <div 
        ref={containerRef}
        className="h-full w-full overflow-y-scroll no-scrollbar snap-y snap-mandatory"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {products.map((product, index) => (
          <div 
            key={product.id}
            data-index={index}
            ref={(el) => (cardRefs.current[index] = el)}
            className="h-dvh w-full flex-shrink-0 relative bg-black snap-start snap-always"
            onPointerDown={(e) => handleDragStart(e, product.id)}
            onPointerMove={(e) => handleDragMove(e, product.id, index)}
            onPointerUp={(e) => handleDragEnd(e, product.id, product, index)}
            onPointerCancel={(e) => handleDragEnd(e, product.id, product, index)}
            style={{ touchAction: 'pan-y' }}
          >
            {/* Swipe RIGHT badge - CART */}
            <div id={`cart-badge-${product.id}`}
              className="absolute top-28 left-5 z-50 pointer-events-none"
              style={{ opacity: 0, transform: 'rotate(-12deg)' }}
            >
              <div className="bg-[#22c55e] px-5 py-2.5 rounded-2xl border-2 border-white/30 flex items-center gap-2 shadow-2xl">
                <span className="material-symbols-outlined text-white text-xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}>shopping_cart</span>
                <span className="text-white font-black text-sm tracking-widest uppercase">Add to Cart</span>
              </div>
            </div>

            {/* Swipe LEFT badge - WISHLIST */}
            <div id={`wishlist-badge-${product.id}`}
              className="absolute top-28 right-5 z-50 pointer-events-none"
              style={{ opacity: 0, transform: 'rotate(12deg)' }}
            >
              <div className="bg-[#8B5CF6] px-5 py-2.5 rounded-2xl border-2 border-white/30 flex items-center gap-2 shadow-2xl">
                <span className="text-white font-black text-sm tracking-widest uppercase">Send</span>
                <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
              </div>
            </div>

            {/* Heart Burst Animation */}
            {heartBurst[product.id] && (
              <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                <span
                  className="material-symbols-outlined text-[#FF4D6D] text-[90px]"
                  style={{ fontVariationSettings: "'FILL' 1", animation: 'heartPop 0.6s ease forwards' }}
                >
                  favorite
                </span>
              </div>
            )}

            {/* Size Peek Overlay */}
            {sizePeek === product.id && (
              <div
                className="absolute bottom-24 left-4 right-4 z-50 bg-black/80 backdrop-blur-2xl rounded-[1.5rem] p-5 border border-white/10"
                style={{ animation: 'slideUp 0.2s ease' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#B5853F] text-lg">straighten</span>
                    <span className="text-white font-bold text-sm">Quick Fit Check</span>
                  </div>
                  <button onClick={() => setSizePeek(null)} className="active:scale-90">
                    <span className="material-symbols-outlined text-white/50 text-lg">close</span>
                  </button>
                </div>
                <p className="text-white/60 text-xs mb-4 leading-relaxed">
                  Complete your Fit Profile to get an instant size recommendation for {product.brand}.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setSizePeek(null); navigate('/add-product', { state: { prefill: product } }); }}
                    className="flex-1 bg-[#B5853F] text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest active:scale-95"
                  >
                    Get My Size
                  </button>
                  <button
                    onClick={() => setSizePeek(null)}
                    className="px-4 py-3 rounded-xl border border-white/10 text-white/60 text-xs active:scale-95"
                  >
                    Later
                  </button>
                </div>
              </div>
            )}

            {/* Product Image */}
            <img 
              src={product.image} 
              alt={product.title}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
            {/* Subtle Obsidian Overlay for Contrast */}
            <div className="absolute inset-0 bg-[#111111]/10 pointer-events-none" />

            {/* Gradient Overlay */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.4) 100%)' }}>
            </div>

            {/* RIGHT SIDE ACTION BAR */}
            <div className="absolute right-4 bottom-36 z-40 flex flex-col items-center gap-4">
              {/* Like */}
              <button 
                onClick={() => toggleLike(product)}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <span 
                    className={`material-symbols-outlined text-[26px] ${likedMap[product.id] ? 'text-[#FF4D6D] filled' : 'text-white'}`}
                    style={{ fontVariationSettings: likedMap[product.id] ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    favorite
                  </span>
                </div>
                <span className="text-white text-[10px] font-bold">Like</span>
              </button>

              {/* Try-On */}
              <button 
                onClick={() => navigate('/fashion-studio')}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <span className="material-symbols-outlined text-white text-[26px]">view_in_ar</span>
                </div>
                <span className="text-white text-[10px] font-bold">Try-On</span>
              </button>

              {/* Gift */}
              <button
                onClick={() => navigate('/gift-look', { state: { product } })}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <span className="material-symbols-outlined text-[26px]"
                    style={{ color: '#8B5CF6', fontVariationSettings: "'FILL' 1" }}>
                    card_giftcard
                  </span>
                </div>
                <span className="text-white text-[10px] font-bold">Gift</span>
              </button>

              {/* Share */}
              <button 
                onClick={() => handleShare(product)}
                className="flex flex-col items-center gap-1 active:scale-90"
              >
                <div className="h-12 w-12 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10">
                  <span className="material-symbols-outlined text-white text-[26px]">ios_share</span>
                </div>
                <span className="text-white text-[10px] font-bold">Share</span>
              </button>
            </div>

            {/* BOTTOM OVERLAY DRAWER (Collapsed) */}
            <div className="absolute bottom-20 left-0 right-20 z-40 pl-4">
              <div className="bg-black/60 backdrop-blur-xl rounded-[1.5rem] px-5 py-4 border border-white/10 shadow-2xl">
                {/* Item Info Row */}
                <div className="flex items-end justify-between">
                  <div className="flex-1 mr-4">
                    <p className="text-white font-bold text-base tracking-tight">{product.brand}</p>
                    <p className="text-white/80 text-xs mt-0.5 line-clamp-1 font-medium">{product.title}</p>
                  </div>
                  <button 
                    onClick={() => setDrawerOpen(true)} 
                    className="text-white/90 text-xs font-bold underline underline-offset-4 active:scale-95 shrink-0"
                  >
                    see more...
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* EXPANDED DRAWER (Bottom Sheet) */}
      {currentProduct && (
        <>
          {/* Backdrop */}
          <div 
            className={`fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setDrawerOpen(false)}
          ></div>

          {/* Sheet */}
          <div 
            className={`fixed inset-x-0 bottom-0 z-[60] bg-[#111111] rounded-t-[2.5rem] max-h-[85vh] overflow-y-auto no-scrollbar transition-transform duration-300 ease-out border-t border-white/10 ${drawerOpen ? 'translate-y-0' : 'translate-y-full'}`}
          >
            {/* Drag Handle */}
            <div className="flex justify-center pt-4 pb-2">
              <div className="w-12 h-1.5 bg-white/20 rounded-full"></div>
            </div>

            <div className="px-6 pb-12 pt-4">
              {/* Product Header */}
              <div className="flex gap-4 mb-8">
                <div className="h-24 w-24 rounded-2xl overflow-hidden border border-white/10 shrink-0">
                  <img src={currentProduct.image} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="flex flex-col justify-center">
                  <h3 className="text-white font-bold text-xl tracking-tight">{currentProduct.brand}</h3>
                  <p className="text-white/60 text-sm mt-1">{currentProduct.title}</p>
                  <p className="text-[#B5853F] font-black text-lg mt-2">{currentProduct.price}</p>
                </div>
              </div>

              {/* AI Recommendation Section */}
              {currentAiResult ? (
                <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-[#B5853F]/20 flex items-center justify-center text-[#B5853F]">
                      <span className="material-symbols-outlined">auto_awesome</span>
                    </div>
                    <div>
                      <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest">AI Recommendation</p>
                      <p className="text-white font-bold text-lg">Size {currentAiResult.recommendedSize}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Why this size?</p>
                      <p className="text-white/80 text-sm leading-relaxed">{currentAiResult.reasoning}</p>
                    </div>
                    <div>
                      <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Fit Notes</p>
                      <p className="text-white/80 text-sm leading-relaxed">{currentAiResult.fitNotes}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 rounded-[2rem] p-8 border border-white/10 mb-8 text-center">
                  <span className="material-symbols-outlined text-[#B5853F] text-4xl mb-3">straighten</span>
                  <p className="text-white font-bold mb-2">Get Your Perfect Fit</p>
                  <p className="text-white/60 text-xs mb-6 px-4">Our AI Fit Engine analyzes your body profile to recommend the best size for this brand.</p>
                  <button 
                    onClick={() => {
                      setDrawerOpen(false);
                      navigate('/add-product', { state: { prefill: currentProduct } });
                    }}
                    className="bg-[#B5853F] text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest active:scale-95"
                  >
                    Run Fit Engine
                  </button>
                </div>
              )}

              {/* Shop Now CTA */}
              <button 
                onClick={() => window.open(currentProduct.url, '_blank')}
                className="w-full bg-white text-[#111111] py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl active:scale-95"
              >
                Shop Now
              </button>
            </div>
          </div>
        </>
      )}

      {/* FRIEND SHARE SHEET */}
      {friendShareProduct && (
        <>
          <div
            className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm"
            onClick={() => setFriendShareProduct(null)}
          />
          <div className="fixed inset-x-0 bottom-0 z-[60] bg-[#111111] rounded-t-[2.5rem] border-t border-white/10">
            <div className="flex justify-center pt-4 pb-2">
              <div className="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>
            <div className="px-6 pb-10 pt-2">
              {/* Product preview row */}
              <div className="flex items-center gap-3 mb-6 bg-white/5 rounded-2xl p-3 border border-white/5">
                <img src={friendShareProduct.image} alt="" className="h-12 w-12 rounded-xl object-cover" />
                <div>
                  <p className="text-white font-bold text-sm">{friendShareProduct.brand}</p>
                  <p className="text-white/50 text-xs">{friendShareProduct.title} · {friendShareProduct.price}</p>
                </div>
                <span className="material-symbols-outlined text-[#8B5CF6] ml-auto" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
              </div>

              <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.25em] mb-4">Send to your Style Circle</p>

              {/* Friends list */}
              {friendsList.length === 0 ? (
                <div className="text-center py-8">
                  <span className="material-symbols-outlined text-white/20 text-5xl mb-3 block">group_add</span>
                  <p className="text-white/60 text-sm font-bold mb-1">No friends yet</p>
                  <p className="text-white/30 text-xs mb-5">Add friends to share fits with them</p>
                  <button
                    onClick={() => { setFriendShareProduct(null); navigate('/friends'); }}
                    className="bg-[#B5853F] text-white px-6 py-3 rounded-full text-xs font-black uppercase tracking-widest active:scale-95"
                  >
                    Find Friends
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 max-h-[40vh] overflow-y-auto no-scrollbar">
                  {friendsList.map((friend) => (
                    <button
                      key={friend.uid}
                      onClick={async () => {
                        const user = auth.currentUser;
                        if (!user) return;
                        try {
                          await addDoc(collection(db, 'users', friend.uid, 'friend_inbox'), {
                            fromUid: user.uid,
                            fromName: user.displayName || 'A friend',
                            productId: friendShareProduct.id,
                            brand: friendShareProduct.brand,
                            title: friendShareProduct.title,
                            price: friendShareProduct.price,
                            image: friendShareProduct.image,
                            url: friendShareProduct.url,
                            sentAt: new Date(),
                            seen: false,
                          });
                          showToast(`Sent to ${friend.name} ✦`, 'success');
                          setFriendShareProduct(null);
                        } catch (e) {
                          showToast('Could not send. Try again.', 'error');
                        }
                      }}
                      className="flex items-center gap-4 p-3 bg-white/5 rounded-2xl border border-white/5 active:scale-95"
                    >
                      <div className="h-11 w-11 rounded-full bg-[#B5853F]/20 flex items-center justify-center shrink-0">
                        <span className="text-[#B5853F] font-black text-base">{friend.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <span className="text-white font-bold text-sm">{friend.name}</span>
                      <span className="material-symbols-outlined text-white/30 ml-auto">chevron_right</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Home;
