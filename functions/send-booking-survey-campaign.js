/**
 * Marketing campaign: "Have you tried a free trial lesson yet?" survey email
 * to all eligible students, with the "Optional Survey" (5 questions) linking
 * to /booking-survey?student=<uid>.
 *
 * Usage (run from the functions/ directory):
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-booking-survey-campaign.js --dry-run
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-booking-survey-campaign.js --test
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-booking-survey-campaign.js --send --confirm
 *
 * Modes:
 *   --dry-run     Show recipient count and a sample list. No emails sent.
 *   --test        Send one preview email to the admin address (ADMIN_EMAIL below).
 *   --send        Send to all eligible students. REQUIRES --confirm for safety.
 *   --confirm     Must accompany --send. Prevents accidental live sends.
 */

const admin = require('firebase-admin');
const { Resend } = require('resend');

admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Config ──────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'ianjack1643@gmail.com';
const FROM        = 'Lingua Bud <notifications@linguabud.com>';
const DELAY_MS    = 300; // ms between sends — stays well within Resend rate limits

const UNSUBSCRIBE_BASE_URL =
  'https://us-central1-linguabud-9a942.cloudfunctions.net/unsubscribeMarketing';

// ── CLI flags ────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isTest   = args.includes('--test');
const isSend   = args.includes('--send') && args.includes('--confirm');

if (args.includes('--send') && !args.includes('--confirm')) {
  console.error('Error: --send requires --confirm as well (safety check).');
  process.exit(1);
}
if (!isDryRun && !isTest && !isSend) {
  console.error('Usage: node send-booking-survey-campaign.js [--dry-run | --test | --send --confirm]');
  process.exit(1);
}

// ── Firestore data fetching ──────────────────────────────────────────────────

async function fetchEligibleStudents() {
  const snap = await db.collection('users').where('role', '==', 'student').get();
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(s => {
      if (!s.email)                         return false; // no email address
      if (s.email.endsWith('@example.com')) return false; // test accounts
      if (s.marketingOptOut === true)       return false; // explicitly unsubscribed
      if (s.emailNotifications === false)   return false; // opted out of all emails
      if (s.flagged === true)               return false; // flagged/banned accounts
      return true;
    });
}

// ── Email content ────────────────────────────────────────────────────────────

function emailHeader() {
  return `
  <tr>
    <td style="padding: 40px 40px 20px 40px; text-align: center; background-color: #20bcba;">
      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">Lingua Bud</h1>
      <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Language Learning Platform</p>
    </td>
  </tr>`;
}

function emailFooter(unsubUrl, year) {
  return `
  <tr>
    <td style="padding: 30px 40px; background-color: #f8f9fa; border-top: 1px solid #e9ecef; text-align: center;">
      <p style="margin: 0 0 6px; color: #333333; font-size: 14px; font-weight: bold;">Lingua Bud</p>
      <p style="margin: 0 0 4px; color: #999999; font-size: 12px;">Connect with language partners worldwide.</p>
      <p style="margin: 0 0 10px; color: #999999; font-size: 12px;">© ${year} Lingua Bud &nbsp;|&nbsp; <a href="https://linguabud.com" style="color: #20bcba; text-decoration: none;">linguabud.com</a></p>
      <p style="margin: 0; font-size: 11px; color: #999999;">
        You're receiving this because you have a Lingua Bud student account.<br>
        <a href="${unsubUrl}" style="color: #999999; text-decoration: underline;">Unsubscribe from marketing emails</a>
      </p>
    </td>
  </tr>`;
}

function surveyQuestion(num, label, inputHtml) {
  return `
    <div style="margin: 0 0 20px 0;">
      <p style="margin: 0 0 8px 0; color: #113448; font-size: 14px; font-weight: bold;">${num}. ${label}</p>
      ${inputHtml}
    </div>`;
}

