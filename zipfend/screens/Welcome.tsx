import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { auth } from '../firebase';
import Button from '../components/ui/Button';

/**
 * First-run hero. Theme-fixed dark (entry sequence is a brand moment).
 * Value-prop carousel uses native scroll-snap — gesture-driven, GPU-cheap.
 */

const slides = [
  {
    icon: 'view_in_ar',
    title: 'See it on you first',
    body: 'AI virtual try-on renders any garment on your own photo — before you buy.',
  },
  {
    icon: 'straighten',
    title: 'Your size, solved',
    body: 'One fit profile. Accurate size recommendations across every brand.',
  },
  {
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
    if (auth.currentUser) {
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
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: reduce
      ? { duration: 0.15 }
      : { delay, type: 'spring' as const, stiffness: 260, damping: 28 },
  });

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col overflow-hidden bg-surface-0 text-ink">
      {/* Layered ambient background */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 90% 55% at 50% -12%, rgba(97,87,255,0.22), transparent 68%)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 70% 40% at 85% 110%, rgba(97,87,255,0.10), transparent 70%)' }}
        />
      </div>

      {/* Wordmark */}
      <motion.div {...enter(0)} className="relative z-10 pt-safe px-8 pt-14">
        <span className="text-xl font-bold tracking-tighter text-[#6157FF] select-none">
          <span className="text-ink">Zip</span>RIGHT
        </span>
      </motion.div>

      {/* Editorial headline */}
      <div className="relative z-10 px-8 mt-10">
        <motion.h1
          {...enter(0.12)}
          className="font-sans text-[52px] leading-[1.02] tracking-tight text-ink"
        >
          Fit is
          <br />
          <em className="text-[#6157FF] font-sans">everything.</em>
        </motion.h1>
        <motion.p {...enter(0.24)} className="mt-5 max-w-[300px] text-[15px] leading-relaxed text-ink-soft">
          Try clothes on your own photo, get your true size in any brand, and dress with a stylist that knows you.
        </motion.p>
      </div>

      {/* Value-prop carousel */}
      <motion.div {...enter(0.36)} className="relative z-10 mt-auto pt-10">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          onPointerDown={() => (interacted.current = true)}
          className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar"
          aria-label="What ZipRIGHT does"
        >
          {slides.map((s) => (
            <div key={s.title} className="w-full shrink-0 snap-center px-8">
              <div className="flex items-start gap-4 rounded-card border border-line bg-surface-2 p-5 backdrop-blur-md">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#6157FF]/15">
                  <span className="material-symbols-outlined text-[#6157FF] text-[22px]" aria-hidden="true">
                    {s.icon}
                  </span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold tracking-tight text-ink">{s.title}</h2>
                  <p className="mt-1 text-[13px] leading-snug text-ink-soft">{s.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Dots */}
        <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? 'w-5 bg-[#6157FF]' : 'w-1.5 bg-surface-3'
              }`}
            />
          ))}
        </div>
      </motion.div>

      {/* CTAs */}
      <motion.div {...enter(0.48)} className="relative z-10 px-8 pb-10 pb-safe pt-8 flex flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          trailingIcon="arrow_forward"
          className="!bg-[#6157FF] !text-[#FFFFFF] hover:!bg-[#7C74FF] !shadow-[0_8px_32px_rgba(97,87,255,0.25)]"
          onClick={() => navigate('/login', { state: { isSignUp: true } })}
        >
          Get started
        </Button>
        <Button
          size="lg"
          fullWidth
          variant="ghost"
          className="!text-ink-soft hover:!bg-surface-2 hover:!text-ink"
          onClick={() => navigate('/login')}
        >
          I already have an account
        </Button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-faint">
          By continuing you agree to our{' '}
          <button onClick={() => navigate('/terms-of-use')} className="underline underline-offset-2 text-ink-soft">
            Terms
          </button>{' '}
          &{' '}
          <button onClick={() => navigate('/privacy-policy')} className="underline underline-offset-2 text-ink-soft">
            Privacy Policy
          </button>
        </p>
      </motion.div>
    </div>
  );
};

export default Welcome;
