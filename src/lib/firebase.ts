// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import {
  getFunctions,
  type Functions,
  httpsCallable as _httpsCallable,
} from "firebase/functions";

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",

  // ✅ FIXED: Use correct Firebase Storage bucket
  storageBucket: "the-final-project-5e248.firebasestorage.app",

  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

export const isFirebaseConfigured =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.storageBucket &&
  !!firebaseConfig.messagingSenderId &&
  !!firebaseConfig.appId;

/**
 * We export non-null Firebase singletons so builds/typecheck don’t fail
 * (Firebase App Hosting runs a real type-check).
 *
 * If env vars are missing, we fail fast with a clear error.
 */
function assertConfigured(): void {
  if (!isFirebaseConfigured) {
    throw new Error(
      "Firebase is not configured. Missing NEXT_PUBLIC_FIREBASE_* environment variables."
    );
  }
}

assertConfigured();

// Initialize app once
export const app: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// Auth
export const auth: Auth = getAuth(app);

setPersistence(auth, indexedDBLocalPersistence).catch(() => {
  // Persistence can fail in some environments (e.g. private mode) — safe to ignore.
});

// Firestore / Storage
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);

// Cloud Functions (region must match your deployed region)
export const functions: Functions = getFunctions(app, "europe-west2");

// Re-export httpsCallable for use elsewhere
export const httpsCallable = _httpsCallable;
