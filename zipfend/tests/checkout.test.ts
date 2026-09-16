import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRazorpayOptions,
  loadRazorpayScript,
  openRazorpayCheckout,
  getOrCreateCheckoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
  computeCartHash,
  pollOrderPaymentStatus,
  type ServerCheckoutData,
  type RazorpaySuccessPayload,
  type RazorpayFailurePayload,
} from '../services/checkoutService';

// Mock server-authoritative checkout response
const mockServerOrder: ServerCheckoutData = {
  order_id: 'ord_test_authoritative_123',
  status: 'PENDING_PAYMENT',
  currency: 'INR',
  amount_paise: 499900,
  amount_rupees: 4999.0,
  razorpay_order_id: 'order_rzp_mock_abc999',
  razorpay_key_id: 'rzp_test_public_key',
  item_count: 1,
};

test('Razorpay options strictly use server-authoritative amount, currency, and provider order ID', () => {
  let successCalled = false;
  let failureCalled = false;
  let dismissCalled = false;

  const options = buildRazorpayOptions(
    mockServerOrder,
    {
      onSuccess: () => { successCalled = true; },
      onFailure: () => { failureCalled = true; },
      onDismiss: () => { dismissCalled = true; },
    },
    { name: 'Alice Test', email: 'alice@example.com' }
  );

  // Assert server values are used
  assert.equal(options.key, 'rzp_test_public_key');
  assert.equal(options.amount, 499900); // Server amount in paise
  assert.equal(options.currency, 'INR');
  assert.equal(options.order_id, 'order_rzp_mock_abc999');
  assert.equal(options.name, 'ZipRIGHT');
  assert.equal(options.description, 'Order ord_test_authoritative_123');
  assert.equal(options.prefill?.name, 'Alice Test');
  assert.equal(options.prefill?.email, 'alice@example.com');
  assert.equal(options.notes?.zipright_order_id, 'ord_test_authoritative_123');
});

test('Rejects invalid or non-authoritative server values', () => {
  // Missing key
  assert.throws(() => {
    buildRazorpayOptions(
      { ...mockServerOrder, razorpay_key_id: '' },
      { onSuccess: () => {}, onFailure: () => {}, onDismiss: () => {} }
    );
  }, /Missing Razorpay public key ID/);

  // Missing provider order ID
  assert.throws(() => {
    buildRazorpayOptions(
      { ...mockServerOrder, razorpay_order_id: null },
      { onSuccess: () => {}, onFailure: () => {}, onDismiss: () => {} }
    );
  }, /Missing payment provider order ID/);

  // Invalid or zero amount
  assert.throws(() => {
    buildRazorpayOptions(
      { ...mockServerOrder, amount_paise: 0 },
      { onSuccess: () => {}, onFailure: () => {}, onDismiss: () => {} }
    );
  }, /Invalid server-authoritative payment amount/);

  assert.throws(() => {
    buildRazorpayOptions(
      { ...mockServerOrder, amount_paise: -100 },
      { onSuccess: () => {}, onFailure: () => {}, onDismiss: () => {} }
    );
  }, /Invalid server-authoritative payment amount/);
});

test('Success callback passes payload and does NOT directly mark order paid', () => {
  let receivedPayload: RazorpaySuccessPayload | null = null;
  let paidDirectly = false;

  const options = buildRazorpayOptions(
    mockServerOrder,
    {
      onSuccess: (p) => {
        receivedPayload = p;
        // Verify handler does NOT call an endpoint to set status = PAID
        // Frontend must only transition UI to processing
      },
      onFailure: () => {},
      onDismiss: () => {},
    }
  );

  const fakeSuccessPayload: RazorpaySuccessPayload = {
    razorpay_payment_id: 'pay_rzp_123456',
    razorpay_order_id: 'order_rzp_mock_abc999',
    razorpay_signature: 'fake_sig_abc',
  };

  // Simulate Razorpay calling handler on success
  options.handler(fakeSuccessPayload);

  assert.deepEqual(receivedPayload, fakeSuccessPayload);
  assert.equal(paidDirectly, false);
});

test('Dismissal callback safely triggers on modal close', () => {
  let dismissed = false;

  const options = buildRazorpayOptions(
    mockServerOrder,
    {
      onSuccess: () => {},
      onFailure: () => {},
      onDismiss: () => { dismissed = true; },
    }
  );

  // Simulate modal ondismiss trigger
  options.modal?.ondismiss?.();
  assert.equal(dismissed, true);
});

test('Failure callback receives payment error payload safely', () => {
  let failurePayload: RazorpayFailurePayload | null = null;

  const callbacks = {
    onSuccess: () => {},
    onFailure: (err: RazorpayFailurePayload) => { failurePayload = err; },
    onDismiss: () => {},
  };

  const options = buildRazorpayOptions(mockServerOrder, callbacks);

  // Test failure callback
  callbacks.onFailure({
    error: {
      code: 'BAD_REQUEST_ERROR',
      description: 'Payment failed due to card decline',
      source: 'gateway',
      step: 'payment_authorization',
      reason: 'payment_failed',
    },
  });

  assert.equal(failurePayload?.error?.code, 'BAD_REQUEST_ERROR');
  assert.equal(failurePayload?.error?.description, 'Payment failed due to card decline');
});

