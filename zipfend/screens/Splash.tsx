import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Brand splash. Purely presentational — App renders it while Firebase
 * resolves the auth state, so the wait is real, never artificial.
 * Deliberately theme-fixed (dark atelier): the entry sequence is a cinematic
 * brand moment; the app becomes theme-aware after it.
 */
const Splash: React.FC = () => {
  const reduce = useReducedMotion();

  return (
    <div className="relative flex min-h-screen min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-surface-0">
      {/* Ambient glow */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(97,87,255,0.18), transparent 70%)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0.01 : 1.2 }}
      />

      <div className="relative flex flex-col items-center">
        <motion.h1
          className="text-5xl font-bold tracking-tighter text-[#6157FF] select-none"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <span className="text-ink">Zip</span>RIGHT
        </motion.h1>

        {/* Gold underline draws in */}
        <motion.div
          aria-hidden="true"
          className="mt-2 h-[3px] w-24 origin-left rounded-full bg-gradient-to-r from-[#6157FF] to-[#8A6530] self-end"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={reduce ? { duration: 0.01 } : { delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />

        <motion.p
          className="mt-5 text-[12px] font-bold text-ink-soft"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduce ? { duration: 0.01 } : { delay: 0.55, duration: 0.6 }}
        >
          AI Fashion Tech
        </motion.p>
      </div>
    </div>
  );
};

export default Splash;
