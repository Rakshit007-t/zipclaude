import React from 'react';
import { cn } from './cn';

type BadgeVariant = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Material Symbols icon name. */
  icon?: string;
  size?: 'sm' | 'md';
}

const variantClasses: Record<BadgeVariant, string> = {
  brand: 'bg-brand-soft text-brand',
  neutral: 'bg-surface-2 text-ink-soft border border-line',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** Small status label — sync states, seller status, engine used, etc. */
const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', icon, size = 'md', className, children, ...rest }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full font-semibold whitespace-nowrap',
      size === 'sm' ? 'h-5 px-2 text-[10px] gap-0.5' : 'h-6 px-2.5 text-[11px] gap-1',
      variantClasses[variant],
      className,
    )}
    {...rest}
  >
    {icon && (
      <span className="material-symbols-outlined" style={{ fontSize: size === 'sm' ? 11 : 13 }} aria-hidden="true">
        {icon}
      </span>
    )}
    {children}
  </span>
);

export default Badge;
