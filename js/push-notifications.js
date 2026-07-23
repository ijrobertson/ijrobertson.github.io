// Push notifications (Firebase Cloud Messaging).
//
// Deliberately separate from js/app-shell.js, which stays Firebase-free by
// design (see its own header comment) — pages import this module directly
// rather than it being baked into the shared shell.
//
// Notification permission is NEVER requested on page load — only from a real
// user gesture, either the "push notifications" toggle in Notification
// Settings, or the one-time soft-ask banner below (shown automatically after
// installing the PWA, but still gated on the user tapping "Enable" — iOS
// Safari will not show the native permission prompt without a direct tap,
// even right after install, so a truly silent auto-enable isn't possible).
// A denied native prompt is remembered by the browser with no easy re-ask,
// so timing matters — see docs/PWA_PRD.md §13.
//
// Foreground messages don't use Firebase's onMessage()/onBackgroundMessage()
// API — sw.js's raw `push` handler postMessage()s a focused client directly,
// and initPush()'s serviceWorker 'message' listener below is the other half
// of that bridge. See sw.js for why (avoids a second copy of firebaseConfig
// in a different SDK flavor inside the service worker).

import { app, db, doc, getDoc, setDoc, serverTimestamp, getMessaging, getToken } from '../lib/firebaseClient.js';

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
    if (!payload.url) return;
    // Same conversationId-as-query-param convention as sw.js's
    // notificationclick handler, so messages.html can deep-link to the
    // right thread instead of just opening the generic messages list.
    let url = payload.url;
    if (payload.conversationId) {
      url += (url.includes('?') ? '&' : '?') + 'conversationId=' + encodeURIComponent(payload.conversationId);
    }
    window.location.href = url;
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ── First-launch soft ask ────────────────────────────────────────────────
// Shown automatically the first time someone opens the app after installing
// it to their home screen — the closest thing to "auto-enable" that iOS
// actually allows, since Notification.requestPermission() only works from a
// direct user gesture. Shown at most once ever per device (tracked in
// localStorage), and only when permission hasn't already been decided either
// way, so it never re-nags someone who granted or denied it previously.
const SOFT_ASK_SHOWN_KEY = 'lb_push_soft_ask_shown';

