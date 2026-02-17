// Firebase Client for Lingua Bud
// Using ES modules from CDN for static hosting compatibility

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, updateDoc, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js";
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
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  ref,
  uploadBytes,
  getDownloadURL,
  httpsCallable
};
