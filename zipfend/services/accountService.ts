import {
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { deleteDoc, doc, collection, getDocs } from 'firebase/firestore';
import { deleteObject, getStorage, ref } from 'firebase/storage';
import app, { db } from '../firebase';
import { formatFirebaseAuthError } from '../utils/firebaseErrors';

export interface AccountDeletionResult {
  success: boolean;
  requiresReauth?: boolean;
  error?: string;
}

/**
 * Timeout wrapper ensuring async operations never hang indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Reauthenticate Email/Password user. Password is used ONLY in memory and never logged or stored.
 */
export async function reauthenticateEmail(user: User, password: string): Promise<{ success: boolean; error?: string }> {
  if (!user.email) {
    return { success: false, error: 'User email not found for re-authentication.' };
  }
  if (!password) {
    return { success: false, error: 'Please enter your current password.' };
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await withTimeout(
      reauthenticateWithCredential(user, credential),
      15000,
      'Re-authentication timed out. Please check your network connection.',
    );
    return { success: true };
  } catch (err: any) {
    console.error('[AccountDeletion] Email re-authentication failed:', err);
    if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
      return { success: false, error: 'Incorrect password. Please verify and try again.' };
    }
    return { success: false, error: formatFirebaseAuthError(err, 'Authentication failed. Please try again.') };
  }
}

/**
 * Reauthenticate Google OAuth user using Google Popup flow.
 */
export async function reauthenticateGoogle(user: User): Promise<{ success: boolean; error?: string }> {
  try {
    const provider = new GoogleAuthProvider();
    await withTimeout(
      reauthenticateWithPopup(user, provider),
      30000,
      'Google re-authentication timed out.',
    );
    return { success: true };
  } catch (err: any) {
    console.error('[AccountDeletion] Google re-authentication failed:', err);
    return { success: false, error: formatFirebaseAuthError(err, 'Google re-authentication failed. Please try again.') };
  }
}

/**
 * Permanently deletes the current user's private Firestore documents,
 * subcollections, Firebase Storage files, and Firebase Authentication account.
 * Every step has a deterministic timeout to prevent hanging UI spinners.
 */
export async function deleteAccountPermanently(user: User): Promise<AccountDeletionResult> {
  if (!user || user.isAnonymous) {
    return { success: false, error: 'No authenticated user session found.' };
  }

  const uid = user.uid;

  try {
    // 1. Delete known Storage files. Do not delete the Auth account while
    // private data may still be retained; an operator can then retry safely.
    const storage = getStorage(app);
    const storagePaths = [
      `profiles/${uid}.jpg`,
      `banners/${uid}.jpg`,
    ];

    for (const path of storagePaths) {
      try {
        await withTimeout(
          deleteObject(ref(storage, path)),
          8000,
          `Storage cleanup timeout for ${path}`,
        );
      } catch (err: any) {
        if (err?.code !== 'storage/object-not-found') throw err;
      }
    }

    // 2. Delete client-visible subcollections before deleting the account.
    // Firestore clients cannot enumerate arbitrary nested subcollections.
    const subcollections = ['fitProfiles', 'recommendations', 'smartFitScans', 'blocked'];
    for (const subcol of subcollections) {
      try {
        const subSnap = await withTimeout(
          getDocs(collection(db, 'users', uid, subcol)),
          8000,
          `Firestore lookup timeout for subcollection ${subcol}`,
        );
        for (const subDoc of subSnap.docs) {
          await deleteDoc(subDoc.ref).catch(() => {});
        }
      } catch (err) {
        throw new Error(`Could not remove private ${subcol} data. Please try again.`);
      }
    }

    // 3. Delete Private User Document & Public Profile Projection
    await withTimeout(
      deleteDoc(doc(db, 'users', uid)),
      8000,
      'User document deletion timeout',
    );

    await withTimeout(
      deleteDoc(doc(db, 'publicProfiles', uid)),
      8000,
      'Public profile deletion timeout',
    );

    // 4. Delete Firebase Auth User Account (Must be done LAST with 12s timeout)
    await withTimeout(
      deleteUser(user),
      12000,
      'Authentication account deletion timed out. Please try again.',
    );

    return { success: true };
  } catch (err: any) {
    console.error('[AccountDeletion] Error during account deletion:', err);

    if (err?.code === 'auth/requires-recent-login') {
      return {
        success: false,
        requiresReauth: true,
        error: 'For your security, please verify your identity before deleting your account.',
      };
    }

    return {
      success: false,
      error: formatFirebaseAuthError(err, err?.message || 'Failed to delete account. Please try again.'),
    };
  }
}
