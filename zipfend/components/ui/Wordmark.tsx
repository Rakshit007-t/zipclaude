import React from 'react';
import { cn } from './cn';

interface WordmarkProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Force bone type for use on ink/imagery grounds. */
  inverted?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'text-[18px]',
  md: 'text-[24px]',
  lg: 'text-[34px]',
  xl: 'text-[46px]',
};

/**
 * The V2 brand lockup — Fraunces: a light italic "Zip" leaning into an
 * upright semibold "RIGHT", closed by an ultraviolet full stop.
 * One component so the mark is identical everywhere.
 */
const Wordmark: React.FC<WordmarkProps> = ({ size = 'md', inverted, className }) => (
  <span
    className={cn(
      'font-display select-none leading-none whitespace-nowrap',
      inverted ? 'text-ink-invert' : 'text-ink',
      sizeClasses[size],
      className,
    )}
  >
    <span className="italic font-light">Zip</span>
    <span className="font-semibold tracking-tight">RIGHT</span>
    <span className="text-brand font-semibold">.</span>
  </span>
);

export default Wordmark;
