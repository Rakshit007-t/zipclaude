import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  hasConsented,
  getStoredConsent,
  acceptAllCookies,
  rejectNonEssentialCookies,
  saveConsent,
  ConsentPreferences,
  OPEN_COOKIE_PREFERENCES_EVENT,
  openCookiePreferences,
} from '../../services/cookieConsent';
import { Button, Modal, Eyebrow } from './index';

export { openCookiePreferences };

const CookieConsentBanner: React.FC = () => {
  const navigate = useNavigate();
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Preference modal toggles
  const [functional, setFunctional] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    // Show banner after brief delay if not yet consented
    if (!hasConsented()) {
      const timer = setTimeout(() => setShowBanner(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  // Listen for programmatic open events
  useEffect(() => {
    const handleOpen = () => {
      const current = getStoredConsent();
      setFunctional(current ? current.functional : false);
      setAnalytics(current ? current.analytics : false);
      setShowModal(true);
    };

    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, handleOpen);
  }, []);

  const handleAcceptAll = () => {
    acceptAllCookies();
    setShowBanner(false);
    setShowModal(false);
  };

  const handleRejectNonEssential = () => {
    rejectNonEssentialCookies();
    setShowBanner(false);
    setShowModal(false);
  };

  const handleSaveCustom = () => {
    saveConsent({ functional, analytics });
    setShowBanner(false);
    setShowModal(false);
  };

  const handleOpenCustomize = () => {
    const current = getStoredConsent();
    setFunctional(current ? current.functional : false);
    setAnalytics(current ? current.analytics : false);
    setShowModal(true);
  };

  return (
    <>
      {/* Floating Bottom Consent Banner */}
      <AnimatePresence>
        {showBanner && (
          <motion.div
            role="region"
            aria-label="Cookie and Privacy Consent"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed bottom-4 inset-x-4 max-w-[400px] mx-auto z-[90] p-5 rounded-[1.5rem] bg-surface-1/95 backdrop-blur-xl border border-line-strong shadow-2xl text-ink"
          >
            <div className="flex items-start gap-3 mb-2">
              <span className="material-symbols-outlined text-brand text-[20px] shrink-0 mt-0.5" aria-hidden="true">
                cookie
              </span>
              <div>
                <h2 className="text-[14px] font-semibold text-ink leading-tight">Your Privacy & Consent</h2>
                <p className="text-[12px] text-ink-soft leading-relaxed mt-1">
                  We use essential local storage to keep your session secure and power accurate sizing. With your consent, we also use functional and analytics storage to personalize your style feed.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-ink-faint mb-4 pl-8">
              <button
                type="button"
                onClick={() => navigate('/cookie-policy')}
                className="underline underline-offset-2 hover:text-ink transition-colors"
              >
                Cookie Policy
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => navigate('/privacy-policy')}
                className="underline underline-offset-2 hover:text-ink transition-colors"
              >
                Privacy Policy
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="primary" onClick={handleAcceptAll}>
                  Accept All
                </Button>
                <Button size="sm" variant="secondary" onClick={handleRejectNonEssential}>
                  Reject Non-Essential
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={handleOpenCustomize}>
                Manage Preferences
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detailed Granular Preferences Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Consent Preferences"
        description="Choose which types of storage and cookies you allow. You can update these settings anytime."
        actions={
          <div className="flex flex-col w-full gap-2 pt-2">
            <Button size="md" variant="primary" fullWidth onClick={handleSaveCustom}>
              Save Preferences
            </Button>
            <Button size="sm" variant="ghost" fullWidth onClick={handleAcceptAll}>
              Accept All
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 text-left max-h-[60vh] overflow-y-auto no-scrollbar py-2">
          {/* Category 1: Essential */}
          <div className="p-3.5 rounded-xl bg-surface-2 border border-line">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-brand" aria-hidden="true">lock</span>
                <span className="text-[13.5px] font-semibold text-ink">Strictly Necessary</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint bg-surface-3 px-2 py-0.5 rounded-full">
                Always Active
              </span>
            </div>
            <p className="text-[11.5px] text-ink-soft mt-1 leading-relaxed">
              Required for security, user authentication, profile isolation, and dark/light theme state. Cannot be disabled.
            </p>
          </div>

          {/* Category 2: Functional */}
          <div className="p-3.5 rounded-xl bg-surface-2 border border-line">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-brand" aria-hidden="true">tune</span>
                <span className="text-[13.5px] font-semibold text-ink">Functional & Personalization</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={functional}
                aria-label="Toggle Functional Storage"
                onClick={() => setFunctional(!functional)}
                className={`w-10 h-5 rounded-full flex items-center px-0.5 transition-colors ${
                  functional ? 'bg-brand' : 'bg-line-strong'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    functional ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11.5px] text-ink-soft mt-1 leading-relaxed">
              Remembers your style journey streak, draft look compositions, and temporary cart items across sessions.
            </p>
          </div>

          {/* Category 3: Analytics */}
          <div className="p-3.5 rounded-xl bg-surface-2 border border-line">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-brand" aria-hidden="true">analytics</span>
                <span className="text-[13.5px] font-semibold text-ink">Analytics & Performance</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={analytics}
                aria-label="Toggle Analytics Storage"
                onClick={() => setAnalytics(!analytics)}
                className={`w-10 h-5 rounded-full flex items-center px-0.5 transition-colors ${
                  analytics ? 'bg-brand' : 'bg-line-strong'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    analytics ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11.5px] text-ink-soft mt-1 leading-relaxed">
              Helps us understand recommendation accuracy and app stability without tracking your identity across third-party websites.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default CookieConsentBanner;
