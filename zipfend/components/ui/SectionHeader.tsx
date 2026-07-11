import React from 'react';
import { cn } from './cn';
import Eyebrow from './Eyebrow';

/**
 * Editorial section opener — eyebrow over a display title, with an optional
 * trailing action. The repeating rhythm of every MAISON list screen.
 *
 *   <SectionHeader eyebrow="Curated for you" title="The Edit"
 *     action={{ label: 'View all', onClick: ... }} />
 */
interface SectionHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ eyebrow, title, action, className }) => (
  <div className={cn('flex items-baseline justify-between', className)}>
    <div>
      {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
      <h2 className="title-1">{title}</h2>
    </div>
    {action && (
      <button
        onClick={action.onClick}
        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint underline underline-offset-4 press"
      >
        {action.label}
      </button>
    )}
  </div>
);

export default SectionHeader;
