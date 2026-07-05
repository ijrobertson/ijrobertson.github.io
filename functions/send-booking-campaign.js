/**
 * Marketing campaign: "Book Your Free Trial" email to all eligible students.
 *
 * Usage (run from the functions/ directory):
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-booking-campaign.js --dry-run
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-booking-campaign.js --test
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-booking-campaign.js --send --confirm
 *
 * Modes:
 *   --dry-run     Show recipient count, sample list, featured instructors. No emails sent.
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

const ADMIN_EMAIL        = 'ianjack1643@gmail.com';
const FROM               = 'Lingua Bud <notifications@linguabud.com>';
const SUBJECT            = 'Book a free trial lesson with a real instructor';
const DELAY_MS           = 300;   // ms between sends — stays well within Resend rate limits
const MAX_FEATURED       = 6;     // max instructor cards shown in each email
const FEATURED_POOL_SIZE = 12;    // candidates fetched before per-student personalisation sort

// Instructor emails to exclude from the featured cards (e.g. test/admin accounts)
const EXCLUDED_INSTRUCTOR_EMAILS = new Set(['ianjack1643@gmail.com']);

// After deploying the unsubscribeMarketing Cloud Function, replace this with its live URL.
// Run: firebase deploy --only functions:unsubscribeMarketing
// Then find the URL in the Firebase console or CLI output.
const UNSUBSCRIBE_BASE_URL =
  'https://us-central1-linguabud-9a942.cloudfunctions.net/unsubscribeMarketing';

// ── CLI flags ────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isTest   = args.includes('--test');
const isSend   = args.includes('--send') && args.includes('--confirm');

if (!isDryRun && !isTest && !isSend) {
  console.log(`
Lingua Bud — Booking Campaign Sender
=====================================
Usage (from the functions/ directory):

  --dry-run
      Preview recipient count, sample list, and featured instructors.
      No emails are sent.

  --test
      Send one preview email to ${ADMIN_EMAIL}.
      Shows you exactly what students will receive.

  --send --confirm
      Send to ALL eligible students (LIVE). Requires both flags.

Environment variables required:
  RESEND_API_KEY                  Resend secret key
  GOOGLE_APPLICATION_CREDENTIALS  Path to Firebase service account JSON

Example:
  RESEND_API_KEY=re_xxx GOOGLE_APPLICATION_CREDENTIALS=~/key.json \\
    node send-booking-campaign.js --dry-run
`);
  process.exit(0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function truncate(str, maxLen) {
  if (!str) return '';
  str = str.replace(/\s+/g, ' ').trim();
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

function formatLangs(arr) {
  if (!arr || arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr.join(' & ');
  return arr.slice(0, 2).join(', ') + ` +${arr.length - 2}`;
}

function formatLangsFull(arr) {
  if (!arr || arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr.join(' and ');
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}

function formatPrice(price, currency) {
  if (!price || typeof price !== 'number') return null;
  const sym = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', AUD: 'A$' }[currency] || '$';
  return `${sym}${price}/hr`;
}

function renderRatingHtml(rating, reviewCount) {
  if (!rating) return '';
  const stars = Math.round(Math.min(Math.max(rating, 0), 5));
  const filled = '★'.repeat(stars);
  const empty  = '☆'.repeat(5 - stars);
  const label  = reviewCount ? ` &middot; ${reviewCount} review${reviewCount === 1 ? '' : 's'}` : '';
  return `<span style="color:#f59e0b;">${filled}${empty}</span>&nbsp;${rating.toFixed(1)}${label}`;
}

function renderRatingText(rating, reviewCount) {
  if (!rating) return '';
  const stars = Math.round(Math.min(Math.max(rating, 0), 5));
  return `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} ${rating.toFixed(1)}` +
    (reviewCount ? ` (${reviewCount} reviews)` : '');
}

// ── Firestore data fetching ──────────────────────────────────────────────────

async function fetchFeaturedInstructors() {
  const snap = await db.collection('instructors').where('status', '==', 'approved').get();
  const all  = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(i => i.name && !EXCLUDED_INSTRUCTOR_EMAILS.has(i.email));

  // Sort priority: 1) has avatar photo  2) higher rating  3) more reviews
  all.sort((a, b) => {
    const aPhoto = !!(a.avatar_url), bPhoto = !!(b.avatar_url);
    if (aPhoto !== bPhoto) return bPhoto ? 1 : -1;
    const ar = a.averageRating || 0, br = b.averageRating || 0;
    if (br !== ar) return br - ar;
    return (b.reviewCount || 0) - (a.reviewCount || 0);
  });

  return all.slice(0, FEATURED_POOL_SIZE);
}

async function fetchEligibleStudents() {
  const snap = await db.collection('users').where('role', '==', 'student').get();
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(s => {
      if (!s.email)                         return false; // no email address
      if (s.email.endsWith('@example.com')) return false; // test accounts
      if (s.marketingOptOut === true)        return false; // explicitly unsubscribed
      if (s.emailNotifications === false)    return false; // opted out of all emails
      if (s.flagged === true)                return false; // flagged/banned accounts
      return true;
    });
}

// ── Personalisation ──────────────────────────────────────────────────────────

function personalizeInstructors(pool, learningLangs) {
  if (!learningLangs || learningLangs.length === 0) {
    return pool.slice(0, MAX_FEATURED);
  }
  const lower = learningLangs.map(l => l.toLowerCase());
  const matched = [], unmatched = [];
  for (const instr of pool) {
    const teaching = (instr.languages_teaching || []).map(l => l.toLowerCase());
    const isMatch  = teaching.some(t => lower.some(l => t.includes(l) || l.includes(t)));
    (isMatch ? matched : unmatched).push(instr);
  }
  return [...matched, ...unmatched].slice(0, MAX_FEATURED);
}

// ── Email HTML builder ───────────────────────────────────────────────────────

function buildInstructorCardHtml(instr) {
  const profileUrl = `https://linguabud.com/instructor-profile?id=${instr.id}`;
  const avatar     = instr.avatar_url || 'https://linguabud.com/images/NewLogo8.png';
  const langs      = formatLangs(instr.languages_teaching);
  const price      = formatPrice(instr.price, instr.currency);
  const ratingHtml = renderRatingHtml(instr.averageRating, instr.reviewCount);
  const bio        = truncate(instr.about_me, 130);

  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
  style="border:1px solid #dde5ed;border-radius:10px;overflow:hidden;background:#ffffff;">
  <tr>
    <td style="padding:20px 18px;text-align:center;">
      <img src="${avatar}" alt="${instr.name}" width="72" height="72"
           style="width:72px;height:72px;border-radius:50%;display:block;margin:0 auto 10px;border:3px solid #e0fffe;object-fit:cover;" />
      <p style="margin:0 0 3px;font-size:15px;font-weight:700;color:#113448;">${instr.name}</p>
      ${langs ? `<p style="margin:0 0 2px;font-size:13px;color:#20bcba;font-weight:600;">${langs}</p>` : ''}
      ${instr.country ? `<p style="margin:0 0 6px;font-size:12px;color:#888;">${instr.country}</p>` : ''}
      ${ratingHtml ? `<p style="margin:0 0 6px;font-size:13px;color:#444;">${ratingHtml}</p>` : ''}
      ${price ? `<p style="margin:0 0 10px;font-size:12px;color:#666;">from&nbsp;${price}</p>` : '<p style="margin:0 0 10px;"></p>'}
      ${bio ? `<p style="margin:0 0 14px;font-size:12px;color:#555;line-height:1.55;text-align:left;">${bio}</p>` : ''}
      <a href="${profileUrl}"
         style="display:inline-block;background:#20bcba;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">
        Book Free Trial &rarr;
      </a>
    </td>
  </tr>
</table>`;
}

function buildInstructorGridHtml(instructors) {
  if (instructors.length === 0) return '';
  const rows = [];
  for (let i = 0; i < instructors.length; i += 2) {
    const left  = buildInstructorCardHtml(instructors[i]);
    const right = instructors[i + 1]
      ? buildInstructorCardHtml(instructors[i + 1])
      : '<table role="presentation" width="100%"><tr><td></td></tr></table>';
    rows.push(`
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
  <tr>
    <td class="instr-col" width="48%" valign="top" style="padding-right:8px;">${left}</td>
    <td width="4%" style="font-size:0;line-height:0;">&nbsp;</td>
    <td class="instr-col" width="48%" valign="top">${right}</td>
  </tr>
</table>`);
  }
  return rows.join('\n');
}

function buildHtmlEmail(student, featured) {
  const firstName    = student.name ? student.name.split(' ')[0] : 'there';
  const uid          = student.uid;
  const year         = new Date().getFullYear();
  const unsubUrl     = `${UNSUBSCRIBE_BASE_URL}?uid=${uid}`;
  const learningLangs = student.languages_learning || [];
  const hasLearning  = learningLangs.length > 0;

  const learningNote = hasLearning
    ? `<p style="margin:0 0 16px;font-size:13px;color:#20bcba;font-style:italic;text-align:center;">
         &#10022; We&rsquo;ve highlighted instructors who teach ${formatLangsFull(learningLangs)} for you
       </p>`
    : '';

  const instructorSection = featured.length > 0 ? `
          <hr style="border:none;border-top:1px solid #eee;margin:0 0 28px;" />
          <h2 style="font-size:17px;color:#113448;margin:0 0 6px;">Meet some of our instructors</h2>
          ${learningNote}
          ${buildInstructorGridHtml(featured)}
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${SUBJECT}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .instr-col { display: block !important; width: 100% !important; padding-right: 0 !important; margin-bottom: 12px; }
    }
  </style>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f7f6;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7f6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"
           style="max-width:100%;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">

      <!-- Header -->
      <tr>
        <td style="background:#20bcba;padding:36px 40px;text-align:center;">
          <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud"
               style="height:52px;display:block;margin:0 auto 16px;" />
          <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;line-height:1.3;">
            Ready to Start Speaking?
          </h1>
          <p style="margin:10px 0 0;color:#e0fffe;font-size:15px;">
            Your language journey starts here &mdash; and your first lesson is free.
          </p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="background:#ffffff;padding:40px;">

          <p style="font-size:16px;color:#333;margin:0 0 8px;">Hi ${firstName},</p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 28px;">
            We&rsquo;re glad you&rsquo;re part of the Lingua Bud community. Since you joined,
            the platform has continued to grow &mdash; more instructors, better tools, and a richer
            experience for learners at every level. Whether you&rsquo;re just getting started or
            ready to take your skills further, there&rsquo;s never been a better time to book a lesson.
          </p>

          <!-- Platform updates -->
          <h2 style="font-size:17px;color:#113448;margin:0 0 16px;">&#10024; What&rsquo;s new on Lingua Bud</h2>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;">
            <tr><td style="padding:14px 18px;background:#f0fffe;border-left:4px solid #20bcba;border-radius:0 8px 8px 0;">
              <strong style="color:#113448;font-size:14px;">&#127891; More certified instructors than ever</strong>
              <p style="margin:5px 0 0;color:#555;font-size:13px;line-height:1.6;">
                Our instructor community keeps growing. Find passionate teachers for dozens of languages &mdash;
                from Spanish and French to Japanese, Arabic, and beyond.
              </p>
            </td></tr>
          </table>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;">
            <tr><td style="padding:14px 18px;background:#f0fffe;border-left:4px solid #20bcba;border-radius:0 8px 8px 0;">
              <strong style="color:#113448;font-size:14px;">&#128190; Screen sharing during lessons</strong>
              <p style="margin:5px 0 0;color:#555;font-size:13px;line-height:1.6;">
                Work through documents, grammar exercises, or websites in real time.
                You and your instructor can share screens right inside the video call.
              </p>
            </td></tr>
          </table>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;">
            <tr><td style="padding:14px 18px;background:#f0fffe;border-left:4px solid #20bcba;border-radius:0 8px 8px 0;">
              <strong style="color:#113448;font-size:14px;">&#128203; Homework assignments</strong>
              <p style="margin:5px 0 0;color:#555;font-size:13px;line-height:1.6;">
                Keep making progress between sessions. Instructors can assign exercises,
                vocabulary lists, or reading directly through the platform.
              </p>
            </td></tr>
          </table>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
            <tr><td style="padding:14px 18px;background:#f0fffe;border-left:4px solid #20bcba;border-radius:0 8px 8px 0;">
              <strong style="color:#113448;font-size:14px;">&#128172; Connect with language partners for free</strong>
              <p style="margin:5px 0 0;color:#555;font-size:13px;line-height:1.6;">
                Head to the <a href="https://linguabud.com/connect" style="color:#20bcba;text-decoration:none;font-weight:600;">Connect</a>
                page to find language exchange partners from around the world &mdash; completely free.
              </p>
            </td></tr>
          </table>

          <!-- Free trial CTA banner -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
            <tr>
              <td style="background:#113448;border-radius:10px;padding:28px 32px;text-align:center;">
                <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">
                  &#127881; Your First Lesson is Free
                </p>
                <p style="margin:0 0 20px;font-size:14px;color:#b8d9e8;line-height:1.7;">
                  Every instructor on Lingua Bud offers a
                  <strong style="color:#ffffff;">free 15-minute trial lesson</strong>.<br />
                  No commitment. No payment required.<br />
                  Just show up, have a conversation, and see if it&rsquo;s the right fit.
                </p>
                <a href="https://linguabud.com/instructors"
                   style="display:inline-block;background:#20bcba;color:#ffffff;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;">
                  Book Your Free Trial &rarr;
                </a>
              </td>
            </tr>
          </table>

          ${instructorSection}

          <hr style="border:none;border-top:1px solid #eee;margin:0 0 28px;" />

          <!-- Why it works -->
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 24px;">
            Speaking with a real person is one of the fastest ways to improve. A good instructor
            doesn&rsquo;t just explain grammar &mdash; they help you think in the language, build
            real confidence, and stay motivated. The free trial is your chance to experience that firsthand,
            with no risk.
          </p>

          <!-- Final CTA -->
          <div style="text-align:center;margin-bottom:4px;">
            <a href="https://linguabud.com/instructors"
               style="display:inline-block;background:#113448;color:#ffffff;padding:15px 40px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">
              Browse All Instructors &rarr;
            </a>
          </div>

        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#113448;padding:28px 40px;text-align:center;">
          <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud"
               style="height:32px;display:block;margin:0 auto 12px;" />
          <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.8;">
            The Lingua Bud Team<br />
            <a href="https://linguabud.com" style="color:#20bcba;text-decoration:none;">linguabud.com</a>
            &nbsp;|&nbsp;
            <a href="mailto:support@linguabud.com" style="color:#20bcba;text-decoration:none;">support@linguabud.com</a>
          </p>
          <p style="margin:14px 0 4px;font-size:12px;color:#8aaabb;line-height:1.5;">
            You&rsquo;re receiving this because you have a Lingua Bud student account.<br />
            <a href="${unsubUrl}" style="color:#8aaabb;text-decoration:underline;">
              Unsubscribe from marketing emails
            </a>
          </p>
          <p style="margin:6px 0 0;font-size:11px;color:#5a7888;">&copy; ${year} Lingua Bud</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Plain-text version ───────────────────────────────────────────────────────

function buildPlainText(student, featured) {
  const firstName    = student.name ? student.name.split(' ')[0] : 'there';
  const year         = new Date().getFullYear();
  const unsubUrl     = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
  const learningLangs = student.languages_learning || [];

  const learningNote = learningLangs.length > 0
    ? `We've highlighted instructors who teach ${formatLangsFull(learningLangs)} for you.\n\n`
    : '';

  let instrBlock = '';
  if (featured.length > 0) {
    instrBlock = `FEATURED INSTRUCTORS\n${'─'.repeat(44)}\n\n${learningNote}`;
    for (const i of featured) {
      const langs  = formatLangs(i.languages_teaching);
      const rating = renderRatingText(i.averageRating, i.reviewCount);
      const price  = formatPrice(i.price, i.currency);
      const bio    = truncate(i.about_me, 150);
      const url    = `https://linguabud.com/instructor-profile?id=${i.id}`;
      instrBlock += `${i.name}${langs ? ' — ' + langs : ''}${i.country ? ' | ' + i.country : ''}\n`;
      if (rating) instrBlock += `${rating}\n`;
      if (price)  instrBlock += `From ${price}\n`;
      if (bio)    instrBlock += `${bio}\n`;
      instrBlock += `Book free trial: ${url}\n\n`;
    }
    instrBlock += `${'─'.repeat(44)}\n\n`;
  }

  return `Hi ${firstName},

We're glad you're part of the Lingua Bud community! Since you joined, the platform has continued to grow with more instructors, better tools, and an improved learning experience.

WHAT'S NEW
──────────────────────────────────────────────
• More certified instructors than ever before
• Screen sharing during live video lessons
• Homework assignments from your instructor
• Connect with free language exchange partners

YOUR FIRST LESSON IS FREE
──────────────────────────────────────────────
Every instructor on Lingua Bud offers a FREE 15-minute trial lesson.
No commitment. No payment required.
Just show up, have a conversation, and see if it's a good fit.

Book your free trial: https://linguabud.com/instructors

${instrBlock}Speaking with a real person is one of the fastest ways to improve. A good instructor helps you think in the language, build real confidence, and stay motivated.

Browse all instructors: https://linguabud.com/instructors

──────────────────────────────────────────────
The Lingua Bud Team
linguabud.com | support@linguabud.com

You're receiving this because you have a Lingua Bud student account.
Unsubscribe from marketing emails: ${unsubUrl}
© ${year} Lingua Bud`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log('\nFetching data from Firestore...');
  const [instructorPool, students] = await Promise.all([
    fetchFeaturedInstructors(),
    fetchEligibleStudents(),
  ]);
  console.log(`  ✓ ${instructorPool.length} featured instructor candidates (approved)`);
  console.log(`  ✓ ${students.length} eligible students (student role, not opted out)`);

  // ── Dry run ────────────────────────────────────────────────────────────────
  if (isDryRun) {
    console.log('\n══════════════════════════════════════════════');
    console.log('  DRY RUN — no emails will be sent');
    console.log('══════════════════════════════════════════════\n');

    console.log(`Total recipients: ${students.length}\n`);

    console.log('Sample recipients (first 10):');
    students.slice(0, 10).forEach((s, i) => {
      const langs = s.languages_learning?.join(', ') || 'none set';
      console.log(`  ${String(i + 1).padStart(2)}. ${s.email} — ${s.name || '(no name)'} | learning: ${langs}`);
    });

    console.log('\nFeatured instructor pool (first 6):');
    instructorPool.slice(0, MAX_FEATURED).forEach((instr, i) => {
      const rating = instr.averageRating ? `${instr.averageRating.toFixed(1)}★ (${instr.reviewCount}r)` : 'no rating yet';
      const langs  = formatLangs(instr.languages_teaching) || '—';
      const photo  = instr.avatar_url ? 'yes' : 'NO PHOTO';
      console.log(`  ${String(i + 1).padStart(2)}. ${instr.name} — ${langs} | ${rating} | photo: ${photo}`);
    });

    console.log('\nRun with --test to send a preview to your inbox.');
    console.log('Run with --send --confirm to send to all students.\n');
    process.exit(0);
  }

  // ── Test send ──────────────────────────────────────────────────────────────
  if (isTest) {
    console.log(`\nSending test preview to ${ADMIN_EMAIL}...\n`);

    const mockStudent = {
      uid:               'test-preview-uid',
      name:              'Ian',
      email:             ADMIN_EMAIL,
      languages_learning: ['Spanish', 'French'],
    };
    const featured = personalizeInstructors(instructorPool, mockStudent.languages_learning);
    const html     = buildHtmlEmail(mockStudent, featured);
    const text     = buildPlainText(mockStudent, featured);

    const result = await resend.emails.send({
      from:    FROM,
      to:      ADMIN_EMAIL,
      subject: `[TEST PREVIEW] ${SUBJECT}`,
      html,
      text,
    });

    if (result.error) {
      console.error('Resend error:', result.error);
      process.exit(1);
    }

    console.log(`✓ Test email sent to ${ADMIN_EMAIL}`);
    console.log(`  Email ID: ${result.data?.id}`);
    console.log('\nCheck your inbox. Once you\'re happy with the email,');
    console.log('run with --send --confirm to send to all students.\n');
    process.exit(0);
  }

  // ── Live send ──────────────────────────────────────────────────────────────
  if (isSend) {
    console.log('\n══════════════════════════════════════════════');
    console.log(`  LIVE SEND — ${students.length} students`);
    console.log('══════════════════════════════════════════════\n');

    let sent = 0, failed = 0;

    for (const student of students) {
      const firstName = student.name ? student.name.split(' ')[0] : 'there';
      const featured  = personalizeInstructors(instructorPool, student.languages_learning);
      const html      = buildHtmlEmail(student, featured);
      const text      = buildPlainText(student, featured);
      const unsubUrl  = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;

      try {
        const result = await resend.emails.send({
          from:    FROM,
          to:      student.email,
          subject: SUBJECT,
          html,
          text,
          headers: {
            // List-Unsubscribe headers are required by Gmail and Yahoo for bulk senders
            'List-Unsubscribe':
              `<${unsubUrl}>, <mailto:notifications@linguabud.com?subject=Unsubscribe&body=uid=${student.uid}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });

        if (result.error) {
          console.error(`  ✗ ${student.email} — ${result.error.message}`);
          failed++;
        } else {
          console.log(`  ✓ ${student.email} (${firstName})`);
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
