import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import {
  getFunctions,
  type Functions,
  httpsCallable as _httpsCallable,
} from "firebase/functions";

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

let _app: FirebaseApp;
let _auth: Auth;
let _db: Firestore;
let _storage: FirebaseStorage;
let _functions: Functions;

if (!isFirebaseConfigured) {
  throw new Error(
    "Firebase is not configured. Check NEXT_PUBLIC_FIREBASE_* env vars."
  );
}

_app = getApps().length ? getApp() : initializeApp(firebaseConfig);
_auth = getAuth(_app);
_db = getFirestore(_app);
_storage = getStorage(_app);

// ✅ MUST match your deployed callable region
_functions = getFunctions(_app, "europe-west2");

export const app = _app;
export const auth = _auth;
export const db = _db;
export const storage = _storage;
export const functions = _functions;

// Re-export under the same name you were using
export const httpsCallable = _httpsCallable;
