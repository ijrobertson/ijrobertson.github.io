// Firebase Client for Lingua Bud
// Using ES modules from CDN for static hosting compatibility

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged as _onAuthStateChanged, deleteUser, sendPasswordResetEmail, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocFromServer, setDoc, deleteDoc, collection, collectionGroup, getDocs, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, updateDoc, arrayUnion, arrayRemove, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-functions.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCQkMgY7a6t-qEcBiAO2tAhsdwbEIy9KKI",
  authDomain: "linguabud-9a942.firebaseapp.com",
  projectId: "linguabud-9a942",
  storageBucket: "linguabud-9a942.firebasestorage.app",
  messagingSenderId: "752734519356",
  appId: "1:752734519356:web:d85200d4c3dd6728e44339",
  measurementId: "G-2BEQ0MFFR6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Keep users logged in across browser restarts unless they explicitly sign out
setPersistence(auth, browserLocalPersistence).catch(err => console.warn('Auth persistence error:', err));

const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// Connect to Firebase Emulators for local development
// Check if running locally (localhost, 127.0.0.1, or private IP ranges)
const isLocal = location.hostname === 'localhost'
  || location.hostname === '127.0.0.1'
  || location.hostname.startsWith('192.168.')
  || location.hostname.startsWith('172.')
  || location.hostname.startsWith('10.');

if (isLocal) {
  // Use the same hostname as the web app to connect to emulators
  const emulatorHost = location.hostname;

  try {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
    connectStorageEmulator(storage, emulatorHost, 9199);
    connectFunctionsEmulator(functions, emulatorHost, 5001);
    console.log(`🔧 Connected to Firebase Emulators at ${emulatorHost}`);
  } catch (error) {
    console.warn('Failed to connect to emulators:', error);
  }
}

// ── Mobile-safe onAuthStateChanged ──────────────────────────────────────────
//
// Problem: on mobile (iOS Safari, Chrome Android), Firebase can fire the raw
// onAuthStateChanged callback with null BEFORE it finishes reading the persisted
// auth token from IndexedDB. Pages that redirect unauthenticated users to login
// see this false null and redirect — even though the user is logged in.
//
// Fix strategy:
//  1. Register _onAuthStateChanged immediately so pages are never stuck forever.
//  2. If the first value is a real user (non-null), call the callback right away —
//     a logged-in result is never a false positive.
//  3. If the first value is null, hold it until authStateReady() settles (or a
//     5-second timeout fires). Only then forward null to the page, confirming the
//     user really is not logged in.
//  4. After the initial settle, all subsequent calls (sign-in / sign-out events)
//     pass through immediately — normal behaviour is restored.
//
const AUTH_READY_TIMEOUT_MS = 5000;

function onAuthStateChanged(authInstance, callback) {
  // Build a promise that resolves once Firebase has definitively read auth state
  // from storage, or after AUTH_READY_TIMEOUT_MS if it hangs (iOS IndexedDB issue).
  let readyPromise;
  try {
    const rawReady = (typeof authInstance.authStateReady === 'function')
      ? authInstance.authStateReady()
      : Promise.resolve();
    readyPromise = Promise.race([
      rawReady,
      new Promise(resolve => setTimeout(resolve, AUTH_READY_TIMEOUT_MS))
    ]);
  } catch(e) {
    readyPromise = Promise.resolve();
  }

  let authStateResolved = false;
  readyPromise
    .then(() => { authStateResolved = true; })
    .catch(() => { authStateResolved = true; });

  // lastUser tracks the most recent value so deferred null checks stay correct.
  let lastUser;

  const unsub = _onAuthStateChanged(authInstance, (user) => {
    lastUser = user;

    if (user !== null) {
      // Logged-in state is never a false positive — forward immediately.
      callback(user);
    } else if (authStateResolved) {
      // Auth state already settled — null means genuinely not logged in.
      callback(null);
    } else {
      // null arrived before storage read finished — wait for confirmation
      // before forwarding, to avoid false logouts on mobile.
      readyPromise
        .then(() => { if (lastUser === null) callback(null); })
        .catch(() => { if (lastUser === null) callback(null); });
    }
  });

  return unsub;
}

// Export everything needed by other files
export {
  auth,
  db,
  storage,
  functions,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  addDoc,
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  arrayRemove,
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  httpsCallable,
  sendPasswordResetEmail
};
