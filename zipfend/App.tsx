import React, { Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { springs } from './components/ui/motion';
import { getJourneySnapshot } from './services/styleJourney';
import { ensureUserDoc, startPresence } from './services/social';
import { onConversations, unreadConversations } from './services/messages';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { ToastProvider } from './contexts/ToastContext';
import { UserProfileProvider } from './contexts/UserProfileContext';
import ErrorBoundary from './components/ErrorBoundary';
import { ScreenFallback, OfflineBanner, Wordmark } from './components/ui';
import Splash from './screens/Splash';

// Screens are lazy-loaded: each becomes its own chunk so first paint only
// pays for the route being visited, not the whole app.
const Welcome = React.lazy(() => import('./screens/Welcome'));
const Login = React.lazy(() => import('./screens/Login'));
const FitProfile = React.lazy(() => import('./screens/FitProfile'));
const SmartFitScan = React.lazy(() => import('./screens/SmartFitScan'));
const Home = React.lazy(() => import('./screens/Home'));
const SwipeReel = React.lazy(() => import('./screens/SwipeReel'));
const AddProduct = React.lazy(() => import('./screens/AddProduct'));
const Marketplace = React.lazy(() => import('./screens/Marketplace'));
const Recommendation = React.lazy(() => import('./screens/Recommendation'));
const Settings = React.lazy(() => import('./screens/Settings'));
const ComingSoon = React.lazy(() => import('./screens/ComingSoon'));
const FashionStudio = React.lazy(() => import('./screens/FashionStudio'));
const LiveTryOn = React.lazy(() => import('./screens/LiveTryOn'));
const TryOnStudio = React.lazy(() => import('./screens/TryOnStudio'));
const AIStudio = React.lazy(() => import('./screens/AIStudio'));
const AvatarIntro = React.lazy(() => import('./screens/AvatarIntro'));
const AvatarView = React.lazy(() => import('./screens/AvatarView'));
const Wishlist = React.lazy(() => import('./screens/Wishlist'));
const Cart = React.lazy(() => import('./screens/Cart'));
const RecentScans = React.lazy(() => import('./screens/RecentScans'));
const GiftLook = React.lazy(() => import('./screens/GiftLook'));
const GiftInbox = React.lazy(() => import('./screens/GiftInbox'));
const CommunityFeed = React.lazy(() => import('./screens/CommunityFeed'));
const CreateLook = React.lazy(() => import('./screens/CreateLook'));
const StylistChat = React.lazy(() => import('./screens/StylistChat'));
const FriendsScreen = React.lazy(() => import('./screens/FriendsScreen'));
const UserProfile = React.lazy(() => import('./screens/UserProfile'));
const ChatScreen = React.lazy(() => import('./screens/ChatScreen'));
const ProductFeed = React.lazy(() => import('./screens/ProductFeed'));
const AdminAnalytics = React.lazy(() => import('./screens/AdminAnalytics'));
const SellerAddProduct = React.lazy(() => import('./screens/SellerAddProduct'));
const SellerCatalog = React.lazy(() => import('./screens/SellerCatalog'));
const SellerEditProduct = React.lazy(() => import('./screens/SellerEditProduct'));
const SellerDashboard = React.lazy(() => import('./screens/SellerDashboard'));
const SellerIntegration = React.lazy(() => import('./screens/SellerIntegration'));
const SellerIntegrationSandbox = React.lazy(() => import('./screens/SellerIntegrationSandbox'));

// Info Pages
const FAQs = React.lazy(() => import('./screens/FAQs'));
const AboutUs = React.lazy(() => import('./screens/AboutUs'));
const TermsOfUse = React.lazy(() => import('./screens/TermsOfUse'));
const PrivacyPolicy = React.lazy(() => import('./screens/PrivacyPolicy'));
const PrivacyCenter = React.lazy(() => import('./screens/PrivacyCenter'));

const DEMO_AUTH_KEY = 'zipright_demo_user';

function readDemoUser(): User | null {
  try {
    const raw = localStorage.getItem(DEMO_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.uid) return null;
    return {
      uid: parsed.uid,
      displayName: parsed.displayName || 'ZipRIGHT Demo',
      phoneNumber: parsed.phoneNumber || null,
      photoURL: parsed.photoURL || null,
      email: null,
    } as User;
  } catch {
    return null;
  }
}

/**
 * The V2 dock — the app's navigation signature. A floating pill that is
 * always the inverse of the canvas: ink on bone in light, bone on black in
 * dark. The center Z is an ultraviolet jewel that opens the Atelier launcher.
 */
const BottomNav = ({ zipPoints, unreadFriends, profileImage }: { zipPoints: number; unreadFriends: number; profileImage: string | null }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isZMenuOpen, setIsZMenuOpen] = useState(false);
  const [journey, setJourney] = useState(() => getJourneySnapshot());
  const isActive = (path: string) => location.pathname === path;

  // Close the Z-menu on any route change (it otherwise lingers over the new screen)
  useEffect(() => {
    setIsZMenuOpen(false);
  }, [location.pathname]);

  // Refresh the Style Journey snapshot whenever the menu opens
  useEffect(() => {
    if (isZMenuOpen) setJourney(getJourneySnapshot());
  }, [isZMenuOpen]);

  // Show on specific routes
  const showNav = ['/home', '/marketplace', '/stylist', '/avatar-intro', '/settings', '/friends'].includes(location.pathname);

  if (!showNav) return null;

  const tabs = [
    { icon: 'home', label: 'Home', route: '/home' },
    { icon: 'storefront', label: 'Shop', route: '/marketplace' },
    { icon: 'Z', label: 'Atelier', route: 'z-menu' },
    { icon: 'group', label: 'Friends', route: '/friends' },
    { icon: 'account_circle', label: 'You', route: '/settings' },
  ];

  const zMenuOptions = [
    { icon: 'view_in_ar', title: 'Try-On', desc: 'Virtual fashion studio', route: '/fashion-studio' },
    { icon: 'auto_awesome', title: 'AI Stylist', desc: 'Personal style counsel', route: '/stylist' },
    { icon: 'straighten', title: 'Size Match', desc: 'The AI fit engine', route: '/add-product' },
    { icon: 'face_6', title: 'Avatar', desc: 'Your digital twin', route: '/avatar-intro' },
  ];

  return (
    <>
      {/* Atelier launcher */}
      <AnimatePresence>
        {isZMenuOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[55] bg-scrim backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsZMenuOpen(false)}
            />
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-[60] px-4 pointer-events-none">
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="ZipRIGHT features"
                className="w-full pointer-events-auto"
                initial={{ opacity: 0, y: 28, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.97 }}
                transition={springs.gentle}
              >
              <div className="bg-surface-1 border border-line rounded-[1.75rem] p-6 shadow-float">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <p className="eyebrow mb-1.5">The Atelier</p>
                    <Wordmark size="sm" />
                  </div>
                  <button
                    onClick={() => setIsZMenuOpen(false)}
                    aria-label="Close menu"
                    className="active:scale-90 h-9 w-9 flex items-center justify-center border border-line rounded-full transition-transform"
                  >
                    <span className="material-symbols-outlined text-ink-soft text-[18px]" aria-hidden="true">close</span>
                  </button>
                </div>

                {/* Style Journey strip — quiet progression, always current */}
                <div className="flex items-center gap-4 mb-5 rounded-2xl bg-surface-2 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-ink font-semibold text-[20px] leading-none">{journey.points.toLocaleString()}</span>
                      <span className="eyebrow !text-[9px]">Style Score</span>
                    </div>
                    <div className="mt-2.5 h-px bg-line relative overflow-visible" aria-hidden="true">
                      <div className="absolute inset-y-0 left-0 h-[3px] -top-[1px] bg-brand rounded-full transition-all duration-500" style={{ width: `${journey.levelProgress}%` }} />
                    </div>
                    <p className="mt-2 text-[11px] text-ink-faint">
                      <span className="font-semibold text-ink-soft">{journey.level}</span>
                      {journey.nextLevel && <> · {100 - journey.levelProgress}% to {journey.nextLevel}</>}
                    </p>
                  </div>
                  {journey.currentStreak > 0 && (
                    <div className="flex flex-col items-center shrink-0" aria-label={`${journey.currentStreak} day streak`}>
                      <span className="material-symbols-outlined text-brass text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                        local_fire_department
                      </span>
                      <span className="text-brass font-semibold text-[11px] mt-0.5">{journey.currentStreak}d</span>
                    </div>
                  )}
                </div>

                {/* The Salon — featured row above the tools */}
                <motion.button
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springs.gentle, delay: 0.03 }}
                  onClick={() => {
                    setIsZMenuOpen(false);
                    navigate('/community');
                  }}
                  className="w-full flex items-center gap-4 p-4 mb-3 rounded-2xl bg-ink text-ink-invert active:scale-[0.98] transition-transform text-left"
                >
                  <span className="material-symbols-outlined text-[22px]" aria-hidden="true">gallery_thumbnail</span>
                  <div className="flex-1 min-w-0">
                    <span className="block font-semibold text-[14px]">The Salon</span>
                    <span className="block opacity-60 text-[11.5px] leading-tight">Looks, reels & fits from the circle</span>
                  </div>
                  <span className="material-symbols-outlined text-[18px] opacity-60" aria-hidden="true">arrow_forward</span>
                </motion.button>

                <div className="grid grid-cols-2 gap-3">
                  {zMenuOptions.map((option, i) => (
                    <motion.button
                      key={option.title}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...springs.gentle, delay: 0.05 + i * 0.045 }}
                      onClick={() => {
                        setIsZMenuOpen(false);
                        navigate(option.route);
                      }}
                      className="flex flex-col items-start p-4 rounded-2xl border border-line hover:border-line-strong active:scale-95 transition-[transform,border-color] text-left"
                    >
                      <span className="material-symbols-outlined text-brand text-[22px] mb-3" aria-hidden="true">{option.icon}</span>
                      <span className="text-ink font-semibold text-[14px] mb-0.5">{option.title}</span>
                      <span className="text-ink-faint text-[11.5px] leading-tight">{option.desc}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
          </>
        )}
      </AnimatePresence>

      {/* The dock — full-width mobile tab bar. inset-x-0 (no translate/centering
          math, no float gap) so nothing can peek beside it or overflow the
          viewport on any phone width; safe-area handled by pb-safe below. */}
      <nav
        aria-label="Main navigation"
        className="fixed z-50 w-full max-w-[430px] inset-x-0 mx-auto bg-ink text-ink-invert dark:bg-surface-1 dark:text-ink dark:border-t dark:border-line phone-fixed-bottom"
        style={{ bottom: 0 }}
      >
        <div className="grid grid-cols-5 h-[64px] items-center px-2">
          {tabs.map((tab) => (
            <button
              key={tab.route}
              aria-label={tab.label}
              aria-current={tab.route !== 'z-menu' && isActive(tab.route) ? 'page' : undefined}
              onClick={() => {
                if (tab.route === 'z-menu') {
                  setIsZMenuOpen(!isZMenuOpen);
                } else {
                  setIsZMenuOpen(false);
                  navigate(tab.route);
                }
              }}
              className="flex flex-col items-center justify-center gap-0.5 cursor-pointer active:scale-95 transition-transform relative h-full"
            >
              {tab.icon === 'Z' ? (
                <motion.div
                  animate={isZMenuOpen ? { rotate: 45, scale: 1.06 } : { rotate: 0, scale: 1 }}
                  transition={springs.snappy}
                  className={`h-11 w-11 rounded-full flex items-center justify-center transition-colors ${isZMenuOpen ? 'bg-ink-invert' : 'bg-brand shadow-glow'}`}
                >
                  <motion.span
                    animate={isZMenuOpen ? { rotate: -45 } : { rotate: 0 }}
                    transition={springs.snappy}
                    className={`font-display italic font-semibold text-[20px] leading-none ${isZMenuOpen ? 'text-ink' : 'text-on-brand'}`}
                  >
                    Z
                  </motion.span>
                </motion.div>
              ) : (
                <>
                  {/* Sliding active indicator */}
                  {isActive(tab.route) && (
                    <motion.div
                      layoutId="nav-active-dot"
                      transition={springs.snappy}
                      className="absolute top-[9px] left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-brand"
                      aria-hidden="true"
                    />
                  )}
                  {tab.icon === 'account_circle' && profileImage ? (
                    <img
                      src={profileImage}
                      alt=""
                      className={`w-6 h-6 rounded-full object-cover transition-opacity ${isActive(tab.route) ? 'ring-2 ring-brand' : 'opacity-60'}`}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`material-symbols-outlined text-[22px] transition-opacity ${
                        isActive(tab.route) ? 'opacity-100' : 'opacity-50'
                      }`}
                      style={{ fontVariationSettings: isActive(tab.route) ? "'FILL' 1, 'wght' 300" : "'FILL' 0, 'wght' 300" }}
                    >
                      {tab.icon}
                    </span>
                  )}
                  {tab.icon === 'account_circle' && zipPoints > 0 && (
                    <div className="absolute top-2 right-1/4 h-3.5 w-3.5 bg-brass rounded-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-[10px] text-ink" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
                    </div>
                  )}
                  {tab.icon === 'group' && unreadFriends > 0 && (
                    <div className="absolute top-2 right-1/4 h-3.5 w-3.5 bg-danger rounded-full flex items-center justify-center">
                      <span className="text-[7px] text-white font-bold">{unreadFriends > 9 ? '9+' : unreadFriends}</span>
                    </div>
                  )}
                  <span className={`text-[9px] font-semibold uppercase tracking-[0.12em] transition-opacity ${
                    isActive(tab.route) ? 'opacity-100' : 'opacity-50'
                  }`}>
                    {tab.label}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        {/* iPhone home-indicator safe area */}
        <div className="pb-safe" aria-hidden="true"></div>
      </nav>
    </>
  );
};

const AppContent: React.FC<{ user: User | null; loading: boolean }> = ({ user, loading }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [zipPoints, setZipPoints] = useState(0);
  const [unreadFriends, setUnreadFriends] = useState(0);
  const [profileImage, setProfileImage] = useState<string | null>(null);

  useEffect(() => {
    const publicRoutes = new Set([
      '/',
      '/welcome',
      '/login',
      '/faqs',
      '/about-us',
      '/terms-of-use',
      '/privacy-policy',
      '/privacy-center',
    ]);

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser && !user && !publicRoutes.has(location.pathname)) {
        navigate('/login');
      }
    });

    return () => unsubscribe();
  }, [location.pathname, navigate, user]);

  useEffect(() => {
    if (user) {
      setProfileImage(user.photoURL || null);
      // Style Journey points power the profile-tab badge (client-side progression)
      setZipPoints(getJourneySnapshot().points);
      setUnreadFriends(0);
      // Social layer: public profile fields + online-presence heartbeat
      void ensureUserDoc();
      return startPresence();
    }
    setProfileImage(null);
    setZipPoints(0);
    setUnreadFriends(0);
  }, [user]);

  // Keep the points badge current as the user moves through the app
  useEffect(() => {
    if (user) setZipPoints(getJourneySnapshot().points);
  }, [location.pathname, user]);

  // Friends-tab badge = unread DM conversations
  useEffect(() => {
    if (!user) return;
    return onConversations(convs => setUnreadFriends(unreadConversations(convs)));
  }, [user]);

  if (loading) {
    // Animated brand splash during the (real) Firebase auth-state wait.
    return (
      // Full-bleed mobile shell — no letterbox frame, the app IS the screen
      <div className="min-h-screen min-h-dvh w-full">
        <Splash />
      </div>
    );
  }

  const isAuthenticated = !!user;

  // Full-bleed mobile shell: single container, overflow-x clipped so no
  // decorative element (shadows, stamps, transforms) can ever create
  // horizontal scroll on any phone width.
  return (
    <div className="w-full max-w-[430px] mx-auto min-h-screen min-h-dvh bg-surface-0 relative overflow-x-hidden border-x border-line/50 transition-colors duration-300 shadow-2xl">
        <OfflineBanner />
        <Suspense fallback={<ScreenFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to={isAuthenticated ? '/home' : '/welcome'} />} />
          <Route path="/welcome" element={isAuthenticated ? <Navigate to="/home" /> : <Welcome />} />
          <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/home" />} />

          {/* MVP Core Flow */}
          <Route path="/home" element={isAuthenticated ? <Home /> : <Navigate to="/login" />} />
          <Route path="/reel" element={isAuthenticated ? <SwipeReel /> : <Navigate to="/login" />} />
          <Route path="/add-product" element={isAuthenticated ? <AddProduct /> : <Navigate to="/login" />} />
          <Route path="/marketplace" element={isAuthenticated ? <Marketplace /> : <Navigate to="/login" />} />
          <Route path="/fit-profile" element={isAuthenticated ? <FitProfile /> : <Navigate to="/login" />} />
          <Route path="/smart-fit-scan" element={isAuthenticated ? <SmartFitScan /> : <Navigate to="/login" />} />
          <Route path="/recommendation" element={isAuthenticated ? <Recommendation /> : <Navigate to="/login" />} />
          <Route path="/settings" element={isAuthenticated ? <Settings /> : <Navigate to="/login" />} />
          <Route path="/seller/add-product" element={isAuthenticated ? <SellerAddProduct /> : <Navigate to="/login" />} />
          <Route path="/seller/catalog" element={isAuthenticated ? <SellerCatalog /> : <Navigate to="/login" />} />
          <Route path="/seller/edit-product/:id" element={isAuthenticated ? <SellerEditProduct /> : <Navigate to="/login" />} />
          <Route path="/seller/dashboard" element={isAuthenticated ? <SellerDashboard /> : <Navigate to="/login" />} />
          <Route path="/seller/integration" element={isAuthenticated ? <SellerIntegration /> : <Navigate to="/login" />} />
          <Route path="/seller/integration/sandbox" element={isAuthenticated ? <SellerIntegrationSandbox /> : <Navigate to="/login" />} />
          <Route path="/how-it-works" element={isAuthenticated ? <ComingSoon featureName="How It Works" /> : <Navigate to="/login" />} />
          <Route path="/success" element={isAuthenticated ? <ComingSoon featureName="Success" /> : <Navigate to="/login" />} />

          {/* Coming Soon Features */}
          <Route path="/avatar-intro" element={isAuthenticated ? <AvatarIntro /> : <Navigate to="/login" />} />
          <Route path="/avatar-view" element={isAuthenticated ? <AvatarView /> : <Navigate to="/login" />} />
          <Route path="/fashion-studio" element={isAuthenticated ? <FashionStudio /> : <Navigate to="/login" />} />
          <Route path="/live-tryon" element={isAuthenticated ? <LiveTryOn /> : <Navigate to="/login" />} />
          <Route path="/tryon-studio" element={isAuthenticated ? <TryOnStudio /> : <Navigate to="/login" />} />
          <Route path="/ai-studio" element={isAuthenticated ? <AIStudio /> : <Navigate to="/login" />} />
          <Route path="/voice-assistant" element={<ComingSoon featureName="Voice Assistant" />} />
          <Route path="/video-lookbook" element={<ComingSoon featureName="Video Lookbook" />} />
          <Route path="/style-studio" element={<ComingSoon featureName="Style Studio" />} />
          <Route path="/wishlist" element={isAuthenticated ? <Wishlist /> : <Navigate to="/login" />} />
          <Route path="/cart" element={isAuthenticated ? <Cart /> : <Navigate to="/login" />} />
          <Route path="/gift-look" element={isAuthenticated ? <GiftLook /> : <Navigate to="/login" />} />
          <Route path="/gift-inbox" element={isAuthenticated ? <GiftInbox /> : <Navigate to="/login" />} />
          <Route path="/community" element={isAuthenticated ? <CommunityFeed /> : <Navigate to="/login" />} />
          <Route path="/create-look" element={isAuthenticated ? <CreateLook /> : <Navigate to="/login" />} />
          <Route path="/friends" element={isAuthenticated ? <FriendsScreen /> : <Navigate to="/login" />} />
          <Route path="/profile/:uid" element={isAuthenticated ? <UserProfile /> : <Navigate to="/login" />} />
          <Route path="/chat/:uid" element={isAuthenticated ? <ChatScreen /> : <Navigate to="/login" />} />
          <Route path="/recent-scans" element={isAuthenticated ? <RecentScans /> : <Navigate to="/login" />} />
          <Route path="/feed" element={isAuthenticated ? <ProductFeed /> : <Navigate to="/login" />} />
          <Route path="/admin/analytics" element={isAuthenticated ? <AdminAnalytics /> : <Navigate to="/login" />} />
          <Route path="/order-history" element={<ComingSoon featureName="Order History" />} />
          <Route path="/stylist" element={isAuthenticated ? <StylistChat /> : <Navigate to="/login" />} />
          <Route path="/seller-registration" element={<ComingSoon featureName="Seller Registration" />} />

          {/* Seller Routes */}
          <Route path="/seller/*" element={<ComingSoon featureName="Seller Portal" />} />

          {/* Checkout Flow */}
          <Route path="/checkout/*" element={<ComingSoon featureName="Checkout" />} />
          <Route path="/select-payment" element={<ComingSoon featureName="Payment Selection" />} />

          {/* Info Pages */}
          <Route path="/faqs" element={<FAQs />} />
          <Route path="/about-us" element={<AboutUs />} />
          <Route path="/terms-of-use" element={<TermsOfUse />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/privacy-center" element={<PrivacyCenter />} />

          {/* Redirect */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
        <BottomNav zipPoints={zipPoints} unreadFriends={unreadFriends} profileImage={profileImage} />
    </div>
  );
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [demoUser, setDemoUser] = useState<User | null>(() => readDemoUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const syncDemoUser = () => setDemoUser(readDemoUser());
    window.addEventListener('zipright-demo-auth-changed', syncDemoUser);
    window.addEventListener('storage', syncDemoUser);
    return () => {
      window.removeEventListener('zipright-demo-auth-changed', syncDemoUser);
      window.removeEventListener('storage', syncDemoUser);
    };
  }, []);

  // System Adaptable Theme Logic
  useEffect(() => {
    const storedTheme = localStorage.getItem('zipright_theme');

    const applyTheme = (theme: 'dark' | 'light') => {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    if (storedTheme) {
      applyTheme(storedTheme as 'dark' | 'light');
    } else {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches ? 'dark' : 'light');

      const handleChange = (e: MediaQueryListEvent) => {
        if (!localStorage.getItem('zipright_theme')) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  return (
    <ToastProvider>
      <UserProfileProvider>
        <ErrorBoundary>
          <HashRouter>
            <AppContent user={demoUser || user} loading={loading} />
          </HashRouter>
        </ErrorBoundary>
      </UserProfileProvider>
    </ToastProvider>
  );
};

export default App;
