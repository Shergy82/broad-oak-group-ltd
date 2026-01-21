import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions, httpsCallable as _httpsCallable } from "firebase/functions";

// IMPORTANT:
// Next.js can only inline env vars in the browser when they are referenced directly.
// Do NOT access process.env with dynamic keys like process.env[name].

const firebaseConfig = {
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

export let app: FirebaseApp | null = null;
export let auth: Auth | null = null;
export let db: Firestore | null = null;
export let storage: FirebaseStorage | null = null;
export let functions: Functions | null = null;

if (isFirebaseConfigured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);

  // MUST match the region you deployed callable functions to:
  functions = getFunctions(app, "europe-west2");
}

// Re-export under the same name you were using
export const httpsCallable = _httpsCallable;
