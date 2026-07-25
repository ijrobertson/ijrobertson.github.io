// Culture Guide lesson-completion tracking. One Firestore doc per user
// (cultureProgress/{uid}), holding a map of { [countryId]: { completedLessons: [...] } }
// — same single-doc-per-owner shape as fcmTokens, since per-country lesson
// lists here are small (see firestore.rules).

import { db, doc, getDoc, setDoc, serverTimestamp } from '../lib/firebaseClient.js';

export async function getCultureProgress(uid) {
  const snap = await getDoc(doc(db, 'cultureProgress', uid));
  return snap.exists() ? (snap.data() || {}) : {};
}

export function completedLessonsFor(progress, countryId) {
  return (progress && progress[countryId] && progress[countryId].completedLessons) || [];
}

export async function markLessonComplete(uid, countryId, lessonId) {
  const progress = await getCultureProgress(uid);
  const existing = completedLessonsFor(progress, countryId);
  if (existing.includes(lessonId)) return existing;

  const updated = [...existing, lessonId];
  await setDoc(doc(db, 'cultureProgress', uid), {
    [countryId]: { completedLessons: updated, updatedAt: serverTimestamp() }
  }, { merge: true });
  return updated;
}
