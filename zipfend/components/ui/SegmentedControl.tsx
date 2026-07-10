import React, { useId } from 'react';
import { motion } from 'motion/react';
import { cn } from './cn';
import { springs } from './motion';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  /** Material Symbols icon name. */
  icon?: string;
}

interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  'aria-label': string;
  className?: string;
}

/**
 * Editorial segmented control — bone track, sliding paper thumb, uppercase
 * labels. For binary/ternary mode choices (theme, units, tabs-as-filter).
 */
function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  // Per-instance layoutId — multiple controls on one screen must not share a thumb
  const thumbId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      className={cn('flex p-1 rounded-full bg-surface-2 border border-line', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex-1 h-9 px-3 rounded-full flex items-center justify-center gap-1.5 select-none',
              'text-[10.5px] font-semibold uppercase tracking-[0.1em] transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              active ? 'text-ink' : 'text-ink-faint hover:text-ink-soft',
            )}
          >
            {active && (
              <motion.span
                layoutId={thumbId}
                transition={springs.snappy}
                className="absolute inset-0 rounded-full bg-surface-1 border border-line shadow-lift"
                aria-hidden="true"
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.icon && (
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
