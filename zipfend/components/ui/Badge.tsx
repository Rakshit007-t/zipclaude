import React from 'react';
import { cn } from './cn';

type BadgeVariant = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brass';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Material Symbols icon name. */
  icon?: string;
  size?: 'sm' | 'md';
}

const variantClasses: Record<BadgeVariant, string> = {
  brand: 'bg-brand-soft text-brand',
  neutral: 'bg-surface-2 text-ink-soft',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  /** Reward states — streaks, gold tiers, style score. */
  brass: 'bg-brass-soft text-brass',
};

/** Small status label — editorial uppercase tag. Sync states, seller status, engine used, etc. */
const Badge: React.FC<BadgeProps> = ({ variant = 'neutral', icon, size = 'md', className, children, ...rest }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-md font-semibold uppercase tracking-[0.08em] whitespace-nowrap',
      size === 'sm' ? 'h-5 px-1.5 text-[9px] gap-0.5' : 'h-6 px-2 text-[10px] gap-1',
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
