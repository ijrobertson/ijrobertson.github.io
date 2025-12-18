// Firebase Client for Lingua Bud
// Using ES modules from CDN for static hosting compatibility

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

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

// Export everything needed by other files
export {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs
};
