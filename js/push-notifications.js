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

// TODO(Ian): replace with the real key from Firebase Console → Project
// Settings → Cloud Messaging tab → Web configuration → "Generate key pair".
// Safe to hardcode client-side — same public-config convention already used
// for the Firebase API key in lib/firebaseClient.js.
const VAPID_PUBLIC_KEY = 'REPLACE_WITH_REAL_VAPID_KEY';

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
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
 * never prompts. Pass onForegroundMessage to also wire the service worker's
 * foreground-push bridge (only needed where a page wants to show a toast for
 * a push that arrives while it's open, e.g. messages.html).
 */
export async function initPush(uid, { onForegroundMessage } = {}) {
  if (!pushSupported() || !uid) return;

  if (onForegroundMessage) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'lb-push-foreground') {
        onForegroundMessage(event.data.payload);
      }
    });
  }

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
