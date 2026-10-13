/**
 * Lesson reminder emails: one about 24 hours before a lesson and one about an
 * hour before, sent to both the student and the instructor.
 *
 * Lives in its own module (db and resend are passed in) so the same template
 * and send logic can be previewed and dry-run outside of the deployed
 * functions. index.js wires it to a schedule (sendLessonReminders).
 */
const admin = require('firebase-admin');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {object} opts
 * @param {'24h'|'1h'} opts.kind            Which reminder this is
 * @param {'student'|'instructor'} opts.role Who the email is for
 * @param {string} opts.recipientName
 * @param {string} opts.otherName           The other person in the lesson
 * @param {Date}   opts.lessonDate
 * @param {string} opts.timezone            Recipient's IANA timezone
 * @param {number} opts.durationMinutes
 * @param {boolean} opts.isTrial
 * @returns {{subject: string, html: string, text: string}}
 */
function buildLessonReminderEmail({ kind, role, recipientName, otherName, lessonDate, timezone, durationMinutes, isTrial }) {
  let tz = timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch (_) {
    tz = 'UTC';
  }

  const formattedDate = lessonDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz
  });
  const formattedTime = lessonDate.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: tz
  });

  const isStudent = role === 'student';
  const is1h = kind === '1h';
  const lessonLabel = isTrial ? 'free 15-minute trial lesson' : 'lesson';
  const lessonLabelTitle = isTrial ? 'Free Trial Lesson' : 'Lesson';
  const otherRoleLabel = isStudent ? 'Instructor' : 'Student';
  const greetingName = recipientName || (isStudent ? 'there' : 'Instructor');
  const other = otherName || (isStudent ? 'your instructor' : 'your student');
  const durationLabel = isTrial ? '15 minutes (Free Trial)' : `${durationMinutes} minutes`;

  const subject = is1h
    ? `Starting in 1 hour: your ${lessonLabel} with ${other} at ${formattedTime}`
    : `Reminder: your ${lessonLabel} with ${other} is on ${formattedDate} at ${formattedTime}`;

  const heading = is1h
    ? `Your ${lessonLabelTitle} Starts in 1 Hour`
    : `Your ${lessonLabelTitle} is in 24 Hours`;

  const intro = is1h
    ? `Your ${lessonLabel} with ${other} starts in about an hour.`
    : `This is a friendly reminder that your ${lessonLabel} with ${other} is coming up in about 24 hours.`;

  const tips = is1h
    ? [
        'Open My Bookings a few minutes early. The Join button turns on 5 minutes before the start time.',
        'Check that your camera and microphone are working.',
        'Find a quiet spot with a stable internet connection.'
      ]
    : [
        'The time above is shown in your own timezone.',
        'You join from the My Bookings page. The Join button turns on 5 minutes before the start time.',
        `Can't make it? Please cancel from My Bookings as early as you can so ${other} knows.`
      ];

  const tipsTitle = is1h ? 'Before you join' : 'Good to know';
  const buttonLabel = is1h ? 'Go to My Bookings' : 'View My Booking';
  const e = escapeHtml;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${e(heading)}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align: center; background-color: #20bcba;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">Lingua Bud</h1>
                    <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Language Learning Platform</p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <h2 style="margin: 0 0 10px 0; color: #333333; font-size: 24px;">${e(heading)}</h2>
                    <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.6;">
                      Hi ${e(greetingName)},<br><br>
                      ${e(intro)}
                    </p>

                    <!-- Lesson Details Card -->
                    <div style="background-color: #f8f9fa; border-radius: 8px; padding: 24px; margin: 0 0 28px 0; border-left: 4px solid #20bcba;">
                      <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                        <strong>${otherRoleLabel}:</strong> ${e(other)}
                      </p>
                      <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                        <strong>Date:</strong> ${e(formattedDate)}
                      </p>
                      <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                        <strong>Time:</strong> ${e(formattedTime)}
                      </p>
                      <p style="margin: 0; color: #333333; font-size: 16px;">
                        <strong>Duration:</strong> ${e(durationLabel)}
                      </p>
                    </div>

                    <!-- Tips -->
                    <div style="background-color: #e8f8f7; border-radius: 8px; padding: 20px; margin: 0 0 28px 0;">
                      <p style="margin: 0 0 10px 0; color: #113448; font-size: 15px; font-weight: bold;">${e(tipsTitle)}</p>
                      <ul style="margin: 0; padding-left: 20px; color: #555555; font-size: 14px; line-height: 1.8;">
                        ${tips.map((tip) => `<li>${e(tip)}</li>`).join('\n                        ')}
                      </ul>
                    </div>

                    <p style="margin: 0 0 30px 0; text-align: center;">
                      <a href="https://linguabud.com/bookings"
                         style="display: inline-block; padding: 14px 36px; background-color: #20bcba; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: bold;">
                        ${e(buttonLabel)}
                      </a>
                    </p>

                    <p style="margin: 0; color: #999999; font-size: 14px; line-height: 1.5;">
                      Questions? Contact us at <a href="mailto:support@linguabud.com" style="color: #20bcba; text-decoration: none;">support@linguabud.com</a>
                    </p>
                  </td>
                </tr>

                <!-- Footer / Signature -->
                <tr>
                  <td style="padding: 30px 40px; background-color: #f8f9fa; border-top: 1px solid #e9ecef; text-align: center;">
                    <p style="margin: 0 0 6px; color: #333333; font-size: 14px; font-weight: bold;">Lingua Bud</p>
                    <p style="margin: 0 0 4px; color: #999999; font-size: 12px;">Connect with language partners worldwide.</p>
                    <p style="margin: 0; color: #999999; font-size: 12px;">© 2026 Lingua Bud &nbsp;|&nbsp; <a href="https://linguabud.com" style="color: #20bcba; text-decoration: none;">linguabud.com</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const text = `
${heading}

Hi ${greetingName},

${intro}

${otherRoleLabel}: ${other}
Date: ${formattedDate}
Time: ${formattedTime}
Duration: ${durationLabel}

${tipsTitle}:
${tips.map((tip) => `- ${tip}`).join('\n')}

My Bookings: https://linguabud.com/bookings

Questions? Email support@linguabud.com

Lingua Bud | linguabud.com
© 2026 Lingua Bud
  `.trim();

  return { subject, html, text };
}

