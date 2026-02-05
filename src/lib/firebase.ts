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
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
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

// IMPORTANT: use nulls when not configured (never export fake {} objects)
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let functions: Functions | null = null;

if (isFirebaseConfigured) {
  // Initialize app once
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  auth = getAuth(app);
  setPersistence(auth, indexedDBLocalPersistence).catch(() => {});

  db = getFirestore(app);
  storage = getStorage(app);

  // Ensure your functions are deployed to the same region.
  functions = getFunctions(app, "europe-west2");
} else {
  console.error("Firebase is not configured. Check your environment variables.");
}

// Re-export httpsCallable for use in other parts of the app.
export const httpsCallable = _httpsCallable;

// NOTE: these are nullable now — code using them must handle null
export { app, auth, db, storage, functions };
