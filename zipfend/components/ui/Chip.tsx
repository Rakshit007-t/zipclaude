import React from 'react';
import { cn } from './cn';

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state — renders brand-tinted and sets aria-pressed. */
  selected?: boolean;
  /** Material Symbols icon name. */
  icon?: string;
  size?: 'sm' | 'md';
}

/**
 * Selectable pill for filters, quality pickers, quick replies.
 * Toggle semantics via aria-pressed.
 */
const Chip: React.FC<ChipProps> = ({ selected, icon, size = 'md', className, children, type = 'button', ...rest }) => (
  <button
    type={type}
    aria-pressed={selected}
    className={cn(
      'inline-flex items-center justify-center rounded-full font-medium select-none whitespace-nowrap',
      'transition-[transform,background-color,border-color,color] duration-150 ease-swift active:scale-[0.96]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-surface-0',
      size === 'sm' ? 'h-8 px-3.5 text-[12px] gap-1' : 'h-10 px-4 text-[13px] gap-1.5',
      selected
        ? 'bg-brand-soft text-brand border border-brand/40'
        : 'bg-surface-2 text-ink-soft border border-line hover:text-ink hover:bg-surface-3',
      className,
    )}
    {...rest}
  >
    {icon && (
      <span className="material-symbols-outlined" style={{ fontSize: size === 'sm' ? 14 : 16 }} aria-hidden="true">
        {icon}
      </span>
    )}
    {children}
  </button>
);

export default Chip;
