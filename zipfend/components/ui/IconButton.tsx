import React from 'react';
import { cn } from './cn';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Material Symbols icon name. */
  icon: string;
  /** Accessible name — required, icon-only buttons say nothing otherwise. */
  'aria-label': string;
  variant?: 'surface' | 'ghost' | 'brand' | 'overlay';
  size?: 'sm' | 'md' | 'lg';
  filled?: boolean;
}

const variantClasses = {
  surface: 'bg-surface-2 text-ink hover:bg-surface-3 border border-line',
  ghost: 'bg-transparent text-ink-soft hover:bg-surface-2 hover:text-ink',
  brand: 'bg-brand text-on-brand hover:bg-brand-strong',
  /** For use over imagery — translucent dark glass. */
  overlay: 'bg-black/40 text-white backdrop-blur-md hover:bg-black/55',
};

const sizeClasses = {
  sm: 'h-9 w-9 text-[18px]',
  md: 'h-11 w-11 text-[20px]',
  lg: 'h-12 w-12 text-[22px]',
};

/** Circular icon-only button with mandatory accessible label. */
const IconButton: React.FC<IconButtonProps> = ({
  icon,
  variant = 'surface',
  size = 'md',
  filled,
  className,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={cn(
      'inline-flex items-center justify-center rounded-full shrink-0 select-none',
      'transition-[transform,background-color] duration-150 ease-swift active:scale-[0.92]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
      'disabled:opacity-40 disabled:pointer-events-none',
      variantClasses[variant],
      sizeClasses[size],
      className,
    )}
    {...rest}
  >
    <span className={cn('material-symbols-outlined', filled && 'filled')} style={{ fontSize: 'inherit' }} aria-hidden="true">
      {icon}
    </span>
  </button>
);

export default IconButton;
