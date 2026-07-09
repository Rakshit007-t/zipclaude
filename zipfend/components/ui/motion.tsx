/**
 * Motion system — shared physics, variants, and transition wrappers.
 * All JS-driven animation in the app should come through here so the whole
 * product moves with one voice. Everything respects prefers-reduced-motion.
 */
import React from 'react';
import { motion, useReducedMotion, type Transition, type Variants } from 'motion/react';

export { motion, AnimatePresence, useReducedMotion } from 'motion/react';

/** Spring presets — the app's motion vocabulary. */
export const springs = {
  /** UI response: buttons, chips, toggles. Fast, no overshoot. */
  snappy: { type: 'spring', stiffness: 500, damping: 40, mass: 0.6 } as Transition,
  /** Panels, sheets, page elements. Composed, slight settle. */
  gentle: { type: 'spring', stiffness: 300, damping: 32, mass: 0.8 } as Transition,
  /** Celebratory moments only (achievements, success). */
  bouncy: { type: 'spring', stiffness: 380, damping: 22, mass: 0.9 } as Transition,
};

export const durations = { fast: 0.15, base: 0.25, slow: 0.4 };

/** Standard entrance: rise + fade. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.base } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: springs.gentle },
};

/** Parent for staggered lists — children use `fadeUp`/`scaleIn`. */
export const staggerChildren = (delay = 0.05): Variants => ({
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
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
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
}> = ({ children, className, delay = 0.05 }) => {
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
