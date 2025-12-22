// Firebase Client for Lingua Bud
// Using ES modules from CDN for static hosting compatibility

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js";

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

// Connect to emulators when running locally
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  console.log('🔧 Using Firebase Emulators');
}

// Export everything needed by other files
export {
  auth,
  db,
  storage,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  ref,
  uploadBytes,
  getDownloadURL
};
