/**
 * Server-authoritative Checkout & Razorpay Checkout.js Integration Service.
 *
 * Rules:
 * - NEVER calculate or trust prices on the client. Prices and amounts are strictly server-authoritative.
 * - NEVER directly mark orders as PAID from frontend callbacks. The backend webhook is authoritative.
 * - NEVER log or expose private credentials, secret keys, or customer biometrics.
 * - Handles payment success, failure, and user dismissal states cleanly.
 */

export interface ServerCheckoutData {
  order_id: string;
  status: string;
  currency: string;
  amount_paise: number;
  amount_rupees: number;
  razorpay_order_id: string | null;
  razorpay_key_id: string;
  item_count: number;
}

export interface RazorpaySuccessPayload {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayFailurePayload {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface RazorpayModalOptions {
  ondismiss?: () => void;
  escape?: boolean;
  backdropclose?: boolean;
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpaySuccessPayload) => void;
  modal?: RazorpayModalOptions;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
}

export interface RazorpayInstance {
  open: () => void;
  on?: (event: string, callback: (payload: any) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * Safely and dynamically loads the Razorpay Checkout script if not already present.
 */
export function loadRazorpayScript(url: string = RAZORPAY_SCRIPT_URL): Promise<boolean> {
  if (typeof window === 'undefined') {
    return Promise.resolve(false);
  }

  if (typeof window.Razorpay === 'function') {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      if (typeof window.Razorpay === 'function') {
        resolve(true);
      } else {
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => resolve(false), { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/**
 * Builds Razorpay Checkout options strictly using the server-returned authoritative response values.
 */
export function buildRazorpayOptions(
  serverData: ServerCheckoutData,
  callbacks: {
    onSuccess: (paymentData: RazorpaySuccessPayload) => void;
    onFailure: (errorData: RazorpayFailurePayload) => void;
    onDismiss: () => void;
  },
  prefill?: { name?: string; email?: string; contact?: string }
): RazorpayOptions {
  if (!serverData) {
    throw new Error('Server checkout data is required.');
  }

  const key = (serverData.razorpay_key_id || '').trim();
  if (!key) {
    throw new Error('Missing Razorpay public key ID from server response.');
  }

  const orderId = (serverData.razorpay_order_id || '').trim();
  if (!orderId) {
    throw new Error('Missing payment provider order ID from server response.');
  }

  const amountPaise = Number(serverData.amount_paise);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new Error('Invalid server-authoritative payment amount.');
  }

  const currency = (serverData.currency || 'INR').trim().toUpperCase();

  return {
    key,
    amount: amountPaise,
    currency,
    name: 'ZipRIGHT',
    description: `Order ${serverData.order_id}`,
    order_id: orderId,
    handler: (response: RazorpaySuccessPayload) => {
      // NOTE: Success in checkout modal does NOT mark the order PAID directly.
      // It notifies the UI to enter "processing / confirming" status while
      // the authoritative backend webhook confirms final settlement.
      callbacks.onSuccess(response);
    },
    modal: {
      ondismiss: () => {
        callbacks.onDismiss();
      },
      escape: true,
      backdropclose: false,
    },
    prefill: prefill
      ? {
          name: prefill.name?.trim(),
          email: prefill.email?.trim(),
          contact: prefill.contact?.trim(),
        }
      : undefined,
    notes: {
      zipright_order_id: serverData.order_id,
    },
    theme: {
      color: '#10b981',
    },
  };
}

/**
 * Orchestrates opening Razorpay Checkout.
 */
export async function openRazorpayCheckout(
  serverData: ServerCheckoutData,
  callbacks: {
    onSuccess: (paymentData: RazorpaySuccessPayload) => void;
    onFailure: (errorData: RazorpayFailurePayload) => void;
    onDismiss: () => void;
  },
  prefill?: { name?: string; email?: string; contact?: string }
): Promise<RazorpayInstance> {
  const scriptLoaded = await loadRazorpayScript();
  if (!scriptLoaded || typeof window.Razorpay !== 'function') {
    throw new Error('Failed to load payment gateway checkout SDK. Please check your connection.');
  }

  const options = buildRazorpayOptions(serverData, callbacks, prefill);
  const rzp = new window.Razorpay(options);

  if (typeof rzp.on === 'function') {
    rzp.on('payment.failed', (errPayload: RazorpayFailurePayload) => {
      callbacks.onFailure(errPayload);
    });
  }

  rzp.open();
  return rzp;
}

// ── Client-Side Retry-Stable Idempotency Lifecycle ───────────────────────────

export interface CheckoutAttemptSession {
  key: string;
  cartHash: string;
  createdAt: number;
}

export interface PollingStatusResult {
  status: 'PAID' | 'PENDING_PAYMENT' | 'PAYMENT_FAILED' | 'CANCELLED';
  attempts: number;
  terminal: boolean;
}

/**
 * Computes a deterministic hash of cart items and quantities.
 */
export function computeCartHash(items: Array<{ product_id: string; quantity: number }>): string {
  if (!items || items.length === 0) return 'empty';
  const sorted = [...items].sort((a, b) => a.product_id.localeCompare(b.product_id));
  const repr = sorted.map((i) => `${i.product_id}:${i.quantity}`).join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < repr.length; i++) {
    hash ^= repr.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Retrieves the existing idempotency key for the current logical checkout attempt,
 * or generates and stores a new one in sessionStorage if this is a new attempt or items changed.
 */
export function getOrCreateCheckoutIdempotencyKey(
  userUid: string,
  items: Array<{ product_id: string; quantity: number }>,
  storage?: Storage | null
): string {
  if (!userUid || !userUid.trim()) {
    throw new Error('User UID is required to generate checkout idempotency key.');
  }

  const cleanUid = userUid.trim();
  const cartHash = computeCartHash(items);
  const storageKey = `zipright_idem_${cleanUid}`;

  const store = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.sessionStorage : null);

  if (store) {
    try {
      const raw = store.getItem(storageKey);
      if (raw) {
        const parsed: CheckoutAttemptSession = JSON.parse(raw);
        const ageMs = Date.now() - (parsed.createdAt || 0);
        // Reuse the exact same key across retries if cart items are identical and attempt is < 30 mins old
        if (parsed.cartHash === cartHash && parsed.key && ageMs < 1800000) {
          return parsed.key;
        }
      }
    } catch {
      // Storage read error, generate fresh key
    }
  }

  const randomSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).substring(2, 14);

  const newKey = `chk_${cleanUid.slice(0, 24)}_${cartHash}_${randomSuffix}`;

  if (store) {
    try {
      const sessionData: CheckoutAttemptSession = {
        key: newKey,
        cartHash,
        createdAt: Date.now(),
      };
      store.setItem(storageKey, JSON.stringify(sessionData));
    } catch {
      // Ignore quota or disabled storage
    }
  }

  return newKey;
}

/**
 * Clears the active checkout attempt session from client storage once confirmed PAID or cancelled.
 */
export function clearCheckoutIdempotencyKey(
  userUid: string,
  storage?: Storage | null
): void {
  if (!userUid) return;
  const store = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.sessionStorage : null);
  if (!store) return;
  try {
    store.removeItem(`zipright_idem_${userUid.trim()}`);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Polls backend order status after payment checkout until webhook confirms PAID or max attempts reached.
 * Immediately terminates when reaching terminal states: PAID, PAYMENT_FAILED, or CANCELLED.
 */
export async function pollOrderPaymentStatus(
  orderId: string,
  token: string,
  backendUrl: string,
  maxAttempts: number = 8,
  intervalMs: number = 1500,
  onAttempt?: (info: { attempt: number; status: string }) => void
): Promise<'PAID' | 'PENDING_PAYMENT' | 'PAYMENT_FAILED' | 'CANCELLED'> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${backendUrl}/orders/${encodeURIComponent(orderId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const json = await res.json();
        const status = json?.data?.status;
        if (onAttempt) {
          onAttempt({ attempt: i + 1, status: status || 'unknown' });
        }
        // Terminal states stop polling immediately
        if (status === 'PAID' || status === 'PAYMENT_FAILED' || status === 'CANCELLED') {
          return status;
        }
      }
    } catch {
      // Ignore transient network polling error; continue bounded retry
    }

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return 'PENDING_PAYMENT';
}
