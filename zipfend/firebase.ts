import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { agentDebugLog } from "./utils/agentDebugLog";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  // Newer Firebase projects use firebasestorage.app. The prior appspot.com
  // guess pointed uploads at a non-existent bucket, causing profile uploads
  // to fail after a successful file selection/compression step.
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
};

// #region agent log
agentDebugLog('firebase.ts:init', 'firebase config presence', {hasApiKey:Boolean(firebaseConfig.apiKey),hasAuthDomain:Boolean(firebaseConfig.authDomain),hasProjectId:Boolean(firebaseConfig.projectId),hasStorageBucket:Boolean(firebaseConfig.storageBucket),dbIdSet:Boolean(import.meta.env.VITE_FIRESTORE_DATABASE_ID)}, 'B');
// #endregion

let app: FirebaseApp;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  // #region agent log
  agentDebugLog('firebase.ts:init-error', 'firebase initializeApp failed', { message: error instanceof Error ? error.message : String(error) }, 'B');
  // #endregion
  throw error;
}

// Firestore database initialization: defaults to (default) unless a named database is explicitly provided.
const rawDbId = (import.meta.env.VITE_FIRESTORE_DATABASE_ID || '').trim();
const FIRESTORE_DATABASE_ID = rawDbId || '(default)';

const rawAuth = getAuth(app);
export const auth = new Proxy(rawAuth, {
  get(target, prop, receiver) {
    if (import.meta.env.VITE_AUTH_PROVIDER === 'appwrite') {
      if (prop === 'currentUser') {
        try {
          const cached = typeof window !== 'undefined' ? localStorage.getItem('zipright_cached_appwrite_user') : null;
          if (cached) {
            const u = JSON.parse(cached);
            return {
              uid: u.$id,
              email: u.email,
              displayName: u.name,
              photoURL: null,
              phoneNumber: u.phone || null,
              isAnonymous: false,
              emailVerified: Boolean(u.emailVerification),
              getIdToken: async () => '',
              providerData: [{ providerId: u.phone ? 'phone' : 'password' }],
            };
          }
        } catch {}
        return null;
      }
    }
    const val = Reflect.get(target, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  }
});

export const db =
  FIRESTORE_DATABASE_ID === '(default)'
    ? getFirestore(app)
    : getFirestore(app, FIRESTORE_DATABASE_ID);

export default app;
