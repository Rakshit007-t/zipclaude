import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from './cn';
import { springs } from './motion';
import IconButton from './IconButton';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Extra classes on the panel. */
  className?: string;
  /** Hide the drag grabber (for non-dismissable flows). */
  hideGrabber?: boolean;
}

/**
 * Bottom sheet: portal-rendered, spring entrance, drag-to-dismiss,
 * Esc to close, scroll-locked backdrop. The app's replacement for
 * ad-hoc fixed-position drawers.
 */
const Sheet: React.FC<SheetProps> = ({ open, onClose, title, children, className, hideGrabber }) => {
  const reduce = useReducedMotion();

  // Scroll lock + Esc while open
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
        <div className="fixed inset-0 z-[70] flex justify-center" role="dialog" aria-modal="true" aria-label={title}>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-scrim backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            className={cn(
              'absolute bottom-0 w-full sm:max-w-[430px] max-h-[88dvh] flex flex-col',
              'bg-surface-1 rounded-t-sheet border-t border-x border-line shadow-float',
              className,
            )}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={reduce ? { duration: 0.15 } : springs.gentle}
            drag={reduce ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 500) onClose();
            }}
          >
            {!hideGrabber && (
              <div className="flex justify-center pt-3 pb-1 shrink-0 cursor-grab active:cursor-grabbing">
                <div className="h-1 w-10 rounded-full bg-line-strong" aria-hidden="true" />
              </div>
            )}
            {title && (
              <div className="flex items-center justify-between px-5 pt-2 pb-3 shrink-0">
                <h2 className="text-[17px] font-bold text-ink tracking-tight">{title}</h2>
                <IconButton icon="close" aria-label="Close" variant="ghost" size="sm" onClick={onClose} />
              </div>
            )}
            <div className="overflow-y-auto overscroll-contain px-5 pb-6 pb-safe grow">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default Sheet;