// Each reminder is sent on the first tick where the lesson is at most leadMs
// away. windowMs is how late a reminder may still go out if ticks were missed
// (or on first deploy); past that it is skipped rather than sent with a
// misleading "in 24 hours" / "in 1 hour" message.
const LESSON_REMINDERS = [
  { kind: '24h', leadMs: 24 * 60 * 60 * 1000, windowMs: 2 * 60 * 60 * 1000 },
  { kind: '1h', leadMs: 60 * 60 * 1000, windowMs: 45 * 60 * 1000 },
];

const LESSON_REMINDER_ROLES = ['student', 'instructor'];

/**
 * Marks a reminder as sent on the booking before the email goes out, so two
 * overlapping runs can never both send it. Re-reads the booking inside the
 * transaction so a lesson cancelled moments ago is not reminded.
 */
async function claimLessonReminder(db, bookingRef, flagKey) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) return false;
    const data = snap.data();
    if (data.status === 'cancelled') return false;
    if (data.remindersSent && data.remindersSent[flagKey]) return false;
    tx.update(bookingRef, { [`remindersSent.${flagKey}`]: new Date() });
    return true;
  });
}

/**
 * Finds upcoming lessons and sends any reminder that is due.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} resend  Resend client
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]  Report what would be sent without sending or marking
 * @param {Date} [opts.now]        Override the current time (testing)
 */
