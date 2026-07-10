import React from 'react';
import { cn } from './cn';
import Spinner from './Spinner';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  /** Material Symbols icon name rendered before the label. */
  icon?: string;
  /** Material Symbols icon name rendered after the label. */
  trailingIcon?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  /** The MAISON primary: solid ink, bone type. Quietly absolute. */
  primary: 'bg-ink text-ink-invert hover:bg-ink/90',
  /** Ultraviolet — reserved for the single most important action on a screen. */
  accent: 'bg-brand text-on-brand hover:bg-brand-strong shadow-glow disabled:shadow-none',
  secondary: 'bg-surface-2 text-ink hover:bg-surface-3',
  outline: 'bg-transparent text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-soft hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-[11px] gap-1.5',
  md: 'h-12 px-6 text-[12px] gap-2',
  lg: 'h-[54px] px-7 text-[13px] gap-2',
};

const iconSizeClasses: Record<ButtonSize, string> = {
  sm: 'text-[15px]',
  md: 'text-[17px]',
  lg: 'text-[19px]',
};

/**
 * The app's button. Editorial pill: uppercase letterspaced label, ink-solid
 * primary, press-scale feedback, built-in loading state that preserves
 * layout width.
 */
const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading,
  icon,
  trailingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}) => {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full font-semibold uppercase tracking-[0.1em] select-none',
        'transition-[transform,background-color,box-shadow,opacity] duration-200 ease-swift active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
        'disabled:opacity-40 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      <span className={cn('inline-flex items-center justify-center gap-[inherit]', loading && 'opacity-0')}>
        {icon && <span className={cn('material-symbols-outlined', iconSizeClasses[size])} aria-hidden="true">{icon}</span>}
        {children}
        {trailingIcon && (
          <span className={cn('material-symbols-outlined', iconSizeClasses[size])} aria-hidden="true">{trailingIcon}</span>
        )}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={size === 'lg' ? 22 : 18} />
        </span>
      )}
    </button>
  );
};

export default Button;