function buildHtmlEmail(student) {
  const firstName  = student.name ? student.name.split(' ')[0] : 'there';
  const surveyUrl  = `https://linguabud.com/booking-survey?student=${student.uid}`;
  const unsubUrl   = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
  const year       = new Date().getFullYear();

  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Quick question about your Lingua Bud experience</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td align="center" style="padding: 40px 0;">
            <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              ${emailHeader()}
              <tr>
                <td style="padding: 40px;">
                  <h2 style="margin: 0 0 10px 0; color: #333333; font-size: 24px;">Have you tried a free trial lesson yet?</h2>
                  <p style="margin: 0 0 24px 0; color: #666666; font-size: 16px; line-height: 1.6;">
                    Hey ${firstName}! We wanted to check in on your Lingua Bud experience so far. Did you know you can book lessons directly with language instructors on Lingua Bud &mdash; and that <strong>every instructor</strong> offers a <strong>free 15-minute trial lesson</strong>, so you can find the right fit before committing to paid lessons?
                  </p>

                  <p style="margin: 0 0 30px 0; text-align: center;">
                    <a href="https://linguabud.com/instructors"
                       style="display: inline-block; padding: 14px 36px; background-color: #20bcba; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 16px; font-weight: bold;">
                      Browse Instructors
                    </a>
                  </p>

                  <hr style="border: none; border-top: 1px solid #e9ecef; margin: 0 0 28px 0;">

                  <!-- Optional Survey -->
                  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 24px; margin: 0 0 24px 0; border-left: 4px solid #20bcba;">
                    <p style="margin: 0 0 4px 0; color: #113448; font-size: 17px; font-weight: bold;">Optional Survey</p>
                    <p style="margin: 0 0 20px 0; color: #666666; font-size: 14px; line-height: 1.5;">
                      Mind sharing a little feedback? It'll help us make Lingua Bud better &mdash; totally optional, takes under a minute.
                    </p>

                    ${surveyQuestion(1, 'Did you know you can book lessons with language instructors on Lingua Bud?',
                      `<div style="color: #333; font-size: 14px;">&#9675; Yes &nbsp;&nbsp; &#9675; No</div>`)}

                    ${surveyQuestion(2, 'Did you know that every instructor offers a free 15-minute trial lesson?',
                      `<div style="color: #333; font-size: 14px;">&#9675; Yes &nbsp;&nbsp; &#9675; No</div>`)}

                    ${surveyQuestion(3, "If you haven't booked yet, what's the main thing holding you back?",
                      `<div style="color: #333; font-size: 14px;">N/A &mdash; already booked &nbsp;/&nbsp; Haven't found the right instructor &nbsp;/&nbsp; Not sure how it works &nbsp;/&nbsp; Price &nbsp;/&nbsp; Haven't had time &nbsp;/&nbsp; Prefer self-study for now &nbsp;/&nbsp; Other</div>`)}

                    ${surveyQuestion(4, 'How satisfied are you with our platform?',
                      `<div style="color: #333; font-size: 14px;">&#9675; Very satisfied &nbsp; &#9675; Satisfied &nbsp; &#9675; Neutral &nbsp; &#9675; Unsatisfied &nbsp; &#9675; Very unsatisfied</div>`)}

                    ${surveyQuestion(5, 'What are your language goals?',
                      `<div style="border: 1px solid #ccc; border-radius: 4px; padding: 10px; background: #ffffff; color: #999; font-size: 14px;">Your answer&hellip;</div>`)}

                    <p style="margin: 20px 0 0 0; text-align: center;">
                      <a href="${surveyUrl}"
                         style="display: inline-block; padding: 12px 28px; background-color: #113448; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: bold;">
                        Take the Survey
                      </a>
                    </p>
                  </div>

                  <p style="margin: 0; color: #999999; font-size: 14px; line-height: 1.5;">
                    Questions? Contact us at <a href="mailto:support@linguabud.com" style="color: #20bcba; text-decoration: none;">support@linguabud.com</a>
                  </p>
                </td>
              </tr>
              ${emailFooter(unsubUrl, year)}
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;
}

