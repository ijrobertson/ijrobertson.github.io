// Paid-lesson safety net (2026-11-18).
//
// The booking for a paid lesson is written by the student's browser right
// after Stripe confirms the payment. If that never happens (tab closed, lost
// signal, phone died, a payment method that leaves the page), the student is
// charged with no lesson booked. To prevent that:
//   1. createPaymentIntent stores the lesson start time (and time zones) in
//      the PaymentIntent metadata.
//   2. The Stripe webhook (payment_intent.succeeded) finds no booking for the
//      payment and calls noteMissingBooking(): a bookingRecovery/{piId} marker.
//   3. recoverMissingBookings (every 2 minutes) waits until the marker is
//      WAIT_MINUTES old — the browser has normally saved the booking by then —
//      re-checks Stripe, and if there is still no booking for that payment,
//      creates it exactly like the booking pages do (doc id = PaymentIntent
//      id, so it can only ever be created once), then emails the admin.
// The booking pages themselves are unchanged apart from sending the lesson
// time; if their booking exists, nothing here does anything.

const admin = require('firebase-admin');
const { Resend } = require('resend');

const WAIT_MINUTES = 10; // the Stripe webhook usually arrives BEFORE the browser saves the booking; give slow connections time
const ADMIN_EMAIL = 'ianjack1643@gmail.com';

// Called by the webhook when a succeeded payment has no booking yet.
async function noteMissingBooking(pi) {
  const meta = pi.metadata || {};
  if (!meta.studentId || !meta.instructorId) return false;
  const ref = admin.firestore().collection('bookingRecovery').doc(pi.id);
  const existing = await ref.get();
  if (existing.exists) return false; // webhook retries: keep the first marker
  await ref.set({
    paymentIntentId: pi.id,
    studentId: meta.studentId,
    instructorId: meta.instructorId,
    lessonStart: meta.lessonStart || null,
    instructorTimezone: meta.instructorTimezone || null,
    studentTimezone: meta.studentTimezone || null,
    amount: pi.amount || null,
    currency: pi.currency || null,
    status: meta.lessonStart ? 'waiting' : 'needs_attention',
    reason: meta.lessonStart ? null : 'payment has no lesson time (booked from an older page)',
    attempts: 0,
    createdAt: new Date(),
  });
  if (!meta.lessonStart) await alertAdmin(pi.id, null, 'A lesson was paid for but no booking was saved, and the payment has no lesson time, so it could not be booked automatically. Please contact the student.');
  return true;
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 60) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (_) { return null; }
}