async function processLessonReminders(db, resend, opts = {}) {
  const dryRun = !!opts.dryRun;
  const now = opts.now || new Date();
  const results = { sent: 0, skipped: 0, failed: 0, details: [] };
  const maxLeadMs = Math.max(...LESSON_REMINDERS.map((r) => r.leadMs));

  const snap = await db.collection('bookings')
    .where('dateTime', '>', now)
    .where('dateTime', '<=', new Date(now.getTime() + maxLeadMs))
    .get();

  for (const docSnap of snap.docs) {
    const bookingId = docSnap.id;
    const booking = docSnap.data();
    try {
      if (booking.status === 'cancelled') {
        results.skipped++;
        results.details.push({ bookingId, status: 'skipped', reason: 'cancelled' });
        continue;
      }

      const lessonDate = booking.dateTime?.toDate ? booking.dateTime.toDate() : new Date(booking.dateTime);
      const msUntilLesson = lessonDate.getTime() - now.getTime();
      const bookedAt = booking.bookedAt?.toDate ? booking.bookedAt.toDate()
        : booking.bookedAt ? new Date(booking.bookedAt)
        : docSnap.createTime.toDate();
      const noticeMs = lessonDate.getTime() - bookedAt.getTime();

      const reminder = LESSON_REMINDERS.find((r) => msUntilLesson <= r.leadMs && msUntilLesson > r.leadMs - r.windowMs);
      if (!reminder) continue; // nothing due for this lesson on this tick

      // Booked with less notice than the reminder's lead time: the booking
      // confirmation they just received already covers it.
      if (noticeMs < reminder.leadMs) {
        results.skipped++;
        results.details.push({ bookingId, kind: reminder.kind, status: 'skipped', reason: 'booked_with_short_notice' });
        continue;
      }

      const sent = booking.remindersSent || {};
      const pendingRoles = LESSON_REMINDER_ROLES.filter((role) => !sent[`${role}${reminder.kind}`]);
      if (pendingRoles.length === 0) {
        results.skipped++;
        results.details.push({ bookingId, kind: reminder.kind, status: 'skipped', reason: 'already_sent' });
        continue;
      }

      const [studentSnap, instructorSnap] = await Promise.all([
        booking.studentId ? db.collection('users').doc(booking.studentId).get() : null,
        booking.instructorId ? db.collection('instructors').doc(booking.instructorId).get() : null,
      ]);
      const student = studentSnap && studentSnap.exists ? studentSnap.data() : {};
      const instructor = instructorSnap && instructorSnap.exists ? instructorSnap.data() : {};
      const studentName = student.name || booking.studentName || '';
      const instructorName = instructor.name || booking.instructorName || '';
      const isTrial = booking.bookingType === 'free_trial';
      const durationMinutes = isTrial ? 15 : (booking.durationMinutes || 60);

      const recipients = {
        student: {
          email: student.email, name: studentName, otherName: instructorName,
          timezone: booking.studentTimezone || student.timezone || booking.instructorTimezone,
        },
        instructor: {
          email: instructor.email, name: instructorName, otherName: studentName,
          timezone: booking.instructorTimezone || instructor.timezone,
        },
      };

      for (const role of pendingRoles) {
        const recipient = recipients[role];
        const flagKey = `${role}${reminder.kind}`;
        const detail = { bookingId, kind: reminder.kind, role };

        if (!recipient.email) {
          results.skipped++;
          results.details.push({ ...detail, status: 'skipped', reason: 'no_email' });
          continue;
        }

        const email = buildLessonReminderEmail({
          kind: reminder.kind, role,
          recipientName: recipient.name, otherName: recipient.otherName,
          lessonDate, timezone: recipient.timezone, durationMinutes, isTrial,
        });

        if (dryRun) {
          results.details.push({ ...detail, status: 'would_send', to: recipient.email, subject: email.subject });
          continue;
        }

        if (!(await claimLessonReminder(db, docSnap.ref, flagKey))) {
          results.skipped++;
          results.details.push({ ...detail, status: 'skipped', reason: 'already_sent_or_cancelled' });
          continue;
        }

        let sendError = null;
        let emailId = null;
        try {
          const result = await resend.emails.send({
            from: 'Lingua Bud <notifications@linguabud.com>',
            to: recipient.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          });
          if (result.error) sendError = result.error.message || String(result.error);
          else emailId = result.data?.id || null;
        } catch (err) {
          sendError = err.message;
        }

        if (sendError) {
          // Release the claim so the next tick can retry while still in the window
          await docSnap.ref.update({ [`remindersSent.${flagKey}`]: admin.firestore.FieldValue.delete() });
          console.error(`[Lesson Reminder] ${reminder.kind} ${role} send failed for booking ${bookingId}:`, sendError);
          results.failed++;
          results.details.push({ ...detail, status: 'failed', error: sendError });
          continue;
        }

        await db.collection('emailLog').add({
          type: `lessonReminder${reminder.kind}${role === 'student' ? 'Student' : 'Instructor'}`,
          instructorId: booking.instructorId || null,
          studentId: booking.studentId || null,
          bookingId,
          recipientEmail: recipient.email,
          emailId,
          sentAt: new Date(),
          status: 'sent'
        });
        results.sent++;
        results.details.push({ ...detail, status: 'sent', to: recipient.email });
      }
    } catch (err) {
      results.failed++;
      results.details.push({ bookingId, status: 'failed', error: err.message });
    }
  }

  return results;
}

module.exports = { buildLessonReminderEmail, processLessonReminders };
