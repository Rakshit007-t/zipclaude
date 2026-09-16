import test from 'node:test';
import assert from 'node:assert/strict';
import type * as Sentry from '@sentry/react';
import {
  isSensitiveKey,
  hashUserId,
  sanitizeData,
  sanitizeUrl,
  beforeSendFilter,
  beforeBreadcrumbFilter,
  initSentry,
  isSentryInitialized,
} from '../services/sentry';

test('isSensitiveKey correctly flags all protected and confidential fields', () => {
  // Auth & credentials
  assert.equal(isSensitiveKey('password'), true);
  assert.equal(isSensitiveKey('current_password'), true);
  assert.equal(isSensitiveKey('token'), true);
  assert.equal(isSensitiveKey('id_token'), true);
  assert.equal(isSensitiveKey('refresh_token'), true);
  assert.equal(isSensitiveKey('firebase_credentials'), true);
  assert.equal(isSensitiveKey('api_key'), true);

  // Biometrics & customer media
  assert.equal(isSensitiveKey('biometric'), true);
  assert.equal(isSensitiveKey('face_crop'), true);
  assert.equal(isSensitiveKey('avatar_image'), true);
  assert.equal(isSensitiveKey('selfie'), true);
  assert.equal(isSensitiveKey('photo_url'), true);
  assert.equal(isSensitiveKey('signed_url'), true);
  assert.equal(isSensitiveKey('download_token'), true);

  // Fit & measurements
  assert.equal(isSensitiveKey('bust'), true);
  assert.equal(isSensitiveKey('waist'), true);
  assert.equal(isSensitiveKey('hips'), true);
  assert.equal(isSensitiveKey('chest'), true);
  assert.equal(isSensitiveKey('height'), true);
  assert.equal(isSensitiveKey('weight'), true);
  assert.equal(isSensitiveKey('fit_profiles'), true);
  assert.equal(isSensitiveKey('smart_fit'), true);
  assert.equal(isSensitiveKey('body_shape'), true);

  // Payments & secrets
  assert.equal(isSensitiveKey('razorpay_payment_id'), true);
  assert.equal(isSensitiveKey('card_number'), true);
  assert.equal(isSensitiveKey('cvv'), true);

  // User PII
  assert.equal(isSensitiveKey('email'), true);
  assert.equal(isSensitiveKey('phone'), true);
  assert.equal(isSensitiveKey('phone_number'), true);
  assert.equal(isSensitiveKey('full_name'), true);
  assert.equal(isSensitiveKey('address'), true);

  // Private messages
  assert.equal(isSensitiveKey('chat_content'), true);
  assert.equal(isSensitiveKey('private_message'), true);

  // Safe non-sensitive keys
  assert.equal(isSensitiveKey('product_id'), false);
  assert.equal(isSensitiveKey('category'), false);
  assert.equal(isSensitiveKey('brand_name'), false);
  assert.equal(isSensitiveKey('status'), false);
});

test('hashUserId provides a non-reversible identifier and never leaks raw ID', () => {
  const rawId = 'firebase_user_abc_7788';
  const hashed = hashUserId(rawId);

  assert.ok(hashed);
  assert.notEqual(hashed, rawId);
  assert.ok(hashed?.startsWith('anon_'));
  assert.equal(hashUserId(undefined), undefined);
  assert.equal(hashUserId(''), undefined);
});

test('sanitizeData redacts sensitive keys and nested objects recursively', () => {
  const input = {
    brand: 'Studio Atelier',
    category: 'jackets',
    account: {
      password: 'plain_secret_password',
      email: 'customer@domain.com',
      auth_token: 'jwt.token.abc',
    },
    fit_measurements: {
      bust: 94,
      waist: 76,
      hips: 100,
    },
    user_preferences: {
      bust: 94,
      waist: 76,
      color: 'navy',
    },
    payment: {
      razorpay_payment_id: 'pay_9999',
    },
    storage_media:
      'https://firebasestorage.googleapis.com/v0/b/bucket/o/private%2Favatar.png?alt=media&token=secret-download-token',
  };

  const output = sanitizeData(input) as any;

  assert.equal(output.brand, 'Studio Atelier');
  assert.equal(output.category, 'jackets');
  assert.equal(output.account.password, '[REDACTED]');
  assert.equal(output.account.email, '[REDACTED]');
  assert.equal(output.account.auth_token, '[REDACTED]');
  assert.equal(output.fit_measurements, '[REDACTED]');
  assert.equal(output.user_preferences.bust, '[REDACTED]');
  assert.equal(output.user_preferences.waist, '[REDACTED]');
  assert.equal(output.user_preferences.color, 'navy');
  assert.equal(output.payment.razorpay_payment_id, '[REDACTED]');
  assert.ok(output.storage_media.includes('token=[REDACTED]'));
  assert.ok(!output.storage_media.includes('secret-download-token'));
});

