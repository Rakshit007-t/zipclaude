import React from 'react';
import { cn } from './cn';
import Button from './Button';

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Retry handler — renders a "Try again" button when provided. */
  onRetry?: () => void;
  className?: string;
}

/** Standard error state with optional retry. */
const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  description = 'We could not load this right now. Check your connection and try again.',
  onRetry,
  className,
}) => (
  <div role="alert" className={cn('flex flex-col items-center justify-center text-center px-8 py-16', className)}>
    <div className="h-16 w-16 rounded-full bg-danger-soft flex items-center justify-center mb-5">
      <span className="material-symbols-outlined text-danger text-[30px]" aria-hidden="true">
        error
      </span>
    </div>
    <h3 className="text-[17px] font-bold text-ink tracking-tight mb-1.5">{title}</h3>
    <p className="text-[13px] text-ink-soft leading-relaxed max-w-[260px] mb-6">{description}</p>
    {onRetry && (
      <Button variant="secondary" icon="refresh" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

export default ErrorState;
