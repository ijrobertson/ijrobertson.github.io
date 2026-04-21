// Route protection for Lingua Bud pages
import { auth, db, onAuthStateChanged, doc, getDoc } from './firebaseClient.js';

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function showRedirectBanner(msg) {
  const overlay = document.getElementById('auth-loading');
  if (overlay) {
    overlay.style.cssText = 'position:fixed;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99998;';
    overlay.innerHTML = `
      <div style="width:44px;height:44px;border:4px solid #e8e8e8;border-top-color:#20bcba;border-radius:50%;animation:authSpin 0.9s linear infinite;"></div>
      <p style="margin-top:1rem;color:#666;font-family:'Segoe UI',sans-serif;font-size:0.95rem;">${msg}</p>`;
  }
}

// Guards a page to only allow users with the given role.
// requiredRole: 'instructor' | 'student'
// Call this once per protected page — it runs independently of any existing onAuthStateChanged.
export function guardPage(requiredRole) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login';
      return;
    }
    if (!requiredRole) return;

    let role = null;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) role = snap.data().role;
    } catch {
      role = safeGet('user_role_cache');
    }

    if (!role || role === requiredRole) return;

    if (role === 'instructor') {
      showRedirectBanner('Redirecting you to your instructor dashboard...');
      setTimeout(() => { window.location.href = 'dashboard'; }, 1500);
    } else {
      showRedirectBanner('Redirecting you to your student dashboard...');
      setTimeout(() => { window.location.href = 'student-dashboard'; }, 1500);
    }
  });
}
