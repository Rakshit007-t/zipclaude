import React, { Suspense, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { springs } from './components/ui/motion';
import { getJourneySnapshot } from './services/styleJourney';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { ToastProvider } from './contexts/ToastContext';
import { UserProfileProvider } from './contexts/UserProfileContext';
import ErrorBoundary from './components/ErrorBoundary';
import { ScreenFallback, OfflineBanner } from './components/ui';
import Splash from './screens/Splash';

// Screens are lazy-loaded: each becomes its own chunk so first paint only
// pays for the route being visited, not the whole app.
const Welcome = React.lazy(() => import('./screens/Welcome'));
const Login = React.lazy(() => import('./screens/Login'));
const FitProfile = React.lazy(() => import('./screens/FitProfile'));
const SmartFitScan = React.lazy(() => import('./screens/SmartFitScan'));
const Home = React.lazy(() => import('./screens/Home'));
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
    { icon: 'storefront', label: 'Market', route: '/marketplace' },
    { icon: 'Z', label: 'ZipRIGHT', route: 'z-menu' },
    { icon: 'group', label: 'Friends', route: '/friends' },
    { icon: 'account_circle', label: 'Profile', route: '/settings' },
  ];

  const zMenuOptions = [
    { icon: 'view_in_ar', title: 'Try-On', desc: 'Virtual fashion studio', route: '/fashion-studio' },
    { icon: 'auto_awesome', title: 'AI Stylist', desc: 'Personal style assistant', route: '/stylist' },
    { icon: 'straighten', title: 'Size Recommend', desc: 'AI fit engine', route: '/add-product' },
    { icon: 'face_6', title: 'AI Avatar', desc: 'Your digital twin', route: '/avatar-intro' },
  ];

  return (
    <>
      {/* Z Menu Drawer */}
      <AnimatePresence>
        {isZMenuOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsZMenuOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="ZipRIGHT features"
              className="fixed bottom-20 left-1/2 z-[60] px-4 w-full sm:max-w-[430px]"
              initial={{ opacity: 0, y: 24, scale: 0.96, x: '-50%' }}
              animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
              exit={{ opacity: 0, y: 16, scale: 0.97, x: '-50%' }}
              transition={springs.gentle}
            >
              <div className="bg-surface-1 border border-line rounded-[2rem] p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-[#6157FF] text-xl font-bold tracking-tighter">
                    <span className="text-ink">Zip</span>RIGHT
                  </span>
                  <button
                    onClick={() => setIsZMenuOpen(false)}
                    aria-label="Close menu"
                    className="active:scale-90 p-2 bg-surface-2 rounded-full transition-transform"
                  >
                    <span className="material-symbols-outlined text-ink-soft text-lg" aria-hidden="true">close</span>
                  </button>
                </div>

                {/* Style Journey strip — quiet progression, always current */}
                <div className="flex items-center gap-4 mb-5 rounded-2xl bg-surface-2 border border-line px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[#6157FF] font-bold text-lg leading-none">{journey.points.toLocaleString()}</span>
                      <span className="text-ink-soft text-[12px] font-bold">Style Score</span>
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
                      <div className="h-full bg-[#6157FF] rounded-full transition-all duration-500" style={{ width: `${journey.levelProgress}%` }} />
                    </div>
                    <p className="mt-1.5 text-[12px] text-ink-soft">
                      <span className="text-ink-soft font-bold">{journey.level}</span>
                      {journey.nextLevel && <> · {100 - journey.levelProgress}% to {journey.nextLevel}</>}
                    </p>
                  </div>
                  {journey.currentStreak > 0 && (
                    <div className="flex flex-col items-center shrink-0" aria-label={`${journey.currentStreak} day streak`}>
                      <span className="material-symbols-outlined text-[#E4B95B] text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
                        local_fire_department
                      </span>
                      <span className="text-ink font-bold text-xs">{journey.currentStreak}d</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                      className="flex flex-col items-start p-4 bg-surface-2 rounded-2xl border border-line active:scale-95 transition-transform text-left"
                    >
                      <div className="h-10 w-10 rounded-full bg-[#6157FF]/20 flex items-center justify-center mb-3">
                        <span className="material-symbols-outlined text-[#6157FF]" aria-hidden="true">{option.icon}</span>
                      </div>
                      <span className="text-ink font-bold text-sm mb-1">{option.title}</span>
                      <span className="text-ink-soft text-[12px] leading-tight">{option.desc}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav
        aria-label="Main navigation"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full sm:max-w-[430px] bg-surface-0/92 backdrop-blur-xl border-t border-line shadow-2xl"
      >
        <div className="grid grid-cols-5 h-16 items-center px-2">
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
              className="flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-transform relative h-full"
            >
              {tab.icon === 'Z' ? (
                <motion.div
                  animate={isZMenuOpen ? { rotate: 45, scale: 1.05 } : { rotate: 0, scale: 1 }}
                  transition={springs.snappy}
                  className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors ${isZMenuOpen ? 'bg-[#6157FF] text-ink' : 'bg-surface-2 text-[#6157FF]'}`}
                >
                  <motion.span
                    animate={isZMenuOpen ? { rotate: -45 } : { rotate: 0 }}
                    transition={springs.snappy}
                    className="text-xl font-bold"
                    style={{ fontFamily: 'system-ui' }}
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
                      className="absolute top-1 h-1 w-5 rounded-full bg-[#6157FF]"
                      aria-hidden="true"
                    />
                  )}
                  {tab.icon === 'account_circle' && profileImage ? (
                    <img
                      src={profileImage}
                      alt=""
                      className={`w-6 h-6 rounded-full object-cover transition-transform ${isActive(tab.route) ? 'ring-2 ring-[#6157FF] ring-offset-1 ring-offset-surface-0' : 'opacity-70'}`}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`material-symbols-outlined text-[24px] transition-colors ${
                        isActive(tab.route) ? 'text-[#6157FF]' : 'text-gray-500'
                      }`}
                      style={{ fontVariationSettings: isActive(tab.route) ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      {tab.icon}
                    </span>
                  )}
                  {tab.icon === 'account_circle' && zipPoints > 0 && (
                    <div className="absolute top-1 right-1/4 h-3.5 w-3.5 bg-[#6157FF] rounded-full flex items-center justify-center border border-surface-0">
                      <span className="material-symbols-outlined text-[12px] text-ink filled" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">stars</span>
                    </div>
                  )}
                  {tab.icon === 'group' && unreadFriends > 0 && (
                    <div className="absolute top-1 right-1/4 h-3.5 w-3.5 bg-[#FF4D6D] rounded-full flex items-center justify-center border border-surface-0">
                      <span className="text-[7px] text-ink font-bold">{unreadFriends > 9 ? '9+' : unreadFriends}</span>
                    </div>
                  )}
                  <span className={`text-[11px] font-bold tracking-tighter ${
                    isActive(tab.route) ? 'text-[#6157FF]' : 'text-gray-500'
                  }`}>
                    {tab.label}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        {/* Safe Area Handling */}
        <div className="h-[env(safe-area-inset-bottom)]"></div>
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
      return;
    }
    setProfileImage(null);
    setZipPoints(0);
    setUnreadFriends(0);
  }, [user]);

  // Keep the points badge current as the user moves through the app
  useEffect(() => {
    if (user) setZipPoints(getJourneySnapshot().points);
  }, [location.pathname, user]);

  if (loading) {
    // Animated brand splash during the (real) Firebase auth-state wait.
    return (
      <div className="min-h-screen min-h-dvh bg-surface-3 flex justify-center w-full">
        <div className="w-full sm:max-w-[430px]">
          <Splash />
        </div>
      </div>
    );
  }

  const isAuthenticated = !!user;

  return (
    <div className="min-h-screen min-h-dvh bg-surface-3 flex justify-center w-full">
      <div className="w-full sm:max-w-[430px] min-h-screen min-h-dvh bg-surface-0 relative overflow-hidden transition-colors duration-300 shadow-2xl sm:border-x sm:border-line">
        <OfflineBanner />
        <Suspense fallback={<ScreenFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to={isAuthenticated ? '/home' : '/welcome'} />} />
          <Route path="/welcome" element={isAuthenticated ? <Navigate to="/home" /> : <Welcome />} />
          <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/home" />} />
          
          {/* MVP Core Flow */}
          <Route path="/home" element={isAuthenticated ? <Home /> : <Navigate to="/login" />} />
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
