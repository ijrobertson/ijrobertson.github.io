// Unread-messages indicator for the shared app shell's bottom Messages tab,
// and for the installed PWA's home-screen icon badge (Badging API).
//
// Kept separate from js/app-shell.js, which stays Firebase-free by design
// (see its own header comment) — this module does the Firestore listening
// and just sets the `messages-unread` attribute the shell reads to decide
// whether to highlight the Messages tab red.

import { db, collection, query, where, onSnapshot } from '../lib/firebaseClient.js';

// Not every browser implements the Badging API (e.g. Firefox, older Safari)
// — feature-detected and silently a no-op where unsupported, same as any
// other progressive-enhancement PWA capability in this codebase. Exported
// since messages.html keeps its own separate unread-count listener (see its
// loadUnreadMessageCount()) rather than a second subscription via
// watchUnreadMessages below, and needs this same badge call from there too.
export function setAppBadgeCount(total) {
  if (!('setAppBadge' in navigator)) return;
  const p = total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge();
  p?.catch(() => {}); // badge failures are cosmetic — never worth surfacing to the user
}

/**
 * Call once per page load for a signed-in user, passing the <lb-app-shell>
 * element. Sets up a live listener (same conversations query + unreadCount
 * shape messages.html's own badge already uses) that keeps the shell's
 * `messages-unread` attribute in sync for as long as the page stays open —
 * including on pages other than Messages, so the bottom nav can flag it.
 * Also keeps the installed app's home-screen icon badge in sync the same
 * way (covers the "app is open" case; the closed/backgrounded-app case is
 * covered separately by sw.js's push handler using the badgeCount the
 * server includes in each message push — see functions/index.js).
 * Returns the unsubscribe function.
 */
export function watchUnreadMessages(uid, shell) {
  if (!uid || !shell) return () => {};

  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', uid)
  );

  // Only act on the server's answer (2026-11-17). On opening the app the
  // first answer can come from the empty local cache, which read as "0
  // unread" and cleared the home-screen badge the push had just set — and if
  // the app was closed again before the server replied, it stayed cleared.
  // Pending friend requests (2026-11-18): red ring + count on the account
  // button (app-shell "profile-alerts"); clears when accepted/declined.
  const stopRequests = onSnapshot(
    query(collection(db, 'friendRequests'), where('toId', '==', uid)),
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.fromCache) return;
      const pending = snap.docs.filter((d) => d.data().status === 'pending').length;
      shell.setAttribute('profile-alerts', String(pending));
    },
    () => { /* offline / signed out: keep the last known count */ }
  );

  const stopMessages = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    let total = 0;
    snapshot.forEach((docSnap) => {
      const conv = docSnap.data();
      if (conv.unreadCount && conv.unreadCount[uid]) total += conv.unreadCount[uid];
      // A chat the user marked as unread themselves (messages.html long-press)
      // counts as one, like WhatsApp.
      else if (conv.markedUnread && conv.markedUnread[uid] === true) total += 1;
    });
    shell.setAttribute('messages-unread', String(total)); // the tab shows the number
    setAppBadgeCount(total);
  });
  return () => { stopMessages(); stopRequests(); };
}
