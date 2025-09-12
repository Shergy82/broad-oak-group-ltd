
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, httpsCallable, type Functions } from "firebase/functions";


// Your Firebase project configuration.
const firebaseConfig = {
  apiKey: "AIzaSyCmch6jop04hdM0GhAq4RmYv9CuH_TRH3w",
  authDomain: "broad-oak-build-live.firebaseapp.com",
  projectId: "broad-oak-build-live",
  storageBucket: "broad-oak-build-live.appspot.com",
  messagingSenderId: "510466083182",
  appId: "1:510466083182:web:6261a80a83ee1fc31bd97f",
};

// A flag to check if Firebase is configured
export const isFirebaseConfigured = !!firebaseConfig.apiKey;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let functions: Functions | null = null;


if (isFirebaseConfigured) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    functions = getFunctions(app, 'europe-west2');
} else {
    // This console.error is helpful for server-side debugging
    console.error("Firebase not configured. Please check your .env.local file.");
}

export { app, auth, db, storage, functions, httpsCallable };
