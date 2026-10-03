/**
 * Marketing campaign: student review spotlight (Graham M.) + free trial nudge.
 *
 * Usage (run from the functions/ directory):
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-review-spotlight-campaign.js --dry-run
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-review-spotlight-campaign.js --render <dir>
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-review-spotlight-campaign.js --test
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-review-spotlight-campaign.js --send --confirm
 *
 * Modes:
 *   --dry-run     Show recipient count, sample list, featured instructors. No emails sent.
 *   --render dir  Write preview HTML files to <dir>. No emails sent.
 *   --test        Send one preview email to the admin address (ADMIN_EMAIL below).
 *   --send        Send to all eligible students. REQUIRES --confirm for safety.
 */

const admin = require('firebase-admin');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── Config ──────────────────────────────────────────────────────────────────

const ADMIN_EMAIL  = 'ianjack1643@gmail.com';
const FROM         = 'Lingua Bud <notifications@linguabud.com>';
const REPLY_TO     = 'support@linguabud.com';
const SUBJECT      = '“Easy to set up and join” — what Graham said about his lesson';
const PREHEADER    = 'Every instructor offers a free 15-minute trial, so you can see if it’s a fit before you commit.';
const DELAY_MS     = 300;
const MAX_FEATURED = 4;

const UNSUBSCRIBE_BASE_URL =
  'https://us-central1-linguabud-9a942.cloudfunctions.net/unsubscribeMarketing';

// The featured review (same wording as the homepage reviews strip)
const REVIEW = {
  studentUid:   '8LLSdHoUs0cEuQCgzx5cZA0tmVu1',
  name:         'Graham M.',
  context:      'Spanish lesson with Veronica',
  instructorId: 'BnPoHjDVasZlWhhft8Ohr0eYJy22',
  quoteHtml:    'It was easy to find a Spanish instructor at an affordable rate that my schedule lined up with&hellip; My lesson with her was easy to set up and join and she was kind and patient!',
  quoteText:    'It was easy to find a Spanish instructor at an affordable rate that my schedule lined up with... My lesson with her was easy to set up and join and she was kind and patient!',
};

// Ian's own instructor profile (doxDE7put...) is left out of the cards
const EXCLUDED_INSTRUCTOR_EMAILS = new Set(['ianjack1643@gmail.com', 'linguabuddev@gmail.com']);
const EXCLUDED_INSTRUCTOR_IDS    = new Set(['doxDE7putWSNb8FsQMJgctyVrHD3']);
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', BRL: 'R$', MXN: 'MX$', COP: 'COL$' };

// ── CLI flags ────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const isDryRun  = args.includes('--dry-run');
const renderIdx = args.indexOf('--render');
const renderDir = renderIdx !== -1 ? args[renderIdx + 1] : null;
const isTest    = args.includes('--test');
const isSend    = args.includes('--send') && args.includes('--confirm');