test('sanitizeUrl redacts sensitive query parameters', () => {
  const url = 'https://app.zipright.ai/api/v1/store?view=grid&token=private_123&sig=hmac_99&page=2';
  const sanitized = sanitizeUrl(url);

  assert.ok(sanitized.includes('view=grid'));
  assert.ok(sanitized.includes('page=2'));
  assert.ok(sanitized.includes('token=[REDACTED]'));
  assert.ok(sanitized.includes('sig=[REDACTED]'));
  assert.ok(!sanitized.includes('private_123'));
});

test('beforeSendFilter scrubs user PII, request headers, extra data, and hashes user ID', () => {
  const mockEvent: Sentry.ErrorEvent = {
    event_id: 'evt_test_123',
    user: {
      id: 'customer_uid_445566',
      email: 'shopper@zipright.ai',
      username: 'chic_shopper',
      ip_address: '198.51.100.22',
      name: 'Jane Doe',
      phone: '+15550199',
    } as Sentry.User,
    request: {
      url: 'https://app.zipright.ai/checkout?token=checkout_secret_abc',
      headers: {
        Authorization: 'Bearer id_token_123',
        Cookie: 'session=secret_session_id',
        'User-Agent': 'ZipRIGHT Mobile',
      },
      data: {
        bust: 88,
        waist: 70,
        clothing_category: 'dress',
      },
    },
    extra: {
      razorpay_key_secret: 'rzp_sec_secret',
      app_mode: 'production',
    },
  };

  const scrubbed = beforeSendFilter(mockEvent);

  assert.ok(scrubbed);

  // User PII stripped
  assert.equal(scrubbed.user?.email, undefined);
  assert.equal(scrubbed.user?.username, undefined);
  assert.equal(scrubbed.user?.ip_address, undefined);
  assert.equal((scrubbed.user as Record<string, unknown> | undefined)?.phone, undefined);
  assert.equal((scrubbed.user as Record<string, unknown> | undefined)?.name, undefined);

  // User ID hashed
  assert.notEqual(scrubbed.user?.id, 'customer_uid_445566');
  assert.ok(scrubbed.user?.id?.startsWith('anon_'));

  // Request scrubbed
  assert.ok(scrubbed.request?.url?.includes('token=[REDACTED]'));
  assert.equal(scrubbed.request?.headers?.Authorization, '[REDACTED]');
  assert.equal(scrubbed.request?.headers?.Cookie, '[REDACTED]');
  assert.equal(scrubbed.request?.headers?.['User-Agent'], 'ZipRIGHT Mobile');
  assert.equal((scrubbed.request?.data as Record<string, unknown>)?.bust, '[REDACTED]');
  assert.equal((scrubbed.request?.data as Record<string, unknown>)?.clothing_category, 'dress');

  // Extra scrubbed
  assert.equal(scrubbed.extra?.razorpay_key_secret, '[REDACTED]');
  assert.equal(scrubbed.extra?.app_mode, 'production');
});

test('beforeBreadcrumbFilter sanitizes tokenized URLs and breadcrumb messages', () => {
  const crumb: Sentry.Breadcrumb = {
    type: 'http',
    category: 'fetch',
    data: {
      url: 'https://firebasestorage.googleapis.com/v0/b/bucket/o/avatar.jpg?alt=media&token=secret_dl_token',
      status_code: 200,
    },
    message: 'Authorized upload Bearer private_secret_token_123',
  };

  const cleaned = beforeBreadcrumbFilter(crumb);

  assert.ok(cleaned.data?.url.includes('token=[REDACTED]'));
  assert.ok(!cleaned.data?.url.includes('secret_dl_token'));
  assert.ok(cleaned.message?.includes('Bearer [REDACTED]'));
  assert.ok(!cleaned.message?.includes('private_secret_token_123'));
});

test('initSentry skips safely when VITE_SENTRY_DSN is absent', () => {
  // In test environment, import.meta.env.VITE_SENTRY_DSN is not configured
  const initialized = initSentry();
  assert.equal(initialized, false);
});
