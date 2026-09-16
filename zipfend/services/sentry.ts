/**
 * Privacy-safe Sentry Error Monitoring Integration for ZipRIGHT Frontend.
 *
 * Features:
 * - Error monitoring only (tracing, profiling, and session replays disabled).
 * - Comprehensive privacy filtering:
 *   * Firebase auth tokens, session tokens, and credentials scrubbed.
 *   * Customer biometric data, avatar images, and try-on photos redacted.
 *   * Customer body measurements (fit profiles, SmartFit scans, bust/waist/hips) redacted.
 *   * Payment details and Razorpay signatures redacted.
 *   * Private chat and message content redacted.
 *   * User PII (email, phone, name) stripped; user ID non-reversibly hashed.
 *   * Sensitive breadcrumbs and query parameters sanitized.
 */

import * as Sentry from '@sentry/react';

// Regex patterns for sensitive keys across event contexts, extras, and payloads
const SENSITIVE_KEY_PATTERNS = [
  /(password|token|secret|credential|api_?key)/i,
  /(auth|authorization|bearer)/i,
  /(cookie|set-cookie)/i,
  /(razorpay|card|cvv|account_number)/i,
  /(x-wallet-topup-secret|x-razorpay-signature|x-csrf-token)/i,
  /(firebase_?credentials|id_?token|refresh_?token)/i,
  /(measurement|body_?shape|fit_?profile|smart_?fit|shoulder)/i,
  /^(bust|waist|hips|chest|height|weight|inseam|thigh)$/i,
  /(biometric|face_?crop|avatar_?image|selfie|photo_?url)/i,
  /(private_?media|signed_?url|download_?token)/i,
  /^(email|phone|phone_number|full_name|address|shipping_address)$/i,
  /^(message_text|chat_content|private_message)$/i,
];

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'secret',
  'key',
  'api_key',
  'password',
  'auth',
  'signature',
  'sig',
  'code',
  'access_token',
  'refresh_token',
]);

/**
 * Return true if key matches any known sensitive field pattern.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Non-reversible simple hash for user IDs in browser context.
 */
export function hashUserId(userId?: string | number | null): string | undefined {
  if (!userId) return undefined;
  const str = String(userId).trim();
  if (!str) return undefined;

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `anon_${Math.abs(hash).toString(16)}`;
}

/**
 * Recursively sanitize objects and arrays to redact sensitive keys and values.
 */
export function sanitizeData<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact token in Firebase Storage or bearer links
    if (data.includes('firebasestorage.googleapis.com') && data.includes('token=')) {
      return data.replace(/token=[^&\s]+/g, 'token=[REDACTED]') as unknown as T;
    }
    if (data.includes('Bearer ')) {
      return data.replace(/Bearer\s+[^\s]+/g, 'Bearer [REDACTED]') as unknown as T;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeData(value);
      }
    }
    return sanitized as unknown as T;
  }

  return data;
}

/**
 * Redact sensitive query parameters in a URL string.
 */
export function sanitizeUrl(url?: string): string {
  if (!url) return '';
  const [base, query] = url.split('?');
  if (!query) return base;

  const cleanParams = query.split('&').map((param) => {
    const [k, v] = param.split('=');
    if (k && (SENSITIVE_QUERY_PARAMS.has(k.toLowerCase()) || isSensitiveKey(k))) {
      return `${k}=[REDACTED]`;
    }
    return param;
  });

  return `${base}?${cleanParams.join('&')}`;
}

/**
 * Central event scrubber applied before sending to Sentry.
 */
export function beforeSendFilter(
  event: Sentry.ErrorEvent,
  _hint?: Sentry.EventHint
): Sentry.ErrorEvent | null {
  try {
    // 1. Scrub User Information
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
      // Strip any extra PII attached to user
      const customUser = event.user as Record<string, unknown>;
      delete customUser.phone;
      delete customUser.name;

      if (event.user.id) {
        event.user.id = hashUserId(event.user.id);
      }
    }

    // 2. Scrub Request URL & Query String
    if (event.request?.url) {
      event.request.url = sanitizeUrl(event.request.url);
    }
    if (event.request?.headers) {
      event.request.headers = sanitizeData(event.request.headers);
    }
    if (event.request?.data) {
      event.request.data = sanitizeData(event.request.data);
    }

    // 3. Scrub Contexts
    if (event.contexts) {
      event.contexts = sanitizeData(event.contexts);
    }

    // 4. Scrub Extra Data
    if (event.extra) {
      event.extra = sanitizeData(event.extra);
    }

    // 5. Scrub Breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) => beforeBreadcrumbFilter(crumb));
    }
  } catch (err) {
    // Fallback: don't block error dispatch if scrubbing encounters unexpected structure
    console.warn('Error during Sentry beforeSend filtering:', err);
  }

  return event;
}

/**
 * Breadcrumb scrubber to prevent capturing sensitive network/navigation data.
 */
export function beforeBreadcrumbFilter(
  breadcrumb: Sentry.Breadcrumb,
  _hint?: Sentry.BreadcrumbHint
): Sentry.Breadcrumb {
  if (breadcrumb.data) {
    const data = breadcrumb.data as Record<string, unknown>;
    if (typeof data.url === 'string') {
      data.url = sanitizeUrl(data.url);
    }
    breadcrumb.data = sanitizeData(data);
  }

  if (breadcrumb.message) {
    if (breadcrumb.message.includes('firebasestorage.googleapis.com') && breadcrumb.message.includes('token=')) {
      breadcrumb.message = breadcrumb.message.replace(/token=[^&\s]+/g, 'token=[REDACTED]');
    }
    if (breadcrumb.message.includes('Bearer ')) {
      breadcrumb.message = breadcrumb.message.replace(/Bearer\s+[^\s]+/g, 'Bearer [REDACTED]');
    }
  }

  return breadcrumb;
}

let sentryInitialized = false;

export function isSentryInitialized(): boolean {
  return sentryInitialized;
}

function getEnvVar(name: string): string | undefined {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env[name] === 'string') {
      return import.meta.env[name];
    }
  } catch {
    // import.meta may not be available in node test runner
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[name] === 'string') {
    return process.env[name];
  }
  return undefined;
}

/**
 * Initialize Sentry for React/Vite.
 * Only activates if VITE_SENTRY_DSN is configured.
 */
export function initSentry(): boolean {
  const dsn = getEnvVar('VITE_SENTRY_DSN');
  if (!dsn || !dsn.trim()) {
    return false;
  }

  const environment =
    getEnvVar('VITE_SENTRY_ENVIRONMENT') || getEnvVar('MODE') || 'development';
  const release = getEnvVar('VITE_SENTRY_RELEASE') || 'zipright-frontend@1.0.0';

  Sentry.init({
    dsn: dsn.trim(),
    environment,
    release,
    // Phase 5B Quota & Privacy:
    sendDefaultPii: false,
    tracesSampleRate: 0,           // Tracing DISABLED
    replaysSessionSampleRate: 0,   // Session Replay DISABLED
    replaysOnErrorSampleRate: 0,   // Replay on Error DISABLED
    maxBreadcrumbs: 30,
    beforeSend: beforeSendFilter,
    beforeBreadcrumb: beforeBreadcrumbFilter,
  });

  sentryInitialized = true;
  return true;
}
