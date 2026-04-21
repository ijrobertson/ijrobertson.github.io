// Shared auth utilities for Lingua Bud
import { auth, db, onAuthStateChanged, doc, getDoc } from './firebaseClient.js';

export function redirectByRole(role) {
  if (role === 'instructor') window.location.href = '/dashboard';
  else if (role === 'student') window.location.href = '/student-dashboard';
}

export async function fetchUserRole(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists() && snap.data().role) {
      const role = snap.data().role;
      try { localStorage.setItem('user_role_cache', role); } catch {}
      return role;
    }
  } catch {}
  try { return localStorage.getItem('user_role_cache'); } catch { return null; }
}

// Auto-redirects logged-in users to their dashboard. Use on public landing pages.
export function initAutoRedirect() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const role = await fetchUserRole(user.uid);
    if (role) redirectByRole(role);
  });
}
