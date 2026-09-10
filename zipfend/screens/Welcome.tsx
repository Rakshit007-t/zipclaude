import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { auth } from '../firebase';
import { requiresEmailVerification } from '../services/authClient';
import { Button, Wordmark } from '../components/ui';

/**
 * First-run cover page — an editorial manifesto, not a feature pitch.
 * Value-prop carousel uses native scroll-snap — gesture-driven, GPU-cheap.
 */

const slides = [
  {
    no: '01',
    icon: 'view_in_ar',
    title: 'See it on you first',
    body: 'AI virtual try-on renders any garment on your own photo — before you buy.',
  },
  {
    no: '02',
    icon: 'straighten',
    title: 'Your size, solved',
    body: 'One fit profile. Accurate size recommendations across every brand.',
  },
  {
    no: '03',
    icon: 'auto_awesome',
    title: 'A stylist that knows you',
    body: 'Personal AI styling built around your body, taste, and wardrobe.',
  },
];

const Welcome: React.FC = () => {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const user = auth.currentUser;
    if (user && !user.isAnonymous && !requiresEmailVerification(user)) {
      navigate('/home');
    }
  }, [navigate]);

  // Track which slide is in view for the dots
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  // Gentle auto-advance until the user interacts
  const interacted = useRef(false);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      const el = scrollerRef.current;
      if (!el || interacted.current) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, 3800);
    return () => clearInterval(id);
  }, [reduce]);

  const enter = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: reduce
      ? { duration: 0.15 }
      : { delay, type: 'spring' as const, stiffness: 170, damping: 26 },
  });

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col overflow-hidden bg-surface-0 text-ink">
      {/* Faint ultraviolet atmosphere at the crown */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 90% 45% at 50% -14%, var(--brand-soft), transparent 70%)' }}
        />
      </div>

      {/* Masthead */}
      <motion.div {...enter(0)} className="relative z-10 pt-safe px-8 pt-12 flex items-center justify-between">
        <Wordmark size="sm" />
        <span className="eyebrow">Est. for fit</span>
      </motion.div>

      {/* Manifesto headline */}
      <div className="relative z-10 px-8 mt-12">
        <motion.p {...enter(0.1)} className="eyebrow mb-4">
          The Fit Atelier
        </motion.p>
        <motion.h1
          {...enter(0.18)}
          className="font-display text-[54px] leading-[1.04] text-ink font-light"
        >
          Fit is
          <br />
          <em className="font-medium text-brand">everything.</em>
        </motion.h1>
        <motion.p {...enter(0.3)} className="mt-6 max-w-[300px] text-[15px] leading-relaxed text-ink-soft">
          Try clothes on your own photo, get your true size in any brand, and dress with a stylist that knows you.
        </motion.p>
      </div>

      {/* Value-prop carousel */}
      <motion.div {...enter(0.42)} className="relative z-10 mt-auto pt-10">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          onPointerDown={() => (interacted.current = true)}
          className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar"
          aria-label="What ZipRIGHT does"
        >
          {slides.map((s) => (
            <div key={s.title} className="w-full shrink-0 snap-center px-8">
              <div className="flex items-start gap-4 rounded-card border border-line bg-surface-1 p-5">
                <span className="font-display italic text-[22px] leading-none text-ink-faint pt-0.5 select-none" aria-hidden="true">
                  {s.no}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold text-ink">{s.title}</h2>
                  <p className="mt-1 text-[13px] leading-snug text-ink-soft">{s.body}</p>
                </div>
                <span className="material-symbols-outlined text-brand text-[20px] shrink-0" aria-hidden="true">
                  {s.icon}
                </span>
              </div>
            </div>
          ))}
        </div>
        {/* Dots */}
        <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === active ? 'w-6 bg-ink' : 'w-1.5 bg-line-strong'
              }`}
            />
          ))}
        </div>
      </motion.div>

      {/* CTAs */}
      <motion.div {...enter(0.54)} className="relative z-10 px-8 pb-10 pb-safe pt-8 flex flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          trailingIcon="arrow_forward"
          onClick={() => navigate('/login', { state: { isSignUp: true } })}
        >
          Get started
        </Button>
        <Button
          size="lg"
          fullWidth
          variant="ghost"
          onClick={() => navigate('/login')}
        >
          I already have an account
        </Button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-faint">
          By continuing you agree to our{' '}
          <button onClick={() => navigate('/terms-of-use')} className="underline underline-offset-2 text-ink-soft">
            Terms
          </button>
          ,{' '}
          <button onClick={() => navigate('/privacy-policy')} className="underline underline-offset-2 text-ink-soft">
            Privacy
          </button>
          ,{' '}
          <button onClick={() => navigate('/cookie-policy')} className="underline underline-offset-2 text-ink-soft">
            Cookies
          </button>
          {' '}&{' '}
          <button onClick={() => navigate('/refund-policy')} className="underline underline-offset-2 text-ink-soft">
            Refunds
          </button>
        </p>
      </motion.div>
    </div>
  );
};

export default Welcome;
