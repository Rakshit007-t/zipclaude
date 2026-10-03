import React, { useState } from 'react';
import {
  startStandardCheckout,
  type VerifyPaymentResponse,
  type RazorpayFailurePayload,
} from '../services/checkoutService';

export interface RazorpayCheckoutButtonProps {
  amount: number; // in paise (minimum 100 paise = 1 INR)
  currency?: string;
  receipt?: string;
  name?: string;
  description?: string;
  buttonText?: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  onSuccess?: (response: {
    payment_id: string;
    order_id: string;
    signature: string;
    verification: VerifyPaymentResponse;
  }) => void;
  onFailure?: (error: RazorpayFailurePayload) => void;
  onDismiss?: () => void;
  className?: string;
  disabled?: boolean;
}

export const RazorpayCheckoutButton: React.FC<RazorpayCheckoutButtonProps> = ({
  amount,
  currency = 'INR',
  receipt,
  name = 'ZipRIGHT Atelier',
  description,
  buttonText,
  prefill,
  onSuccess,
  onFailure,
  onDismiss,
  className = '',
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'modal_open' | 'success' | 'failed' | 'dismissed'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [verifiedPayment, setVerifiedPayment] = useState<{ payment_id: string; order_id: string } | null>(null);

  const formattedAmount = (amount / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: currency || 'INR',
  });

  const handleCheckout = async () => {
    if (loading || disabled) return;

    try {
      setLoading(true);
      setStatus('modal_open');
      setStatusMessage('Initiating secure payment session...');

      await startStandardCheckout({
        amount,
        currency,
        receipt,
        name,
        description: description || `Payment of ${formattedAmount}`,
        prefill,
        onSuccess: (res) => {
          setLoading(false);
          setStatus('success');
          setVerifiedPayment({ payment_id: res.payment_id, order_id: res.order_id });
          setStatusMessage(`Payment verified! ID: ${res.payment_id}`);
          if (onSuccess) {
            onSuccess(res);
          }
        },
        onFailure: (err) => {
          setLoading(false);
          setStatus('failed');
          const desc = err?.error?.description || 'Payment was declined or cancelled.';
          setStatusMessage(`Payment failed: ${desc}`);
          if (onFailure) {
            onFailure(err);
          }
        },
        onDismiss: () => {
          setLoading(false);
          setStatus('dismissed');
          setStatusMessage('Payment cancelled. Modal dismissed.');
          if (onDismiss) {
            onDismiss();
          }
        },
      });
    } catch (err) {
      setLoading(false);
      setStatus('failed');
      const msg = err instanceof Error ? err.message : 'Failed to launch checkout.';
      setStatusMessage(msg);
      if (onFailure) {
        onFailure({ error: { description: msg } });
      }
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <button
        type="button"
        id="rzp-checkout-btn"
        onClick={handleCheckout}
        disabled={loading || disabled}
        className={
          className ||
          'inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-medium text-sm text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        {loading ? (
          <>
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Opening Payment Gateway...</span>
          </>
        ) : (
          <>
            <svg
              className="w-4 h-4 fill-current"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h-2v-2h2v2zm0-4h-2V7h2v5zm3 4h-2v-2h2v2zm0-4h-2V7h2v5z" />
            </svg>
            <span>{buttonText || `Pay ${formattedAmount} via Razorpay`}</span>
          </>
        )}
      </button>

      {/* Status Messages */}
      {status === 'success' && verifiedPayment && (
        <div className="p-3 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg flex flex-col gap-1 animate-fade-in">
          <div className="font-semibold flex items-center gap-1.5">
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Payment Verified Successfully</span>
          </div>
          <p className="text-[11px] text-emerald-300">
            Payment ID: <span className="font-mono">{verifiedPayment.payment_id}</span>
          </p>
          <p className="text-[11px] text-emerald-300">
            Order ID: <span className="font-mono">{verifiedPayment.order_id}</span>
          </p>
        </div>
      )}

      {status === 'failed' && (
        <div className="p-3 text-xs bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg flex items-center gap-2 animate-fade-in">
          <svg className="w-4 h-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{statusMessage}</span>
        </div>
      )}

      {status === 'dismissed' && (
        <div className="p-3 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg flex items-center gap-2 animate-fade-in">
          <svg className="w-4 h-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  );
};
export default RazorpayCheckoutButton;
