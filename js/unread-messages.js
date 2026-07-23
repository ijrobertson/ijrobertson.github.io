// Unread-messages indicator for the shared app shell's bottom Messages tab.
//
// Kept separate from js/app-shell.js, which stays Firebase-free by design
// (see its own header comment) — this module does the Firestore listening
// and just sets the `messages-unread` attribute the shell reads to decide
// whether to highlight the Messages tab red.

import { db, collection, query, where, onSnapshot } from '../lib/firebaseClient.js';

/**
 * Call once per page load for a signed-in user, passing the <lb-app-shell>
 * element. Sets up a live listener (same conversations query + unreadCount
 * shape messages.html's own badge already uses) that keeps the shell's
 * `messages-unread` attribute in sync for as long as the page stays open —
 * including on pages other than Messages, so the bottom nav can flag it.
 * Returns the unsubscribe function.
 */
export function watchUnreadMessages(uid, shell) {
  if (!uid || !shell) return () => {};

  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', uid)
  );

  return onSnapshot(q, (snapshot) => {
    let total = 0;
    snapshot.forEach((docSnap) => {
      const conv = docSnap.data();
      if (conv.unreadCount && conv.unreadCount[uid]) total += conv.unreadCount[uid];
    });
    shell.setAttribute('messages-unread', total > 0 ? 'true' : 'false');
  });
}
