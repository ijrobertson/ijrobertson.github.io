// Presence (online / last-seen), Firestore-only — this project has no
// Realtime Database, so there's no onDisconnect() to reliably detect a
// closed tab/dead connection the instant it happens (that's an RTDB-only
// capability). Instead: a heartbeat write while the tab is open/visible,
// plus a staleness check on the reading side — if lastSeenAt is older than
// STALE_THRESHOLD_MS, treat the user as offline regardless of the stored
// `online` flag. Trade-off worth knowing: someone whose browser or device
// dies without firing pagehide (killed process, phone battery dies, network
// drops instantly) will still show "Online" for up to that threshold.

import { db, doc, setDoc, onSnapshot, serverTimestamp } from '../lib/firebaseClient.js';

const HEARTBEAT_INTERVAL_MS = 30000;
export const STALE_THRESHOLD_MS = 90000; // 3x the heartbeat interval — tolerates a couple of missed beats before treating someone as offline

async function writePresence(uid, online) {
  try {
    await setDoc(doc(db, 'presence', uid), { online, lastSeenAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error('Presence write error:', e);
  }
}

/**
 * Call once per page load for a signed-in user. Writes an initial "online"
 * heartbeat immediately, then keeps refreshing it every 30s while the tab is
 * visible, and best-effort marks offline on pagehide (not guaranteed to fire
 * on every platform, especially mobile Safari — the staleness check on the
 * reading side is what actually keeps this honest over time). Returns a
 * cleanup function.
 */
export function startPresenceHeartbeat(uid) {
  if (!uid) return () => {};

  writePresence(uid, true);
  const heartbeatTimer = setInterval(() => {
    if (document.visibilityState === 'visible') writePresence(uid, true);
  }, HEARTBEAT_INTERVAL_MS);

  // Deliberately NOT writing offline on visibilitychange->hidden — briefly
  // switching apps/tabs shouldn't flip someone to "offline"; the staleness
  // threshold above handles the case where they never come back.
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') writePresence(uid, true);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const onPageHide = () => writePresence(uid, false);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    clearInterval(heartbeatTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
  };
}

/** Subscribes to another user's raw presence doc. Returns the unsubscribe function. */
export function watchPresence(otherUid, callback) {
  if (!otherUid) return () => {};
  return onSnapshot(doc(db, 'presence', otherUid), (snap) => {
    callback(snap.exists() ? snap.data() : { online: false, lastSeenAt: null });
  }, (err) => {
    console.error('Presence watch error:', err);
    callback({ online: false, lastSeenAt: null });
  });
}

// Pure — takes the raw doc data plus "now", so a consumer can re-evaluate it
// on its own timer (to catch staleness) without needing a fresh Firestore
// read every time.
export function isEffectivelyOnline(data) {
  if (!data || data.online !== true || !data.lastSeenAt) return false;
  const lastSeenMs = data.lastSeenAt.toMillis ? data.lastSeenAt.toMillis() : new Date(data.lastSeenAt).getTime();
  return (Date.now() - lastSeenMs) < STALE_THRESHOLD_MS;
}

export function formatPresenceLabel(data) {
  if (isEffectivelyOnline(data)) return 'Online';
  if (!data || !data.lastSeenAt) return '';
  const date = data.lastSeenAt.toDate ? data.lastSeenAt.toDate() : new Date(data.lastSeenAt);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'Last seen just now';
  if (diff < 3600000) return `Last seen ${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `Last seen ${Math.floor(diff / 3600000)}h ago`;
  return `Last seen ${Math.floor(diff / 86400000)}d ago`;
}