if (!isDryRun && !renderDir && !isTest && !isSend) {
  console.log('Usage: --dry-run | --render <dir> | --test | --send --confirm');
  process.exit(0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(str, maxLen) {
  if (!str) return '';
  str = str.replace(/\s+/g, ' ').trim();
  return str.length > maxLen ? str.slice(0, maxLen - 1).trimEnd() + '…' : str;
}

function firstNameOf(student) {
  const first = (student.name || '').trim().split(/\s+/)[0];
  if (!first) return 'there';
  // Some students signed up with ALL CAPS names
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function formatLangs(arr) {
  if (!arr || arr.length === 0) return '';
  if (arr.length <= 2) return arr.join(' & ');
  return arr.slice(0, 2).join(', ') + ` +${arr.length - 2}`;
}

function formatPrice(instr) {
  const price = instr.price_per_lesson;
  if (!price) return null;
  const code = (instr.currency || 'USD').trim();
  const sym  = CURRENCY_SYMBOLS[code];
  return sym ? `${sym}${price}/hr` : `${code} ${price}/hr`;
}

function isPaymentReady(instr) {
  return (instr.chargesEnabled === true && instr.payoutsEnabled === true) ||
         (instr.payoutMethod === 'wise' && !!instr.wiseEmail);
}

// "MIRIAM" -> "Miriam"; leaves normally-cased names alone
function displayName(name) {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function trialUrl(instrId) {
  return `https://linguabud.com/instructor-profile?id=${encodeURIComponent(instrId)}&book=trial`;
}

// ── Firestore data fetching ──────────────────────────────────────────────────

async function fetchReviewerAvatar() {
  const doc = await db.collection('users').doc(REVIEW.studentUid).get();
  return doc.exists ? doc.data().avatar_url || null : null;
}

async function fetchBookableInstructors() {
  const snap = await db.collection('instructors').where('status', '==', 'approved').get();
  const all  = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(i => i.name && i.avatar_url && isPaymentReady(i) &&
                 !EXCLUDED_INSTRUCTOR_EMAILS.has(i.email) && !EXCLUDED_INSTRUCTOR_IDS.has(i.id));

  all.sort((a, b) => {
    const ar = a.averageRating || 0, br = b.averageRating || 0;
    if (br !== ar) return br - ar;
    return (b.reviewCount || 0) - (a.reviewCount || 0);
  });
  return all;
}

async function fetchEligibleStudents() {
  const snap = await db.collection('users').where('role', '==', 'student').get();
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(s => {
      if (!s.email)                         return false; // no email address
      if (s.email.endsWith('@example.com')) return false; // test accounts
      if (s.marketingOptOut === true)       return false; // explicitly unsubscribed
      if (s.flagged === true)               return false; // flagged/banned accounts
      if (s.uid === REVIEW.studentUid)      return false; // don't send Graham his own review
      return true;
    });
}

// ── Personalisation ──────────────────────────────────────────────────────────

// Instructors who teach what the student is learning come first. Veronica leads
// for Spanish learners so the review and the cards tell one story.
function personalizeInstructors(pool, learningLangs) {
  const lower = (learningLangs || []).map(l => l.toLowerCase());
  const langMatch = (t, l) => t.toLowerCase().includes(l) || l.includes(t.toLowerCase());
  const teaches = instr => (instr.languages_teaching || []).some(t => lower.some(l => langMatch(t, l)));

  const matched   = pool.filter(teaches);
  const unmatched = pool.filter(i => !teaches(i));
  if (lower.some(l => l.includes('spanish'))) {
    const v = matched.findIndex(i => i.id === REVIEW.instructorId);
    if (v > 0) matched.unshift(matched.splice(v, 1)[0]);
  }
  const instructors = [...matched, ...unmatched].slice(0, MAX_FEATURED);
  // Only name languages that the shown cards actually teach (e.g. not Polish if no Polish instructor)
  // Name the language in the heading only when every card teaches it
  const matchedLangs = (learningLangs || []).filter(l => instructors.length > 0 && instructors
    .every(i => (i.languages_teaching || []).some(t => langMatch(t, l.toLowerCase()))));
  return { instructors, matchedLangs };
}

// ── Email HTML builder ───────────────────────────────────────────────────────

function buildInstructorCardHtml(instr) {
  const langs  = formatLangs(instr.languages_teaching);
  const price  = formatPrice(instr);
  const rating = instr.averageRating && instr.reviewCount
    ? `<span style="color:#20bcba;">&#9733;</span>&nbsp;${instr.averageRating.toFixed(1)} &middot; ${instr.reviewCount} review${instr.reviewCount === 1 ? '' : 's'}`
    : '';
  const bio = escapeHtml(truncate(instr.about_me, 110));

  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"
  style="border:1px solid #dde5ed;border-radius:10px;overflow:hidden;background:#ffffff;">
  <tr>
    <td style="padding:20px 16px;text-align:center;">
      <img src="${escapeHtml(instr.avatar_url)}" alt="${escapeHtml(displayName(instr.name))}" width="72" height="72"
           style="width:72px;height:72px;border-radius:50%;display:block;margin:0 auto 10px;border:3px solid #e0fffe;object-fit:cover;" />
      <p style="margin:0 0 3px;font-size:15px;font-weight:700;color:#113448;">${escapeHtml(displayName(instr.name))}</p>
      ${langs ? `<p style="margin:0 0 4px;font-size:13px;color:#0b6664;font-weight:600;">${escapeHtml(langs)}</p>` : ''}
      ${rating ? `<p style="margin:0 0 4px;font-size:12px;color:#444;">${rating}</p>` : ''}
      ${price ? `<p style="margin:0 0 10px;font-size:12px;color:#666;">from&nbsp;${escapeHtml(price)}</p>` : '<p style="margin:0 0 10px;"></p>'}
      ${bio ? `<p style="margin:0 0 14px;font-size:12px;color:#555;line-height:1.55;text-align:left;">${bio}</p>` : ''}
      <a href="${trialUrl(instr.id)}"
         style="display:inline-block;background:#20bcba;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">
        Book Free Trial &rarr;
      </a>
    </td>
  </tr>
</table>`;
}

function buildInstructorGridHtml(instructors) {
  const rows = [];
  for (let i = 0; i < instructors.length; i += 2) {
    const left  = buildInstructorCardHtml(instructors[i]);
    const right = instructors[i + 1] ? buildInstructorCardHtml(instructors[i + 1]) : '';
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

function stepRow(num, title, body) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:14px;">
  <tr>
    <td width="40" valign="top">
      <div style="width:30px;height:30px;line-height:30px;border-radius:50%;background:#20bcba;color:#ffffff;font-weight:700;font-size:14px;text-align:center;">${num}</div>
    </td>
    <td valign="top">
      <p style="margin:4px 0 2px;font-size:14px;font-weight:700;color:#113448;">${title}</p>
      <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">${body}</p>
    </td>
  </tr>
</table>`;
}

function buildHtmlEmail(student, avatarUrl, personalized) {
  const firstName = escapeHtml(firstNameOf(student));
  const year      = new Date().getFullYear();
  const unsubUrl  = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
  const { instructors, matchedLangs } = personalized;

  const sectionTitle = matchedLangs.length > 0
    ? `A few ${escapeHtml(matchedLangs.slice(0, 2).join(' & '))} instructors you might like`
    : 'A few instructors you might like';

  const avatarHtml = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="${REVIEW.name}" width="88" height="88"
            style="width:88px;height:88px;border-radius:50%;display:block;margin:0 auto 14px;border:4px solid #ffffff;box-shadow:0 2px 8px rgba(17,52,72,0.15);object-fit:cover;" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(SUBJECT)}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .instr-col { display: block !important; width: 100% !important; padding-right: 0 !important; margin-bottom: 12px; }
      .pad { padding-left: 24px !important; padding-right: 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f7f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f7f6;">${escapeHtml(PREHEADER)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7f6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"
           style="max-width:100%;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">

      <!-- Header -->
      <tr>
        <td class="pad" style="background:#20bcba;padding:36px 40px;text-align:center;">
          <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud"
               style="height:52px;display:block;margin:0 auto 16px;" />
          <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;line-height:1.3;">
            A Note From a Fellow Student
          </h1>
          <p style="margin:10px 0 0;color:#e0fffe;font-size:15px;">
            Real words from a real Lingua Bud learner.
          </p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td class="pad" style="background:#ffffff;padding:40px;">

          <p style="font-size:16px;color:#333;margin:0 0 8px;">Hi ${firstName},</p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 28px;">
            We love hearing from students after their lessons, and a recent review from Graham
            really made our week. He was looking for a Spanish instructor who fit his budget
            and his schedule &mdash; here&rsquo;s how it went:
          </p>

          <!-- Review card -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
            <tr>
              <td style="background:#f0fffe;border:1px solid #d9eeee;border-radius:12px;padding:28px 28px 24px;text-align:center;">
                ${avatarHtml}
                <p style="margin:0 0 10px;color:#20bcba;font-size:18px;letter-spacing:3px;">&#9733;&#9733;&#9733;&#9733;&#9733;</p>
                <p style="margin:0 0 16px;font-size:17px;color:#113448;line-height:1.6;font-style:italic;">
                  &ldquo;${REVIEW.quoteHtml}&rdquo;
                </p>
                <p style="margin:0;font-size:14px;font-weight:700;color:#113448;">${REVIEW.name}</p>
                <p style="margin:2px 0 0;font-size:13px;font-weight:600;color:#0b6664;">${REVIEW.context}</p>
              </td>
            </tr>
          </table>

          <!-- How it works -->
          <h2 style="font-size:17px;color:#113448;margin:0 0 6px;">Getting started is just as simple for you</h2>
          <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 18px;">
            What Graham liked most is what we work hardest on: making it easy.
          </p>
          ${stepRow(1, 'Find your instructor', 'Browse profiles, watch intro videos, and compare rates and reviews.')}
          ${stepRow(2, 'Pick a time that works', 'Choose a slot from their calendar that fits your schedule.')}
          ${stepRow(3, 'Join from your browser', 'Your lesson happens right on Lingua Bud &mdash; nothing to download or install.')}

          <!-- Free trial banner -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 32px;">
            <tr>
              <td style="background:#113448;border-radius:10px;padding:28px 32px;text-align:center;">
                <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">
                  Try it free first
                </p>
                <p style="margin:0 0 20px;font-size:14px;color:#b8d9e8;line-height:1.7;">
                  Every instructor offers a <strong style="color:#ffffff;">free 15-minute trial lesson</strong>.<br />
                  No payment, no commitment &mdash; just a relaxed chat to see if it&rsquo;s a good fit.
                </p>
                <a href="https://linguabud.com/instructors"
                   style="display:inline-block;background:#20bcba;color:#ffffff;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;">
                  Find Your Instructor &rarr;
                </a>
              </td>
            </tr>
          </table>

          ${instructors.length > 0 ? `
          <hr style="border:none;border-top:1px solid #eee;margin:0 0 28px;" />
          <h2 style="font-size:17px;color:#113448;margin:0 0 16px;">${sectionTitle}</h2>
          ${buildInstructorGridHtml(instructors)}
          ` : ''}

          <hr style="border:none;border-top:1px solid #eee;margin:12px 0 24px;" />

          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 16px;">
            No pressure at all &mdash; whenever you&rsquo;re ready, your free trial will be waiting.
            Fifteen minutes is all it takes to find out if an instructor is right for you.
          </p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 16px;">
            Happy learning,<br />
            <strong style="color:#113448;">The Lingua Bud Team</strong>
          </p>
          <p style="font-size:13px;color:#777;line-height:1.6;margin:0;">
            P.S. Not sure who to pick? Just reply to this email and tell us what you&rsquo;re learning
            &mdash; we&rsquo;ll happily suggest a few instructors.
          </p>

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

function buildPlainText(student, personalized) {
  const year     = new Date().getFullYear();
  const unsubUrl = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
  const line     = '─'.repeat(44);

  let instrBlock = '';
  for (const i of personalized.instructors) {
    const langs = formatLangs(i.languages_teaching);
    const price = formatPrice(i);
    instrBlock += `${displayName(i.name)}${langs ? ' — ' + langs : ''}${price ? ' | from ' + price : ''}\n`;
    instrBlock += `Book a free trial: ${trialUrl(i.id)}\n\n`;
  }

  return `Hi ${firstNameOf(student)},

We love hearing from students after their lessons, and a recent review from Graham really made our week. He was looking for a Spanish instructor who fit his budget and his schedule. Here's how it went:

"${REVIEW.quoteText}"
★★★★★ ${REVIEW.name}, ${REVIEW.context}

GETTING STARTED IS JUST AS SIMPLE FOR YOU
${line}
1. Find your instructor: browse profiles, watch intro videos, compare rates and reviews.
2. Pick a time that works: choose a slot that fits your schedule.
3. Join from your browser: nothing to download or install.

TRY IT FREE FIRST
${line}
Every instructor offers a free 15-minute trial lesson.
No payment, no commitment. Just a relaxed chat to see if it's a good fit.

Find your instructor: https://linguabud.com/instructors

${instrBlock ? `A FEW INSTRUCTORS YOU MIGHT LIKE\n${line}\n${instrBlock}` : ''}No pressure at all. Whenever you're ready, your free trial will be waiting.

Happy learning,
The Lingua Bud Team

P.S. Not sure who to pick? Just reply to this email and tell us what you're learning, and we'll happily suggest a few instructors.

${line}
linguabud.com | support@linguabud.com
You're receiving this because you have a Lingua Bud student account.
Unsubscribe from marketing emails: ${unsubUrl}
© ${year} Lingua Bud`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if ((isTest || isSend) && !process.env.RESEND_API_KEY) {
    console.error('Error: RESEND_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log('\nFetching data from Firestore...');
  const [avatarUrl, pool, students] = await Promise.all([
    fetchReviewerAvatar(),
    fetchBookableInstructors(),
    fetchEligibleStudents(),
  ]);
  console.log(`  ✓ Reviewer avatar: ${avatarUrl ? 'found' : 'MISSING'}`);
  console.log(`  ✓ ${pool.length} bookable instructors with photos`);
  console.log(`  ✓ ${students.length} eligible students`);
  if (!avatarUrl) { console.error('Reviewer avatar missing; aborting.'); process.exit(1); }

  if (isDryRun) {
    console.log(`\nDRY RUN — ${students.length} recipients. Sample:`);
    students.slice(0, 10).forEach((s, i) =>
      console.log(`  ${String(i + 1).padStart(2)}. ${s.email} — ${firstNameOf(s)} | learning: ${(s.languages_learning || []).join(', ') || 'none set'}`));
    for (const langs of [['Spanish'], ['English'], ['French'], ['German'], ['Russian'], ['Polish'], ['Spanish', 'Polish'], []]) {
      const p = personalizeInstructors(pool, langs);
      console.log(`\nLearning ${langs.join(',') || '(none)'} [title: ${p.matchedLangs.join(' & ') || 'generic'}]: ${p.instructors.map(i => i.name + ' (' + (i.languages_teaching || []).join('/') + ')').join(' | ')}`);
    }
    process.exit(0);
  }

  if (renderDir) {
    fs.mkdirSync(renderDir, { recursive: true });
    for (const langs of [['Spanish'], ['English'], []]) {
      const mock = { uid: 'preview', name: 'Ian', languages_learning: langs };
      const p    = personalizeInstructors(pool, langs);
      const name = (langs[0] || 'none').toLowerCase();
      fs.writeFileSync(path.join(renderDir, `review-${name}.html`), buildHtmlEmail(mock, avatarUrl, p));
      fs.writeFileSync(path.join(renderDir, `review-${name}.txt`), buildPlainText(mock, p));
    }
    console.log(`Rendered previews to ${renderDir}`);
    process.exit(0);
  }

  if (isTest) {
    const mock = { uid: 'test-preview-uid', name: 'Ian', languages_learning: ['Spanish'] };
    const p    = personalizeInstructors(pool, mock.languages_learning);
    const result = await resend.emails.send({
      from:    FROM,
      to:      ADMIN_EMAIL,
      replyTo: REPLY_TO,
      subject: `[TEST PREVIEW] ${SUBJECT}`,
      html:    buildHtmlEmail(mock, avatarUrl, p),
      text:    buildPlainText(mock, p),
    });
    if (result.error) { console.error('Resend error:', result.error); process.exit(1); }
    console.log(`✓ Test email sent to ${ADMIN_EMAIL} (id ${result.data?.id})`);
    process.exit(0);
  }

  if (isSend) {
    console.log(`\nLIVE SEND — ${students.length} students\n`);
    let sent = 0, failed = 0;
    for (const student of students) {
      const p        = personalizeInstructors(pool, student.languages_learning);
      const unsubUrl = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
      try {
        const result = await resend.emails.send({
          from:    FROM,
          to:      student.email,
          replyTo: REPLY_TO,
          subject: SUBJECT,
          html:    buildHtmlEmail(student, avatarUrl, p),
          text:    buildPlainText(student, p),
          headers: {
            'List-Unsubscribe':
              `<${unsubUrl}>, <mailto:notifications@linguabud.com?subject=Unsubscribe&body=uid=${student.uid}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        if (result.error) { console.error(`  ✗ ${student.email} — ${result.error.message}`); failed++; }
        else { console.log(`  ✓ ${student.email}`); sent++; }
      } catch (err) {
        console.error(`  ✗ ${student.email} — ${err.message}`);
        failed++;
      }
      await sleep(DELAY_MS);
    }
    console.log(`\nDone. Sent: ${sent}  Failed: ${failed}  Total: ${students.length}\n`);
    process.exit(0);
  }
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
