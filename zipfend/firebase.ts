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

export const auth = getAuth(app);
export const db =
  FIRESTORE_DATABASE_ID === '(default)'
    ? getFirestore(app)
    : getFirestore(app, FIRESTORE_DATABASE_ID);

export default app;
