import React from 'react';
import { cn } from './cn';

/** Circular brand spinner. Inherits color via currentColor. */
const Spinner: React.FC<{ size?: number; className?: string; 'aria-label'?: string }> = ({
  size = 20,
  className,
  ...rest
}) => (
  <svg
    role="status"
    aria-label={rest['aria-label'] ?? 'Loading'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={cn('animate-spin', className)}
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
    <path
      d="M22 12a10 10 0 0 0-10-10"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

export default Spinner;
