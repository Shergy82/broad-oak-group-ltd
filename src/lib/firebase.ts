import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
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

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let storage: FirebaseStorage;
let functions: Functions;

// This check ensures we only initialize Firebase once.
if (!getApps().length) {
  if (isFirebaseConfigured) {
    app = initializeApp(firebaseConfig);
  } else {
    // In a real app, you might want to show a more user-friendly error
    // or have a fallback experience if Firebase isn't configured.
    console.error("Firebase is not configured. Check your .env.local file.");
    // We'll create dummy objects to prevent the app from crashing.
    app = {} as FirebaseApp;
  }
} else {
  app = getApp();
}

if (isFirebaseConfigured) {
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  // Ensure your functions are deployed to the same region.
  functions = getFunctions(app, "europe-west2");
} else {
  auth = {} as Auth;
  db = {} as Firestore;
  storage = {} as FirebaseStorage;
  functions = {} as Functions;
}

// Re-export httpsCallable for use in other parts of the app.
export const httpsCallable = _httpsCallable;
export { app, auth, db, storage, functions };
