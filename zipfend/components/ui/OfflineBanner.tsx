import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { springs } from './motion';

/**
 * Global connectivity indicator. Mounted once in the app shell; slides in
 * when the device goes offline and announces itself to screen readers.
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
          className="fixed top-0 left-1/2 z-[90] w-full sm:max-w-[430px] -translate-x-1/2"
          initial={{ y: '-100%' }}
          animate={{ y: 0 }}
          exit={{ y: '-100%' }}
          transition={springs.gentle}
        >
          <div className="pt-safe bg-warning-soft backdrop-blur-xl border-b border-warning/30">
            <div className="flex items-center justify-center gap-2 py-2 px-4">
              <span className="material-symbols-outlined text-warning text-[16px]" aria-hidden="true">
                cloud_off
              </span>
              <span className="text-[12px] font-semibold text-warning">
                You're offline — some features are unavailable
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineBanner;
