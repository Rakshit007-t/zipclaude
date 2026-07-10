import React from 'react';
import { cn } from './cn';

interface ListRowProps {
  /** Material Symbols icon name shown in a hairline circle. */
  icon?: string;
  title: string;
  subtitle?: string;
  /** Right edge: defaults to a chevron when onClick is set. Pass null to hide. */
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Renders title/icon in danger color (destructive rows). */
  destructive?: boolean;
  className?: string;
}

/**
 * Editorial list row — settings, menus, detail lists. Hairline-separated,
 * icon in a thin ring, quiet chevron. Renders as a button when clickable.
 */
const ListRow: React.FC<ListRowProps> = ({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  destructive,
  className,
}) => {
  const content = (
    <>
      {icon && (
        <span
          className={cn(
            'h-10 w-10 rounded-full border flex items-center justify-center shrink-0',
            destructive ? 'border-danger/30 text-danger' : 'border-line text-ink-soft',
          )}
        >
          <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
            {icon}
          </span>
        </span>
      )}
      <span className="flex-1 min-w-0 text-left">
        <span className={cn('block text-[15px] font-medium truncate', destructive ? 'text-danger' : 'text-ink')}>
          {title}
        </span>
        {subtitle && <span className="block text-[12px] text-ink-faint truncate mt-0.5">{subtitle}</span>}
      </span>
      {trailing !== null && (
        <span className="shrink-0 flex items-center text-ink-faint">
          {trailing ?? (onClick && (
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward_ios
            </span>
          ))}
        </span>
      )}
    </>
  );

  const base = cn('flex items-center gap-3.5 w-full py-3.5 px-1', className);

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          base,
          'transition-[background-color,transform] duration-200 ease-swift active:scale-[0.99] rounded-xl',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        )}
      >
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
};

export default ListRow;
