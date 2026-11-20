/**
 * Lesson rescheduled: move a booking to a new time and email the student and
 * the instructor (design approved by Ian 2026-11-19, first used for Kayce
 * Lamelas' free trial with Ian).
 *
 * Usage (run from the functions/ directory):
 *   GOOGLE_APPLICATION_CREDENTIALS=<path> node send-reschedule-email.js --booking <id> --to "2026-11-20T10:00" --tz America/Los_Angeles [mode]
 *
 *   --to / --tz       the NEW start time, as wall-clock time in --tz (usually the
 *                     instructor's zone, i.e. how they asked for it). Omit both
 *                     when the booking was already moved (it then uses the
 *                     booking's dateTime as new and previousDateTime as old).
 *
 * Modes (one per run, in this order):
 *   (none) / --dry-run     print what would change + both emails' subjects
 *   --render <dir>         write student.html + instructor.html
 *   --move --confirm       move the booking (keeps previousDateTime, rescheduledAt)
 *   --preview              send BOTH emails to ADMIN_EMAIL only, for approval
 *   --send --confirm       send to the student and the instructor
 *
 * RESEND_API_KEY is read from functions/.env if not set. Moving the booking
 * updates bookedSlots by itself (syncBookedSlot trigger). Lesson reminders
 * follow the new time automatically (1h reminder still sent; a 24h reminder is
 * skipped if the new time is less than ~22h away).
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();

const ADMIN_EMAIL = 'ianjack1643@gmail.com';
const FROM = 'Lingua Bud <notifications@linguabud.com>';
const BOOKINGS_URL = 'https://linguabud.com/bookings';

function resendKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/^RESEND_API_KEY=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch (e) { return null; }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(name);

// Wall-clock "YYYY-MM-DDTHH:MM" in a time zone → Date.
function zonedToDate(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) throw new Error('--to must look like 2026-11-20T10:00');
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Offset of tz at that moment (two passes cover DST edges).
  let guess = asUtc;
  for (let k = 0; k < 2; k++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    guess += asUtc - shown;
  }
  return new Date(guess);
}

const fmtDay = (d, tz) => d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = (d, tz) => d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
const tzName = (d, tz) => (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' })
  .formatToParts(d).find((p) => p.type === 'timeZoneName') || {}).value || tz;
const tzShort = (name) => name.replace(/ Time$/, '').split(' ').map((w) => w[0]).join('') + 'T'; // "Eastern Time" → "ET"
const shortDay = (d, tz) => d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' });
const firstName = (n) => (n || '').trim().split(/\s+/)[0] || 'there';
const titleCase = (n) => (n || '').trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page({ title, intro, oldTime, newTime, detail, tips }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
<tr><td style="padding:36px 40px 20px;text-align:center;background-color:#20bcba;">
<h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:bold;">Lingua Bud</h1>
<p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Lesson rescheduled</p></td></tr>
<tr><td style="padding:32px 40px 8px;color:#113448;font-size:16px;line-height:1.6;">${intro}</td></tr>
<tr><td style="padding:8px 40px;">
<table role="presentation" style="width:100%;border-collapse:collapse;border:2px solid #20bcba;border-radius:8px;">
<tr><td style="padding:18px 20px;background-color:#eefafa;">
<p style="margin:0 0 4px;font-size:13px;color:#0b6664;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">New time</p>
<p style="margin:0;font-size:20px;color:#113448;font-weight:bold;">${newTime}</p>
<p style="margin:6px 0 0;font-size:14px;color:#4a5a63;">${detail}</p>
</td></tr>
<tr><td style="padding:12px 20px;font-size:14px;color:#7b8a91;">Previously: <span style="text-decoration:line-through;">${oldTime}</span></td></tr>
</table></td></tr>
<tr><td style="padding:24px 40px 8px;text-align:center;">
<a href="${BOOKINGS_URL}" style="display:inline-block;padding:14px 32px;background-color:#0b6664;color:#ffffff;text-decoration:none;border-radius:999px;font-size:16px;font-weight:bold;">View my booking</a>
<p style="margin:12px 0 0;font-size:13px;color:#7b8a91;">Or open: <a href="${BOOKINGS_URL}" style="color:#0b6664;">${BOOKINGS_URL}</a></p></td></tr>
<tr><td style="padding:16px 40px 28px;color:#4a5a63;font-size:14px;line-height:1.6;">${tips}</td></tr>
<tr><td style="padding:20px 40px;background-color:#113448;text-align:center;color:rgba(255,255,255,0.8);font-size:12px;">Lingua Bud | linguabud.com<br>© 2026 Lingua Bud</td></tr>
</table></td></tr></table></body></html>`;
}

const TIPS = 'You join from the My Bookings page (on the website, or the <strong>Calendar</strong> tab in the Lingua Bud app). The <strong>Join</strong> button turns on 5 minutes before the start time.';

function buildEmails({ booking, student, instructor, newDate, oldDate }) {
  const sTz = booking.studentTimezone || student.timezone || booking.instructorTimezone || 'UTC';
  const iTz = booking.instructorTimezone || instructor.timezone || sTz;
  const isTrial = booking.bookingType === 'free_trial' || booking.bookingType === 'trial';
  const minutes = isTrial ? 15 : (booking.durationMinutes || 60);
  const end = new Date(newDate.getTime() + minutes * 60000);
  const sName = titleCase(student.name || booking.studentName || 'your student');
  const iName = titleCase(instructor.name || booking.instructorName || 'your instructor');
  const lessonWord = isTrial ? 'free trial lesson' : 'lesson';
  const lessonLabel = isTrial ? 'Free 15-minute trial lesson' : `${minutes}-minute lesson`;
  const sTzN = tzName(newDate, sTz), iTzN = tzName(newDate, iTz);
  const sameTz = sTzN === iTzN;

  const forStudent = {
    to: student.email,
    subject: `Your ${isTrial ? 'free trial' : 'lesson'} with ${iName} is now ${shortDay(newDate, sTz)} at ${fmtTime(newDate, sTz)} ${tzShort(sTzN)}`,
    html: page({
      title: 'Your lesson has been rescheduled',
      intro: `<p style="margin:0 0 12px;">Hi ${esc(firstName(sName))},</p><p style="margin:0;">As you requested, your ${lessonWord} with <strong>${esc(iName)}</strong> has been moved to a new date and time. Here are the updated details:</p>`,
      newTime: `${fmtDay(newDate, sTz)}<br>${fmtTime(newDate, sTz)} – ${fmtTime(end, sTz)} ${sTzN}`,
      oldTime: `${fmtDay(oldDate, sTz)} at ${fmtTime(oldDate, sTz)} ${tzName(oldDate, sTz)}`,
      detail: lessonLabel + (sameTz ? '' : ` · ${fmtTime(newDate, iTz)} ${iTzN}`),
      tips: `<p style="margin:0 0 10px;">${TIPS}</p><p style="margin:0;">See you then!<br>The Lingua Bud team</p>`,
    }),
  };
  const forInstructor = {
    to: instructor.email,
    subject: `${isTrial ? 'Trial' : 'Lesson'} with ${sName} moved to ${shortDay(newDate, iTz)} at ${fmtTime(newDate, iTz)} ${tzShort(iTzN)}`,
    html: page({
      title: 'Lesson rescheduled',
      intro: `<p style="margin:0 0 12px;">Hi ${esc(firstName(iName))},</p><p style="margin:0;">Your ${lessonWord} with <strong>${esc(sName)}</strong> has been moved at the student's request. Here are the updated details:</p>`,
      newTime: `${fmtDay(newDate, iTz)}<br>${fmtTime(newDate, iTz)} – ${fmtTime(end, iTz)} ${iTzN}`,
      oldTime: `${fmtDay(oldDate, iTz)} at ${fmtTime(oldDate, iTz)} ${tzName(oldDate, iTz)}`,
      detail: lessonLabel + (sameTz ? '' : ` · ${fmtTime(newDate, sTz)} ${sTzN} for the student`),
      tips: `<p style="margin:0;">${TIPS}</p>`,
    }),
  };
  return [['student', forStudent], ['instructor', forInstructor]];
}

async function send(key, msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, ...msg }),
  });
  const j = await r.json();
  console.log(r.status, msg.to, '|', msg.subject, '|', j.id || JSON.stringify(j));
  if (!r.ok) process.exitCode = 1;
}

(async () => {
  const bookingId = arg('--booking');
  if (!bookingId) throw new Error('--booking <id> is required');
  const ref = db.doc(`bookings/${bookingId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('no such booking');
  const booking = snap.data();

  let newDate, oldDate;
  if (arg('--to')) {
    newDate = zonedToDate(arg('--to'), arg('--tz') || booking.instructorTimezone || 'UTC');
    oldDate = booking.dateTime.toDate();
    if (Math.abs(newDate - oldDate) < 60000 && booking.previousDateTime) oldDate = booking.previousDateTime.toDate();
  } else {
    if (!booking.previousDateTime) throw new Error('booking was not moved yet: pass --to and --tz');
    newDate = booking.dateTime.toDate();
    oldDate = booking.previousDateTime.toDate();
  }

  const [s, i] = await Promise.all([
    db.doc(`users/${booking.studentId}`).get(),
    db.doc(`instructors/${booking.instructorId}`).get(),
  ]);
  const student = s.exists ? s.data() : {};
  const instructor = i.exists ? i.data() : {};
  const emails = buildEmails({ booking, student, instructor, newDate, oldDate });

  console.log(`Booking ${bookingId} (${booking.bookingType || 'lesson'}, ${booking.status})`);
  console.log(`  old: ${oldDate.toISOString()}   new: ${newDate.toISOString()}   currently stored: ${booking.dateTime.toDate().toISOString()}`);
  emails.forEach(([role, e]) => console.log(`  ${role}: ${e.to} | ${e.subject}`));

  if (has('--render')) {
    const dir = arg('--render');
    fs.mkdirSync(dir, { recursive: true });
    emails.forEach(([role, e]) => fs.writeFileSync(path.join(dir, `${role}.html`), e.html));
    console.log('rendered to', dir);
  } else if (has('--move') && has('--confirm')) {
    if (booking.status !== 'confirmed') throw new Error(`booking status is ${booking.status}, not moving it`);
    if (Math.abs(newDate - booking.dateTime.toDate()) < 60000) { console.log('already at the new time'); return; }
    await ref.update({
      dateTime: admin.firestore.Timestamp.fromDate(newDate),
      previousDateTime: booking.dateTime,
      rescheduledAt: admin.firestore.FieldValue.serverTimestamp(),
      rescheduledBy: 'admin script (send-reschedule-email.js)',
    });
    console.log('moved. bookedSlots follows via the syncBookedSlot trigger.');
  } else if (has('--preview') || (has('--send') && has('--confirm'))) {
    const key = resendKey();
    if (!key) throw new Error('RESEND_API_KEY not found');
    if (Math.abs(newDate - booking.dateTime.toDate()) >= 60000) throw new Error('booking is not at the new time yet: run --move --confirm first');
    for (const [, e] of emails) {
      if (!e.to) throw new Error('missing recipient email');
      await send(key, has('--preview') ? { to: ADMIN_EMAIL, subject: `[PREVIEW → ${e.to}] ${e.subject}`, html: e.html } : e);
    }
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
