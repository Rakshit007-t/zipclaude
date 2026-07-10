import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Brand splash. Purely presentational — App renders it while Firebase
 * resolves the auth state, so the wait is real, never artificial.
 * Deliberately theme-fixed (atelier night): the entry sequence is a cinematic
 * brand moment; the app becomes theme-aware after it. Colors are hard-coded
 * because this renders before the theme class settles.
 */
const Splash: React.FC = () => {
  const reduce = useReducedMotion();

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#12100d]">
      {/* Ambient ultraviolet dawn */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 85% 55% at 50% -12%, rgba(232,155,107,0.14), transparent 70%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0.01 : 1.4 }}
      />

      <div className="relative flex flex-col items-center">
        <motion.p
          className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[#f1ede3]/40 select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduce ? { duration: 0.01 } : { delay: 0.15, duration: 0.8 }}
        >
          The Fit Atelier
        </motion.p>

        <motion.h1
          className="mt-4 font-display text-[46px] leading-none text-[#f1ede3] select-none"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 150, damping: 26, mass: 1.1, delay: 0.3 }}
        >
          <span className="italic font-light">Zip</span>
          <span className="font-semibold tracking-tight">RIGHT</span>
          <span className="text-[#e89b6b] font-semibold">.</span>
        </motion.h1>

        {/* Hairline draws in beneath the mark */}
        <motion.div
          aria-hidden="true"
          className="mt-7 h-px w-40 origin-center"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(241,237,227,0.35), transparent)' }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={reduce ? { duration: 0.01 } : { delay: 0.7, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
};

export default Splash;
