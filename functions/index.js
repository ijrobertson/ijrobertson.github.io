const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { Resend } = require('resend');
const Stripe = require('stripe');

// Initialize Firebase Admin
admin.initializeApp();

/**
 * Cloud Function that triggers when a new message is added to a conversation
 * Sends an email notification to the recipient if they have notifications enabled
 */
exports.sendMessageNotification = onDocumentCreated(
  'conversations/{conversationId}/messages/{messageId}',
  async (event) => {
    try {
      // Initialize Resend with API key from environment variable
      const resend = new Resend(process.env.RESEND_API_KEY);

      const snap = event.data;
      if (!snap) {
        console.log('No data in event');
        return null;
      }

      const message = snap.data();
      const conversationId = event.params.conversationId;

      // Get conversation details to find the recipient
      const conversationRef = admin.firestore().collection('conversations').doc(conversationId);
      const conversationSnap = await conversationRef.get();

      if (!conversationSnap.exists) {
        console.log('Conversation not found:', conversationId);
        return null;
      }

      const conversation = conversationSnap.data();
      const participants = conversation.participants || [];

      // Find the recipient (the participant who is NOT the sender)
      const recipientId = participants.find(id => id !== message.senderId);

      if (!recipientId) {
        console.log('No recipient found for message');
        return null;
      }

      // Get recipient's user data from BOTH users and instructors collections
      // Prefer instructors collection if user is in both
      const recipientUserRef = admin.firestore().collection('users').doc(recipientId);
      const recipientInstructorRef = admin.firestore().collection('instructors').doc(recipientId);

      const [recipientUserSnap, recipientInstructorSnap] = await Promise.all([
        recipientUserRef.get(),
        recipientInstructorRef.get()
      ]);

      let recipient = null;
      if (recipientInstructorSnap.exists) {
        recipient = recipientInstructorSnap.data();
        console.log('Found recipient in instructors collection');
      } else if (recipientUserSnap.exists) {
        recipient = recipientUserSnap.data();
        console.log('Found recipient in users collection');
      }

      if (!recipient) {
        console.log('Recipient not found in either collection:', recipientId);
        return null;
      }

      // Check if recipient has email notifications enabled (default to true)
      const emailNotificationsEnabled = recipient.emailNotifications !== false;

      if (!emailNotificationsEnabled) {
        console.log('Email notifications disabled for user:', recipientId);
        return null;
      }

      if (!recipient.email) {
        console.log('Recipient has no email address:', recipientId);
        return null;
      }

      // Get sender's name from conversation participant details
      const senderName = conversation.participantDetails?.[message.senderId]?.name || 'A Lingua Bud user';

      // Truncate message for preview (max 100 characters)
      const messagePreview = message.text.length > 100
        ? message.text.substring(0, 100) + '...'
        : message.text;

      // Send email via Resend
      const emailResult = await resend.emails.send({
        from: 'Lingua Bud <notifications@linguabud.com>',
        to: recipient.email,
        subject: `New message from ${senderName}`,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>New Message on Lingua Bud</title>
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
                        </td>
                      </tr>

                      <!-- Content -->
                      <tr>
                        <td style="padding: 40px;">
                          <h2 style="margin: 0 0 20px 0; color: #333333; font-size: 24px;">New Message from ${senderName}</h2>

                          <p style="margin: 0 0 20px 0; color: #666666; font-size: 16px; line-height: 1.5;">
                            You have received a new message on Lingua Bud:
                          </p>

                          <div style="background-color: #f8f9fa; border-left: 4px solid #20bcba; padding: 20px; margin: 20px 0;">
                            <p style="margin: 0; color: #333333; font-size: 16px; line-height: 1.6; font-style: italic;">
                              "${messagePreview}"
                            </p>
                          </div>

                          <p style="margin: 30px 0 20px 0;">
                            <a href="https://linguabud.com/messages"
                               style="display: inline-block; padding: 14px 32px; background-color: #20bcba; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: bold;">
                              View Message
                            </a>
                          </p>

                          <p style="margin: 30px 0 0 0; color: #999999; font-size: 14px; line-height: 1.5;">
                            Don't want to receive these emails? You can turn off email notifications in your
                            <a href="https://linguabud.com/student-dashboard" style="color: #20bcba; text-decoration: none;">dashboard settings</a>.
                          </p>
                        </td>
                      </tr>

                      <!-- Footer -->
                      <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
                          <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.5; text-align: center;">
                            © 2026 Lingua Bud. Connect with language partners worldwide.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
          </html>
        `,
        text: `
New message from ${senderName}

"${messagePreview}"

View your message at: https://linguabud.com/messages

Don't want to receive these emails? Turn off notifications in your dashboard: https://linguabud.com/student-dashboard

© 2026 Lingua Bud
        `.trim()
      });

      console.log('Email sent successfully:', emailResult);

      // Check if email was actually sent successfully
      if (emailResult.error) {
        console.error('Resend API error:', emailResult.error);

        // Log error to Firestore
        await admin.firestore().collection('emailLog').add({
          recipientId: recipientId,
          recipientEmail: recipient.email,
          senderId: message.senderId,
          conversationId: conversationId,
          messageId: event.params.messageId,
          error: emailResult.error.message,
          errorCode: emailResult.error.statusCode,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'failed'
        });

        return null;
      }

      // Optional: Log the email send to Firestore for tracking
      await admin.firestore().collection('emailLog').add({
        recipientId: recipientId,
        recipientEmail: recipient.email,
        senderId: message.senderId,
        conversationId: conversationId,
        messageId: event.params.messageId,
        emailId: emailResult.data?.id,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'sent'
      });

      return emailResult;

    } catch (error) {
      console.error('Error sending email notification:', error);

      // Log error to Firestore for debugging
      await admin.firestore().collection('emailLog').add({
        error: error.message,
        conversationId: event.params.conversationId,
        messageId: event.params.messageId,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'failed'
      });

      // Don't throw - we don't want to fail the message send if email fails
      return null;
    }
  });

/**
 * Sends an email to the instructor when a student books and pays for a lesson
 */
exports.sendBookingNotification = onDocumentCreated(
  'bookings/{bookingId}',
  async (event) => {
    try {
      const booking = event.data.data();
      const { instructorId, studentId, dateTime, amount, currency } = booking;

      if (!instructorId) return null;

      const resend = new Resend(process.env.RESEND_API_KEY);

      // Get instructor's profile and email
      const instructorSnap = await admin.firestore().collection('instructors').doc(instructorId).get();
      if (!instructorSnap.exists || !instructorSnap.data().email) {
        console.log('Instructor not found or has no email:', instructorId);
        return null;
      }
      const instructor = instructorSnap.data();

      // Get student's real name and email
      let studentName = booking.studentName || 'A student';
      let studentEmail = null;
      if (studentId) {
        const studentSnap = await admin.firestore().collection('users').doc(studentId).get();
        if (studentSnap.exists) {
          if (studentSnap.data().name) studentName = studentSnap.data().name;
          studentEmail = studentSnap.data().email || null;
        }
      }

      // Format lesson date and time in the instructor's timezone (stored at booking time)
      const lessonDate = dateTime?.toDate ? dateTime.toDate() : new Date(dateTime);
      const tz = booking.instructorTimezone || 'UTC';
      const formattedDate = lessonDate.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        timeZone: tz
      });
      const formattedTime = lessonDate.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
        timeZone: tz
      });

      // Format payment amount
      const amountStr = amount ? `$${(amount / 100).toFixed(2)} ${(currency || 'USD').toUpperCase()}` : '';

      const emailResult = await resend.emails.send({
        from: 'Lingua Bud <notifications@linguabud.com>',
        to: instructor.email,
        subject: `New lesson booked: ${studentName} on ${formattedDate}`,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>New Lesson Booking</title>
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
                        </td>
                      </tr>

                      <!-- Content -->
                      <tr>
                        <td style="padding: 40px;">
                          <h2 style="margin: 0 0 10px 0; color: #333333; font-size: 24px;">New Lesson Booked!</h2>
                          <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.5;">
                            Hi ${instructor.name || 'Instructor'},<br><br>
                            Great news — <strong>${studentName}</strong> has booked a lesson with you and payment has been confirmed.
                          </p>

                          <!-- Lesson Details Card -->
                          <div style="background-color: #f8f9fa; border-radius: 8px; padding: 24px; margin: 0 0 28px 0; border-left: 4px solid #20bcba;">
                            <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                              <strong>Student:</strong> ${studentName}
                            </p>
                            <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                              <strong>Date:</strong> ${formattedDate}
                            </p>
                            <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                              <strong>Time:</strong> ${formattedTime}
                            </p>
                            ${amountStr ? `<p style="margin: 0; color: #333333; font-size: 16px;">
                              <strong>Payment:</strong> ${amountStr} (confirmed)
                            </p>` : ''}
                          </div>

                          <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.5;">
                            View this lesson in your Activity page and join the video call when it's time to start.
                          </p>

                          <p style="margin: 0 0 30px 0; text-align: center;">
                            <a href="https://linguabud.com/bookings"
                               style="display: inline-block; padding: 14px 36px; background-color: #20bcba; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: bold;">
                              View Upcoming Lesson
                            </a>
                          </p>

                          <p style="margin: 0; color: #999999; font-size: 14px; line-height: 1.5;">
                            Questions? Contact us at <a href="mailto:support@linguabud.com" style="color: #20bcba; text-decoration: none;">support@linguabud.com</a>
                          </p>
                        </td>
                      </tr>

                      <!-- Footer -->
                      <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
                          <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.5; text-align: center;">
                            © 2026 Lingua Bud. Connect with language partners worldwide.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
          </html>
        `,
        text: `
New Lesson Booked!

Hi ${instructor.name || 'Instructor'},

${studentName} has booked a lesson with you and payment has been confirmed.

Student: ${studentName}
Date: ${formattedDate}
Time: ${formattedTime}
${amountStr ? `Payment: ${amountStr} (confirmed)` : ''}

View your upcoming lesson: https://linguabud.com/bookings

© 2026 Lingua Bud
        `.trim()
      });

      if (emailResult.error) {
        console.error('Resend API error:', emailResult.error);
        return null;
      }

      await admin.firestore().collection('emailLog').add({
        type: 'bookingNotification',
        instructorId,
        studentId,
        bookingId: event.params.bookingId,
        instructorEmail: instructor.email,
        emailId: emailResult.data?.id,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'sent'
      });

      console.log('Booking notification sent to instructor:', instructor.email);

      // Send confirmation email to student
      if (studentEmail) {
        const studentEmailResult = await resend.emails.send({
          from: 'Lingua Bud <notifications@linguabud.com>',
          to: studentEmail,
          subject: `Lesson confirmed with ${instructor.name || 'your instructor'} on ${formattedDate}`,
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Lesson Booking Confirmed</title>
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
                          </td>
                        </tr>

                        <!-- Content -->
                        <tr>
                          <td style="padding: 40px;">
                            <h2 style="margin: 0 0 10px 0; color: #333333; font-size: 24px;">Your Lesson is Confirmed!</h2>
                            <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.5;">
                              Hi ${studentName},<br><br>
                              Your lesson with <strong>${instructor.name || 'your instructor'}</strong> has been confirmed and your payment has been processed. We look forward to seeing you learn!
                            </p>

                            <!-- Lesson Details Card -->
                            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 24px; margin: 0 0 28px 0; border-left: 4px solid #20bcba;">
                              <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                                <strong>Instructor:</strong> ${instructor.name || 'Your Instructor'}
                              </p>
                              <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                                <strong>Date:</strong> ${formattedDate}
                              </p>
                              <p style="margin: 0 0 10px 0; color: #333333; font-size: 16px;">
                                <strong>Time:</strong> ${formattedTime}
                              </p>
                              ${amountStr ? `<p style="margin: 0; color: #333333; font-size: 16px;">
                                <strong>Amount Paid:</strong> ${amountStr}
                              </p>` : ''}
                            </div>

                            <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.5;">
                              You can view your upcoming lesson and join the video call when it's time on your Activity page.
                            </p>

                            <p style="margin: 0 0 30px 0; text-align: center;">
                              <a href="https://linguabud.com/bookings"
                                 style="display: inline-block; padding: 14px 36px; background-color: #20bcba; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: bold;">
                                View My Booking
                              </a>
                            </p>

                            <p style="margin: 0; color: #999999; font-size: 14px; line-height: 1.5;">
                              Questions? Contact us at <a href="mailto:support@linguabud.com" style="color: #20bcba; text-decoration: none;">support@linguabud.com</a>
                            </p>
                          </td>
                        </tr>

                        <!-- Footer -->
                        <tr>
                          <td style="padding: 30px 40px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.5; text-align: center;">
                              © 2026 Lingua Bud. Connect with language partners worldwide.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
          `,
          text: `
Your Lesson is Confirmed!

Hi ${studentName},

Your lesson with ${instructor.name || 'your instructor'} has been confirmed and your payment has been processed.

Instructor: ${instructor.name || 'Your Instructor'}
Date: ${formattedDate}
Time: ${formattedTime}
${amountStr ? `Amount Paid: ${amountStr}` : ''}

View your booking: https://linguabud.com/bookings

Questions? Email support@linguabud.com

© 2026 Lingua Bud
          `.trim()
        });

        if (studentEmailResult.error) {
          console.error('Resend API error (student confirmation):', studentEmailResult.error);
        } else {
          await admin.firestore().collection('emailLog').add({
            type: 'bookingConfirmationStudent',
            instructorId,
            studentId,
            bookingId: event.params.bookingId,
            studentEmail,
            emailId: studentEmailResult.data?.id,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'sent'
          });
          console.log('Booking confirmation sent to student:', studentEmail);
        }
      }

      return emailResult;

    } catch (error) {
      console.error('Error sending booking notification:', error);
      return null;
    }
  }
);

/**
 * Generates an Agora RTC token for video calling
 * Called from the client when a user wants to join a video call
 */
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const functions = require('firebase-functions');

exports.generateAgoraToken = onCall(async (request) => {
  try {
    // Get channel name and UID from request
    const { channelName, uid } = request.data;

    if (!channelName) {
      throw new HttpsError('invalid-argument', 'Channel name is required');
    }

    // Agora credentials - support both process.env and legacy functions.config()
    const appId = process.env.AGORA_APP_ID ||
                  functions.config().agora?.app_id ||
                  'dfd628e44de640e3b7717f422d1dc3e7';

    const appCertificate = process.env.AGORA_APP_CERTIFICATE ||
                          functions.config().agora?.app_certificate;

    if (!appCertificate) {
      console.error('Agora App Certificate not found. Checked process.env.AGORA_APP_CERTIFICATE and functions.config().agora.app_certificate');
      throw new HttpsError(
        'failed-precondition',
        'Agora App Certificate not configured. Please set AGORA_APP_CERTIFICATE in environment variables.'
      );
    }

    console.log('Using Agora App ID:', appId);
    console.log('App Certificate configured:', appCertificate ? 'Yes' : 'No');

    // Token configuration
    const role = RtcRole.PUBLISHER; // Allow both publishing and subscribing
    const expirationTimeInSeconds = 3600 * 24; // 24 hours
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    // Use provided UID or 0 for auto-assignment
    const userUid = uid || 0;

    // Build the token
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      userUid,
      role,
      privilegeExpiredTs,
      privilegeExpiredTs
    );

    console.log('Generated Agora token for channel:', channelName, 'UID:', userUid);

    return {
      token: token,
      uid: userUid,
      appId: appId,
      expiresAt: privilegeExpiredTs
    };

  } catch (error) {
    console.error('Error generating Agora token:', error);
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Handles contact form submissions from the home page
 * Sends an email via Resend to the site owner
 */
exports.sendContactEmail = onCall(async (request) => {

  const { name, email, message } = request.data;

  if (!name || !email || !message) {
    throw new HttpsError('invalid-argument', 'Name, email, and message are required');
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const result = await resend.emails.send({
    from: 'Lingua Bud <notifications@linguabud.com>',
    to: 'support@linguabud.com',
    reply_to: email,
    subject: `Contact Form: Message from ${name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #20bcba; color: white; padding: 20px 30px; border-radius: 4px 4px 0 0;">
          <h2 style="margin: 0;">New Contact Form Submission</h2>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 4px 4px;">
          <p><strong>From:</strong> ${name}</p>
          <p><strong>Reply to:</strong> <a href="mailto:${email}">${email}</a></p>
          <p><strong>Message:</strong></p>
          <div style="background: #f8f9fa; border-left: 4px solid #20bcba; padding: 15px; white-space: pre-wrap;">${message}</div>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">Sent via Lingua Bud contact form</p>
        </div>
      </div>
    `,
    text: `New Contact Form Submission\n\nFrom: ${name}\nReply to: ${email}\n\nMessage:\n${message}`
  });

  if (result.error) {
    console.error('Resend error:', result.error);
    throw new HttpsError('internal', 'Failed to send email');
  }

  // Log to Firestore so the admin dashboard can display contact messages
  try {
    await admin.firestore().collection('contactMessages').add({
      name,
      email,
      message,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false
    });
  } catch (logErr) {
    console.error('Failed to log contact message to Firestore:', logErr);
  }

  return { success: true };
});

// ── Admin Functions ────────────────────────────────────────────────────────

/**
 * Helper: verify the calling user is an admin
 */
async function assertAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');
  const snap = await admin.firestore().collection('admins').doc(request.auth.uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Admin access required');
}

/**
 * Approve a pending instructor application
 */
exports.adminApproveInstructor = onCall(async (request) => {
  await assertAdmin(request);
  const { instructorId, personalMessage } = request.data;
  if (!instructorId) throw new HttpsError('invalid-argument', 'instructorId required');

  const db = admin.firestore();
  const instructorRef = db.collection('instructors').doc(instructorId);
  const userRef = db.collection('users').doc(instructorId);
  const statsRef = db.collection('platformStats').doc('global');

  // Use a transaction to atomically determine founding instructor status
  const { isFoundingInstructor, commissionRate } = await db.runTransaction(async (tx) => {
    const statsSnap = await tx.get(statsRef);
    const currentCount = statsSnap.exists ? (statsSnap.data().foundingInstructorCount || 0) : 0;

    let isFoundingInstructor = false;
    let commissionRate = DEFAULT_COMMISSION_RATE;

    if (currentCount < FOUNDING_INSTRUCTOR_LIMIT) {
      isFoundingInstructor = true;
      commissionRate = FOUNDING_INSTRUCTOR_RATE;
      tx.set(statsRef, {
        foundingInstructorCount: admin.firestore.FieldValue.increment(1)
      }, { merge: true });
    }

    tx.update(instructorRef, {
      status: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedBy: request.auth.uid,
      commissionRate,
      isFoundingInstructor
    });

    tx.set(userRef, {
      role: 'instructor',
      status: 'approved',
      commissionRate,
      isFoundingInstructor
    }, { merge: true });

    return { isFoundingInstructor, commissionRate };
  });

  // Notify instructor by email
  try {
    const snap = await admin.firestore().collection('instructors').doc(instructorId).get();
    if (snap.exists && snap.data().email) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const keepPercent = Math.round((1 - commissionRate) * 100);
      const foundingBadge = isFoundingInstructor
        ? `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:4px;padding:12px 16px;margin:16px 0;">
             <strong style="color:#f59e0b;">&#9733; Founding Instructor</strong>
             <p style="margin:6px 0 0;">You are one of our first ${FOUNDING_INSTRUCTOR_LIMIT} approved instructors and have been granted a <strong>lifetime ${FOUNDING_INSTRUCTOR_RATE * 100}% commission rate</strong>. You keep ${keepPercent}% of every lesson — forever.</p>
           </div>`
        : `<p>You keep <strong>${keepPercent}% of every lesson</strong> you complete on Lingua Bud.</p>`;

      const personalNoteHtml = personalMessage
        ? `<div style="background:#f0fffe;border-left:4px solid #20bcba;border-radius:4px;padding:14px 18px;margin:20px 0;">
             <p style="margin:0;font-size:15px;color:#333;line-height:1.6;">${personalMessage.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
           </div>`
        : '';
      const personalNoteText = personalMessage ? `\n${personalMessage}\n` : '';

      await resend.emails.send({
        from: 'Lingua Bud <notifications@linguabud.com>',
        to: snap.data().email,
        subject: 'Welcome to Lingua Bud — You\'re approved as an instructor!',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f7f6;">
            <!-- Header -->
            <div style="background:#20bcba;padding:32px;text-align:center;border-radius:8px 8px 0 0;">
              <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:48px;margin-bottom:12px;" />
              <h1 style="margin:0;color:white;font-size:24px;font-weight:700;">You're approved — welcome aboard!</h1>
            </div>

            <!-- Body -->
            <div style="background:white;padding:36px 40px;border-left:1px solid #e0e0e0;border-right:1px solid #e0e0e0;">
              <p style="font-size:16px;color:#333;margin-top:0;">Hi ${snap.data().name || 'there'},</p>
              <p style="font-size:15px;color:#444;line-height:1.6;">
                We're thrilled to welcome you to the Lingua Bud instructor community! Your application has been reviewed and <strong style="color:#20bcba;">approved</strong>. Your profile is now live and students can start booking lessons with you.
              </p>

              ${personalNoteHtml}

              ${foundingBadge}

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />

              <!-- Getting Started Steps -->
              <h2 style="font-size:17px;color:#113448;margin-bottom:16px;">Getting started — 3 simple steps</h2>

              <!-- Step 1 -->
              <div style="display:flex;align-items:flex-start;margin-bottom:20px;">
                <div style="background:#20bcba;color:white;font-weight:bold;font-size:14px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:14px;line-height:28px;text-align:center;">1</div>
                <div>
                  <strong style="color:#113448;">Complete your instructor profile</strong>
                  <p style="margin:4px 0 0;color:#555;font-size:14px;line-height:1.5;">
                    Head to your <a href="https://linguabud.com/dashboard" style="color:#20bcba;">Dashboard</a> and make sure your bio, languages, availability, and profile photo are up to date. A complete profile helps students find and choose you with confidence.
                  </p>
                </div>
              </div>

              <!-- Step 2 -->
              <div style="display:flex;align-items:flex-start;margin-bottom:20px;">
                <div style="background:#20bcba;color:white;font-weight:bold;font-size:14px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:14px;line-height:28px;text-align:center;">2</div>
                <div>
                  <strong style="color:#113448;">Set up Stripe to accept payments</strong>
                  <p style="margin:4px 0 0;color:#555;font-size:14px;line-height:1.5;">
                    Lingua Bud uses <strong>Stripe</strong> to process lesson payments securely. To receive payouts, you'll need to connect your Stripe account from your Dashboard. Click <strong>"Connect with Stripe"</strong> and follow the on-screen steps — it only takes a few minutes. You will not be able to receive payment for completed lessons until this is done.
                  </p>
                </div>
              </div>

              <!-- Step 3 -->
              <div style="display:flex;align-items:flex-start;margin-bottom:8px;">
                <div style="background:#20bcba;color:white;font-weight:bold;font-size:14px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:14px;line-height:28px;text-align:center;">3</div>
                <div>
                  <strong style="color:#113448;">Check your Bookings tab for upcoming lessons</strong>
                  <p style="margin:4px 0 0;color:#555;font-size:14px;line-height:1.5;">
                    Once students start booking with you, all upcoming and past lessons will appear in the <strong>Bookings</strong> tab on your Dashboard. You'll receive an email notification each time a new lesson is booked, so keep an eye on your inbox!
                  </p>
                </div>
              </div>

              <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />

              <!-- Tips -->
              <h2 style="font-size:17px;color:#113448;margin-bottom:12px;">A few tips for a great start</h2>
              <ul style="color:#555;font-size:14px;line-height:1.8;padding-left:20px;margin:0;">
                <li>Set a competitive lesson rate to attract your first students — you can always adjust it later from your Dashboard.</li>
                <li>Write a warm, detailed bio that highlights your teaching experience and the languages you specialise in.</li>
                <li>Respond to student messages promptly — quick responses lead to more bookings.</li>
                <li>After each lesson, encourage students to leave a review. Reviews build trust and help your profile stand out.</li>
              </ul>

              <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />

              <!-- CTA Buttons -->
              <div style="text-align:center;margin-bottom:8px;">
                <a href="https://linguabud.com/dashboard"
                   style="display:inline-block;background:#20bcba;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 8px;">
                  Go to My Dashboard
                </a>
                <a href="https://linguabud.com/bookings"
                   style="display:inline-block;background:#113448;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 8px;">
                  View My Bookings
                </a>
              </div>
            </div>

            <!-- Footer / Signature -->
            <div style="background:#f4f7f6;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:24px 40px;text-align:center;">
              <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:32px;margin-bottom:10px;" />
              <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
                The Lingua Bud Team<br />
                <a href="https://linguabud.com" style="color:#20bcba;text-decoration:none;">linguabud.com</a> &nbsp;|&nbsp;
                <a href="mailto:support@linguabud.com" style="color:#20bcba;text-decoration:none;">support@linguabud.com</a>
              </p>
              <p style="margin:10px 0 0;font-size:11px;color:#bbb;">
                You're receiving this email because you applied to become an instructor on Lingua Bud.
              </p>
            </div>
          </div>
        `,
        text: `Hi ${snap.data().name || 'there'},\n\nWelcome to Lingua Bud — your instructor application has been approved!\n\n${isFoundingInstructor ? `FOUNDING INSTRUCTOR: You have a lifetime ${FOUNDING_INSTRUCTOR_RATE * 100}% commission rate — you keep ${keepPercent}% of every lesson, forever.\n\n` : `You keep ${keepPercent}% of every lesson you complete on Lingua Bud.\n\n`}${personalNoteText}GETTING STARTED\n\n1. Complete your profile\nMake sure your bio, languages, availability, and profile photo are up to date on your Dashboard.\n\n2. Connect Stripe to accept payments\nGo to your Dashboard and click "Connect with Stripe". You must complete this step before you can receive payouts for completed lessons.\n\n3. Check your Bookings tab\nAll upcoming and past lessons appear in the Bookings tab. You'll get an email each time a new lesson is booked.\n\nDashboard: https://linguabud.com/dashboard\nBookings: https://linguabud.com/bookings\n\nTIPS\n- Set a competitive lesson rate to attract your first students.\n- Write a warm, detailed bio highlighting your teaching experience.\n- Respond to student messages quickly — it leads to more bookings.\n- Encourage students to leave reviews after each lesson.\n\nQuestions? Email us at support@linguabud.com\n\n— The Lingua Bud Team\nlinguabud.com | support@linguabud.com`
      });
    }
  } catch (e) {
    console.error('Failed to send approval email:', e);
  }

  return { success: true };
});

/**
 * Decline a pending instructor application
 */
exports.adminDeclineInstructor = onCall(async (request) => {
  await assertAdmin(request);
  const { instructorId, personalMessage } = request.data;
  if (!instructorId) throw new HttpsError('invalid-argument', 'instructorId required');

  await admin.firestore().collection('instructors').doc(instructorId).update({
    status: 'declined',
    declinedAt: admin.firestore.FieldValue.serverTimestamp(),
    declinedBy: request.auth.uid
  });

  // Notify instructor by email
  try {
    const snap = await admin.firestore().collection('instructors').doc(instructorId).get();
    if (snap.exists && snap.data().email) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const personalNoteHtml = personalMessage
        ? `<div style="background:#f0fffe;border-left:4px solid #20bcba;border-radius:4px;padding:14px 18px;margin:20px 0;">
             <p style="margin:0;font-size:15px;color:#333;line-height:1.6;">${personalMessage.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
           </div>`
        : '';
      const personalNoteText = personalMessage ? `\n${personalMessage}\n` : '';
      await resend.emails.send({
        from: 'Lingua Bud <notifications@linguabud.com>',
        to: snap.data().email,
        subject: 'An update on your Lingua Bud instructor application',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f7f6;">
            <!-- Header -->
            <div style="background:#113448;padding:32px;text-align:center;border-radius:8px 8px 0 0;">
              <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:48px;margin-bottom:12px;" />
              <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">An update on your application</h1>
            </div>

            <!-- Body -->
            <div style="background:white;padding:36px 40px;border-left:1px solid #e0e0e0;border-right:1px solid #e0e0e0;">
              <p style="font-size:16px;color:#333;margin-top:0;">Hi ${snap.data().name || 'there'},</p>
              <p style="font-size:15px;color:#444;line-height:1.6;">
                Thank you for taking the time to apply to become an instructor on Lingua Bud. We genuinely appreciate your interest in joining our community and the effort you put into your application.
              </p>
              <p style="font-size:15px;color:#444;line-height:1.6;">
                After carefully reviewing your application, we are unfortunately <strong>unable to approve your profile at this time</strong>. This is not a permanent decision — we review applications on a rolling basis, and our requirements may evolve as the platform grows.
              </p>

              ${personalNoteHtml}

              <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />

              <!-- What to do next -->
              <h2 style="font-size:17px;color:#113448;margin-bottom:12px;">What can I do next?</h2>
              <ul style="color:#555;font-size:14px;line-height:1.8;padding-left:20px;margin:0;">
                <li><strong>Request feedback</strong> — we're happy to give you specific guidance on what we'd like to see. Just email us at <a href="mailto:support@linguabud.com" style="color:#20bcba;">support@linguabud.com</a>.</li>
                <li><strong>Reapply in the future</strong> — once you have addressed any feedback, you are welcome to submit a new application. We'd love to reconsider.</li>
                <li><strong>Explore Lingua Bud as a learner</strong> — in the meantime, you're welcome to use the platform to take lessons, connect with other language enthusiasts, and access our free learning resources.</li>
              </ul>

              <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />

              <p style="font-size:15px;color:#444;line-height:1.6;">
                We know this isn't the news you were hoping for, and we're sorry for that. If you have any questions at all, please don't hesitate to get in touch — we're always happy to help.
              </p>

              <!-- CTA -->
              <div style="text-align:center;margin-top:28px;">
                <a href="mailto:support@linguabud.com"
                   style="display:inline-block;background:#20bcba;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;">
                  Contact Us
                </a>
              </div>
            </div>

            <!-- Footer / Signature -->
            <div style="background:#f4f7f6;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:24px 40px;text-align:center;">
              <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:32px;margin-bottom:10px;" />
              <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
                The Lingua Bud Team<br />
                <a href="https://linguabud.com" style="color:#20bcba;text-decoration:none;">linguabud.com</a> &nbsp;|&nbsp;
                <a href="mailto:support@linguabud.com" style="color:#20bcba;text-decoration:none;">support@linguabud.com</a>
              </p>
              <p style="margin:10px 0 0;font-size:11px;color:#bbb;">
                You're receiving this email because you applied to become an instructor on Lingua Bud.
              </p>
            </div>
          </div>
        `,
        text: `Hi ${snap.data().name || 'there'},\n\nThank you for applying to become an instructor on Lingua Bud. We appreciate your interest and the effort you put into your application.\n\nAfter carefully reviewing your application, we are unfortunately unable to approve your profile at this time. This is not a permanent decision — we review applications on a rolling basis.\n${personalNoteText}\nWHAT CAN I DO NEXT?\n\n- Request feedback: Email us at support@linguabud.com and we'll give you specific guidance.\n- Reapply in the future: Once you've addressed any feedback, you're welcome to submit a new application.\n- Explore Lingua Bud as a learner: You can still use the platform to take lessons and access our free learning resources.\n\nWe're sorry this wasn't the news you were hoping for. Please don't hesitate to reach out with any questions.\n\n— The Lingua Bud Team\nlinguabud.com | support@linguabud.com`
      });
    }
  } catch (e) {
    console.error('Failed to send decline email:', e);
  }

  return { success: true };
});

/**
 * Permanently delete a user account (Auth + Firestore)
 */
exports.adminDeleteUser = onCall(async (request) => {
  await assertAdmin(request);
  const { userId } = request.data;
  if (!userId) throw new HttpsError('invalid-argument', 'userId required');

  // Delete from Firebase Auth
  try {
    await admin.auth().deleteUser(userId);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  // Delete Firestore profile documents
  const batch = admin.firestore().batch();
  batch.delete(admin.firestore().collection('users').doc(userId));
  batch.delete(admin.firestore().collection('instructors').doc(userId));
  batch.delete(admin.firestore().collection('instructor_availability').doc(userId));
  await batch.commit();

  return { success: true };
});

/**
 * Set or clear the flagged status on a user or instructor
 */
exports.adminFlagUser = onCall(async (request) => {
  await assertAdmin(request);
  const { userId, userCollection, flagged } = request.data;
  if (!userId || !userCollection) throw new HttpsError('invalid-argument', 'userId and userCollection required');

  const update = flagged
    ? { flagged: true, flaggedAt: admin.firestore.FieldValue.serverTimestamp() }
    : { flagged: false, flaggedAt: null };

  await admin.firestore().collection(userCollection).doc(userId).update(update);
  return { success: true };
});

/**
 * Mark a contact message as read
 */
exports.adminMarkMessageRead = onCall(async (request) => {
  await assertAdmin(request);
  const { messageId } = request.data;
  if (!messageId) throw new HttpsError('invalid-argument', 'messageId required');

  await admin.firestore().collection('contactMessages').doc(messageId).update({ read: true });
  return { success: true };
});

// ── Stripe Connect Integration ─────────────────────────────────────────────

const STUDENT_PLATFORM_FEE = 1.00; // flat $1 fee added to every transaction
const DEFAULT_COMMISSION_RATE = 0.15; // 15% commission for standard instructors
const FOUNDING_INSTRUCTOR_RATE = 0.10; // 10% lifetime commission for first 50 instructors
const FOUNDING_INSTRUCTOR_LIMIT = 50;

function getStripe() {
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * Creates (or retrieves) a Stripe Express Connect account for an instructor
 * and returns an onboarding URL.
 */
exports.createStripeConnectAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const uid = request.auth.uid;
  const stripe = getStripe();

  const instructorRef = admin.firestore().collection('instructors').doc(uid);
  const instructorSnap = await instructorRef.get();

  // Determine which Stripe environment is active from the secret key prefix
  const currentMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test';

  const existingData = instructorSnap.exists ? instructorSnap.data() : {};
  const existingAccountId = existingData.stripeAccountId;
  // Accounts created before mode tracking was added are treated as test accounts
  const existingMode = existingData.stripeMode || (existingAccountId ? 'test' : null);

  let stripeAccountId;

  if (existingAccountId && existingMode === currentMode) {
    // Same mode — reuse the existing account, just generate a fresh onboarding link
    stripeAccountId = existingAccountId;
  } else {
    // Need a new account: either first-time setup, or instructor transitioning test → live
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { firebaseUid: uid, mode: currentMode }
    });
    stripeAccountId = account.id;

    const updateData = {
      stripeAccountId,
      stripeMode: currentMode,
      stripeOnboardingComplete: false
    };

    // Preserve the old account ID under a mode-specific key so it is never lost
    if (existingAccountId && existingMode && existingMode !== currentMode) {
      updateData[`stripeAccountId_${existingMode}`] = existingAccountId;
    }

    await instructorRef.set(updateData, { merge: true });
  }

  // Generate an account onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: 'https://linguabud.com/dashboard?stripe=refresh',
    return_url: 'https://linguabud.com/dashboard?stripe=success',
    type: 'account_onboarding'
  });

  return { url: accountLink.url };
});

/**
 * Returns the Stripe Express dashboard login link for a connected instructor.
 * Also returns chargesEnabled so the dashboard can update onboarding status.
 */
exports.getStripeConnectDashboard = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const uid = request.auth.uid;
  const stripe = getStripe();

  const instructorSnap = await admin.firestore().collection('instructors').doc(uid).get();

  if (!instructorSnap.exists || !instructorSnap.data().stripeAccountId) {
    throw new HttpsError('not-found', 'No Stripe account found. Please connect first.');
  }

  const data = instructorSnap.data();
  const stripeAccountId = data.stripeAccountId;

  // Detect test→live mode transition before hitting the Stripe API
  const currentMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test';
  const storedMode  = data.stripeMode || 'test'; // no stripeMode = legacy test account

  if (storedMode !== currentMode) {
    // The stored account belongs to a different Stripe environment.
    // The instructor must complete a one-time live-mode onboarding.
    return { needsLiveModeReconnect: true, chargesEnabled: false, loginUrl: null };
  }

  let account;
  try {
    account = await stripe.accounts.retrieve(stripeAccountId);
  } catch (err) {
    if (err.code === 'resource_missing') {
      // Account ID doesn't exist in the current environment — stale test-mode reference
      return { needsLiveModeReconnect: true, chargesEnabled: false, loginUrl: null };
    }
    throw err;
  }

  let loginUrl = null;
  if (account.charges_enabled) {
    const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
    loginUrl = loginLink.url;
  }

  return {
    loginUrl,
    chargesEnabled: account.charges_enabled,
    stripeAccountId,
    needsLiveModeReconnect: false
  };
});

/**
 * Creates a Stripe PaymentIntent for a student booking a lesson.
 * Directs funds to the instructor's Connect account.
 * Platform fee = instructor's commissionRate (default 15%, 10% for founding instructors)
 * plus a flat $1 student platform fee, both collected as application_fee_amount.
 */
exports.createPaymentIntent = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { instructorId, idempotencyKey } = request.data;
  const uid = request.auth.uid;

  if (!instructorId) {
    throw new HttpsError('invalid-argument', 'instructorId is required');
  }

  const stripe = getStripe();

  const instructorSnap = await admin.firestore().collection('instructors').doc(instructorId).get();

  if (!instructorSnap.exists) {
    throw new HttpsError('not-found', 'Instructor not found');
  }

  const instructor = instructorSnap.data();
  const { price_per_lesson, currency, stripeAccountId } = instructor;

  if (!stripeAccountId) {
    throw new HttpsError('failed-precondition', 'Instructor has not connected Stripe');
  }

  if (!price_per_lesson || price_per_lesson < 5) {
    throw new HttpsError('failed-precondition', 'Instructor lesson price must be at least $5');
  }

  // Verify instructor can accept charges
  const account = await stripe.accounts.retrieve(stripeAccountId);
  if (!account.charges_enabled) {
    throw new HttpsError('failed-precondition', 'Instructor payment setup is incomplete');
  }

  // Use instructor's individual commission rate (set at approval time)
  const commissionRate = typeof instructor.commissionRate === 'number'
    ? instructor.commissionRate
    : DEFAULT_COMMISSION_RATE;

  const lessonAmountCents = Math.round(price_per_lesson * 100); // lesson price in cents
  const studentFeeCents   = Math.round(STUDENT_PLATFORM_FEE * 100); // flat $1 fee in cents
  const totalChargeCents  = lessonAmountCents + studentFeeCents; // student pays lesson + $1

  const commissionCents   = Math.round(lessonAmountCents * commissionRate);
  // Platform collects commission on lesson price + the student platform fee
  const applicationFeeAmountCents = commissionCents + studentFeeCents;

  const normalizedCurrency = (currency || 'USD').toLowerCase();

  // Idempotency key prevents duplicate charges on network retries
  const stripeOptions = idempotencyKey ? { idempotencyKey } : {};

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalChargeCents,
    currency: normalizedCurrency,
    application_fee_amount: applicationFeeAmountCents,
    transfer_data: {
      destination: stripeAccountId
    },
    automatic_payment_methods: { enabled: true },
    // Metadata lets the webhook reconcile bookings for redirect-based payments
    metadata: {
      instructorId,
      studentId: uid,
      lessonAmount: String(lessonAmountCents),
      studentPlatformFee: String(studentFeeCents),
      commissionRate: String(commissionRate),
      isFoundingInstructor: String(!!instructor.isFoundingInstructor)
    }
  }, stripeOptions);

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: totalChargeCents,
    lessonAmount: lessonAmountCents,
    studentPlatformFee: studentFeeCents,
    currency: normalizedCurrency,
    platformFee: applicationFeeAmountCents
  };
});

/**
 * Cancels a booking, issues a Stripe refund per the cancellation policy,
 * and sends email notifications to both parties.
 * Can be called by either the student or the instructor on the booking.
 *
 * Refund policy:
 *   Instructor cancels             → 100% refund always
 *   Student cancels >24h before    → 100% refund
 *   Student cancels 12–24h before  → 50% refund
 *   Student cancels <12h before    → no refund
 */
exports.cancelBooking = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { bookingId } = request.data;
  if (!bookingId) throw new HttpsError('invalid-argument', 'bookingId is required');

  const uid = request.auth.uid;
  const bookingRef = admin.firestore().collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();

  if (!bookingSnap.exists) throw new HttpsError('not-found', 'Booking not found');
  const booking = bookingSnap.data();

  if (booking.studentId !== uid && booking.instructorId !== uid) {
    throw new HttpsError('permission-denied', 'Not authorized to cancel this booking');
  }
  if (booking.status === 'cancelled') {
    throw new HttpsError('failed-precondition', 'Booking is already cancelled');
  }

  const cancelledBy = booking.studentId === uid ? 'student' : 'instructor';

  // ── Determine refund percentage ──────────────────────────────────────────
  const lessonDate = booking.dateTime?.toDate ? booking.dateTime.toDate() : new Date(booking.dateTime);
  const now = new Date();
  const hoursUntilLesson = (lessonDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  let refundPercent = 0;
  let refundLabel = '';

  if (cancelledBy === 'instructor') {
    refundPercent = 100;
    refundLabel = 'Full refund (instructor cancellation)';
  } else if (hoursUntilLesson > 24) {
    refundPercent = 100;
    refundLabel = 'Full refund (cancelled more than 24 hours before lesson)';
  } else if (hoursUntilLesson > 12) {
    refundPercent = 50;
    refundLabel = '50% refund (cancelled 12–24 hours before lesson)';
  } else {
    refundPercent = 0;
    refundLabel = 'No refund (cancelled less than 12 hours before lesson)';
  }

  // ── Process Stripe refund if payment was made ────────────────────────────
  let stripeRefundId = null;
  let refundAmountCents = 0;

  if (refundPercent > 0 && booking.paymentIntentId && booking.paymentStatus === 'paid') {
    try {
      const stripe = getStripe();
      refundAmountCents = refundPercent === 100
        ? booking.amount
        : Math.round(booking.amount * refundPercent / 100);

      const refund = await stripe.refunds.create({
        payment_intent: booking.paymentIntentId,
        ...(refundPercent < 100 && { amount: refundAmountCents }),
        refund_application_fee: true,
        reverse_transfer: true,
      });
      stripeRefundId = refund.id;
      console.log(`Refund created: ${refund.id} — ${refundPercent}% of ${booking.amount} ${booking.currency}`);
    } catch (refundErr) {
      console.error('Stripe refund error:', refundErr);
      // Don't block the cancellation — refund can be issued manually if needed
    }
  }

  // Helper: format cents to display amount (e.g. 5000 USD → "$50.00")
  const formatCurrency = (cents, currency) => {
    if (!cents || !currency) return null;
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() });
  };
  const refundAmountStr = formatCurrency(refundAmountCents, booking.currency);

  await bookingRef.update({
    status: 'cancelled',
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    cancelledBy,
    refundPercent,
    refundLabel,
    refundAmountCents,
    ...(stripeRefundId && { stripeRefundId }),
  });

  // Format lesson date/time for emails (lessonDate already declared above for refund calc)
  const tz = booking.instructorTimezone || 'UTC';
  const formattedDate = lessonDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz
  });
  const formattedTime = lessonDate.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: tz
  });

  const resend = new Resend(process.env.RESEND_API_KEY);

  const emailHeader = `
    <tr>
      <td style="padding: 36px 40px 20px 40px; text-align: center; background-color: #113448;">
        <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: bold;">Lingua Bud</h1>
      </td>
    </tr>`;
  const emailFooter = `
    <tr>
      <td style="padding: 24px 40px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
        <p style="margin: 0; color: #999999; font-size: 12px; text-align: center;">
          © 2026 Lingua Bud. Connect with language partners worldwide.<br>
          Questions? <a href="mailto:support@linguabud.com" style="color: #20bcba;">support@linguabud.com</a>
        </p>
      </td>
    </tr>`;

  // Look up student's real name (stored booking.studentName may be an email for older bookings)
  const studentProfileSnap = await admin.firestore().collection('users').doc(booking.studentId).get();
  const studentDisplayName = (studentProfileSnap.exists && studentProfileSnap.data().name)
    ? studentProfileSnap.data().name
    : (booking.studentName && !booking.studentName.includes('@') ? booking.studentName : 'A student');

  try {
    if (cancelledBy === 'student') {
      // Notify instructor that student cancelled
      const instructorSnap = await admin.firestore().collection('instructors').doc(booking.instructorId).get();
      if (instructorSnap.exists && instructorSnap.data().email) {
        const instructor = instructorSnap.data();
        const studentName = studentDisplayName;
        await resend.emails.send({
          from: 'Lingua Bud <notifications@linguabud.com>',
          to: instructor.email,
          subject: `Lesson cancelled by ${studentName}`,
          html: `
            <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4;">
              <table role="presentation" style="width:100%;border-collapse:collapse;">
                <tr><td align="center" style="padding:40px 0;">
                  <table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
                    ${emailHeader}
                    <tr><td style="padding:40px;">
                      <h2 style="margin:0 0 16px;color:#333;font-size:22px;">Lesson Cancellation Notice</h2>
                      <p style="margin:0 0 20px;color:#666;font-size:16px;line-height:1.6;">
                        Hi ${instructor.name || 'Instructor'},<br><br>
                        <strong>${studentName}</strong> has cancelled their upcoming lesson with you.
                      </p>
                      <div style="background:#f8f9fa;border-left:4px solid #20bcba;border-radius:6px;padding:20px;margin:0 0 24px;">
                        <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Student:</strong> ${studentName}</p>
                        <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Date:</strong> ${formattedDate}</p>
                        <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Time:</strong> ${formattedTime}</p>
                        <p style="margin:0;color:#333;font-size:15px;"><strong>Refund:</strong> ${refundLabel}</p>
                      </div>
                      <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.6;">
                        This time slot is now available for other students to book. Visit your dashboard to review your schedule.
                      </p>
                      <p style="margin:0 0 28px;text-align:center;">
                        <a href="https://linguabud.com/dashboard" style="display:inline-block;padding:13px 32px;background-color:#20bcba;color:#fff;text-decoration:none;border-radius:4px;font-size:15px;font-weight:bold;">
                          Go to Dashboard
                        </a>
                      </p>
                    </td></tr>
                    ${emailFooter}
                  </table>
                </td></tr>
              </table>
            </body></html>
          `,
          text: `Hi ${instructor.name || 'Instructor'},\n\n${studentName} has cancelled their lesson with you.\n\nDate: ${formattedDate}\nTime: ${formattedTime}\nRefund: ${refundLabel}\n\nThis slot is now available for other students.\n\nDashboard: https://linguabud.com/dashboard\n\n© 2026 Lingua Bud`
        });
        console.log('Cancellation email sent to instructor:', instructor.email);
      }

      // Also notify student of their refund status (reuse already-fetched profile)
      if (studentProfileSnap.exists && studentProfileSnap.data().email) {
        const student = studentProfileSnap.data();
        const refundNote = refundPercent === 0
          ? `Per our <a href="https://linguabud.com/refund-policy" style="color:#20bcba;">cancellation policy</a>, no refund is issued for cancellations within 12 hours of the lesson.`
          : `<strong>${refundPercent === 100 ? 'A full refund' : 'A 50% refund'}${refundAmountStr ? ` of ${refundAmountStr}` : ''}</strong> has been issued to your original payment method and should appear within 5–10 business days.`;
        const refundNotePlain = refundPercent === 0
          ? 'Per our cancellation policy, no refund is issued for cancellations within 12 hours of the lesson.'
          : `${refundPercent === 100 ? 'A full refund' : 'A 50% refund'}${refundAmountStr ? ` of ${refundAmountStr}` : ''} has been issued to your original payment method and should appear within 5–10 business days.`;
        await resend.emails.send({
          from: 'Lingua Bud <notifications@linguabud.com>',
          to: student.email,
          subject: 'Your lesson has been cancelled',
          html: `
            <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4;">
              <table role="presentation" style="width:100%;border-collapse:collapse;">
                <tr><td align="center" style="padding:40px 0;">
                  <table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
                    ${emailHeader}
                    <tr><td style="padding:40px;">
                      <h2 style="margin:0 0 16px;color:#333;font-size:22px;">Lesson Cancellation Confirmed</h2>
                      <p style="margin:0 0 20px;color:#666;font-size:16px;line-height:1.6;">
                        Hi ${student.name || 'there'},<br><br>
                        Your lesson has been successfully cancelled.
                      </p>
                      <div style="background:#f8f9fa;border-left:4px solid #20bcba;border-radius:6px;padding:20px;margin:0 0 24px;">
                        <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Date:</strong> ${formattedDate}</p>
                        <p style="margin:0;color:#333;font-size:15px;"><strong>Time:</strong> ${formattedTime}</p>
                      </div>
                      <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.6;">${refundNote}</p>
                      <p style="margin:0 0 28px;text-align:center;">
                        <a href="https://linguabud.com/instructors" style="display:inline-block;padding:13px 32px;background-color:#20bcba;color:#fff;text-decoration:none;border-radius:4px;font-size:15px;font-weight:bold;">
                          Find Another Instructor
                        </a>
                      </p>
                    </td></tr>
                    ${emailFooter}
                  </table>
                </td></tr>
              </table>
            </body></html>
          `,
          text: `Hi ${student.name || 'there'},\n\nYour lesson has been cancelled.\n\nDate: ${formattedDate}\nTime: ${formattedTime}\n\n${refundNotePlain}\n\nFind another instructor: https://linguabud.com/instructors\n\n© 2026 Lingua Bud`
        });
      }
    } else {
      // Notify student that instructor cancelled — always full refund (reuse already-fetched profile)
      if (studentProfileSnap.exists && studentProfileSnap.data().email) {
        const student = studentProfileSnap.data();
        const instructorSnap = await admin.firestore().collection('instructors').doc(booking.instructorId).get();
        const instructorName = instructorSnap.exists ? (instructorSnap.data().name || 'Your instructor') : 'Your instructor';
        const refundNote = stripeRefundId
          ? `A <strong>full refund${refundAmountStr ? ` of ${refundAmountStr}` : ''}</strong> has been issued to your original payment method and should appear within 5–10 business days.`
          : booking.paymentStatus === 'paid'
            ? `A full refund will be processed to your original payment method within 5–10 business days.`
            : `No payment was charged for this lesson.`;
        const refundNotePlain = stripeRefundId
          ? `A full refund${refundAmountStr ? ` of ${refundAmountStr}` : ''} has been issued to your original payment method and should appear within 5–10 business days.`
          : booking.paymentStatus === 'paid'
            ? `A full refund will be processed to your original payment method within 5–10 business days.`
            : `No payment was charged for this lesson.`;
        await resend.emails.send({
          from: 'Lingua Bud <notifications@linguabud.com>',
          to: student.email,
          subject: `Your lesson with ${instructorName} has been cancelled`,
          html: `
            <!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f4f4f4;">
              <table role="presentation" style="width:100%;border-collapse:collapse;">
                <tr><td align="center" style="padding:40px 0;">
                  <table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
                    ${emailHeader}
                    <tr><td style="padding:40px;">
                      <h2 style="margin:0 0 16px;color:#333;font-size:22px;">Lesson Cancellation Notice</h2>
                      <p style="margin:0 0 20px;color:#666;font-size:16px;line-height:1.6;">
                        Hi ${student.name || 'there'},<br><br>
                        We're sorry to let you know that <strong>${instructorName}</strong> has cancelled your upcoming lesson.
                      </p>
                      <div style="background:#f8f9fa;border-left:4px solid #20bcba;border-radius:6px;padding:20px;margin:0 0 24px;">
                        <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Instructor:</strong> ${instructorName}</p>
                        <p style="margin:0 0 8px;color:#333;font-size:15px;"><strong>Date:</strong> ${formattedDate}</p>
                        <p style="margin:0;color:#333;font-size:15px;"><strong>Time:</strong> ${formattedTime}</p>
                      </div>
                      <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.6;">${refundNote}</p>
                      <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.6;">
                        We apologize for the inconvenience. Please browse our other available instructors to rebook your lesson.
                      </p>
                      <p style="margin:0 0 28px;text-align:center;">
                        <a href="https://linguabud.com/instructors" style="display:inline-block;padding:13px 32px;background-color:#20bcba;color:#fff;text-decoration:none;border-radius:4px;font-size:15px;font-weight:bold;">
                          Find Another Instructor
                        </a>
                      </p>
                    </td></tr>
                    ${emailFooter}
                  </table>
                </td></tr>
              </table>
            </body></html>
          `,
          text: `Hi ${student.name || 'there'},\n\n${instructorName} has cancelled your upcoming lesson.\n\nDate: ${formattedDate}\nTime: ${formattedTime}\n\n${refundNotePlain}\n\nFind another instructor: https://linguabud.com/instructors\n\n© 2026 Lingua Bud`
        });
        console.log('Cancellation email sent to student:', student.email);
      }
    }
  } catch (emailErr) {
    console.error('Error sending cancellation email:', emailErr);
    // Don't fail the cancellation if email fails
  }

  return { success: true, cancelledBy, refundPercent, refundLabel, refundAmountCents };
});

