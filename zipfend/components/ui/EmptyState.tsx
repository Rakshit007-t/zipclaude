import React from 'react';
import { cn } from './cn';

interface EmptyStateProps {
  /** Material Symbols icon name. */
  icon: string;
  title: string;
  description?: string;
  /** Call-to-action (Button). */
  action?: React.ReactNode;
  className?: string;
}

/** Standard empty state: soft brand icon, headline, guidance, one CTA. */
const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <div className={cn('flex flex-col items-center justify-center text-center px-8 py-16', className)}>
    <div className="h-16 w-16 rounded-full bg-brand-soft flex items-center justify-center mb-5">
      <span className="material-symbols-outlined text-brand text-[30px]" aria-hidden="true">
        {icon}
      </span>
    </div>
    <h3 className="text-[17px] font-bold text-ink tracking-tight mb-1.5">{title}</h3>
    {description && <p className="text-[13px] text-ink-soft leading-relaxed max-w-[260px] mb-6">{description}</p>}
    {action}
  </div>
);

export default EmptyState;
