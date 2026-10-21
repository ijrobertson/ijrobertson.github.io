/**
 * One-time backfill for bookedSlots (see syncBookedSlot in index.js), plus a
 * one-time move of Google Calendar tokens off public instructor profiles.
 *
 * syncBookedSlot only mirrors bookings as they are written, so confirmed
 * bookings that already exist need copying once before booking pages switch
 * to reading bookedSlots. Run after deploying syncBookedSlot and before the
 * page changes go live:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=<path> node backfill-booked-slots.js            (dry run)
 *   GOOGLE_APPLICATION_CREDENTIALS=<path> node backfill-booked-slots.js --write
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();
const write = process.argv.includes('--write');

(async () => {
  // Confirmed bookings from a day ago onwards (older slots can't be booked anyway)
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const snap = await db.collection('bookings').where('status', '==', 'confirmed').get();
  const upcoming = snap.docs.filter(d => d.data().dateTime?.toMillis?.() >= since.toMillis() && d.data().instructorId);
  console.log(`${upcoming.length} upcoming confirmed booking(s) to mirror into bookedSlots`);

  let batch = db.batch(), n = 0;
  for (const d of upcoming) {
    const b = d.data();
    batch.set(db.collection('bookedSlots').doc(d.id), {
      instructorId:    b.instructorId,
      dateTime:        b.dateTime,
      durationMinutes: b.durationMinutes || 60,
      status:          'confirmed'
    });
    if (++n % 400 === 0) { if (write) await batch.commit(); batch = db.batch(); }
  }
  if (write) await batch.commit();

  // Google Calendar tokens: move any still on the public profile to the
  // private googleCalendarTokens collection
  const instructors = await db.collection('instructors').get();
  const exposed = instructors.docs.filter(d => d.data().googleCalendar?.refreshToken || d.data().googleCalendar?.accessToken);
  console.log(`${exposed.length} instructor profile(s) with Google Calendar tokens to move`);
  for (const d of exposed) {
    const g = d.data().googleCalendar;
    if (!write) continue;
    await db.collection('googleCalendarTokens').doc(d.id).set({
      accessToken:  g.accessToken || null,
      refreshToken: g.refreshToken || null,
      tokenExpiry:  g.tokenExpiry || null,
      connectedAt:  g.connectedAt || admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await d.ref.update({ googleCalendar: { connected: !!g.connected, connectedAt: g.connectedAt || null } });
  }

  console.log(write ? 'Done.' : 'Dry run only. Re-run with --write to apply.');
})().catch(err => { console.error(err); process.exit(1); });