/**
 * Submits a student review for a completed lesson.
 * Atomically writes the review and updates instructor averageRating + reviewCount.
 */
exports.submitReview = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { bookingId, rating, review } = request.data;
  if (!bookingId) throw new HttpsError('invalid-argument', 'bookingId is required');
  if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new HttpsError('invalid-argument', 'Rating must be an integer 1–5');

  const studentId = request.auth.uid;

  // Verify booking exists and belongs to this student
  const bookingRef = admin.firestore().collection('bookings').doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) throw new HttpsError('not-found', 'Booking not found');
  const booking = bookingSnap.data();
  if (booking.studentId !== studentId) throw new HttpsError('permission-denied', 'Not your booking');

  // Verify lesson has ended (lesson start + 55 min)
  const lessonTime = booking.dateTime.toDate();
  if (new Date() < new Date(lessonTime.getTime() + 55 * 60 * 1000))
    throw new HttpsError('failed-precondition', 'Lesson has not ended yet');

  // Prevent duplicate reviews
  const existing = await admin.firestore().collection('reviews')
    .where('bookingId', '==', bookingId).limit(1).get();
  if (!existing.empty) throw new HttpsError('already-exists', 'You have already reviewed this lesson');

  // Get student's display name
  const studentSnap = await admin.firestore().collection('users').doc(studentId).get();
  const studentName = studentSnap.exists ? (studentSnap.data().name || 'Student') : 'Student';

  // Atomic transaction: write review + update instructor averageRating & reviewCount
  const instructorRef = admin.firestore().collection('instructors').doc(booking.instructorId);
  await admin.firestore().runTransaction(async (tx) => {
    const instSnap = await tx.get(instructorRef);
    if (!instSnap.exists) throw new HttpsError('not-found', 'Instructor profile not found');
    const inst = instSnap.data();
    const count = inst.reviewCount || 0;
    const avg = inst.averageRating || 0;
    const newCount = count + 1;
    const newAvg = Math.round(((avg * count) + rating) / newCount * 10) / 10;

    tx.set(admin.firestore().collection('reviews').doc(), {
      bookingId,
      instructorId: booking.instructorId,
      studentId,
      studentName,
      rating,
      review: (review || '').trim(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    tx.set(instructorRef, { averageRating: newAvg, reviewCount: newCount }, { merge: true });
  });

  return { success: true };
});

// ── Stripe Config & Webhooks ────────────────────────────────────────────────

/**
 * Returns the Stripe publishable key to the frontend.
 * Keeps the key out of HTML source; switching test↔live is a single .env change.
 */
exports.getStripeConfig = onCall(async (_request) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new HttpsError('internal', 'Stripe publishable key not configured');
  }
  // `mode` lets the frontend detect test→live transitions without extra calls
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test';
  return { publishableKey, mode };
});