// Create the booking for one marker if it is still missing.
// Returns 'recovered' | 'found' | 'skipped' | 'needs_attention'.
async function recoverOne(markerRef, getStripe) {
  const db = admin.firestore();
  const marker = (await markerRef.get()).data();
  const piId = marker.paymentIntentId;

  const pi = await getStripe().paymentIntents.retrieve(piId);
  const meta = pi.metadata || {};
  if (pi.status !== 'succeeded') {
    await markerRef.update({ status: 'skipped', reason: `payment status is ${pi.status}`, doneAt: new Date() });
    return 'skipped';
  }
  if (meta.studentId !== marker.studentId || meta.instructorId !== marker.instructorId) {
    await markerRef.update({ status: 'needs_attention', reason: 'payment details do not match', doneAt: new Date() });
    return 'needs_attention';
  }
  const start = new Date(meta.lessonStart || marker.lessonStart || '');
  if (isNaN(start.getTime())) {
    await markerRef.update({ status: 'needs_attention', reason: 'no valid lesson time', doneAt: new Date() });
    await alertAdmin(piId, null, 'A paid lesson has no booking and no valid lesson time. Please contact the student.');
    return 'needs_attention';
  }

  const [instSnap, studSnap] = await Promise.all([
    db.collection('instructors').doc(meta.instructorId).get(),
    db.collection('users').doc(meta.studentId).get(),
  ]);
  const instructor = instSnap.exists ? instSnap.data() : {};
  const student = studSnap.exists ? studSnap.data() : {};

  // Same fields as the booking pages write (instructor-profile.html /
  // instructors.html), plus recoveredByServer so it can be told apart.
  const booking = {
    instructorId: meta.instructorId,
    studentId: meta.studentId,
    dateTime: start,
    durationMinutes: 60,
    status: 'confirmed',
    instructorTimezone: validTimeZone(meta.instructorTimezone) || validTimeZone(marker.instructorTimezone) || null,
    studentTimezone: validTimeZone(meta.studentTimezone) || validTimeZone(marker.studentTimezone) || validTimeZone(student.timezone) || 'UTC',
    bookedAt: new Date(),
    instructorName: instructor.name || '',
    studentName: student.name || 'Student',
    paymentIntentId: pi.id,
    paymentStatus: 'paid',
    amount: pi.amount,
    currency: pi.currency,
    instructorSeen: false,
    studentSeen: false,
    recoveredByServer: true,
    ...(meta.referralCreditApplied === 'true' && meta.referralDocId
      ? { referralCreditApplied: true, referralDocId: meta.referralDocId } : {}),
  };
  if (!booking.instructorTimezone) {
    const avail = await db.collection('instructor_availability').doc(meta.instructorId).get();
    booking.instructorTimezone = validTimeZone(avail.exists ? avail.data().timezone : null) || 'UTC';
  }

  let created = false;
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(db.collection('bookings').where('paymentIntentId', '==', pi.id).limit(1));
    if (!existing.empty) return;
    const own = await tx.get(db.collection('bookings').doc(pi.id));
    if (own.exists) return;
    tx.create(db.collection('bookings').doc(pi.id), booking);
    created = true;
  });

  await markerRef.update({ status: created ? 'recovered' : 'found', bookingId: created ? pi.id : null, doneAt: new Date() });
  if (created) {
    console.warn(`[BookingRecovery] Created booking ${pi.id} for a paid lesson the browser never saved`);
    await alertAdmin(pi.id, booking, 'A student paid for a lesson but their browser did not save the booking (closed tab or lost connection). The server booked it automatically; the instructor and student get the usual booking emails. You may want to check the time still works for the instructor.');
  }
  return created ? 'recovered' : 'found';
}

async function processBookingRecovery(getStripe, { now = new Date() } = {}) {
  const db = admin.firestore();
  const snap = await db.collection('bookingRecovery').where('status', '==', 'waiting').limit(25).get();
  const results = [];
  for (const d of snap.docs) {
    const m = d.data();
    const created = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : new Date(m.createdAt);
    if (!(created instanceof Date) || isNaN(created) || now - created < WAIT_MINUTES * 60000) continue;
    try {
      results.push([d.id, await recoverOne(d.ref, getStripe)]);
    } catch (err) {
      const attempts = (m.attempts || 0) + 1;
      console.error(`[BookingRecovery] ${d.id} attempt ${attempts} failed:`, err.message);
      await d.ref.update({ attempts, lastError: String(err.message || err).slice(0, 300), ...(attempts >= 10 ? { status: 'needs_attention' } : {}) });
      if (attempts === 10) await alertAdmin(d.id, null, `Automatic booking for this paid lesson failed 10 times (${String(err.message).slice(0, 200)}). Please book it manually.`);
      results.push([d.id, 'error']);
    }
  }
  return results;
}

async function alertAdmin(piId, booking, message) {
  try {
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = booking ? [
      ['Student', booking.studentName], ['Instructor', booking.instructorName],
      ['Lesson time (UTC)', booking.dateTime.toISOString().replace('T', ' ').slice(0, 16)],
      ['Amount', `${(booking.amount / 100).toFixed(2)} ${String(booking.currency || '').toUpperCase()}`],
    ] : [];
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Lingua Bud <notifications@linguabud.com>',
      to: ADMIN_EMAIL,
      subject: booking ? 'Paid lesson booked automatically' : 'Paid lesson needs attention',
      html: `<p>${esc(message)}</p>${rows.length ? '<table>' + rows.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('') + '</table>' : ''}<p>Payment: ${esc(piId)}</p>`,
      text: `${message}\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\nPayment: ${piId}`,
    });
  } catch (err) {
    console.error('[BookingRecovery] admin email failed:', err.message);
  }
}

module.exports = { noteMissingBooking, processBookingRecovery, recoverOne, WAIT_MINUTES };