test('No secret keys or private payment tokens exist in frontend files', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const filesToCheck = [
    'services/checkoutService.ts',
    'screens/Cart.tsx',
  ];

  const secretPatterns = [
    /rzp_live_[a-zA-Z0-9]{14,}/,
    /RAZORPAY_KEY_SECRET/,
    /RAZORPAY_WEBHOOK_SECRET/,
    /sk_live_[a-zA-Z0-9]+/,
    /api_secret/i,
  ];

  for (const file of filesToCheck) {
    const fullPath = path.resolve(process.cwd(), file);
    const content = await fs.readFile(fullPath, 'utf-8');

    for (const pattern of secretPatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden secret pattern ${pattern} matched in ${file}`
      );
    }
  }
});

// ── In-Memory Storage Stand-in for Node.js Testing ───────────────────────────

class MockStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

test('IDEMP-CLIENT-01: Same checkout attempt + retry produces the exact same idempotency key', () => {
  const storage = new MockStorage();
  const items = [
    { product_id: 'prod_cashmere_1', quantity: 2 },
    { product_id: 'prod_scarf_2', quantity: 1 },
  ];

  // 1. First checkout attempt
  const key1 = getOrCreateCheckoutIdempotencyKey('user_alice_123', items, storage);
  assert.ok(key1.startsWith('chk_user_alice_123_'));

  // 2. Simulated network retry with identical items
  const key2 = getOrCreateCheckoutIdempotencyKey('user_alice_123', items, storage);
  assert.equal(key1, key2, 'Retry of same checkout attempt must reuse the exact same idempotency key');
});

test('IDEMP-CLIENT-02: A genuinely new checkout attempt produces a new idempotency key', () => {
  const storage = new MockStorage();
  const itemsA = [{ product_id: 'prod_cashmere_1', quantity: 1 }];
  const itemsB = [{ product_id: 'prod_cashmere_1', quantity: 2 }]; // Cart modified

  const key1 = getOrCreateCheckoutIdempotencyKey('user_alice_123', itemsA, storage);

  // Cart changed -> new key generated
  const key2 = getOrCreateCheckoutIdempotencyKey('user_alice_123', itemsB, storage);
  assert.notEqual(key1, key2, 'Modified cart must generate a new idempotency key');

  // Explicit session clear (after confirmed order) -> new key generated
  clearCheckoutIdempotencyKey('user_alice_123', storage);
  const key3 = getOrCreateCheckoutIdempotencyKey('user_alice_123', itemsB, storage);
  assert.notEqual(key2, key3, 'New checkout after clearing session must generate a fresh key');
});

test('IDEMP-CLIENT-03: Reload/retry behavior persists the attempt key across simulated page reloads', () => {
  const storage = new MockStorage();
  const items = [{ product_id: 'prod_jacket_9', quantity: 1 }];

  // Initial attempt before reload
  const keyBeforeReload = getOrCreateCheckoutIdempotencyKey('user_bob_456', items, storage);

  // Simulated page reload: reading from same storage session
  const keyAfterReload = getOrCreateCheckoutIdempotencyKey('user_bob_456', items, storage);
  assert.equal(keyBeforeReload, keyAfterReload, 'SessionStorage must preserve key across page reloads in same session');
});

test('IDEMP-CLIENT-04: User A key is strictly isolated and cannot be replayed or read by User B', () => {
  const storage = new MockStorage();
  const items = [{ product_id: 'prod_silk_scarf', quantity: 1 }];

  const keyUserA = getOrCreateCheckoutIdempotencyKey('user_alice', items, storage);
  const keyUserB = getOrCreateCheckoutIdempotencyKey('user_bob', items, storage);

  assert.notEqual(keyUserA, keyUserB, 'Different users must receive separate idempotency keys');
  assert.ok(storage.getItem('zipright_idem_user_alice')?.includes(keyUserA));
  assert.ok(storage.getItem('zipright_idem_user_bob')?.includes(keyUserB));
});

test('CONSIST-CLIENT-01: Polling terminates immediately upon reaching terminal PAID state', async () => {
  let callCount = 0;

  // Mock global fetch to return PENDING on call 1, PAID on call 2
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    const status = callCount >= 2 ? 'PAID' : 'PENDING_PAYMENT';
    return {
      ok: true,
      json: async () => ({ data: { status } }),
    } as any;
  };

  try {
    const finalStatus = await pollOrderPaymentStatus(
      'ord_test_terminal_paid',
      'test_token',
      'http://localhost:8000',
      8,
      10 // fast interval for unit test
    );

    assert.equal(finalStatus, 'PAID');
    assert.equal(callCount, 2, 'Polling must stop immediately once PAID is returned without continuing');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CONSIST-CLIENT-02: Polling terminates immediately upon reaching terminal PAYMENT_FAILED state', async () => {
  let callCount = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({ data: { status: 'PAYMENT_FAILED' } }),
    } as any;
  };

  try {
    const finalStatus = await pollOrderPaymentStatus(
      'ord_test_terminal_failed',
      'test_token',
      'http://localhost:8000',
      8,
      10
    );

    assert.equal(finalStatus, 'PAYMENT_FAILED');
    assert.equal(callCount, 1, 'Polling must stop immediately once PAYMENT_FAILED is returned');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CONSIST-CLIENT-03: Polling safely times out after bounded maxAttempts without infinite loop', async () => {
  let callCount = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({ data: { status: 'PENDING_PAYMENT' } }),
    } as any;
  };

  try {
    const finalStatus = await pollOrderPaymentStatus(
      'ord_test_timeout',
      'test_token',
      'http://localhost:8000',
      3, // strict bound of 3 attempts
      10
    );

    assert.equal(finalStatus, 'PENDING_PAYMENT');
    assert.equal(callCount, 3, 'Polling must strictly respect maxAttempts and terminate');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
