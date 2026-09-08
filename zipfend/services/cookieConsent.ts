/**
 * ZipRIGHT Cookie & Storage Informed Consent Manager
 * Compliant with GDPR / ePrivacy Directive, California CPRA, and India DPDP Act 2023.
 */

export interface ConsentPreferences {
  timestamp: number;
  version: string;
  essential: true; // Always true; required for auth, core navigation, security
  functional: boolean; // Style journey progress, draft looks, saved preferences
  analytics: boolean; // Recommendation telemetry, performance metrics
}

const CONSENT_STORAGE_KEY = 'zipright_consent_preferences';
const CURRENT_CONSENT_VERSION = '2026.1';

type ConsentListener = (preferences: ConsentPreferences) => void;
const listeners: Set<ConsentListener> = new Set();

/**
 * Returns stored consent preferences or null if the user has not made a choice yet.
 */
export function getStoredConsent(): ConsentPreferences | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.essential === true) {
      return parsed as ConsentPreferences;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Checks whether the user has affirmatively recorded consent preferences.
 */
export function hasConsented(): boolean {
  return getStoredConsent() !== null;
}

/**
 * Check if a specific category of cookies/storage is permitted.
 */
export function hasCategoryConsent(category: keyof Omit<ConsentPreferences, 'timestamp' | 'version'>): boolean {
  if (category === 'essential') return true;
  const stored = getStoredConsent();
  if (!stored) return false; // Default opt-in is FALSE for non-essential under GDPR/DPDP
  return Boolean(stored[category]);
}

/**
 * Saves or updates user consent preferences.
 */
export function saveConsent(preferences: { functional: boolean; analytics: boolean }): ConsentPreferences {
  const updated: ConsentPreferences = {
    timestamp: Date.now(),
    version: CURRENT_CONSENT_VERSION,
    essential: true,
    functional: preferences.functional,
    analytics: preferences.analytics,
  };

  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[Consent] Failed to persist consent preferences to localStorage:', err);
  }

  listeners.forEach((listener) => {
    try {
      listener(updated);
    } catch (e) {
      console.error('[Consent] Listener error:', e);
    }
  });

  return updated;
}

/**
 * Accepts all cookies and storage categories.
 */
export function acceptAllCookies(): ConsentPreferences {
  return saveConsent({ functional: true, analytics: true });
}

/**
 * Rejects all non-essential cookies and storage categories.
 */
export function rejectNonEssentialCookies(): ConsentPreferences {
  return saveConsent({ functional: false, analytics: false });
}

/**
 * Listen for changes in consent preferences.
 */
export function onConsentChange(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Event name for requesting the cookie preferences modal to open.
 */
export const OPEN_COOKIE_PREFERENCES_EVENT = 'zipright:open-cookie-preferences';

/**
 * Dispatches a global event instructing the CookieConsentBanner component to present
 * its granular preferences modal to the user.
 */
export function openCookiePreferences(): void {
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_PREFERENCES_EVENT));
}


