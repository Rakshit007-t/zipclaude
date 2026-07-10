import React from 'react';
import { cn } from './cn';

interface DividerProps {
  /** Optional centered eyebrow label between two hairlines. */
  label?: string;
  className?: string;
}

/** Hairline rule; with a label it becomes an editorial chapter break. */
const Divider: React.FC<DividerProps> = ({ label, className }) => {
  if (!label) {
    return <div className={cn('h-px bg-line', className)} role="separator" />;
  }
  return (
    <div className={cn('flex items-center gap-4', className)} role="separator">
      <div className="h-px bg-line flex-1" />
      <span className="eyebrow">{label}</span>
      <div className="h-px bg-line flex-1" />
    </div>
  );
};

export default Divider;
