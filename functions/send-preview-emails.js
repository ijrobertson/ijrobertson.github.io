/**
 * One-time script to send preview copies of both instructor approval email
 * templates to the platform owner's Gmail address.
 * Run once: node send-preview-emails.js
 */
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FOUNDING_INSTRUCTOR_LIMIT = 50;
const FOUNDING_INSTRUCTOR_RATE = 0.10;
const DEFAULT_COMMISSION_RATE = 0.15;
const ADMIN_EMAIL = 'ianjack1643@gmail.com';

function buildApprovalEmail({ name, commissionRate, isFoundingInstructor, personalMessage }) {
  const keepPercent = Math.round((1 - commissionRate) * 100);

  const foundingBadge = isFoundingInstructor
    ? `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:4px;padding:12px 16px;margin:16px 0;">
         <strong style="color:#f59e0b;">&#9733; Founding Instructor</strong>
         <p style="margin:6px 0 0;">You are one of our first ${FOUNDING_INSTRUCTOR_LIMIT} approved instructors and have been granted a <strong>lifetime ${FOUNDING_INSTRUCTOR_RATE * 100}% commission rate</strong>. You keep ${keepPercent}% of every lesson — forever.</p>
       </div>`
    : `<p>You keep <strong>${keepPercent}% of every lesson</strong> you complete on Lingua Bud.</p>`;

  const personalNoteHtml = personalMessage
    ? `<div style="background:#f0fffe;border-left:4px solid #20bcba;border-radius:4px;padding:14px 18px;margin:20px 0;">
         <p style="margin:0;font-size:15px;color:#333;line-height:1.6;">${personalMessage}</p>
       </div>`
    : '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f7f6;">
      <div style="background:#20bcba;padding:32px;text-align:center;border-radius:8px 8px 0 0;">
        <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:48px;margin-bottom:12px;" />
        <h1 style="margin:0;color:white;font-size:24px;font-weight:700;">You're approved — welcome aboard!</h1>
      </div>
      <div style="background:white;padding:36px 40px;border-left:1px solid #e0e0e0;border-right:1px solid #e0e0e0;">
        <p style="font-size:16px;color:#333;margin-top:0;">Hi ${name},</p>
        <p style="font-size:15px;color:#444;line-height:1.6;">
          We're thrilled to welcome you to the Lingua Bud instructor community! Your application has been reviewed and <strong style="color:#20bcba;">approved</strong>. Your profile is now live and students can start booking lessons with you.
        </p>
        ${personalNoteHtml}
        ${foundingBadge}
        <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />
        <h2 style="font-size:17px;color:#113448;margin-bottom:16px;">Getting started — 3 simple steps</h2>
        <div style="display:flex;align-items:flex-start;margin-bottom:20px;">
          <div style="background:#20bcba;color:white;font-weight:bold;font-size:14px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:14px;line-height:28px;text-align:center;">1</div>
          <div>
            <strong style="color:#113448;">Complete your instructor profile</strong>
            <p style="margin:4px 0 0;color:#555;font-size:14px;line-height:1.5;">
              Head to your <a href="https://linguabud.com/dashboard" style="color:#20bcba;">Dashboard</a> and make sure your bio, languages, availability, and profile photo are up to date.
            </p>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;margin-bottom:20px;">
          <div style="background:#20bcba;color:white;font-weight:bold;font-size:14px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:14px;line-height:28px;text-align:center;">2</div>
          <div>
            <strong style="color:#113448;">Connect a payment method to receive payouts</strong>
            <p style="margin:4px 0 0;color:#555;font-size:14px;line-height:1.5;">Lingua Bud supports two payout options:</p>
            <ul style="margin:8px 0 0;padding-left:18px;color:#555;font-size:14px;line-height:1.7;">
              <li><strong>Stripe Connect</strong> — Connect your Stripe account directly from your Dashboard.</li>
              <li style="margin-top:6px;"><strong>Wise</strong> — Enter your Wise email address in your Dashboard settings for weekly payouts.</li>
            </ul>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;margin-bottom:8px;">
          <div style="background:#20bcba;color:white;font-weight:bold;font-size:14px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:14px;line-height:28px;text-align:center;">3</div>
          <div>
            <strong style="color:#113448;">Check your Bookings tab for upcoming lessons</strong>
            <p style="margin:4px 0 0;color:#555;font-size:14px;line-height:1.5;">
              All upcoming and past lessons will appear in the <strong>Bookings</strong> tab on your Dashboard.
            </p>
          </div>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:28px 0;" />
        <div style="text-align:center;margin-bottom:8px;">
          <a href="https://linguabud.com/dashboard" style="display:inline-block;background:#20bcba;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 8px;">Go to My Dashboard</a>
          <a href="https://linguabud.com/bookings" style="display:inline-block;background:#113448;color:white;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 8px;">View My Bookings</a>
        </div>
      </div>
      <div style="background:#f4f7f6;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:24px 40px;text-align:center;">
        <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:32px;margin-bottom:10px;" />
        <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
          The Lingua Bud Team<br />
          <a href="https://linguabud.com" style="color:#20bcba;text-decoration:none;">linguabud.com</a> &nbsp;|&nbsp;
          <a href="mailto:support@linguabud.com" style="color:#20bcba;text-decoration:none;">support@linguabud.com</a>
        </p>
      </div>
    </div>
  `;
}

async function main() {
  // 1. Preview of the founding instructor email (what the first 50 received)
  console.log('Sending founding instructor email preview...');
  await resend.emails.send({
    from: 'Lingua Bud <notifications@linguabud.com>',
    to: ADMIN_EMAIL,
    subject: '[PREVIEW] Founding Instructor Email — what your first 50 instructors received',
    html: buildApprovalEmail({
      name: 'Instructor Name',
      commissionRate: FOUNDING_INSTRUCTOR_RATE,
      isFoundingInstructor: true,
      personalMessage: 'Welcome aboard! We\'re so excited to have you as one of our founding instructors.'
    })
  });
  console.log('✓ Founding instructor preview sent to', ADMIN_EMAIL);

  // 2. Preview of the new instructor email (what all future instructors will receive, showing 85%)
  console.log('Sending new instructor email preview...');
  await resend.emails.send({
    from: 'Lingua Bud <notifications@linguabud.com>',
    to: ADMIN_EMAIL,
    subject: '[PREVIEW] New Instructor Email — what instructors approved going forward will receive',
    html: buildApprovalEmail({
      name: 'Instructor Name',
      commissionRate: DEFAULT_COMMISSION_RATE,
      isFoundingInstructor: false,
      personalMessage: ''
    })
  });
  console.log('✓ New instructor (85%) preview sent to', ADMIN_EMAIL);

  console.log('\nDone. Check your inbox at', ADMIN_EMAIL);
}

main().catch(err => { console.error(err); process.exit(1); });
