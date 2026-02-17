const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { Resend } = require('resend');

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
 * Generates an Agora RTC token for video calling
 * Called from the client when a user wants to join a video call
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

exports.generateAgoraToken = onCall(async (request) => {
  try {
    // Get channel name and UID from request
    const { channelName, uid } = request.data;

    if (!channelName) {
      throw new HttpsError('invalid-argument', 'Channel name is required');
    }

    // Agora credentials
    const appId = 'dfd628e44de640e3b7717f422d1dc3e7';
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appCertificate) {
      throw new HttpsError(
        'failed-precondition',
        'Agora App Certificate not configured. Please set AGORA_APP_CERTIFICATE in Firebase environment config.'
      );
    }

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
