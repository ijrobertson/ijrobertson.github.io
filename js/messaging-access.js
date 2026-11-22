/*
  Who may message a student who turned off "Accept new requests"
  (users.acceptingRequests === false, mirrored to publicUsers).

  2026-11-19 (Ian): the setting is meant to stop a flood of messages from
  NEW language-exchange users. It must not stop:
    - approved instructors (e.g. one the student just booked and paid), and
    - anyone the student already has a conversation with (at least one
      message sent, by either side; including chats the student started).
  Accepted language partners were already allowed and still are.

  Shared by messages.html, learner-profile.html and connect.html on the app
  and the website, so all three agree.
*/
import { db, doc, getDoc, getDocs, collection, query, where, limit } from '../lib/firebaseClient.js';

const instructorCache = new Map();

/** True when uid is an approved instructor (public profile, readable by all). */
export async function isApprovedInstructor(uid) {
  if (!uid) return false;
  if (instructorCache.has(uid)) return instructorCache.get(uid);
  const p = getDoc(doc(db, 'publicInstructors', uid))
    .then(s => s.exists() && s.data().status === 'approved')
    .catch(() => false);
  instructorCache.set(uid, p);
  return p;
}

/** True when uid is a parent/guardian account (public marker, set by the server). */
export async function isParentAccount(uid) {
  if (!uid) return false;
  try {
    const s = await getDoc(doc(db, 'publicUsers', uid));
    return s.exists() && s.data().accountType === 'parent';
  } catch (e) { return false; }
}

/** True when the two users are accepted language partners. */
async function arePartners(myUid, otherUid) {
  const [sent, received] = await Promise.all([
    getDocs(query(collection(db, 'friendRequests'),
      where('fromId', '==', myUid), where('toId', '==', otherUid), where('status', '==', 'accepted'))),
    getDocs(query(collection(db, 'friendRequests'),
      where('toId', '==', myUid), where('fromId', '==', otherUid), where('status', '==', 'accepted')))
  ]);
  return !sent.empty || !received.empty;
}

/** True when a conversation between the two has at least one message.
 *  conversationId: pass it when already known (skips the lookup). */
export async function haveChatted(myUid, otherUid, conversationId) {
  let ids = conversationId ? [conversationId] : [];
  if (!ids.length) {
    const convs = await getDocs(query(collection(db, 'conversations'),
      where('participants', 'array-contains', myUid)));
    ids = convs.docs.filter(d => (d.data().participants || []).includes(otherUid)).map(d => d.id);
  }
  for (const id of ids) {
    const msgs = await getDocs(query(collection(db, 'conversations', id, 'messages'), limit(1)));
    if (!msgs.empty) return true;
  }
  return false;
}

/**
 * True when myUid may NOT message otherUid because of otherUid's privacy
 * setting. otherPublic: otherUid's publicUsers data if the page already has
 * it. conversationId: the open conversation, if any.
 */
export async function messagingBlocked(myUid, otherUid, { otherPublic, conversationId } = {}) {
  let other = otherPublic;
  if (other === undefined) {
    const s = await getDoc(doc(db, 'publicUsers', otherUid));
    other = s.exists() ? s.data() : null;
  }
  if (!other) return false;
  // Parent/guardian accounts (2026-11-22): only approved instructors may
  // message them, and they may only message approved instructors — no
  // exceptions for partners or earlier chats. firestore.rules enforces the
  // same thing when a chat is created; this just explains it on screen.
  if (other.accountType === 'parent') return !(await isApprovedInstructor(myUid));
  if (await isParentAccount(myUid)) return !(await isApprovedInstructor(otherUid));
  if (other.acceptingRequests !== false) return false;
  if (await isApprovedInstructor(myUid)) return false;
  if (await arePartners(myUid, otherUid)) return false;
  if (await haveChatted(myUid, otherUid, conversationId)) return false;
  return true;
}
