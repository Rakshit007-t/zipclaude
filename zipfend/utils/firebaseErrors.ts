/**
 * Friendly production error formatter for Firebase Auth and system errors.
 * Ensures raw Firebase codes and internal errors are never displayed to users.
 */
export function formatFirebaseAuthError(error: unknown, fallbackMessage = 'An unexpected error occurred. Please try again.'): string {
  if (!error) return fallbackMessage;

  const errObj = error as { code?: string; message?: string };
  const code = typeof errObj.code === 'string' ? errObj.code : '';
  const rawMsg = typeof errObj.message === 'string' ? errObj.message : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Please sign in instead.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect email or password.';
    case 'auth/user-not-found':
      return 'No account found.';
    case 'auth/network-request-failed':
      return 'No internet connection.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing.';
    case 'auth/cancelled-popup-request':
      return 'Sign-in request was cancelled.';
    case 'auth/invalid-phone-number':
      return 'Enter a valid phone number, including the country code.';
    case 'auth/missing-phone-number':
      return 'Enter your phone number to continue.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This verification code has expired. Request a new code and try again.';
    case 'auth/invalid-verification-code':
      return 'That verification code is invalid. Check the SMS and try again.';
    case 'auth/quota-exceeded':
      return 'SMS delivery is temporarily unavailable. Please try again later.';
    case 'auth/captcha-check-failed':
      return 'Security verification failed. Please try again.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters long.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled.';
    default:
      if (rawMsg.includes('network-request-failed') || rawMsg.includes('network error')) {
        return 'No internet connection.';
      }
      if (rawMsg.includes('invalid-credential') || rawMsg.includes('user-not-found')) {
        return 'Incorrect email or password.';
      }
      if (rawMsg.includes('email-already-in-use')) {
        return 'An account with this email already exists. Please sign in instead.';
      }
      return fallbackMessage;
  }
}
