
// src/lib/firebase.ts

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import {
  getFunctions,
  httpsCallable as _httpsCallable,
  type Functions,
} from 'firebase/functions';

/* =========================
   Firebase configuration
   ========================= */

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,

  // ✅ Correct App Hosting storage bucket
  storageBucket: 'the-final-project-5e248.firebasestorage.app',

  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

/* =========================
   Config validation (fail fast)
   ========================= */

function assertConfigured() {
  for (const [key, value] of Object.entries(firebaseConfig)) {
    if (!value) {
      throw new Error(
        `Firebase is not configured correctly. Missing value for ${key}`
      );
    }
  }
}

assertConfigured();

/* =========================
   Firebase App (singleton)
   ========================= */

export const app: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/* =========================
   Auth
   ========================= */

export const auth: Auth = getAuth(app);

// IndexedDB persistence (safe to ignore failures)
setPersistence(auth, indexedDBLocalPersistence).catch(() => {});

/* =========================
   Firestore / Storage
   ========================= */

export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);

/* =========================
   Cloud Functions (CENTRALIZED)
   ========================= */

export const functions: Functions = getFunctions(app, 'europe-west2');

/* =========================
   Re-export helper
   ========================= */

export const httpsCallable = _httpsCallable;

export const isFirebaseConfigured = true;
