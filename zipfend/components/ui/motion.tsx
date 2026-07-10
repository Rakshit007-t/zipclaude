/**
 * MAISON motion system — shared physics, variants, and transition wrappers.
 * The voice: composed, confident, never busy. Entrances glide and settle;
 * bounce is reserved for genuine celebration. All JS-driven animation in the
 * app should come through here. Everything respects prefers-reduced-motion.
 */
import React from 'react';
import { motion, useReducedMotion, type Transition, type Variants } from 'motion/react';

export { motion, AnimatePresence, useReducedMotion } from 'motion/react';

/** Spring presets — the app's motion vocabulary. */
export const springs = {
  /** UI response: buttons, chips, toggles. Fast, no overshoot. */
  snappy: { type: 'spring', stiffness: 480, damping: 38, mass: 0.6 } as Transition,
  /** Panels, sheets, page elements. Composed glide with a quiet settle. */
  gentle: { type: 'spring', stiffness: 250, damping: 30, mass: 0.9 } as Transition,
  /** Hero reveals and editorial moments. Slow, luxurious decel. */
  luxe: { type: 'spring', stiffness: 150, damping: 26, mass: 1.1 } as Transition,
  /** Celebratory moments only (achievements, success). */
  bouncy: { type: 'spring', stiffness: 380, damping: 22, mass: 0.9 } as Transition,
};

export const durations = { fast: 0.15, base: 0.28, slow: 0.5 };

/** Standard entrance: rise + fade. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.base } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: springs.gentle },
};

/** Editorial reveal — longer travel, luxe physics. For heroes and headlines. */
export const reveal: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: springs.luxe },
};

/** Parent for staggered lists — children use `fadeUp`/`scaleIn`/`reveal`. */
export const staggerChildren = (delay = 0.06): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: delay } },
});

/**
 * Screen-level entrance wrapper. Wrap a screen's root to give it the app's
 * standard arrival (rise + fade). Renders a plain fade when the user prefers
 * reduced motion.
 */
export const PageTransition: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0.15 } : springs.gentle}
    >
      {children}
    </motion.div>
  );
};

/** List container that staggers its children in. */
export const StaggerList: React.FC<{
  children: React.ReactNode;
  className?: string;
  delay?: number;
}> = ({ children, className, delay = 0.06 }) => {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={staggerChildren(delay)} initial="hidden" animate="visible">
      {children}
    </motion.div>
  );
};

/** Item for use inside StaggerList. */
export const StaggerItem: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={fadeUp}>
      {children}
    </motion.div>
  );
};
