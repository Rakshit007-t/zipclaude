import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStandardRazorpayOrder,
  verifyStandardRazorpayPayment,
  startStandardCheckout,
} from '../services/checkoutService';

test('createStandardRazorpayOrder rejects amounts under 100 paise', async () => {
  await assert.rejects(
    async () => {
      await createStandardRazorpayOrder({ amount: 99 });
    },
    /Minimum order amount is 100 paise/
  );

  await assert.rejects(
    async () => {
      await createStandardRazorpayOrder({ amount: 0 });
    },
    /Minimum order amount is 100 paise/
  );
});

test('createStandardRazorpayOrder sends valid request to backend', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestMethod = '';
  let requestBody: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requestedUrl = url;
    requestMethod = init?.method || 'GET';
    requestBody = JSON.parse((init?.body as string) || '{}');
    return {
      ok: true,
      json: async () => ({
        order_id: 'order_mock_test_123',
        amount: 5000,
        currency: 'INR',
        key_id: 'rzp_test_TjSCR9TMoW6lb9',
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const res = await createStandardRazorpayOrder(
      { amount: 5000, currency: 'INR', receipt: 'rcpt_custom_1' },
      'http://localhost:8000'
    );
    assert.equal(requestedUrl, 'http://localhost:8000/api/create-order');
    assert.equal(requestMethod, 'POST');
    assert.equal(requestBody.amount, 5000);
    assert.equal(requestBody.currency, 'INR');
    assert.equal(requestBody.receipt, 'rcpt_custom_1');
    assert.equal(res.order_id, 'order_mock_test_123');
    assert.equal(res.amount, 5000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifyStandardRazorpayPayment validates missing parameters', async () => {
  await assert.rejects(
    async () => {
      await verifyStandardRazorpayPayment({
        razorpay_order_id: '',
        razorpay_payment_id: 'pay_123',
        razorpay_signature: 'sig_123',
      });
    },
    /Missing payment verification details/
  );
});

test('verifyStandardRazorpayPayment posts details to /api/verify-payment', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestBody: any = null;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requestedUrl = url;
    requestBody = JSON.parse((init?.body as string) || '{}');
    return {
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Payment verified successfully',
        order_id: requestBody.razorpay_order_id,
        payment_id: requestBody.razorpay_payment_id,
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const res = await verifyStandardRazorpayPayment(
      {
        razorpay_order_id: 'order_test_456',
        razorpay_payment_id: 'pay_test_789',
        razorpay_signature: 'sig_valid_hex',
      },
      'http://localhost:8000'
    );
    assert.equal(requestedUrl, 'http://localhost:8000/api/verify-payment');
    assert.equal(requestBody.razorpay_order_id, 'order_test_456');
    assert.equal(requestBody.razorpay_payment_id, 'pay_test_789');
    assert.equal(requestBody.razorpay_signature, 'sig_valid_hex');
    assert.equal(res.status, 'success');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
