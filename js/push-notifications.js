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

// Instructors get their own reminder (2026-11-16): a missed booking costs
// them a student, so unlike the one-time student ask it comes back a week
// after "Not now", for as long as notifications are still undecided. Kept on
// a separate key so instructors who already dismissed the old one-time banner
// still see this one. A denied native prompt is never re-asked (the browser
// wouldn't show it anyway).
const INSTRUCTOR_ASK_KEY = 'lb_push_instructor_ask_at';
const INSTRUCTOR_ASK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function shouldShowInstructorAsk() {
  if (!isStandalonePWA()) return false;
  if (Notification.permission !== 'default') return false;
  try {
    const last = parseInt(localStorage.getItem(INSTRUCTOR_ASK_KEY) || '0', 10);
    return !last || (Date.now() - last) > INSTRUCTOR_ASK_INTERVAL_MS;
  } catch (e) {
    return false;
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

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Replaces the banner's description with the outcome of tapping Enable.
function showSoftAskResult(banner, text, ok) {
  const desc = banner.querySelector('.lb-push-softask-text');
  if (!desc) return;
  desc.textContent = text;
  desc.style.color = ok ? '#0b6664' : '#5f6b72';
  desc.style.fontWeight = ok ? '700' : '400';
}

function showSoftAskBanner(uid, { instructor = false } = {}) {
  // Mark as shown immediately (not after a decision) — if the user reloads
  // mid-thought, or navigates away without tapping either button, it still
  // won't reappear. A missed opportunity is far less annoying than a nag.
  markSoftAskShown();
  if (instructor) {
    try { localStorage.setItem(INSTRUCTOR_ASK_KEY, String(Date.now())); } catch (e) {}
  }
  const title = instructor ? 'Never miss a booking' : 'Stay in the loop';
  const text = instructor
    ? 'Turn on notifications to hear right away when a student books a lesson or sends you a message.'
    : 'Get notified about new messages and daily practice reminders.';

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
    <div style="font-weight:700;font-size:1rem;color:#113448;margin-bottom:0.3rem;">${title}</div>
    <div class="lb-push-softask-text" style="font-size:0.88rem;color:#5f6b72;margin-bottom:0.9rem;line-height:1.4;">${text}</div>
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
    const dismissBtn = banner.querySelector('#lb-push-softask-dismiss');
    enableBtn.disabled = true;
    enableBtn.textContent = 'Enabling…';
    const result = await enablePush(uid);
    if (result === 'enabled' || result === 'pending') {
      // Permission is what matters: if registering didn't finish, it's
      // retried automatically on the next page load. Saved in the
      // background so a slow connection can't hold the banner open.
      resolvePreferenceDocRef(uid)
        .then((ref) => setDoc(ref, { messagePushEnabled: true, dailyReminderEnabled: true }, { merge: true }))
        .catch((e) => console.error('Error saving push preferences from soft-ask:', e));
      showSoftAskResult(banner, 'Notifications are on', true);
      enableBtn.textContent = '✓';
      dismissBtn.remove();
      setTimeout(removeBanner, 1800);
      return;
    }
    if (result === 'denied') {
      showSoftAskResult(banner, isIOS()
        ? 'Notifications are turned off for Lingua Bud. To turn them on, open your iPhone Settings → Notifications → Lingua Bud.'
        : "Notifications are blocked for Lingua Bud. You can allow them in your browser's site settings.", false);
      dismissBtn.textContent = 'OK';
      enableBtn.remove();
      return;
    }
    // 'error' / 'unsupported': let them try again rather than leave the
    // button stuck.
    showSoftAskResult(banner, "Couldn't turn on notifications. Please try again.", false);
    enableBtn.disabled = false;
    enableBtn.textContent = 'Try again';
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
    // One-time refresh after 2026-11-17 so every install records its origin.
    if (!localStorage.getItem('lb_push_token_origin_v1')) { localStorage.setItem('lb_push_token_origin_v1', '1'); return true; }
    const last = localStorage.getItem(TOKEN_REFRESH_KEY);
    return !last || (Date.now() - parseInt(last, 10)) > TOKEN_REFRESH_INTERVAL_MS;
  } catch (e) {
    return true; // be safe — still allow a refresh if localStorage is unavailable
  }
}

// Every step here can stall on a real phone (2026-11-16 report: the
// "Enabling…" button never finished): serviceWorker.ready waits forever if
// the worker failed to install (e.g. its workbox import didn't download on a
// first launch), getToken talks to Google's push servers, and setDoc only
// resolves once Firestore's server confirms. So each step has a time limit,
// and the token save isn't waited on (Firestore keeps it queued and sends it
// when the connection is back).
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function getWorkerRegistration() {
  // Make sure the worker is registered (harmless if it already is), then
  // wait for it to be active.
  // Not awaited: registering can itself stall (it downloads sw.js).
  try { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); } catch (e) {}
  return withTimeout(navigator.serviceWorker.ready, 8000, 'service worker');
}