/**
 * Stripe webhook endpoint — receives events from Stripe and keeps Firestore in sync.
 *
 * Register this URL in Stripe Dashboard → Developers → Webhooks:
 *   https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net/stripeWebhook
 *
 * Two Stripe webhook destinations point to this same URL:
 *   Destination 1 — "Your Account"            → STRIPE_WEBHOOK_SECRET
 *     events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
 *   Destination 2 — "Connected and v2 Accounts" → STRIPE_CONNECT_WEBHOOK_SECRET
 *     events: account.updated
 *
 * Register at: Stripe Dashboard → Developers → Webhooks → Add Destination
 * URL: https://us-central1-<YOUR_PROJECT_ID>.cloudfunctions.net/stripeWebhook
 */
exports.stripeWebhook = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const sig = req.headers['stripe-signature'];
  const stripe = getStripe();

  // Try each configured secret in turn — the one that matches will verify cleanly.
  // This handles both the "Your Account" destination and the "Connected accounts"
  // destination, which Stripe signs with different secrets.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  ].filter(Boolean);

  if (secrets.length === 0) {
    console.error('No Stripe webhook secrets configured (STRIPE_WEBHOOK_SECRET / STRIPE_CONNECT_WEBHOOK_SECRET)');
    res.status(500).send('Webhook secrets not configured');
    return;
  }

  let event;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
      break; // verified — stop trying
    } catch (_) {
      // wrong secret for this delivery — try the next one
    }
  }

  if (!event) {
    console.error('Stripe webhook signature verification failed for all configured secrets');
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  const db = admin.firestore();

  try {
    switch (event.type) {

      // ── Payment confirmed server-side ────────────────────────────────────
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        console.log(`payment_intent.succeeded: ${pi.id}`);
        const bookingsSnap = await db.collection('bookings')
          .where('paymentIntentId', '==', pi.id)
          .limit(1)
          .get();
        if (!bookingsSnap.empty) {
          await bookingsSnap.docs[0].ref.update({
            paymentStatus: 'paid',
            webhookConfirmedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`Booking ${bookingsSnap.docs[0].id} confirmed via webhook`);
        } else {
          // Redirect-based payment: booking not yet created client-side.
          // Metadata holds instructorId + studentId for manual recovery if needed.
          console.warn(`No booking found for paymentIntentId ${pi.id}. Metadata:`, pi.metadata);
        }
        break;
      }

      // ── Payment failed ───────────────────────────────────────────────────
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        console.log(`payment_intent.payment_failed: ${pi.id}`);
        const bookingsSnap = await db.collection('bookings')
          .where('paymentIntentId', '==', pi.id)
          .limit(1)
          .get();
        if (!bookingsSnap.empty) {
          await bookingsSnap.docs[0].ref.update({
            paymentStatus: 'failed',
            webhookFailedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        break;
      }

      // ── Instructor Stripe account updated (onboarding progress) ──────────
      case 'account.updated': {
        const account = event.data.object;
        console.log(`account.updated: ${account.id}, charges_enabled=${account.charges_enabled}`);
        const instructorsSnap = await db.collection('instructors')
          .where('stripeAccountId', '==', account.id)
          .limit(1)
          .get();
        if (!instructorsSnap.empty) {
          await instructorsSnap.docs[0].ref.update({
            stripeOnboardingComplete: account.charges_enabled === true,
            stripePayoutsEnabled:     account.payouts_enabled === true,
            stripeDetailsSubmitted:   account.details_submitted === true,
            stripeAccountUpdatedAt:   admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`Instructor ${instructorsSnap.docs[0].id} Stripe status updated`);
        }
        break;
      }

      // ── Refund processed ─────────────────────────────────────────────────
      case 'charge.refunded': {
        const charge = event.data.object;
        const piId = charge.payment_intent;
        if (piId) {
          const bookingsSnap = await db.collection('bookings')
            .where('paymentIntentId', '==', piId)
            .limit(1)
            .get();
          if (!bookingsSnap.empty) {
            await bookingsSnap.docs[0].ref.update({
              paymentStatus: 'refunded',
              webhookRefundedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    // Append all events to an audit log for debugging and compliance
    await db.collection('stripeEvents').add({
      eventId:     event.id,
      type:        event.type,
      livemode:    event.livemode,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });

  } catch (handlerErr) {
    // Return 200 anyway so Stripe does not retry indefinitely
    console.error(`Error handling Stripe event ${event.type}:`, handlerErr);
  }

  res.json({ received: true });
});
