import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from './cn';
import { springs } from './motion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  /** Action row (Buttons). Rendered below the content. */
  actions?: React.ReactNode;
  className?: string;
}

/** Centered dialog for confirmations and focused decisions. */
const Modal: React.FC<ModalProps> = ({ open, onClose, title, description, children, actions, className }) => {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-6"
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            className="absolute inset-0 bg-scrim backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className={cn(
              'relative w-full max-w-[340px] bg-surface-1 border border-line rounded-card shadow-float p-6',
              className,
            )}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={reduce ? { duration: 0.15 } : springs.gentle}
          >
            {title && <h2 className="text-[18px] font-bold text-ink tracking-tight mb-1.5">{title}</h2>}
            {description && <p className="text-[14px] text-ink-soft leading-relaxed mb-4">{description}</p>}
            {children}
            {actions && <div className="flex gap-2.5 mt-5">{actions}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default Modal;
