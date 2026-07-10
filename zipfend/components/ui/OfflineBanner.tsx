import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { springs } from './motion';

/**
 * Global connectivity indicator. Mounted once in the app shell; slides in
 * when the device goes offline and announces itself to screen readers.
 * Ink bar — quiet, absolute.
 */
const OfflineBanner: React.FC = () => {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          role="status"
          aria-live="polite"
          className="fixed top-0 inset-x-0 z-[90] w-full phone-fixed-bottom"
          initial={{ y: '-100%' }}
          animate={{ y: 0 }}
          exit={{ y: '-100%' }}
          transition={springs.gentle}
        >
          <div className="pt-safe bg-ink">
            <div className="flex items-center justify-center gap-2 py-2 px-4">
              <span className="material-symbols-outlined text-ink-invert text-[15px]" aria-hidden="true">
                cloud_off
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-invert">
                Offline — some features unavailable
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineBanner;
