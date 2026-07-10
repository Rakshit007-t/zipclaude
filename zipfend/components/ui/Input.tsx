import React, { useId } from 'react';
import { cn } from './cn';

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { inputId: string; describedBy?: string }) => React.ReactNode;
}

/**
 * Label + control + hint/error wrapper. Editorial eyebrow label above a
 * hairline-framed control. Wires label→control and control→error for
 * screen readers automatically.
 */
export const Field: React.FC<FieldProps> = ({ label, hint, error, required, className, children }) => {
  const inputId = useId();
  const msgId = useId();
  const describedBy = error || hint ? msgId : undefined;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {label}
          {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      {children({ inputId, describedBy })}
      {(error || hint) && (
        <p id={msgId} role={error ? 'alert' : undefined} className={cn('text-[12px]', error ? 'text-danger' : 'text-ink-faint')}>
          {error || hint}
        </p>
      )}
    </div>
  );
};

const baseControlClasses =
  'w-full rounded-ctl bg-surface-1 text-ink placeholder:text-ink-faint border text-[15px] ' +
  'transition-[border-color,box-shadow,background-color] duration-200 ' +
  'focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 ' +
  'disabled:opacity-50';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Material Symbols icon name shown at the left. */
  icon?: string;
  /** Element rendered at the right edge (e.g. visibility toggle). */
  trailing?: React.ReactNode;
}

/** Text input with label, icon, error, and hint support. */
export const Input: React.FC<InputProps> = ({ label, hint, error, icon, trailing, className, required, ...rest }) => (
  <Field label={label} hint={hint} error={error} required={required} className={className}>
    {({ inputId, describedBy }) => (
      <div className="relative">
        {icon && (
          <span
            className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint text-[20px] pointer-events-none"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={required}
          className={cn(
            baseControlClasses,
            'h-12',
            icon ? 'pl-11' : 'pl-4',
            trailing ? 'pr-12' : 'pr-4',
            error ? 'border-danger' : 'border-line',
          )}
          {...rest}
        />
        {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
    )}
  </Field>
);

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

/** Multiline input with the same field chrome as Input. */
export const TextArea: React.FC<TextAreaProps> = ({ label, hint, error, className, required, rows = 4, ...rest }) => (
  <Field label={label} hint={hint} error={error} required={required} className={className}>
    {({ inputId, describedBy }) => (
      <textarea
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        required={required}
        className={cn(baseControlClasses, 'p-4 resize-none', error ? 'border-danger' : 'border-line')}
        {...rest}
      />
    )}
  </Field>
);
