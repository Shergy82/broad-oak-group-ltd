
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, httpsCallable, type Functions } from "firebase/functions";


// Your Firebase project configuration.
const firebaseConfig = {
  apiKey: "AIzaSyAdYOSzCJAN8iKphycmgoUwUwjCZyJ9T-U",
  authDomain: "group-build-29768421-feed1.firebaseapp.com",
  projectId: "group-build-29768421-feed1",
  storageBucket: "group-build-29768421-feed1.firebasestorage.app",
  messagingSenderId: "380758139603",
  appId: "1:380758139603:web:8ff0eab0c5a109436eaa26"
};

// A flag to check if Firebase is configured
export const isFirebaseConfigured = !!firebaseConfig.apiKey;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let functions: Functions | null = null;


if (isFirebaseConfigured && typeof window !== 'undefined') {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    functions = getFunctions(app, 'europe-west2');
} else if (isFirebaseConfigured) {
    // For server-side rendering
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    functions = getFunctions(app, 'europe-west2');
}


export { app, auth, db, storage, functions, httpsCallable };
