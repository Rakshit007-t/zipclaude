import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { addDoc, collection } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useToast } from '../contexts/ToastContext';
import { useUserProfile } from '../contexts/UserProfileContext';
import { fetchProductAvailability } from '../services/BrandAPI';
import { recommendSize } from '../services/ziprightApi';
import { buildSizeEngineProfileFromUserProfile } from '../utils/sizeProfile';
import { demoProducts } from '../services/demoProducts';
import { SEED_LOOKS } from '../services/salonSeed';
import { addToCloset, closetCount, listCloset, onClosetChange, toggleCloset } from '../services/closet';
import { Sheet, Button, EmptyState, Eyebrow, SectionHeader, Wordmark, springs, StaggerList, StaggerItem } from '../components/ui';


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
  fit_hint?: string | null;
  size_chart?: Record<string, number> | null;
  sizeChart?: Record<string, number> | null;
  available_sizes?: string[] | null;
  availableSizes?: string[] | null;
  size_format?: string | null;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Quiet icon action in the masthead. */
const MastAction: React.FC<{ icon: string; label: string; badge?: number; badgeTone?: string; onClick: () => void }> = ({ icon, label, badge, badgeTone, onClick }) => (
  <button onClick={onClick} aria-label={`${label}${badge ? `, ${badge}` : ''}`} className="relative h-10 w-10 rounded-full border border-line flex items-center justify-center text-ink-soft press-icon bg-surface-1">
    <span className="material-symbols-outlined text-[19px]" aria-hidden="true">{icon}</span>
    {badge ? (
      <span className={`absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${badgeTone || 'bg-brand'}`}>
        {badge}
      </span>
    ) : null}
  </button>
);

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { userProfile, profile } = useUserProfile() as any;
  const [products, setProducts] = useState<Product[]>([]);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [recommendedSize, setRecommendedSize] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [engineRunning, setEngineRunning] = useState(false);
  const [recommendedForProductId, setRecommendedForProductId] = useState<string | null>(null);
  const [friendShareProduct, setFriendShareProduct] = useState<Product | null>(null);
  const [friendsList, setFriendsList] = useState<{ uid: string; name: string; avatar: string }[]>([]);

  useEffect(() => {
    setProducts(demoProducts);
    setFriendsList([
      { uid: 'demo-rhea', name: 'Rhea', avatar: '' },
      { uid: 'demo-aman', name: 'Aman', avatar: '' },
      { uid: 'demo-sara', name: 'Sara', avatar: '' },
    ]);
  }, []);

  // Live closet state — hearts and badges reflect real saved data
  useEffect(() => {
    const sync = () => {
      setWishlistCount(closetCount('likes'));
      setCartCount(closetCount('cart'));
      const map: Record<string, boolean> = {};
      listCloset('likes').forEach(i => { map[i.id] = true; });
      setLikedMap(map);
    };
    sync();
    return onClosetChange(sync);
  }, []);

  const toClosetItem = (p: Product) => ({
    id: p.id, title: p.title, brand: p.brand, price: p.price,
    image: p.image, url: p.url, affiliateLink: p.affiliateLink, category: p.category,
  });

  const firstName = (profile?.profileName || userProfile?.profileName || '').split(' ')[0];

  const toggleLike = (product: Product) => {
    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }
    const saved = toggleCloset('likes', toClosetItem(product));
    showToast(saved ? `${product.brand} saved to wishlist ♥` : 'Removed from wishlist', 'success');
  };

  const addProductToCart = async (product: Product) => {
    const added = addToCloset('cart', toClosetItem(product));
    showToast(added ? `${product.brand} added to bag` : 'Already in your bag', added ? 'success' : 'info');
  };

  const normalizeProductForSizeEngine = (product: Product) => {
    const rawCategory = String(product.category || product.type || '').toLowerCase();
    const rawTitle = String(product.title || '').toLowerCase();
    let normalizedCategory = rawCategory;
    if (rawCategory.includes('t-shirt') || rawCategory.includes('tshirt') || rawTitle.includes('t-shirt') || rawTitle.includes('tshirt')) {
      normalizedCategory = 'tshirt';
    } else if (rawCategory.includes('jacket') || rawTitle.includes('jacket')) {
      normalizedCategory = 'jacket';
    }
    return {
      id: product.id,
      title: product.title,
      brand: product.brand,
      price: product.price,
      image: product.image,
      category: normalizedCategory || 'clothing',
      url: product.affiliateLink || product.url,
      source: 'link' as const,
      confidence: 0.7,
      fit_hint: product.fit_hint,
      size_chart: product.size_chart ?? product.sizeChart,
      available_sizes: product.available_sizes ?? product.availableSizes,
      size_format: product.size_format,
    };
  };

  const handleProductClick = async (product: Product) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const stockData = await fetchProductAvailability(product.brand, product.title);
      const sizeProfile = buildSizeEngineProfileFromUserProfile(userProfile);
      const sizeResult = sizeProfile
        ? await recommendSize({
          product: normalizeProductForSizeEngine(product),
          profile: sizeProfile,
        })
        : null;

      navigate('/recommendation', {
        state: {
          product: {
            ...product,
            stock: stockData,
            recommendedSize: sizeResult?.size,
            sizeConfidence: sizeResult ? `${Math.round(sizeResult.confidence)}%` : undefined,
          },
          productUrl: product.affiliateLink || product.url,
          source: 'home_edit'
        }
      });
    } catch (error) {
      console.error("Error navigating to recommendation:", error);
      showToast("Something went wrong", "error");
      window.open(product.affiliateLink || product.url, '_blank');
    }
  };

  const handleRunFitEngine = async (product: Product) => {
    if (engineRunning) return;
    setEngineRunning(true);
    try {
      const sizeProfile = buildSizeEngineProfileFromUserProfile(userProfile);
      if (!sizeProfile) {
        showToast("Complete Smart Fit Scan to get your size.", "error");
        return;
      }
      const result = await recommendSize({
        product: normalizeProductForSizeEngine(product),
        profile: sizeProfile,
      });
      setRecommendedSize(result.size);
      setConfidence(`${Math.round(result.confidence)}%`);
      setReason(result.reason || null);
      setRecommendedForProductId(product.id);
    } catch (error) {
      console.error("Error running fit engine:", error);
      showToast("Could not run fit engine right now.", "error");
    } finally {
      setEngineRunning(false);
    }
  };

  const openDetails = (product: Product) => {
    setRecommendedSize(null);
    setConfidence(null);
    setReason(null);
    setRecommendedForProductId(null);
    setDetailProduct(product);
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

  const hero = products[0];
  const editGrid = products.slice(1);
  const detailResult = detailProduct && recommendedForProductId === detailProduct.id && recommendedSize
    ? { recommendedSize, confidence, reason }
    : null;

  const quickActions = [
    { icon: 'straighten', title: 'Find My Size', desc: 'Your size in any brand', route: '/add-product' },
    { icon: 'view_in_ar', title: 'Virtual Try-On', desc: 'See it on you first', route: '/fashion-studio' },
    { icon: 'auto_awesome', title: 'AI Stylist', desc: 'Chat for outfit advice', route: '/stylist' },
  ];

  return (
    <div className="min-h-screen min-h-dvh bg-surface-0 text-ink pb-36">
      {/* Masthead */}
      <div className="sticky top-0 z-40 bg-surface-0/90 backdrop-blur-xl border-b border-line">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 pt-safe">
          <Wordmark size="sm" />
          <div className="flex gap-2">
            <MastAction icon="favorite" label="Wishlist" badge={wishlistCount} onClick={() => navigate('/wishlist')} />
            <MastAction icon="shopping_bag" label="Cart" badge={cartCount} badgeTone="bg-success" onClick={() => navigate('/cart')} />
            <MastAction icon="featured_seasonal_and_gifts" label="Gift inbox" onClick={() => navigate('/gift-inbox')} />
          </div>
        </div>
      </div>

      {/* Greeting */}
      <div className="px-6 pt-7 pb-2">
        <Eyebrow className="mb-2">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Eyebrow>
        <h1 className="display-1">
          {greeting()}{firstName ? `, ${firstName}` : ''}<em className="font-medium text-brand">.</em>
        </h1>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon="inventory_2"
          title="The rail is empty"
          description="The catalogue is unavailable right now. Check back shortly."
        />
      ) : (
        <>
          {/* Look of the day — editorial hero */}
          {hero && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.luxe}
              className="px-6 pt-5"
            >
              <div className="relative rounded-card overflow-hidden border border-line shadow-lift group">
                <button className="block w-full text-left" onClick={() => openDetails(hero)} aria-label={`${hero.brand} ${hero.title} — details`}>
                  <div className="aspect-[4/5] bg-surface-2">
                    <img
                      src={hero.image}
                      alt={hero.title}
                      className="h-full w-full object-cover opacity-0 transition-opacity duration-700"
                      onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="absolute inset-0 pointer-events-none scrim-cover-b" />
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/60 mb-2">Look of the day</p>
                    <p className="font-display text-[26px] font-medium text-white leading-tight">{hero.brand}</p>
                    <p className="text-white/75 text-[13px] mt-1 line-clamp-1">{hero.title}</p>
                    <p className="text-white font-semibold text-[15px] mt-2">{hero.price}</p>
                  </div>
                </button>
                {/* Hero actions */}
                <div className="absolute top-4 right-4 flex flex-col gap-2.5">
                  <button onClick={() => toggleLike(hero)} aria-label="Like" className="h-10 w-10 rounded-full bg-black/35 backdrop-blur-md border border-white/15 flex items-center justify-center press-icon">
                    <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: likedMap[hero.id] ? "'FILL' 1" : "'FILL' 0" }} aria-hidden="true">favorite</span>
                  </button>
                  <button onClick={() => addProductToCart(hero)} aria-label="Add to cart" className="h-10 w-10 rounded-full bg-black/35 backdrop-blur-md border border-white/15 flex items-center justify-center press-icon">
                    <span className="material-symbols-outlined text-white text-[18px]" aria-hidden="true">add_shopping_cart</span>
                  </button>
                  <button onClick={() => navigate('/tryon-studio', { state: { product: hero } })} aria-label="Try on" className="h-10 w-10 rounded-full bg-black/35 backdrop-blur-md border border-white/15 flex items-center justify-center press-icon">
                    <span className="material-symbols-outlined text-white text-[18px]" aria-hidden="true">view_in_ar</span>
                  </button>
                  <button onClick={() => handleShare(hero)} aria-label="Share" className="h-10 w-10 rounded-full bg-black/35 backdrop-blur-md border border-white/15 flex items-center justify-center press-icon">
                    <span className="material-symbols-outlined text-white text-[18px]" aria-hidden="true">ios_share</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* The Reel — swipe entry */}
          <div className="px-6 pt-4">
            <button
              onClick={() => navigate('/reel')}
              className="w-full flex items-center justify-between p-5 rounded-card bg-brand text-on-brand shadow-glow press-soft text-left"
            >
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-70 mb-1.5">The Reel</p>
                <p className="font-display text-[20px] font-medium leading-tight">Swipe your next outfit.</p>
                <p className="text-[11.5px] opacity-80 mt-1">Right to bag · left to pass · double-tap to like</p>
              </div>
              <span className="material-symbols-outlined text-[30px] shrink-0 ml-4" aria-hidden="true">swipe</span>
            </button>
          </div>

          {/* Quick actions — the three doors */}
          <div className="px-6 pt-6">
            <StaggerList className="grid grid-cols-3 gap-3" delay={0.06}>
              {quickActions.map((action) => (
                <StaggerItem key={action.title}>
                  <button
                    onClick={() => navigate(action.route)}
                    className="w-full flex flex-col items-start p-4 rounded-card bg-surface-1 border border-line hover:border-line-strong active:scale-[0.98] transition-[transform,border-color] text-left"
                  >
                    <span className="material-symbols-outlined text-brand text-[22px] mb-3" aria-hidden="true">{action.icon}</span>
                    <span className="text-ink font-semibold text-[13px]">{action.title}</span>
                    <span className="text-ink-faint text-[10.5px] leading-tight mt-0.5">{action.desc}</span>
                  </button>
                </StaggerItem>
              ))}
            </StaggerList>
          </div>

          {/* The Salon — the fashion feed, one scroll from the top */}
          <div className="pt-9">
            <SectionHeader
              eyebrow="The Salon"
              title="Worn by the community"
              action={{ label: 'Open', onClick: () => navigate('/community') }}
              className="mb-4 px-6"
            />
            <div className="flex gap-3 overflow-x-auto no-scrollbar px-6 snap-x">
              {SEED_LOOKS.slice(0, 6).map(look => (
                <button
                  key={look.id}
                  onClick={() => navigate('/community')}
                  className="relative w-32 aspect-[3/4] rounded-xl overflow-hidden shrink-0 snap-start bg-surface-2 border border-line press-soft text-left"
                  aria-label={`Open The Salon — ${look.caption.slice(0, 40)}`}
                >
                  <img src={look.mediaUrl} alt="" loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  <div className="absolute inset-x-0 bottom-0 p-2.5 pt-6 scrim-b">
                    <p className="text-white/90 text-[10px] leading-snug line-clamp-2">{look.caption.replace(/#\w+/g, '').trim()}</p>
                  </div>
                  {look.taggedProducts.length > 0 && (
                    <span className="absolute top-2 right-2 h-5 px-1.5 rounded-full bg-black/50 backdrop-blur-md flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-white text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">sell</span>
                      <span className="text-white text-[9px] font-semibold">{look.taggedProducts.length}</span>
                    </span>
                  )}
                </button>
              ))}
              {/* End card → the feed itself */}
              <button
                onClick={() => navigate('/community')}
                className="w-32 aspect-[3/4] rounded-xl shrink-0 snap-start bg-ink text-ink-invert flex flex-col items-center justify-center gap-2 press-soft"
              >
                <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_forward</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">The Salon</span>
              </button>
            </div>
          </div>

          {/* The Edit — curated grid */}
          <div className="px-6 pt-9">
            <SectionHeader
              eyebrow="Curated for you"
              title="The Edit"
              action={{ label: 'View all', onClick: () => navigate('/marketplace') }}
              className="mb-4"
            />
            <StaggerList className="grid grid-cols-2 gap-x-4 gap-y-7" delay={0.05}>
              {editGrid.map((product) => (
                <StaggerItem key={product.id}>
                  <div className="flex flex-col">
                    <button
                      onClick={() => openDetails(product)}
                      className="relative aspect-[3/4] rounded-xl overflow-hidden bg-surface-2 border border-line press-soft text-left"
                      aria-label={`${product.brand} ${product.title} — details`}
                    >
                      <img
                        src={product.image}
                        alt={product.title}
                        loading="lazy"
                        className="w-full h-full object-cover opacity-0 transition-opacity duration-500"
                        onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
                        referrerPolicy="no-referrer"
                      />
                    </button>
                    <div className="flex items-start justify-between gap-2 pt-3 px-0.5">
                      <div className="min-w-0">
                        <p className="font-display text-[15px] font-medium text-ink leading-tight truncate">{product.brand}</p>
                        <p className="text-ink-faint text-[11px] truncate mt-0.5">{product.title}</p>
                        <p className="text-[13px] font-semibold text-ink mt-1">{product.price}</p>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0 pt-0.5">
                        <button onClick={() => toggleLike(product)} aria-label={`Like ${product.title}`} className="h-8 w-8 rounded-full border border-line flex items-center justify-center text-ink-soft press-icon">
                          <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: likedMap[product.id] ? "'FILL' 1" : "'FILL' 0" }} aria-hidden="true">favorite</span>
                        </button>
                        <button onClick={() => addProductToCart(product)} aria-label={`Add ${product.title} to cart`} className="h-8 w-8 rounded-full border border-line flex items-center justify-center text-ink-soft press-icon">
                          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">add_shopping_cart</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerList>
          </div>

          {/* Community strip */}
          <div className="px-6 pt-9">
            <button
              onClick={() => navigate('/community')}
              className="w-full p-6 rounded-card bg-ink text-ink-invert relative overflow-hidden text-left press-soft"
            >
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-[50px] -mr-10 -mt-10" style={{ background: 'var(--brand)', opacity: 0.3 }} aria-hidden="true"></div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-50 mb-2">The Salon</p>
              <p className="font-display text-[20px] font-medium leading-snug">See what everyone is wearing.</p>
              <span className="inline-flex items-center gap-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-80">
                Open community
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">arrow_forward</span>
              </span>
            </button>
          </div>
        </>
      )}

      {/* DETAILS SHEET — identity, fit engine, actions */}
      <Sheet open={!!detailProduct} onClose={() => setDetailProduct(null)} title={detailProduct?.brand || 'Details'}>
        {detailProduct && (
          <>
            <div className="flex gap-5 mb-6">
              <div className="h-32 w-[104px] rounded-xl overflow-hidden border border-line shrink-0">
                <img src={detailProduct.image} alt={detailProduct.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <p className="eyebrow !text-[9px] mb-1">{detailProduct.category || 'Garment'}</p>
                <p className="text-ink text-[14px] leading-snug line-clamp-2">{detailProduct.title}</p>
                <p className="font-display text-[20px] font-medium text-ink mt-2">{detailProduct.price}</p>
              </div>
            </div>

            {/* Fit engine */}
            <div className="rounded-card border border-line p-5 mb-5 text-center">
              <Eyebrow className="mb-3">The fit engine</Eyebrow>
              {detailResult ? (
                <div className="mb-4">
                  <div className="flex items-baseline justify-center gap-3">
                    <span className="font-display text-[42px] font-semibold text-ink leading-none">{detailResult.recommendedSize}</span>
                    <span className="text-[11px] uppercase tracking-[0.1em] text-ink-faint">Confidence {detailResult.confidence}</span>
                  </div>
                  {detailResult.reason && <p className="text-[12.5px] text-ink-soft mt-3 leading-relaxed">{detailResult.reason}</p>}
                </div>
              ) : (
                <p className="text-[13px] text-ink-soft mb-4">Reveal your perfect size for this piece.</p>
              )}
              <Button variant="accent" loading={engineRunning} onClick={() => handleRunFitEngine(detailProduct)}>
                {detailResult ? 'Run again' : 'Run fit engine'}
              </Button>
            </div>

            {/* Secondary actions */}
            <div className="grid grid-cols-3 gap-2.5 mb-5">
              <Button variant="outline" size="sm" icon="view_in_ar" onClick={() => { const p = detailProduct; setDetailProduct(null); navigate('/tryon-studio', { state: { product: p } }); }}>Try-on</Button>
              <Button variant="outline" size="sm" icon="featured_seasonal_and_gifts" onClick={() => { const p = detailProduct; setDetailProduct(null); navigate('/gift-look', { state: { product: p } }); }}>Gift</Button>
              <Button variant="outline" size="sm" icon="send" onClick={() => { setFriendShareProduct(detailProduct); }}>Send</Button>
            </div>

            <div className="flex flex-col gap-2.5 pb-2">
              <Button size="lg" fullWidth icon="add_shopping_cart" onClick={() => { addProductToCart(detailProduct); setDetailProduct(null); }}>
                Add to cart
              </Button>
              <Button variant="secondary" size="lg" fullWidth trailingIcon="arrow_forward" onClick={() => { const p = detailProduct; setDetailProduct(null); void handleProductClick(p); }}>
                Full recommendation
              </Button>
              <Button variant="ghost" fullWidth onClick={() => window.open(detailProduct.url, '_blank')}>
                Shop now
              </Button>
            </div>
          </>
        )}
      </Sheet>

      {/* FRIEND SHARE SHEET */}
      <Sheet
        open={!!friendShareProduct}
        onClose={() => setFriendShareProduct(null)}
        title="Send to a friend"
      >
        {friendShareProduct && (
          <>
            <div className="flex items-center gap-3 mb-6 bg-surface-2 rounded-2xl p-3">
              <img src={friendShareProduct.image} alt="" className="h-14 w-12 rounded-xl object-cover" />
              <div className="min-w-0">
                <p className="text-ink font-semibold text-[14px]">{friendShareProduct.brand}</p>
                <p className="text-ink-soft text-[12px] truncate">{friendShareProduct.title} · {friendShareProduct.price}</p>
              </div>
              <span className="material-symbols-outlined text-brand ml-auto shrink-0" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">send</span>
            </div>

            {friendsList.length === 0 ? (
              <EmptyState
                icon="group_add"
                title="No friends yet"
                description="Add friends to share finds with them."
                action={
                  <Button onClick={() => { setFriendShareProduct(null); navigate('/friends'); }}>
                    Find friends
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col pb-2">
                {friendsList.map((friend) => (
                  <button
                    key={friend.uid}
                    onClick={async () => {
                      const user = auth.currentUser;
                      if (!user) return;
                      const p = friendShareProduct;
                      try {
                        // Real users: write into the friend's inbox (same doc shape FriendsScreen reads)
                        if (user && !user.isAnonymous && !friend.uid.startsWith('demo-')) {
                          await addDoc(collection(db, 'users', friend.uid, 'friend_inbox'), {
                            fromUid: user.uid,
                            fromName: user.displayName || user.email || 'A friend',
                            brand: p.brand,
                            title: p.title,
                            price: p.price,
                            image: p.image,
                            url: p.affiliateLink || p.url,
                            ...(p.category ? { category: p.category } : {}),
                            sentAt: new Date(),
                            seen: false,
                          });
                        }
                        showToast(`Sent to ${friend.name} ✦`, 'success');
                      } catch {
                        showToast('Could not send right now.', 'error');
                      }
                      setFriendShareProduct(null);
                    }}
                    className="flex items-center gap-4 py-3.5 border-b border-line last:border-none press-soft"
                  >
                    <div className="h-11 w-11 rounded-full border border-line flex items-center justify-center shrink-0">
                      <span className="text-ink font-display font-medium text-[16px]">{friend.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <span className="text-ink font-medium text-[14px]">{friend.name}</span>
                    <span className="material-symbols-outlined text-ink-faint ml-auto text-[18px]" aria-hidden="true">arrow_forward</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
};

export default Home;
