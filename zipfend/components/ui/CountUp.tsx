import React, { useEffect, useRef, useState } from 'react';

/**
 * Animated number that counts up to `value` when it first appears or the
 * value changes. Honors prefers-reduced-motion by jumping straight to the
 * final value. rAF-driven — no re-render storm, no layout thrash.
 */
const CountUp: React.FC<{ value: number; durationMs?: number; className?: string }> = ({
  value,
  durationMs = 800,
  className,
}) => {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(value)) {
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return <span className={className}>{display.toLocaleString()}</span>;
};

export default CountUp;
