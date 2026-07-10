import React, { createContext, useContext, useRef, useState, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { springs } from '../components/ui/motion';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const toastIcon: Record<Toast['type'], string> = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
};

const toastIconColor: Record<Toast['type'], string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-brand',
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastGuardRef = useRef<Record<string, number>>({});

  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    const key = `${type}:${message}`;
    const now = Date.now();
    const lastShownAt = toastGuardRef.current[key] ?? 0;

    if (now - lastShownAt < 1500) {
      return;
    }

    toastGuardRef.current[key] = now;
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Editorial toasts — paper slips gliding in from the top */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col gap-2 w-full max-w-[340px] px-4 pointer-events-none pt-safe">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ opacity: 0, y: -16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={springs.gentle}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface-1 border border-line shadow-float"
            >
              <span
                className={`material-symbols-outlined filled text-[18px] shrink-0 ${toastIconColor[toast.type]}`}
                aria-hidden="true"
              >
                {toastIcon[toast.type]}
              </span>
              <p className="text-[13px] font-medium text-ink leading-snug">{toast.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
