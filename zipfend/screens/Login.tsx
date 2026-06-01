import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

declare global {
  interface Window {
    google: any;
    recaptchaVerifier: any;
  }
}

type AuthStep = 'input' | 'otp' | 'profile' | 'forgot-password';

const DEMO_AUTH_KEY = 'zipright_demo_user';

const countryCodes = [
  { name: 'India', code: '+91', iso: 'IN', requiredLength: 10 },
  { name: 'USA', code: '+1', iso: 'US', requiredLength: 10 },
  { name: 'UK', code: '+44', iso: 'GB', requiredLength: 10 },
  { name: 'Canada', code: '+1', iso: 'CA', requiredLength: 10 },
  { name: 'Australia', code: '+61', iso: 'AU', requiredLength: 9 },
  { name: 'Germany', code: '+49', iso: 'DE', requiredLength: 11 },
  { name: 'France', code: '+33', iso: 'FR', requiredLength: 9 },
];

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<AuthStep>('input');
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('phone');
  const [isSignUp, setIsSignUp] = useState(location.state?.isSignUp ?? false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedCountry, setSelectedCountry] = useState(countryCodes[0]); // Default to +91 India
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null)
  ];
  const [confirmationResult, setConfirmationResult] = useState<any>(null);

  // Profile Data State
  const [profileData, setProfileData] = useState({
    firstName: '',
    email: '',
    dob: '',
    gender: ''
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [error, setError] = useState('');

  // Reset phone if it exceeds length when country changes
  useEffect(() => {
    if (phone.length > selectedCountry.requiredLength) {
      setPhone(phone.substring(0, selectedCountry.requiredLength));
    }
  }, [selectedCountry, phone]);

  // Clear recaptchaVerifier on unmount to prevent "reCAPTCHA client element has been removed" error
  useEffect(() => {
    return () => {
      if (window.recaptchaVerifier) {
        try {
          window.recaptchaVerifier.clear();
        } catch (e) {
          console.error('Error clearing recaptcha:', e);
        }
        window.recaptchaVerifier = null;
      }
    };
  }, []);

  const createSessionAndNavigate = async (requiresProfile = false) => {
    setIsLoading(false);
    navigate(requiresProfile ? '/fit-profile' : '/home');
  };

  const createLocalDemoSession = (phoneNumber?: string) => {
    localStorage.setItem(DEMO_AUTH_KEY, JSON.stringify({
      uid: `demo-${phoneNumber || 'investor'}`,
      phoneNumber: phoneNumber || '',
      displayName: 'ZipRIGHT Demo',
      photoURL: null,
    }));
    window.dispatchEvent(new Event('zipright-demo-auth-changed'));
    setIsLoading(false);
    navigate('/home', { replace: true });
  };

  const handleFastPhoneLogin = async () => {
    const phoneNumber = `${selectedCountry.code}${phone}`;
    try {
      await signInAnonymously(auth);
      await createSessionAndNavigate(false);
    } catch (err) {
      console.warn('[Login] Anonymous Firebase auth unavailable, using local demo session.', err);
      createLocalDemoSession(phoneNumber);
    }
  };

  const startDemoOtpFlow = () => {
    const phoneNumber = `${selectedCountry.code}${phone}`;
    setConfirmationResult({
      isDemo: true,
      confirm: async (code: string) => {
        if (code !== '123456') {
          throw new Error('Invalid demo OTP. Use 123456.');
        }
        createLocalDemoSession(phoneNumber);
        return { user: null };
      },
    });
    setOtp(['', '', '', '', '', '']);
    setIsLoading(false);
    setStep('otp');
  };

  const handleGoogleLogin = async () => {
    setError('');
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Wait a moment for Firestore auth state to sync
      await new Promise(resolve => setTimeout(resolve, 500));

      const userDocRef = doc(db, 'users', user.uid);
      let userDoc;
      try {
        userDoc = await getDoc(userDocRef);
      } catch (e: any) {
        if (e.code === 'permission-denied') {
          // Retry once after a longer delay
          await new Promise(resolve => setTimeout(resolve, 1000));
          userDoc = await getDoc(userDocRef);
        } else {
          throw e;
        }
      }

      createSessionAndNavigate(!userDoc.exists());
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Google Sign-In failed. Please try again.');
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'input') navigate('/welcome');
    else if (step === 'otp') setStep('input');
    else if (step === 'profile') setStep('input');
    else setStep('input');
  };

  const handleContinue = async () => {
    setError('');
    if (authMethod === 'phone') {
      if (!phone || phone.length !== selectedCountry.requiredLength) {
        setError(`Please enter a valid ${selectedCountry.requiredLength}-digit mobile number`);
        return;
      }
      setIsLoading(true);
      try {
        startDemoOtpFlow();
        return;

        if (window.recaptchaVerifier) {
          try {
            window.recaptchaVerifier.clear();
          } catch (e) {
            console.warn('Error clearing reCAPTCHA:', e);
          }
          window.recaptchaVerifier = null;
        }

        // Ensure the container is empty before creating a new one
        const container = document.getElementById('recaptcha-container');
        if (container) container.innerHTML = '';

        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
          'callback': () => {
            // reCAPTCHA solved
          },
          'expired-callback': () => {
            // Response expired. Ask user to solve reCAPTCHA again.
            setError('reCAPTCHA expired. Please try again.');
          }
        });

        const phoneNumber = `${selectedCountry.code}${phone}`;
        const confirmation = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
        setConfirmationResult(confirmation);
        setIsLoading(false);
        setStep('otp');
      } catch (err: any) {
        console.error('SMS sending error:', err);
        if (err.code === 'auth/billing-not-enabled') {
          setError('Phone authentication requires Firebase billing to be enabled. Please upgrade to the Blaze plan in your Firebase console.');
        } else if (err.code === 'auth/operation-not-allowed') {
          if (err.message.includes('region enabled')) {
            setError('SMS sending is restricted for this region. Please enable your country in the Firebase Console (Authentication > Settings > SMS Region Policy).');
          } else {
            setError('Phone Authentication is not enabled in your Firebase project. Please enable it in the Firebase Console (Authentication > Sign-in method).');
          }
        } else if (err.message.includes('reCAPTCHA')) {
          setError('reCAPTCHA error. Please refresh the page and try again.');
        } else {
          setError(err.message || 'Failed to send verification code.');
        }
        setIsLoading(false);

        // Cleanup reCAPTCHA on error
        if (window.recaptchaVerifier) {
          try {
            window.recaptchaVerifier.clear();
          } catch (e) { }
          window.recaptchaVerifier = null;
        }
      }
    } else if (authMethod === 'email') {
      if (!email || !password) {
        setError('Please enter both email and password');
        return;
      }
      setIsLoading(true);
      try {
        let user;
        if (isSignUp) {
          const result = await createUserWithEmailAndPassword(auth, email, password);
          user = result.user;
        } else {
          const result = await signInWithEmailAndPassword(auth, email, password);
          user = result.user;
        }

        // Wait a moment for Firestore auth state to sync
        await new Promise(resolve => setTimeout(resolve, 500));

        const userDocRef = doc(db, 'users', user.uid);
        let userDoc;
        try {
          userDoc = await getDoc(userDocRef);
        } catch (e: any) {
          if (e.code === 'permission-denied') {
            // Retry once after a longer delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            userDoc = await getDoc(userDocRef);
          } else {
            throw e;
          }
        }

        createSessionAndNavigate(!userDoc.exists());
      } catch (err: any) {
        console.error('Email auth error:', err);
        setError(err.message || 'Authentication failed.');
        setIsLoading(false);
      }
    }
  };

  const handleVerifyOtp = async () => {
    const otpString = otp.join('');
    if (otpString.length !== 6) {
      setError('Please enter a 6-digit code.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      if (confirmationResult?.isDemo) {
        await confirmationResult.confirm(otpString);
        return;
      }

      const result = await confirmationResult.confirm(otpString);
      const user = result.user;

      // Wait a moment for Firestore auth state to sync
      await new Promise(resolve => setTimeout(resolve, 500));

      const userDocRef = doc(db, 'users', user.uid);
      let userDoc;
      try {
        userDoc = await getDoc(userDocRef);
      } catch (e: any) {
        if (e.code === 'permission-denied') {
          // Retry once after a longer delay
          await new Promise(resolve => setTimeout(resolve, 1000));
          userDoc = await getDoc(userDocRef);
        } else {
          throw e;
        }
      }

      if (!userDoc.exists()) {
        createSessionAndNavigate(true);
        return;
      } else {
        createSessionAndNavigate(false);
      }
    } catch (err: any) {
      console.error('OTP verification error:', err);
      setError(err.message || 'Invalid verification code.');
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (isResending) return;
    setIsResending(true);
    setResendMessage('');
    setError('');
    try {
      if (window.recaptchaVerifier) {
        try {
          window.recaptchaVerifier.clear();
        } catch (e) { }
        window.recaptchaVerifier = null;
      }

      // Ensure the container is empty before creating a new one
      const container = document.getElementById('recaptcha-container');
      if (container) container.innerHTML = '';

      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible'
      });

      const phoneNumber = `${selectedCountry.code}${phone}`;
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
      setConfirmationResult(confirmation);
      setResendMessage(`Verification code sent to ${selectedCountry.code} ${phone}`);
      setTimeout(() => setResendMessage(''), 5000);
    } catch (err: any) {
      console.error('Resend error:', err);
      if (err.code === 'auth/billing-not-enabled') {
        setError('Phone authentication requires Firebase billing to be enabled. Please upgrade to the Blaze plan in your Firebase console.');
      } else if (err.code === 'auth/operation-not-allowed') {
        if (err.message.includes('region enabled')) {
          setError('SMS sending is restricted for this region. Please enable your country in the Firebase Console (Authentication > Settings > SMS Region Policy).');
        } else {
          setError('Phone Authentication is not enabled in your Firebase project. Please enable it in the Firebase Console.');
        }
      } else {
        setError(err.message || 'Failed to resend code.');
      }
      if (window.recaptchaVerifier) {
        try {
          window.recaptchaVerifier.clear();
        } catch (e) { }
        window.recaptchaVerifier = null;
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileData.firstName || !profileData.email) {
      setError("First name and email are required.");
      return;
    }
    setError('');
    setIsLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      createSessionAndNavigate(true);
    } catch (err: any) {
      setError(err.message || "Failed to save profile");
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (newOtp[index] !== '' && index < 5) {
      otpRefs[index + 1].current?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && otp[index] === '' && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };

  return (
    <div className="relative flex h-full min-h-screen w-full flex-col font-display overflow-hidden" style={{ backgroundColor: '#111111', color: '#F5F0E8' }}>

      {/* Background Texture/Gradient */}
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% -20%, #B5853F 0%, transparent 70%)' }}></div>

      {/* Header Section */}
      <div className="pt-20 pb-12 px-6 text-center z-10 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8 relative"
        >
          <div className="h-24 w-24 rounded-full border-2 border-[#B5853F] flex items-center justify-center relative overflow-hidden">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="material-symbols-outlined text-[#B5853F] text-5xl"
              style={{ fontVariationSettings: "'FILL' 0" }}
            >
              auto_awesome
            </motion.span>
          </div>
          <div className="absolute -inset-2 rounded-full border border-[#B5853F]/30 animate-pulse"></div>
        </motion.div>

        <h1 className="text-4xl font-serif mb-2 tracking-tight" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
          <span className="text-white">Zip</span><span style={{ color: '#B5853F' }}>RIGHT</span> {isSignUp ? 'Join' : 'Welcome'}
        </h1>
        <p className="text-[#F5F0E8]/60 text-sm tracking-wide uppercase font-medium">
          {authMethod === 'phone' ? 'Enter your mobile to begin' : 'Sign in with your credentials'}
        </p>
      </div>

      <div className="flex-1 flex flex-col px-8 z-10">
        <AnimatePresence mode="wait">
          {step === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-sm mx-auto w-full"
            >

              {/* Auth Method Toggle */}
              <div className="flex bg-white/5 p-1 rounded-full mb-10 border border-white/10">
                <button
                  onClick={() => setAuthMethod('phone')}
                  className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${authMethod === 'phone' ? 'bg-[#B5853F] text-white shadow-lg' : 'text-[#F5F0E8]/40'}`}
                >
                  Phone
                </button>
                <button
                  onClick={() => setAuthMethod('email')}
                  className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${authMethod === 'email' ? 'bg-[#B5853F] text-white shadow-lg' : 'text-[#F5F0E8]/40'}`}
                >
                  Email
                </button>
              </div>

              {authMethod === 'phone' ? (
                <div className="flex gap-4 mb-10 h-16 border-b border-white/20 focus-within:border-[#B5853F] transition-colors">
                  <div className="relative w-20">
                    <button
                      onClick={() => setShowCountryPicker(!showCountryPicker)}
                      className="flex h-full w-full items-center justify-center gap-2 bg-transparent text-lg font-bold text-[#B5853F]"
                    >
                      {selectedCountry.code}
                    </button>

                    {showCountryPicker && (
                      <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-[#1A1A1A] border border-white/10 rounded-2xl overflow-hidden shadow-2xl max-h-48 overflow-y-auto no-scrollbar">
                        {countryCodes.map(c => (
                          <button
                            key={c.iso}
                            onClick={() => { setSelectedCountry(c); setShowCountryPicker(false); }}
                            className="w-full text-left px-4 py-4 text-sm font-bold border-b border-white/5 last:border-none flex items-center gap-3 hover:bg-white/5"
                          >
                            <span className="text-[#B5853F]">{c.code}</span>
                            <span className="text-[#F5F0E8]/60 text-xs">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-1">
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        if (val.length <= selectedCountry.requiredLength) {
                          setPhone(val);
                        }
                      }}
                      placeholder="Mobile Number"
                      className="h-full w-full bg-transparent font-bold outline-none placeholder:text-white/20 text-white text-xl tracking-widest"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-6 mb-10">
                  <div className="border-b border-white/20 focus-within:border-[#B5853F] transition-colors">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email Address"
                      className="h-14 w-full bg-transparent font-bold outline-none placeholder:text-white/20 text-white text-lg"
                    />
                  </div>
                  <div className="border-b border-white/20 focus-within:border-[#B5853F] transition-colors">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="h-14 w-full bg-transparent font-bold outline-none placeholder:text-white/20 text-white text-lg"
                    />
                  </div>
                </div>
              )}

              {error && <p className="mb-6 text-center text-[10px] font-bold text-[#FF4D6D] uppercase tracking-widest">{error}</p>}

              <button
                onClick={handleContinue}
                disabled={isLoading}
                className="h-16 w-full rounded-full bg-[#B5853F] text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-[#B5853F]/20 flex items-center justify-center gap-2 mb-10 active:scale-95 transition-transform"
              >
                {isLoading ? (
                  <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (isSignUp ? 'Create Account' : 'Sign In')}
              </button>

              <div className="relative flex items-center justify-center mb-10">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <div className="relative bg-[#111111] px-6 text-[10px] text-white/30 font-black uppercase tracking-widest">Or continue with</div>
              </div>

              <div className="flex flex-col gap-4">
                <button
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                  className="relative flex h-16 w-full items-center justify-center rounded-full bg-white text-black shadow-xl active:scale-95 transition-transform"
                >
                  <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="h-6 w-6 absolute left-8" alt="G" />
                  <span className="font-black text-xs uppercase tracking-widest">Google</span>
                </button>
              </div>

              <div className="mt-10 text-center">
                <p className="text-xs font-medium text-white/40">
                  {isSignUp ? 'Already a member? ' : <>New to <span className="text-white">Zip</span><span className="text-[#B5853F]">RIGHT</span>? </>}
                  <button onClick={() => setIsSignUp(!isSignUp)} className="font-black text-[#B5853F] uppercase tracking-widest ml-1">
                    {isSignUp ? 'Log in' : 'Join now'}
                  </button>
                </p>
              </div>

              <p className="text-[9px] text-center text-white/20 mt-10 leading-relaxed max-w-[280px] mx-auto uppercase tracking-widest font-bold">
                By continuing you agree to our <span onClick={() => navigate('/terms-of-use')} className="text-white/40 cursor-pointer">Terms</span> & <span onClick={() => navigate('/privacy-policy')} className="text-white/40 cursor-pointer">Privacy</span>
              </p>

            </motion.div>
          )}

          {step === 'otp' && (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col items-center max-w-sm mx-auto w-full pt-10"
            >
              <h1 className="text-3xl font-serif text-[#B5853F] mb-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>Verify Phone</h1>
              <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-12 text-center">Code sent to {selectedCountry.code} {phone}</p>
              {confirmationResult?.isDemo && (
                <p className="text-[#C9A06C] text-[10px] font-black uppercase tracking-[0.25em] mb-6 text-center">
                  Demo OTP: 123456
                </p>
              )}

              <div className="flex justify-center gap-3 mb-12 w-full">
                {otp.map((digit, i) => (
                  <div key={i} className="flex-1 max-w-[48px] border-b-2 border-white/20 focus-within:border-[#B5853F] transition-colors">
                    <input
                      ref={otpRefs[i]}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      className="h-16 w-full bg-transparent text-center text-3xl font-bold outline-none text-white"
                      autoFocus={i === 0}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={handleVerifyOtp}
                className="h-16 w-full rounded-full bg-[#B5853F] text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-[#B5853F]/20 active:scale-95 transition-transform"
                disabled={isLoading}
              >
                {isLoading ? 'Verifying...' : 'Verify Code'}
              </button>

              <div className="mt-10 flex flex-col items-center gap-6">
                <button
                  onClick={handleResendCode}
                  disabled={isResending}
                  className="text-[10px] font-black text-[#B5853F] uppercase tracking-widest disabled:text-white/20"
                >
                  {isResending ? 'Sending...' : 'Resend Code'}
                </button>
                {resendMessage && <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">{resendMessage}</p>}

                <button onClick={handleBack} className="text-[10px] font-black text-white/30 uppercase tracking-widest">
                  Change Number
                </button>
              </div>
            </motion.div>
          )}

          {step === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-sm mx-auto w-full pt-4"
            >
              <h1 className="text-3xl font-serif text-[#B5853F] mb-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>Setup Profile</h1>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-10">
                Complete your fashion identity.
              </p>

              <div className="flex flex-col gap-8">
                <div className="border-b border-white/20 focus-within:border-[#B5853F] transition-colors">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 block">First Name</label>
                  <input
                    type="text"
                    value={profileData.firstName}
                    onChange={(e) => setProfileData({ ...profileData, firstName: e.target.value })}
                    className="w-full h-12 bg-transparent text-white font-bold outline-none placeholder:text-white/10"
                    placeholder="Enter your name"
                  />
                </div>

                <div className="border-b border-white/20 focus-within:border-[#B5853F] transition-colors">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 block">Email</label>
                  <input
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                    className="w-full h-12 bg-transparent text-white font-bold outline-none placeholder:text-white/10"
                    placeholder="Enter your email"
                  />
                </div>

                <div className="flex gap-6">
                  <div className="flex-1 border-b border-white/20 focus-within:border-[#B5853F] transition-colors">
                    <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 block">Date of Birth</label>
                    <input
                      type="date"
                      value={profileData.dob}
                      onChange={(e) => setProfileData({ ...profileData, dob: e.target.value })}
                      className="w-full h-12 bg-transparent text-white font-bold outline-none"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>

                  <div className="flex-1 border-b border-white/20 focus-within:border-[#B5853F] transition-colors">
                    <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 block">Gender</label>
                    <select
                      value={profileData.gender}
                      onChange={(e) => setProfileData({ ...profileData, gender: e.target.value })}
                      className="w-full h-12 bg-transparent text-white font-bold outline-none appearance-none"
                    >
                      <option value="" disabled className="bg-[#111111]">Select</option>
                      <option value="Male" className="bg-[#111111]">Male</option>
                      <option value="Female" className="bg-[#111111]">Female</option>
                      <option value="Non-Binary" className="bg-[#111111]">Non-Binary</option>
                      <option value="Other" className="bg-[#111111]">Other</option>
                    </select>
                  </div>
                </div>

                <div className="border-b border-white/20 opacity-50">
                  <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 block">Phone Number</label>
                  <div className="w-full h-12 flex items-center text-white/40 font-bold">
                    {selectedCountry.code} {phone}
                    <span className="material-symbols-outlined ml-auto text-emerald-500 text-lg">check_circle</span>
                  </div>
                </div>

                {error && <p className="text-center text-[10px] font-bold text-[#FF4D6D] uppercase tracking-widest">{error}</p>}
              </div>

              <button
                onClick={handleSaveProfile}
                disabled={isLoading}
                className="mt-12 h-16 w-full rounded-full bg-[#B5853F] text-white font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-[#B5853F]/20 active:scale-95 transition-transform"
              >
                {isLoading ? 'Creating Account...' : 'Finish Setup'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div id="recaptcha-container"></div>
    </div>
  );
};

export default Login;
