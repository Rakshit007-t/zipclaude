import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  sendPasswordResetEmail,
  sendEmailVerification,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Button, Wordmark } from '../components/ui';
import { formatFirebaseAuthError } from '../utils/firebaseErrors';
import { requiresEmailVerification } from '../services/authClient';

declare global {
  interface Window {
    google: any;
    recaptchaVerifier: any;
  }
}

type AuthStep = 'input' | 'otp' | 'profile' | 'forgot-password' | 'email-verify';

const PHONE_AUTH_ENABLED = true;

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
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState('');
  const [passwordResetMessage, setPasswordResetMessage] = useState('');
  const [error, setError] = useState('');

  const firebasePhoneErrorMessage = (err: unknown, fallback: string) => {
    return formatFirebaseAuthError(err, fallback);
  };

  const firebaseEmailErrorMessage = (err: unknown, fallback: string) => {
    return formatFirebaseAuthError(err, fallback);
  };

  function clearRecaptchaVerifier() {
    if (!window.recaptchaVerifier) return;
    try {
      window.recaptchaVerifier.clear();
    } catch (recaptchaError) {
      console.warn('Unable to clear the previous reCAPTCHA verifier:', recaptchaError);
    }
    window.recaptchaVerifier = null;
  }

  function createRecaptchaVerifier() {
    clearRecaptchaVerifier();
    const container = document.getElementById('recaptcha-container');
    if (!container) {
      throw new Error('reCAPTCHA could not be initialized. Refresh the page and try again.');
    }
    container.replaceChildren();
    window.recaptchaVerifier = new RecaptchaVerifier(auth, container, {
      size: 'invisible',
      'expired-callback': () => {
        clearRecaptchaVerifier();
        setError('reCAPTCHA expired. Please try again.');
      },
    });
    return window.recaptchaVerifier;
  }

  function getPasswordResetActionCodeSettings() {
    const configuredUrl = import.meta.env.VITE_PASSWORD_RESET_CONTINUE_URL?.trim();
    const url = configuredUrl || `${window.location.origin}/#/login?passwordReset=complete`;
    const redirectUrl = new URL(url);
    if (!['https:', 'http:'].includes(redirectUrl.protocol)) {
      throw new Error('Password reset redirect URL must use HTTP or HTTPS.');
    }
    return { url: redirectUrl.toString(), handleCodeInApp: false };
  }

  // Reset phone if it exceeds length when country changes
  useEffect(() => {
    if (phone.length > selectedCountry.requiredLength) {
      setPhone(phone.substring(0, selectedCountry.requiredLength));
    }
  }, [selectedCountry, phone]);

  // Clear recaptchaVerifier on unmount to prevent "reCAPTCHA client element has been removed" error
  useEffect(() => {
    return () => {
      clearRecaptchaVerifier();
    };
  }, []);

  // Auto-detect if current user session requires email verification
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (currentUser && requiresEmailVerification(currentUser)) {
      setEmail(currentUser.email || '');
      setStep('email-verify');
    }
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const createSessionAndNavigate = async (requiresProfile = false) => {
    setIsLoading(false);
    navigate(requiresProfile ? '/fit-profile' : '/home', { replace: true });
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

  const handleForgotPassword = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('Enter your email address to reset your password.');
      return;
    }

    setError('');
    setPasswordResetMessage('');
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, normalizedEmail, getPasswordResetActionCodeSettings());
      // Do not reveal whether this email belongs to an account.
      setPasswordResetMessage('If an account exists for this email, a password reset link has been sent.');
    } catch (err: any) {
      console.error('Password reset error:', err);
      if (err?.code === 'auth/invalid-email') {
        setError('Enter a valid email address.');
      } else if (err?.code === 'auth/too-many-requests') {
        setError('Too many reset requests. Please wait a moment and try again.');
      } else {
        setError('Unable to send a reset link right now. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
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
        const phoneNumber = `${selectedCountry.code}${phone}`;
        const confirmation = await signInWithPhoneNumber(auth, phoneNumber, createRecaptchaVerifier());
        setConfirmationResult(confirmation);
        setIsLoading(false);
        setStep('otp');
      } catch (err: any) {
        console.error('SMS sending error:', err);
        setError(firebasePhoneErrorMessage(err, 'Failed to send a verification code.'));
        setIsLoading(false);
        clearRecaptchaVerifier();
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
          try {
            await sendEmailVerification(user);
          } catch (verr) {
            console.warn('Send email verification warning:', verr);
          }

          const userDocRef = doc(db, 'users', user.uid);
          const defaultUsername = `user_${user.uid.replace(/[-_]/g, '').slice(0, 8).toLowerCase()}`;
          await setDoc(userDocRef, {
            uid: user.uid,
            email: user.email,
            emailVerified: false,
            username: defaultUsername,
            displayName: '',
            onboardingCompleted: true,
            fitProfileCompleted: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });

          setIsLoading(false);
          setStep('email-verify');
          return;
        } else {
          const result = await signInWithEmailAndPassword(auth, email, password);
          user = result.user;
          await user.reload();

          if (!user.emailVerified) {
            setIsLoading(false);
            setStep('email-verify');
            return;
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        const userDocRef = doc(db, 'users', user.uid);
        let userDoc;
        try {
          userDoc = await getDoc(userDocRef);
        } catch (e: any) {
          if (e.code === 'permission-denied') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            userDoc = await getDoc(userDocRef);
          } else {
            throw e;
          }
        }

        createSessionAndNavigate(!userDoc.exists() || !userDoc.data()?.fitProfileCompleted);
      } catch (err: any) {
        console.error('Email auth error:', err);
        setError(firebaseEmailErrorMessage(err, 'Authentication failed.'));
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
      if (!confirmationResult) {
        throw new Error('Request a new verification code and try again.');
      }

      const result = await confirmationResult.confirm(otpString);
      const user = result.user;

      await new Promise(resolve => setTimeout(resolve, 500));

      const userDocRef = doc(db, 'users', user.uid);
      let userDoc;
      try {
        userDoc = await getDoc(userDocRef);
      } catch (e: any) {
        if (e.code === 'permission-denied') {
          await new Promise(resolve => setTimeout(resolve, 1000));
          userDoc = await getDoc(userDocRef);
        } else {
          throw e;
        }
      }

      if (!userDoc.exists()) {
        const defaultUsername = `user_${user.uid.replace(/[-_]/g, '').slice(0, 8).toLowerCase()}`;
        await setDoc(userDocRef, {
          uid: user.uid,
          phoneNumber: user.phoneNumber,
          username: defaultUsername,
          displayName: '',
          onboardingCompleted: true,
          fitProfileCompleted: false,
          usage: { tryOns: 0 },
          walletBalanceRupees: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        createSessionAndNavigate(true);
        return;
      } else {
        createSessionAndNavigate(!userDoc.data()?.fitProfileCompleted);
      }
    } catch (err: any) {
      console.error('OTP verification error:', err);
      setError(firebasePhoneErrorMessage(err, 'Invalid verification code.'));
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (isResending || resendCooldown > 0) return;
    setIsResending(true);
    setResendMessage('');
    setError('');
    try {
      if (!PHONE_AUTH_ENABLED) {
        throw new Error('Phone sign-in is not enabled for this environment.');
      }

      const phoneNumber = `${selectedCountry.code}${phone}`;
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, createRecaptchaVerifier());
      setConfirmationResult(confirmation);
      setResendMessage(`Verification code sent to ${selectedCountry.code} ${phone}`);
      setResendCooldown(30);
      setTimeout(() => setResendMessage(''), 5000);
    } catch (err: any) {
      console.error('Resend error:', err);
      setError(firebasePhoneErrorMessage(err, 'Failed to resend the verification code.'));
      clearRecaptchaVerifier();
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

  /** Editorial underline field — the login form's signature control. */
  const underlineField = 'border-b border-line-strong focus-within:border-ink transition-colors duration-200';

  return (
    <div className="relative flex h-full min-h-screen min-h-dvh w-full flex-col bg-surface-0 text-ink overflow-hidden">
      {/* Faint ultraviolet atmosphere */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 90% 40% at 50% -12%, var(--brand-soft), transparent 70%)' }}
      />

      {/* Masthead */}
      <div className="relative z-10 pt-safe px-6 pt-6 flex items-center justify-between">
        <button
          onClick={handleBack}
          aria-label="Go back"
          className="h-10 w-10 rounded-full border border-line flex items-center justify-center text-ink-soft active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-[19px]" aria-hidden="true">arrow_back</span>
        </button>
        <Wordmark size="sm" />
        <div className="w-10" aria-hidden="true" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col px-8 pt-10 pb-10 pb-safe">
        <AnimatePresence mode="wait">
          {step === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-sm mx-auto w-full"
            >
              {/* Headline */}
              <p className="eyebrow mb-3">{isSignUp ? 'New membership' : 'Members'}</p>
              <h1 className="font-display text-[36px] leading-[1.06] font-light mb-2">
                {isSignUp ? <>Join the <em className="font-medium">atelier.</em></> : <>Welcome <em className="font-medium">back.</em></>}
              </h1>
              <p className="text-ink-soft text-[13.5px] mb-10">
                {authMethod === 'phone' ? 'Enter your mobile number to begin.' : 'Sign in with your credentials.'}
              </p>

              {/* Auth method tabs — sliding underline */}
              <div className="flex gap-8 mb-8 border-b border-line" role="tablist" aria-label="Sign-in method">
                {(['phone', 'email'] as const).map((method) => (
                  <button
                    key={method}
                    role="tab"
                    aria-selected={authMethod === method}
                    onClick={() => setAuthMethod(method)}
                    className={`relative pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                      authMethod === method ? 'text-ink' : 'text-ink-faint'
                    }`}
                  >
                    {method}
                    {authMethod === method && (
                      <motion.span
                        layoutId="auth-method-underline"
                        className="absolute -bottom-px left-0 right-0 h-[2px] bg-ink"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>

              {authMethod === 'phone' ? (
                <div className={`flex gap-4 mb-10 h-14 ${underlineField}`}>
                  <div className="relative w-20">
                    <button
                      onClick={() => setShowCountryPicker(!showCountryPicker)}
                      aria-label={`Country code ${selectedCountry.code} ${selectedCountry.name}. Tap to change`}
                      aria-expanded={showCountryPicker}
                      className="flex h-full w-full items-center justify-start gap-1 bg-transparent text-[18px] font-medium text-ink"
                    >
                      {selectedCountry.code}
                      <span className="material-symbols-outlined text-[16px] text-ink-faint" aria-hidden="true">expand_more</span>
                    </button>

                    {showCountryPicker && (
                      <div
                        className="fixed inset-0 z-40"
                        aria-hidden="true"
                        onClick={() => setShowCountryPicker(false)}
                      />
                    )}
                    {showCountryPicker && (
                      <div className="absolute top-full left-0 w-56 mt-2 z-50 bg-surface-1 border border-line rounded-2xl overflow-hidden shadow-float max-h-52 overflow-y-auto no-scrollbar">
                        {countryCodes.map(c => (
                          <button
                            key={c.iso}
                            onClick={() => { setSelectedCountry(c); setShowCountryPicker(false); }}
                            className="w-full text-left px-4 py-3.5 border-b border-line last:border-none flex items-center gap-3 hover:bg-surface-2"
                          >
                            <span className="text-ink font-medium text-[14px]">{c.code}</span>
                            <span className="text-ink-faint text-[12px]">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-1">
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      aria-label="Mobile number"
                      value={phone}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        if (val.length <= selectedCountry.requiredLength) {
                          setPhone(val);
                        }
                      }}
                      placeholder="Mobile number"
                      className="h-full w-full bg-transparent font-medium outline-none placeholder:text-ink-faint text-ink text-[18px] tracking-wide"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-6 mb-10">
                  <div className={underlineField}>
                    <input
                      type="email"
                      autoComplete="email"
                      aria-label="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email address"
                      className="h-14 w-full bg-transparent font-medium outline-none placeholder:text-ink-faint text-ink text-[16px]"
                    />
                  </div>
                  <div className={underlineField}>
                    <input
                      type="password"
                      autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      aria-label="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="h-14 w-full bg-transparent font-medium outline-none placeholder:text-ink-faint text-ink text-[16px]"
                    />
                  </div>
                </div>
              )}

              {authMethod === 'email' && !isSignUp && (
                <button
                  type="button"
                  onClick={() => { setError(''); setPasswordResetMessage(''); setStep('forgot-password'); }}
                  className="-mt-5 mb-7 block ml-auto text-[12px] font-semibold text-ink underline underline-offset-4"
                >
                  Forgot Password?
                </button>
              )}

              {error && (
                <p role="alert" className="mb-6 text-center text-[13px] font-medium leading-snug text-danger">
                  {error}
                </p>
              )}

              <Button
                size="lg"
                fullWidth
                loading={isLoading}
                onClick={handleContinue}
                className="mb-8"
              >
                {isSignUp ? 'Create account' : 'Sign in'}
              </Button>

              <div className="flex items-center gap-4 mb-8" aria-hidden="true">
                <div className="h-px bg-line flex-1" />
                <span className="eyebrow !text-[9px]">Or continue with</span>
                <div className="h-px bg-line flex-1" />
              </div>

              <button
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="relative flex h-[54px] w-full items-center justify-center rounded-full bg-surface-1 border border-line-strong text-ink active:scale-[0.97] transition-transform disabled:opacity-50 hover:bg-surface-2"
              >
                {/* Inline Google mark — no external image dependency */}
                <svg className="h-5 w-5 absolute left-7" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3a7.24 7.24 0 0 1-10.78-3.8H1.29v3.1A12 12 0 0 0 12 24z" />
                  <path fill="#FBBC05" d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.29a12 12 0 0 0 0 10.78l3.99-3.1z" />
                  <path fill="#EA4335" d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.97 11.97 0 0 0 1.29 6.6l3.99 3.1A7.24 7.24 0 0 1 12 4.77z" />
                </svg>
                <span className="font-semibold uppercase tracking-[0.1em] text-[12px]">Continue with Google</span>
              </button>

              <div className="mt-10 text-center">
                <p className="text-[13px] text-ink-soft">
                  {isSignUp ? 'Already a member? ' : 'New to ZipRIGHT? '}
                  <button onClick={() => setIsSignUp(!isSignUp)} className="font-semibold text-ink underline underline-offset-4 ml-1">
                    {isSignUp ? 'Log in' : 'Join now'}
                  </button>
                </p>
              </div>

              <p className="text-[11px] text-center text-ink-faint mt-8 leading-relaxed max-w-[280px] mx-auto">
                By continuing you agree to our{' '}
                <span onClick={() => navigate('/terms-of-use')} className="text-ink-soft cursor-pointer underline underline-offset-2">Terms</span> &{' '}
                <span onClick={() => navigate('/privacy-policy')} className="text-ink-soft cursor-pointer underline underline-offset-2">Privacy</span>
              </p>
            </motion.div>
          )}

          {step === 'otp' && (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col max-w-sm mx-auto w-full pt-6"
            >
              <p className="eyebrow mb-3">Verification</p>
              <h1 className="font-display text-[36px] leading-[1.06] font-light mb-2">
                Check your <em className="font-medium">phone.</em>
              </h1>
              <p className="text-ink-soft text-[13.5px] mb-2">
                Code sent to {selectedCountry.code} {phone}
              </p>
              <div className="flex justify-between gap-2.5 mt-8 mb-10 w-full">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={otpRefs[i]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Verification code digit ${i + 1}`}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="h-14 w-full min-w-0 rounded-ctl bg-surface-1 border border-line text-center font-display text-[24px] font-medium outline-none text-ink focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow]"
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              {error && (
                <p role="alert" className="mb-6 -mt-4 text-center text-[13px] font-medium leading-snug text-danger">
                  {error}
                </p>
              )}

              <Button size="lg" fullWidth loading={isLoading} onClick={handleVerifyOtp}>
                Verify code
              </Button>

              <div className="mt-10 flex flex-col items-center gap-5">
                <button
                  onClick={handleResendCode}
                  disabled={isResending || resendCooldown > 0}
                  className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink underline underline-offset-4 disabled:text-ink-faint disabled:no-underline"
                >
                  {isResending ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
                {resendMessage && <p className="text-[12px] text-success font-medium">{resendMessage}</p>}

                <button onClick={handleBack} className="text-[12px] font-medium text-ink-faint">
                  Change number
                </button>
              </div>
            </motion.div>
          )}

          {step === 'profile' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-sm mx-auto w-full pt-2"
            >
              <p className="eyebrow mb-3">Almost there</p>
              <h1 className="font-display text-[36px] leading-[1.06] font-light mb-2">
                Introduce <em className="font-medium">yourself.</em>
              </h1>
              <p className="text-ink-soft text-[13.5px] mb-10">
                Complete your fashion identity.
              </p>

              <div className="flex flex-col gap-7">
                <div className={underlineField}>
                  <label className="eyebrow !text-[9px] mb-1 block">First name</label>
                  <input
                    type="text"
                    value={profileData.firstName}
                    onChange={(e) => setProfileData({ ...profileData, firstName: e.target.value })}
                    className="w-full h-11 bg-transparent text-ink font-medium outline-none placeholder:text-ink-faint text-[16px]"
                    placeholder="Enter your name"
                  />
                </div>

                <div className={underlineField}>
                  <label className="eyebrow !text-[9px] mb-1 block">Email</label>
                  <input
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                    className="w-full h-11 bg-transparent text-ink font-medium outline-none placeholder:text-ink-faint text-[16px]"
                    placeholder="Enter your email"
                  />
                </div>

                <div className="flex gap-6">
                  <div className={`flex-1 ${underlineField}`}>
                    <label className="eyebrow !text-[9px] mb-1 block">Date of birth</label>
                    <input
                      type="date"
                      value={profileData.dob}
                      onChange={(e) => setProfileData({ ...profileData, dob: e.target.value })}
                      className="w-full h-11 bg-transparent text-ink font-medium outline-none text-[15px]"
                    />
                  </div>

                  <div className={`flex-1 ${underlineField}`}>
                    <label className="eyebrow !text-[9px] mb-1 block">Gender</label>
                    <select
                      value={profileData.gender}
                      onChange={(e) => setProfileData({ ...profileData, gender: e.target.value })}
                      className="w-full h-11 bg-transparent text-ink font-medium outline-none appearance-none text-[15px]"
                    >
                      <option value="" disabled>Select</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Non-Binary">Non-Binary</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="border-b border-line opacity-60">
                  <label className="eyebrow !text-[9px] mb-1 block">Phone number</label>
                  <div className="w-full h-11 flex items-center text-ink-soft font-medium text-[15px]">
                    {selectedCountry.code} {phone}
                    <span className="material-symbols-outlined filled ml-auto text-success text-[18px]" aria-hidden="true">check_circle</span>
                  </div>
                </div>

                {error && <p role="alert" className="text-center text-[12px] font-medium text-danger">{error}</p>}
              </div>

              <Button size="lg" fullWidth loading={isLoading} onClick={handleSaveProfile} className="mt-12">
                Finish setup
              </Button>
            </motion.div>
          )}

          {step === 'forgot-password' && (
            <motion.div
              key="forgot-password"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-sm mx-auto w-full pt-6"
            >
              <p className="eyebrow mb-3">Password reset</p>
              <h1 className="font-display text-[36px] leading-[1.06] font-light mb-2">
                Reset your <em className="font-medium">password.</em>
              </h1>
              <p className="text-ink-soft text-[13.5px] mb-10">
                We’ll email you a secure link to choose a new password.
              </p>

              <div className={`${underlineField} mb-7`}>
                <label className="eyebrow !text-[9px] mb-1 block">Email address</label>
                <input
                  type="email"
                  autoComplete="email"
                  aria-label="Email address for password reset"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="h-14 w-full bg-transparent font-medium outline-none placeholder:text-ink-faint text-ink text-[16px]"
                />
              </div>

              {error && <p role="alert" className="mb-5 text-center text-[13px] font-medium text-danger">{error}</p>}
              {passwordResetMessage && <p role="status" className="mb-5 text-center text-[13px] font-medium text-success">{passwordResetMessage}</p>}

              <Button size="lg" fullWidth loading={isLoading} onClick={handleForgotPassword}>
                Send reset link
              </Button>
              <button onClick={handleBack} className="mt-7 w-full text-[12px] font-semibold text-ink underline underline-offset-4">
                Back to sign in
              </button>
            </motion.div>
          )}

          {step === 'email-verify' && (
            <motion.div
              key="email-verify"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="max-w-sm mx-auto w-full pt-6 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center mx-auto mb-6">
                <span className="material-symbols-outlined text-brand text-[32px]">mark_email_unread</span>
              </div>
              <p className="eyebrow mb-2">Email Verification</p>
              <h1 className="font-display text-[32px] leading-[1.08] font-light mb-3">
                Verify your <em className="font-medium">email.</em>
              </h1>
              <p className="text-ink-soft text-[13.5px] leading-relaxed mb-8">
                We sent a verification link to <strong className="text-ink font-medium">{email || auth.currentUser?.email}</strong>. Please verify your email to access ZipRIGHT.
              </p>

              {resendMessage && (
                <p className="mb-5 text-center text-[13px] font-medium text-success bg-success/10 p-3 rounded-xl border border-success/20">
                  {resendMessage}
                </p>
              )}
              {error && (
                <p role="alert" className="mb-5 text-center text-[13px] font-medium text-danger bg-danger/10 p-3 rounded-xl border border-danger/20">
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-3">
                <Button
                  size="lg"
                  fullWidth
                  loading={isLoading}
                  onClick={async () => {
                    setIsLoading(true);
                    setError('');
                    try {
                      await auth.currentUser?.reload();
                      const currentUser = auth.currentUser;
                      if (currentUser?.emailVerified) {
                        const userDocRef = doc(db, 'users', currentUser.uid);
                        const userDoc = await getDoc(userDocRef);
                        await setDoc(userDocRef, { emailVerified: true }, { merge: true });
                        createSessionAndNavigate(!userDoc.exists() || !userDoc.data()?.fitProfileCompleted);
                      } else {
                        setError('Email is not verified yet. Please check your inbox and click the verification link.');
                      }
                    } catch (e: any) {
                      setError(e.message || 'Verification check failed.');
                    } finally {
                      setIsLoading(false);
                    }
                  }}
                >
                  Refresh Verification Status
                </Button>

                <Button
                  variant="outline"
                  fullWidth
                  disabled={isResending || resendCooldown > 0}
                  onClick={async () => {
                    if (!auth.currentUser) return;
                    setIsResending(true);
                    setError('');
                    setResendMessage('');
                    try {
                      await sendEmailVerification(auth.currentUser);
                      setResendMessage('Verification email sent! Please check your inbox.');
                      setResendCooldown(30);
                    } catch (e: any) {
                      setError(e.message || 'Unable to send verification email.');
                    } finally {
                      setIsResending(false);
                    }
                  }}
                >
                  {isResending ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification Email'}
                </Button>
              </div>

              <button
                onClick={async () => {
                  try { await auth.signOut(); } catch {}
                  setStep('input');
                }}
                className="mt-8 text-[12px] font-semibold text-ink-faint hover:text-ink underline underline-offset-4"
              >
                Sign in with another account
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