async function registerToken(uid) {
  const swReg = await getWorkerRegistration();
  const messaging = getMessaging(app);
  const token = await withTimeout(
    getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: swReg }),
    20000, 'push token');
  if (!token) return null;

  // Nested-map merge: only adds/overwrites this one token's entry, leaving
  // any other device's token already on the doc untouched.
  setDoc(doc(db, 'fcmTokens', uid), {
    tokens: {
      [token]: {
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        userAgent: navigator.userAgent,
        // Which install this token belongs to — each web address (and the
        // installed app vs a browser tab) has its own push registration.
        origin: location.host,
        installedApp: isStandalonePWA(),
      },
    },
    updatedAt: serverTimestamp(),
  }, { merge: true }).then(() => {
    try { localStorage.setItem(TOKEN_REFRESH_KEY, String(Date.now())); } catch (e) {}
  }).catch((e) => console.error('Saving push token failed:', e));
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
// Uploads the service worker's log of received pushes (see sw.js logPush)
// to fcmTokens/{uid}.pushLog, then clears it. Diagnostics only.
async function uploadPushLog(uid) {
  try {
    const cache = await caches.open('lb-push-log');
    const res = await cache.match('/__push-log');
    if (!res) return;
    const entries = await res.json();
    if (!Array.isArray(entries) || !entries.length) return;
    const tagged = entries.map((e) => ({ ...e, origin: location.host, installedApp: isStandalonePWA() }));
    const ref = doc(db, 'fcmTokens', uid);
    const prev = (await getDoc(ref)).data()?.pushLog || [];
    await setDoc(ref, { pushLog: [...prev, ...tagged].slice(-40) }, { merge: true });
    await cache.delete('/__push-log');
  } catch (e) {
    // never matters to the person using the app
  }
}

export async function initPush(uid, { onForegroundMessage } = {}) {
  if (!pushSupported() || !uid) return;
  uploadPushLog(uid);

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
  } else if (Notification.permission === 'default' && isStandalonePWA()) {
    // Only undecided, installed-app users get here, so the extra read is rare.
    let isInstructor = false;
    try { isInstructor = (await getDoc(doc(db, 'instructors', uid))).exists(); } catch (e) {}
    if (isInstructor ? shouldShowInstructorAsk() : shouldShowSoftAsk()) {
      showSoftAskBanner(uid, { instructor: isInstructor });
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
  return (await enablePush(uid)) === 'enabled';
}

/**
 * Same as above but says what happened, and never hangs:
 *   'enabled'     — permission granted and this device registered
 *   'denied'      — the person (or iOS) said no; only Settings can undo it
 *   'pending'     — permission granted but registering didn't finish (slow or
 *                   offline); initPush retries on the next page load because
 *                   the daily refresh stamp is only written on success
 *   'unsupported' — this browser can't do web push (e.g. iPhone Safari tab,
 *                   not the installed app)
 *   'error'       — permission request itself failed
 */
export async function enablePush(uid) {
  if (!pushSupported()) return 'unsupported';
  let permission;
  try {
    // Must be the first await after the tap: iOS only shows its prompt
    // when it's tied directly to the gesture.
    permission = await Notification.requestPermission();
  } catch (e) {
    console.error('Push permission error:', e);
    return 'error';
  }
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'error';
  try {
    const token = await registerToken(uid);
    return token ? 'enabled' : 'pending';
  } catch (e) {
    console.error('Push registration error:', e);
    return 'pending';
  }
}
