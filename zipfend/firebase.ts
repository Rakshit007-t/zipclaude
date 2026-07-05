import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
};

const app = initializeApp(firebaseConfig);

// This project's Firestore data lives in a named database (created by the AI
// Studio deployment; see firebase-applet-config.json), not in "(default)" —
// which does not exist for this project.
const FIRESTORE_DATABASE_ID =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID || 'ai-studio-b0abadf0-fee1-4a8b-ad1b-c9b670ea63a7';

export const auth = getAuth(app);
export const db = getFirestore(app, FIRESTORE_DATABASE_ID);

export default app;