function isStandalonePWA() {
  // display-mode:standalone covers installed PWAs generally; navigator.standalone
  // is the older iOS-specific signal, kept as a fallback for older Safari versions.
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function shouldShowSoftAsk() {
  if (!isStandalonePWA()) return false;
  if (Notification.permission !== 'default') return false;
  try {
    return !localStorage.getItem(SOFT_ASK_SHOWN_KEY);
  } catch (e) {
    return false; // e.g. Safari private mode — be conservative, don't risk re-showing every load
  }
}

function markSoftAskShown() {
  try { localStorage.setItem(SOFT_ASK_SHOWN_KEY, '1'); } catch (e) {}
}

// Same "check instructors first" pattern used throughout this codebase
// (e.g. sendMessageNotification in functions/index.js) to find which
// collection a user's preference fields actually live on.
async function resolvePreferenceDocRef(uid) {
  const instructorSnap = await getDoc(doc(db, 'instructors', uid));
  return instructorSnap.exists() ? doc(db, 'instructors', uid) : doc(db, 'users', uid);
}

function showSoftAskBanner(uid) {
  // Mark as shown immediately (not after a decision) — if the user reloads
  // mid-thought, or navigates away without tapping either button, it still
  // won't reappear. A missed opportunity is far less annoying than a nag.
  markSoftAskShown();

  const banner = document.createElement('div');
  banner.className = 'lb-push-softask';
  banner.setAttribute('style', [
    'position:fixed', 'left:16px', 'right:16px', 'bottom:100px', 'z-index:2100',
    'background:#fff', 'border:2px solid #e7e9e7', 'border-radius:20px', 'padding:1.1rem 1.25rem',
    'box-shadow:0 16px 36px -14px rgba(17,52,72,0.35)',
    'font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    'opacity:0', 'transition:opacity 200ms ease',
  ].join(';'));
  banner.innerHTML = `
    <div style="font-weight:700;font-size:1rem;color:#113448;margin-bottom:0.3rem;">Stay in the loop</div>
    <div style="font-size:0.88rem;color:#5f6b72;margin-bottom:0.9rem;line-height:1.4;">Get notified about new messages and daily practice reminders.</div>
    <div style="display:flex;gap:0.6rem;">
      <button type="button" id="lb-push-softask-enable" style="flex:1;border:none;border-radius:999px;padding:0.6rem 1rem;font-weight:700;font-size:0.9rem;cursor:pointer;background:#0b6664;color:#fff;">Enable</button>
      <button type="button" id="lb-push-softask-dismiss" style="border:none;border-radius:999px;padding:0.6rem 1rem;font-weight:700;font-size:0.9rem;cursor:pointer;background:#eef1f0;color:#5f6b72;">Not now</button>
    </div>
  `;
  document.body.appendChild(banner);
  requestAnimationFrame(() => { banner.style.opacity = '1'; });

  const removeBanner = () => {
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 200);
  };

  banner.querySelector('#lb-push-softask-dismiss').addEventListener('click', removeBanner);
  banner.querySelector('#lb-push-softask-enable').addEventListener('click', async () => {
    const enableBtn = banner.querySelector('#lb-push-softask-enable');
    enableBtn.disabled = true;
    enableBtn.textContent = 'Enabling…';
    const granted = await requestPushPermissionAndRegister(uid);
    if (granted) {
      try {
        const prefDocRef = await resolvePreferenceDocRef(uid);
        await setDoc(prefDocRef, { messagePushEnabled: true, dailyReminderEnabled: true }, { merge: true });
      } catch (e) {
        console.error('Error saving push preferences from soft-ask:', e);
      }
    }
    removeBanner();
  });
}

// FCM web tokens are long-lived and don't need re-verifying every single
// page load — doing so anyway (an earlier version of this file did) meant a
// real network round-trip to Google's messaging servers on every navigation,
// competing for bandwidth/CPU with whatever else that page was doing (e.g.
// messages.html's own live listeners, or a notebook save mid-flight), which
// showed up as real, reported lag switching tabs and sending messages.
// Once a day is plenty.
const TOKEN_REFRESH_KEY = 'lb_push_token_refreshed_at';
const TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

function shouldRefreshToken() {
  try {
    const last = localStorage.getItem(TOKEN_REFRESH_KEY);
    return !last || (Date.now() - parseInt(last, 10)) > TOKEN_REFRESH_INTERVAL_MS;
  } catch (e) {
    return true; // be safe — still allow a refresh if localStorage is unavailable
  }
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

  try { localStorage.setItem(TOKEN_REFRESH_KEY, String(Date.now())); } catch (e) {}
  return token;
}

/**
 * Call on every page load for a signed-in user. Refreshes the stored FCM
 * token if permission is already granted — but at most once a day (see
 * shouldRefreshToken above), and never prompts. Also wires the service
 * worker's foreground-push bridge so a push that arrives while this page is
 * open shows *something* — pass onForegroundMessage for page-specific
 * handling (e.g. messages.html suppresses the toast for whichever
 * conversation is already open); every other page gets a generic toast by
 * default rather than showing nothing.
 */
export async function initPush(uid, { onForegroundMessage } = {}) {
  if (!pushSupported() || !uid) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'lb-push-foreground') {
      (onForegroundMessage || showDefaultToast)(event.data.payload);
    }
  });

  if (Notification.permission === 'granted') {
    if (shouldRefreshToken()) {
      try {
        await registerToken(uid);
      } catch (e) {
        console.error('Push token refresh error:', e);
      }
    }
  } else if (shouldShowSoftAsk()) {
    showSoftAskBanner(uid);
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
