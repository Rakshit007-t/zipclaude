import React, { createContext, useContext, useRef, useState, ReactNode } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

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
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[1000] flex flex-col gap-2 w-full max-w-[300px] px-4">
        {toasts.map((toast) => (
          <div 
            key={toast.id}
            className={`p-4 rounded-2xl shadow-2xl animate-in slide-in-from-top duration-300 flex items-center gap-3 border ${
              toast.type === 'success' ? 'bg-green-500 border-green-400 text-ink' :
              toast.type === 'error' ? 'bg-red-500 border-red-400 text-ink' :
              'bg-surface-1 border-line text-ink'
            }`}
          >
            <span className="material-symbols-outlined text-xl">
              {toast.type === 'success' ? 'check_circle' : toast.type === 'error' ? 'error' : 'info'}
            </span>
            <p className="text-xs font-bold">{toast.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
