// Push notifications (Firebase Cloud Messaging).
//
// Deliberately separate from js/app-shell.js, which stays Firebase-free by
// design (see its own header comment) — pages import this module directly
// rather than it being baked into the shared shell.
//
// Notification permission is NEVER requested on page load — only from
// requestPushPermissionAndRegister(), called from an explicit user action
// (flipping the "push notifications" toggle in Notification Settings). A
// denied native prompt is remembered by the browser with no easy re-ask, so
// timing matters — see docs/PWA_PRD.md §13.
//
// Foreground messages don't use Firebase's onMessage()/onBackgroundMessage()
// API — sw.js's raw `push` handler postMessage()s a focused client directly,
// and initPush()'s serviceWorker 'message' listener below is the other half
// of that bridge. See sw.js for why (avoids a second copy of firebaseConfig
// in a different SDK flavor inside the service worker).

import { app, db, doc, setDoc, serverTimestamp, getMessaging, getToken } from '../lib/firebaseClient.js';

// Safe to hardcode client-side — same public-config convention already used
// for the Firebase API key in lib/firebaseClient.js.
const VAPID_PUBLIC_KEY = 'BNYRoqKS4FFGg9dBniIWrCALI7r5bK8-6l0_qQMn5P7D38Fakb86lul93eqnsGo7klnZ-EuG65V1mMN2lz4VdEU';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Default foreground display for any page that doesn't pass its own
// onForegroundMessage — without this, a push that arrives while the app is
// open on, say, home.html or the dashboard would vanish silently: the
// service worker routes foreground pushes to postMessage() rather than a
// native notification (see sw.js), and if nothing on the page is listening
// for that message, nothing is ever shown. Visual style matches the toast
// pattern already used in js/save-word-widget.js / vocab-quiz.html.
function showDefaultToast(payload) {
  const existing = document.querySelector('.lb-push-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'lb-push-toast';
  toast.setAttribute('style', [
    'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
    'background:#113448', 'color:#fff', 'padding:12px 20px', 'border-radius:999px',
    'font-size:14px', 'font-weight:600', 'font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    'z-index:2000', 'box-shadow:0 8px 20px -6px rgba(17,52,72,0.5)',
    'opacity:0', 'transition:opacity 200ms ease', 'cursor:pointer', 'max-width:90vw',
  ].join(';'));
  toast.textContent = payload.body ? `${payload.title}: ${payload.body}` : payload.title;
  toast.addEventListener('click', () => {
    if (payload.url) window.location.href = payload.url;
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

async function registerToken(uid) {
  const swReg = await navigator.serviceWorker.ready;
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: swReg });
  if (!token) return null;

  // Nested-map merge: only adds/overwrites this one token's entry, leaving
  // any other device's token already on the doc untouched.
  await setDoc(doc(db, 'fcmTokens', uid), {
    tokens: {
      [token]: {
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        userAgent: navigator.userAgent,
      },
    },
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return token;
}

/**
 * Call on every page load for a signed-in user. Silently refreshes the
 * stored FCM token if permission is already granted — a no-op otherwise,
 * never prompts. Also wires the service worker's foreground-push bridge so
 * a push that arrives while this page is open shows *something* — pass
 * onForegroundMessage for page-specific handling (e.g. messages.html
 * suppresses the toast for whichever conversation is already open); every
 * other page gets a generic toast by default rather than showing nothing.
 */
export async function initPush(uid, { onForegroundMessage } = {}) {
  if (!pushSupported() || !uid) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'lb-push-foreground') {
      (onForegroundMessage || showDefaultToast)(event.data.payload);
    }
  });

  if (Notification.permission === 'granted') {
    try {
      await registerToken(uid);
    } catch (e) {
      console.error('Push token refresh error:', e);
    }
  }
}

/**
 * Call from the explicit toggle-flip action only. Requests browser
 * permission (a one-shot native prompt) and, if granted, registers the
 * device's token. Returns true only on a real, successful grant +
 * registration — callers should only persist their preference field as true
 * on a true return, and revert the toggle otherwise.
 */
export async function requestPushPermissionAndRegister(uid) {
  if (!pushSupported()) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;
    const token = await registerToken(uid);
    return !!token;
  } catch (e) {
    console.error('Push permission/registration error:', e);
    return false;
  }
}
