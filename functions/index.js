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
                            <a href="https://linguabud.com/messages.html"
                               style="display: inline-block; padding: 14px 32px; background-color: #20bcba; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: bold;">
                              View Message
                            </a>
                          </p>

                          <p style="margin: 30px 0 0 0; color: #999999; font-size: 14px; line-height: 1.5;">
                            Don't want to receive these emails? You can turn off email notifications in your
                            <a href="https://linguabud.com/student-dashboard.html" style="color: #20bcba; text-decoration: none;">dashboard settings</a>.
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

View your message at: https://linguabud.com/messages.html

Don't want to receive these emails? Turn off notifications in your dashboard: https://linguabud.com/student-dashboard.html

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
                            <a href="https://linguabud.com/activity.html"
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

View your upcoming lesson: https://linguabud.com/activity.html

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
                              <a href="https://linguabud.com/activity.html"
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

View your booking: https://linguabud.com/activity.html

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
const { onCall, HttpsError } = require('firebase-functions/v2/https');
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
  const { instructorId } = request.data;
  if (!instructorId) throw new HttpsError('invalid-argument', 'instructorId required');

  await admin.firestore().collection('instructors').doc(instructorId).update({
    status: 'approved',
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedBy: request.auth.uid
  });

  // Notify instructor by email
  try {
    const snap = await admin.firestore().collection('instructors').doc(instructorId).get();
    if (snap.exists && snap.data().email) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Lingua Bud <notifications@linguabud.com>',
        to: snap.data().email,
        subject: 'Your Lingua Bud instructor application has been approved!',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#20bcba;color:white;padding:24px 32px;border-radius:4px 4px 0 0;">
              <h2 style="margin:0;">Welcome to Lingua Bud!</h2>
            </div>
            <div style="background:white;padding:32px;border:1px solid #e9ecef;border-top:none;border-radius:0 0 4px 4px;">
              <p>Hi ${snap.data().name || 'Instructor'},</p>
              <p>Great news — your instructor application has been <strong>approved</strong>! Your profile is now live and students can book lessons with you.</p>
              <p style="margin-top:24px;">
                <a href="https://linguabud.com/dashboard.html"
                   style="background:#20bcba;color:white;padding:12px 28px;border-radius:4px;text-decoration:none;font-weight:bold;">
                  Go to Your Dashboard
                </a>
              </p>
              <p style="color:#999;font-size:13px;margin-top:24px;">Questions? Email us at <a href="mailto:support@linguabud.com" style="color:#20bcba;">support@linguabud.com</a></p>
            </div>
          </div>
        `,
        text: `Hi ${snap.data().name || 'Instructor'},\n\nYour Lingua Bud instructor application has been approved! Your profile is now live.\n\nDashboard: https://linguabud.com/dashboard.html\n\nQuestions? Email support@linguabud.com`
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
  const { instructorId } = request.data;
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
      await resend.emails.send({
        from: 'Lingua Bud <notifications@linguabud.com>',
        to: snap.data().email,
        subject: 'Update on your Lingua Bud instructor application',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#113448;color:white;padding:24px 32px;border-radius:4px 4px 0 0;">
              <h2 style="margin:0;">Lingua Bud</h2>
            </div>
            <div style="background:white;padding:32px;border:1px solid #e9ecef;border-top:none;border-radius:0 0 4px 4px;">
              <p>Hi ${snap.data().name || 'there'},</p>
              <p>Thank you for applying to become an instructor on Lingua Bud. After reviewing your application, we are unable to approve your profile at this time.</p>
              <p>If you have questions or would like feedback, please reach out at <a href="mailto:support@linguabud.com" style="color:#20bcba;">support@linguabud.com</a>.</p>
              <p style="color:#999;font-size:13px;margin-top:24px;">The Lingua Bud Team</p>
            </div>
          </div>
        `,
        text: `Hi ${snap.data().name || 'there'},\n\nThank you for applying to become a Lingua Bud instructor. After review we are unable to approve your profile at this time.\n\nQuestions? Email support@linguabud.com`
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

const PLATFORM_FEE_PERCENT = 0.10; // 10% platform fee — easy to adjust

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

  let stripeAccountId;

  if (instructorSnap.exists && instructorSnap.data().stripeAccountId) {
    // Reuse existing account — create a fresh onboarding link
    stripeAccountId = instructorSnap.data().stripeAccountId;
  } else {
    // Create a new Express account
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { firebaseUid: uid }
    });
    stripeAccountId = account.id;
    await instructorRef.set({ stripeAccountId }, { merge: true });
  }

  // Generate an account onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: 'https://linguabud.com/dashboard.html?stripe=refresh',
    return_url: 'https://linguabud.com/dashboard.html?stripe=success',
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

  const stripeAccountId = instructorSnap.data().stripeAccountId;
  const account = await stripe.accounts.retrieve(stripeAccountId);

  let loginUrl = null;
  if (account.charges_enabled) {
    const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
    loginUrl = loginLink.url;
  }

  return {
    loginUrl,
    chargesEnabled: account.charges_enabled,
    stripeAccountId
  };
});

/**
 * Creates a Stripe PaymentIntent for a student booking a lesson.
 * Directs funds to the instructor's Connect account; platform keeps 10%.
 */
exports.createPaymentIntent = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { instructorId } = request.data;

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

  if (!price_per_lesson || price_per_lesson <= 0) {
    throw new HttpsError('failed-precondition', 'Instructor has not set a lesson price');
  }

  // Verify instructor can accept charges
  const account = await stripe.accounts.retrieve(stripeAccountId);
  if (!account.charges_enabled) {
    throw new HttpsError('failed-precondition', 'Instructor payment setup is incomplete');
  }

  const amount = Math.round(price_per_lesson * 100); // convert to cents
  const normalizedCurrency = (currency || 'USD').toLowerCase();
  const platformFee = Math.round(amount * PLATFORM_FEE_PERCENT);

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: normalizedCurrency,
    application_fee_amount: platformFee,
    transfer_data: {
      destination: stripeAccountId
    },
    automatic_payment_methods: { enabled: true }
  });

  return {
    clientSecret: paymentIntent.client_secret,
    amount,
    currency: normalizedCurrency,
    platformFee
  };
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
