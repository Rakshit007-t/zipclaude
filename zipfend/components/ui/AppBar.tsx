import React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from './cn';
import IconButton from './IconButton';

interface AppBarProps {
  title?: React.ReactNode;
  subtitle?: string;
  /** Hide the back button (e.g. on root tabs). */
  hideBack?: boolean;
  /** Custom back handler; defaults to history back. */
  onBack?: () => void;
  /** Right-aligned actions. */
  trailing?: React.ReactNode;
  /** Transparent over hero imagery instead of blurred surface. */
  transparent?: boolean;
  className?: string;
}

/**
 * Screen header: back navigation, title, actions. Sticky with glass blur so
 * content scrolls beneath it.
 */
const AppBar: React.FC<AppBarProps> = ({
  title,
  subtitle,
  hideBack,
  onBack,
  trailing,
  transparent,
  className,
}) => {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        'sticky top-0 z-30 pt-safe',
        transparent ? 'bg-transparent' : 'bg-surface-0/85 backdrop-blur-xl border-b border-line',
        className,
      )}
    >
      <div className="flex items-center gap-3 h-14 px-4">
        {!hideBack && (
          <IconButton
            icon="arrow_back"
            aria-label="Go back"
            variant={transparent ? 'overlay' : 'ghost'}
            size="sm"
            onClick={onBack ?? (() => navigate(-1))}
          />
        )}
        <div className="flex-1 min-w-0">
          {typeof title === 'string' ? (
            <h1 className="text-[17px] font-bold text-ink tracking-tight truncate">{title}</h1>
          ) : (
            title
          )}
          {subtitle && <p className="text-[11px] text-ink-faint truncate -mt-0.5">{subtitle}</p>}
        </div>
        {trailing && <div className="flex items-center gap-2">{trailing}</div>}
      </div>
    </header>
  );
};

export default AppBar;
