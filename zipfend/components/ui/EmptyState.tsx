import React from 'react';
import { motion } from 'motion/react';
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

/** Standard empty state: hairline-ringed icon, serif headline, guidance, one CTA with motion. */
const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.96 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.25, ease: 'easeOut' }}
    className={cn('flex flex-col items-center justify-center text-center px-8 py-16 bg-surface-1 border border-line rounded-[1.75rem] shadow-elev-lift', className)}
  >
    <div className="h-16 w-16 rounded-full border border-brand/30 bg-brand-soft flex items-center justify-center mb-5 shadow-sm">
      <span className="material-symbols-outlined text-brand text-[28px]" aria-hidden="true">
        {icon}
      </span>
    </div>
    <h3 className="font-display text-[22px] font-medium text-ink mb-2">{title}</h3>
    {description && <p className="text-[13.5px] text-ink-soft leading-relaxed max-w-[280px] mb-6">{description}</p>}
    {action}
  </motion.div>
);

export default EmptyState;