function buildPlainText(student) {
  const firstName = student.name ? student.name.split(' ')[0] : 'there';
  const surveyUrl = `https://linguabud.com/booking-survey?student=${student.uid}`;
  const unsubUrl  = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
  const year      = new Date().getFullYear();

  return `Hey ${firstName}! We wanted to check in on your Lingua Bud experience so far. Did you know you can book lessons directly with language instructors on Lingua Bud, and that every instructor offers a free 15-minute trial lesson, so you can find the right fit before committing to paid lessons?

Browse instructors: https://linguabud.com/instructors

--- Optional Survey ---
1. Did you know you can book lessons with language instructors on Lingua Bud?
2. Did you know that every instructor offers a free 15-minute trial lesson?
3. If you haven't booked yet, what's the main thing holding you back?
4. How satisfied are you with our platform?
5. What are your language goals?

Take the survey: ${surveyUrl}

Questions? Email support@linguabud.com

You're receiving this because you have a Lingua Bud student account.
Unsubscribe from marketing emails: ${unsubUrl}
© ${year} Lingua Bud`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log('\nFetching students from Firestore...');
  const students = await fetchEligibleStudents();
  console.log(`  ✓ ${students.length} eligible students (student role, not opted out)`);

  if (isDryRun) {
    console.log('\n══════════════════════════════════════════════');
    console.log('  DRY RUN — no emails will be sent');
    console.log('══════════════════════════════════════════════\n');
    console.log(`Total recipients: ${students.length}\n`);
    console.log('Sample recipients (first 10):');
    students.slice(0, 10).forEach((s, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${s.email} — ${s.name || '(no name)'}`);
    });
    console.log('\nRun with --test to send a preview to your inbox.');
    console.log('Run with --send --confirm to send to all students.\n');
    process.exit(0);
  }

  if (isTest) {
    console.log(`\nSending test preview to ${ADMIN_EMAIL}...\n`);
    const mockStudent = { uid: 'test-preview-uid', name: 'Ian', email: ADMIN_EMAIL };
    const result = await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `[TEST PREVIEW] Have you tried a free trial lesson yet, Ian?`,
      html: buildHtmlEmail(mockStudent),
      text: buildPlainText(mockStudent),
    });
    if (result.error) {
      console.error('Resend error:', result.error);
      process.exit(1);
    }
    console.log(`✓ Test email sent to ${ADMIN_EMAIL}`);
    console.log(`  Email ID: ${result.data?.id}`);
    console.log('\nRun with --send --confirm to send to all students.\n');
    process.exit(0);
  }

  if (isSend) {
    console.log('\n══════════════════════════════════════════════');
    console.log(`  LIVE SEND — ${students.length} students`);
    console.log('══════════════════════════════════════════════\n');

    let sent = 0, failed = 0;

    for (const student of students) {
      const unsubUrl = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
      try {
        const result = await resend.emails.send({
          from: FROM,
          to: student.email,
          subject: 'Have you tried a free trial lesson yet?',
          html: buildHtmlEmail(student),
          text: buildPlainText(student),
          headers: {
            'List-Unsubscribe':
              `<${unsubUrl}>, <mailto:notifications@linguabud.com?subject=Unsubscribe&body=uid=${student.uid}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        if (result.error) {
          console.error(`  ✗ ${student.email} — ${result.error.message}`);
          failed++;
        } else {
          console.log(`  ✓ ${student.email}`);
          sent++;
        }
      } catch (err) {
        console.error(`  ✗ ${student.email} — ${err.message}`);
        failed++;
      }
      await sleep(DELAY_MS);
    }

    console.log('\n══════════════════════════════════════════════');
    console.log(`  Done.  Sent: ${sent}   Failed: ${failed}   Total: ${students.length}`);
    console.log('══════════════════════════════════════════════\n');
    process.exit(0);
  }
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
