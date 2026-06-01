import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import { ToastProvider } from './contexts/ToastContext';
import { UserProfileProvider } from './contexts/UserProfileContext';
import ErrorBoundary from './components/ErrorBoundary';

// Import Screens
import Welcome from './screens/Welcome';
import Login from './screens/Login';
import FitProfile from './screens/FitProfile';
import SmartFitScan from './screens/SmartFitScan';
import Home from './screens/Home';
import AddProduct from './screens/AddProduct';
import Marketplace from './screens/Marketplace';
import Recommendation from './screens/Recommendation';
import Settings from './screens/Settings';
import ComingSoon from './screens/ComingSoon';
import FashionStudio from './screens/FashionStudio';
import AIStudio from './screens/AIStudio';
import AvatarIntro from './screens/AvatarIntro';
import AvatarView from './screens/AvatarView';
import Wishlist from './screens/Wishlist';
import Cart from './screens/Cart';
import RecentScans from './screens/RecentScans';
import GiftLook from './screens/GiftLook';
import GiftInbox from './screens/GiftInbox';
import CommunityFeed from './screens/CommunityFeed';
import CreateLook from './screens/CreateLook';
import StylistChat from './screens/StylistChat';
import FriendsScreen from './screens/FriendsScreen';
import ProductFeed from './screens/ProductFeed';
import AdminAnalytics from './screens/AdminAnalytics';

// Info Pages
import FAQs from './screens/FAQs';
import AboutUs from './screens/AboutUs';
import TermsOfUse from './screens/TermsOfUse';
import PrivacyPolicy from './screens/PrivacyPolicy';
import PrivacyCenter from './screens/PrivacyCenter';

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
  const isActive = (path: string) => location.pathname === path;

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
      {isZMenuOpen && (
        <>
          <div 
            className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsZMenuOpen(false)}
          />
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] px-4 w-full sm:max-w-[430px]" style={{ animation: 'zMenuSlideIn 0.25s ease-out' }}>
            <div className="bg-[#1A1A1A] border border-white/10 rounded-[2rem] p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <span className="text-[#C9A06C] text-xl font-bold tracking-tight" style={{ fontFamily: 'system-ui', fontStyle: 'normal' }}>
                  <span className="text-white">Zip</span>RIGHT
                </span>
                <button onClick={() => setIsZMenuOpen(false)} className="active:scale-90 p-2 bg-white/5 rounded-full">
                  <span className="material-symbols-outlined text-white/50 text-lg">close</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {zMenuOptions.map((option) => (
                  <button
                    key={option.title}
                    onClick={() => {
                      setIsZMenuOpen(false);
                      navigate(option.route);
                    }}
                    className="flex flex-col items-start p-4 bg-white/5 rounded-2xl border border-white/5 active:scale-95 transition-transform text-left"
                  >
                    <div className="h-10 w-10 rounded-full bg-[#C9A06C]/20 flex items-center justify-center mb-3">
                      <span className="material-symbols-outlined text-[#C9A06C]">{option.icon}</span>
                    </div>
                    <span className="text-white font-bold text-sm mb-1">{option.title}</span>
                    <span className="text-white/50 text-[10px] leading-tight">{option.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full sm:max-w-[430px] bg-[#111111] border-t border-white/5 shadow-2xl">
        <div className="grid grid-cols-5 h-16 items-center px-2">
          {tabs.map((tab) => (
            <button 
              key={tab.route}
              onClick={() => {
                if (tab.route === 'z-menu') {
                  setIsZMenuOpen(!isZMenuOpen);
                } else {
                  setIsZMenuOpen(false);
                  navigate(tab.route);
                }
              }}
              className="flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-transform relative"
            >
              {tab.icon === 'Z' ? (
                <div className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors ${isZMenuOpen ? 'bg-[#C9A06C] text-black' : 'bg-white/10 text-[#C9A06C]'}`}>
                  <span className="text-xl font-black" style={{ fontFamily: 'system-ui' }}>Z</span>
                </div>
              ) : (
                <>
                  {tab.icon === 'account_circle' && profileImage ? (
                    <img 
                      src={profileImage} 
                      alt="Profile" 
                      className={`w-6 h-6 rounded-full object-cover transition-transform ${isActive(tab.route) ? 'ring-2 ring-[#C9A06C] ring-offset-1 ring-offset-[#111111]' : 'opacity-70'}`} 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span 
                      className={`material-symbols-outlined text-[24px] transition-colors ${
                        isActive(tab.route) ? 'text-[#B5853F] dark:text-[#C9A06C]' : 'text-gray-500'
                      }`}
                      style={{ fontVariationSettings: isActive(tab.route) ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      {tab.icon}
                    </span>
                  )}
                  {tab.icon === 'account_circle' && zipPoints > 0 && (
                    <div className="absolute top-1 right-1/4 h-3.5 w-3.5 bg-[#B5853F] rounded-full flex items-center justify-center border border-[#111111]">
                      <span className="material-symbols-outlined text-[8px] text-white filled" style={{ fontVariationSettings: "'FILL' 1" }}>stars</span>
                    </div>
                  )}
                  {tab.icon === 'group' && unreadFriends > 0 && (
                    <div className="absolute top-1 right-1/4 h-3.5 w-3.5 bg-[#FF4D6D] rounded-full flex items-center justify-center border border-[#111111]">
                      <span className="text-[7px] text-white font-black">{unreadFriends > 9 ? '9+' : unreadFriends}</span>
                    </div>
                  )}
                  <span className={`text-[9px] font-bold uppercase tracking-tighter ${
                    isActive(tab.route) ? 'text-[#B5853F] dark:text-[#C9A06C]' : 'text-gray-500'
                  }`}>
                    {tab.label}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        {/* Safe Area Handling */}
        <div className="h-[env(safe-area-inset-bottom)] bg-[#111111]"></div>
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
      setZipPoints(0);
      setUnreadFriends(0);
      return;
    }
    setProfileImage(null);
    setZipPoints(0);
    setUnreadFriends(0);
  }, [user]);

  if (loading) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black dark:border-white"></div>
      </div>
    );
  }

  const isAuthenticated = !!user;

  return (
    <div className="min-h-screen min-h-dvh bg-black flex justify-center w-full">
      <div className="w-full sm:max-w-[430px] min-h-screen min-h-dvh bg-[#111111] relative overflow-hidden transition-colors duration-300 shadow-2xl sm:border-x sm:border-white/5">
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
          <Route path="/how-it-works" element={isAuthenticated ? <ComingSoon featureName="How It Works" /> : <Navigate to="/login" />} />
          <Route path="/success" element={isAuthenticated ? <ComingSoon featureName="Success" /> : <Navigate to="/login" />} />

          {/* Coming Soon Features */}
          <Route path="/avatar-intro" element={isAuthenticated ? <AvatarIntro /> : <Navigate to="/login" />} />
          <Route path="/avatar-view" element={isAuthenticated ? <AvatarView /> : <Navigate to="/login" />} />
          <Route path="/fashion-studio" element={isAuthenticated ? <FashionStudio /> : <Navigate to="/login" />} />
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
