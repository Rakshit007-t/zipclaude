import React from 'react';
import { cn } from './cn';

interface ProgressRingProps {
  /** 0–100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** CSS color for the progress arc. Defaults to the brand gold. */
  color?: string;
  className?: string;
  /** Content rendered in the center (e.g. percentage, score). */
  children?: React.ReactNode;
  'aria-label'?: string;
}

/**
 * Animated circular progress — Fit Confidence, profile completion,
 * generation progress. The arc animates via CSS transition (GPU-cheap).
 */
const ProgressRing: React.FC<ProgressRingProps> = ({
  value,
  size = 96,
  strokeWidth = 7,
  color = 'var(--brand)',
  className,
  children,
  ...rest
}) => {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={rest['aria-label'] ?? 'Progress'}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s var(--ease-swift), stroke 0.3s' }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
};

export default ProgressRing;
