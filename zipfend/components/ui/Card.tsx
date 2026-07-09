import React from 'react';
import { cn } from './cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** surface = flat card; elevated = lifted card; inset = recessed panel. */
  variant?: 'surface' | 'elevated' | 'inset';
  /** Adds press feedback + pointer cursor. Pass onClick alongside. */
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const variantClasses = {
  surface: 'bg-surface-1 border border-line',
  elevated: 'bg-surface-1 border border-line shadow-lift',
  inset: 'bg-surface-2 border border-transparent',
};

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

/** Rounded content card. The base surface for everything in the app. */
const Card: React.FC<CardProps> = ({
  variant = 'surface',
  interactive,
  padding = 'md',
  className,
  children,
  ...rest
}) => (
  <div
    {...(interactive && rest.onClick
      ? { role: 'button', tabIndex: 0, onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            (rest.onClick as React.MouseEventHandler<HTMLDivElement>)?.(e as unknown as React.MouseEvent<HTMLDivElement>);
          }
        } }
      : {})}
    className={cn(
      'rounded-card overflow-hidden',
      variantClasses[variant],
      paddingClasses[padding],
      interactive &&
        'cursor-pointer transition-[transform,background-color,box-shadow] duration-150 ease-swift active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
);

export default Card;
