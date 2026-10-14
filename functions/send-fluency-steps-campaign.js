/**
 * Marketing campaign: "3 Simple Steps to Become Fluent in a Language".
 *
 * Usage (run from the functions/ directory):
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-fluency-steps-campaign.js --dry-run
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-fluency-steps-campaign.js --render <dir>
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-fluency-steps-campaign.js --test
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-fluency-steps-campaign.js --send --confirm
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
const SUBJECT      = '3 Simple Steps to Become Fluent in a Language';
const PREHEADER    = 'Speak with native speakers, build a daily habit, and immerse yourself. Here’s how Lingua Bud makes each one easy.';
const DELAY_MS     = 300;
const MAX_FEATURED = 4;

const UNSUBSCRIBE_BASE_URL =
  'https://us-central1-linguabud-9a942.cloudfunctions.net/unsubscribeMarketing';

const CONNECT_URL     = 'https://linguabud.com/connect';
const INSTRUCTORS_URL = 'https://linguabud.com/instructors';
const RESOURCES_URL   = 'https://linguabud.com/language-learning-resources';

// Languages with a dedicated free learn-<lang> page on linguabud.com
const LEARN_PAGES = ['english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian', 'swedish'];

// Ian Jack and Bruce Robertson are left out of the cards
const EXCLUDED_INSTRUCTOR_EMAILS = new Set(['ianjack1643@gmail.com', 'linguabuddev@gmail.com', 'robertsonbruce1@gmail.com']);
const EXCLUDED_INSTRUCTOR_IDS    = new Set(['doxDE7putWSNb8FsQMJgctyVrHD3', 'wm4cc01q5ORiIIOPimlrxphhz1h1']);
const EXCLUDED_INSTRUCTOR_NAMES  = /^(ian jack|bruce robertson)$/i;
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

// First language the student is learning that has its own free learn-<lang> page
function learnPageFor(learningLangs) {
  for (const l of learningLangs || []) {
    const key = String(l).toLowerCase().trim();
    const match = LEARN_PAGES.find(p => key.includes(p));
    if (match) {
      return { url: `https://linguabud.com/learn-${match}`, label: match.charAt(0).toUpperCase() + match.slice(1) };
    }
  }
  return { url: RESOURCES_URL, label: null };
}

// ── Firestore data fetching ──────────────────────────────────────────────────

async function fetchBookableInstructors() {
  const snap = await db.collection('instructors').where('status', '==', 'approved').get();
  const all  = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(i => i.name && i.avatar_url && isPaymentReady(i) &&
                 !EXCLUDED_INSTRUCTOR_EMAILS.has(i.email) && !EXCLUDED_INSTRUCTOR_IDS.has(i.id) &&
                 !EXCLUDED_INSTRUCTOR_NAMES.test(i.name.trim()));

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
      return true;
    });
}

// ── Personalisation ──────────────────────────────────────────────────────────

// Instructors who teach what the student is learning come first; any remaining
// slots (or students learning a language we have no instructor for) get Spanish instructors
function personalizeInstructors(pool, learningLangs) {
  const lower = (learningLangs || []).map(l => l.toLowerCase());
  const langMatch = (t, l) => t.toLowerCase().includes(l) || l.includes(t.toLowerCase());
  const teachesAny = (instr, langs) => (instr.languages_teaching || []).some(t => langs.some(l => langMatch(t, l)));

  const matched = pool.filter(i => teachesAny(i, lower));
  const spanish = pool.filter(i => !matched.includes(i) && teachesAny(i, ['spanish']));
  const instructors = [...matched, ...spanish].slice(0, MAX_FEATURED);
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

// One numbered step: big teal number, title, description, then the "how Lingua Bud helps" block
function stepBlock(num, title, body, helpHtml) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
  <tr>
    <td width="52" valign="top">
      <div style="width:40px;height:40px;line-height:40px;border-radius:50%;background:#20bcba;color:#ffffff;font-weight:700;font-size:18px;text-align:center;">${num}</div>
    </td>
    <td valign="top">
      <h2 style="margin:6px 0 8px;font-size:19px;font-weight:700;color:#113448;line-height:1.35;">${title}</h2>
      <p style="margin:0 0 14px;font-size:14px;color:#555;line-height:1.7;">${body}</p>
      ${helpHtml}
    </td>
  </tr>
</table>`;
}

function helpBox(innerHtml) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
  <tr>
    <td style="background:#f0fffe;border:1px solid #d9eeee;border-left:4px solid #20bcba;border-radius:8px;padding:16px 18px;">
      ${innerHtml}
    </td>
  </tr>
</table>`;
}

function optionHtml(title, body, href, cta) {
  return `<p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#113448;">${title}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.6;">${body}</p>
      <p style="margin:0;"><a href="${href}" style="color:#0b6664;font-weight:700;font-size:13px;text-decoration:none;">${cta} &rarr;</a></p>`;
}

function buildHtmlEmail(student, personalized) {
  const firstName = escapeHtml(firstNameOf(student));
  const year      = new Date().getFullYear();
  const unsubUrl  = `${UNSUBSCRIBE_BASE_URL}?uid=${student.uid}`;
  const { instructors, matchedLangs } = personalized;
  const learn     = learnPageFor(student.languages_learning);

  const sectionTitle = matchedLangs.length > 0
    ? `Meet a few ${escapeHtml(matchedLangs.slice(0, 2).join(' & '))} instructors`
    : 'Meet a few of our instructors';

  const step1 = stepBlock(1, 'Speak with a native speaker',
    'Apps and textbooks can teach you words, but fluency comes from real conversation. Speaking with a native ' +
    'speaker trains your ear for natural speed and accents, and teaches you the expressions people actually use. ' +
    'It&rsquo;s the fastest way to go from &ldquo;I understand it&rdquo; to &ldquo;I can say it.&rdquo;',
    helpBox(`<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#0b6664;letter-spacing:1px;text-transform:uppercase;">How Lingua Bud helps</p>
      ${optionHtml('Free language exchange',
        'Match with a native speaker who&rsquo;s learning your language. You help them, they help you &mdash; completely free.',
        CONNECT_URL, 'Find an exchange partner')}
      <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
      ${optionHtml('1-on-1 lessons with a verified instructor',
        'Want structure and feedback? Book an experienced instructor. Every one offers a <strong style="color:#113448;">free 15-minute trial</strong>.',
        INSTRUCTORS_URL, 'Browse instructors')}`));

  const step2 = stepBlock(2, 'Practice a little every day',
    'Consistency beats intensity. Fifteen minutes a day will take you further than a three-hour session once a month, ' +
    'because your brain locks in what it sees again and again. Pick a time &mdash; your morning coffee, your commute &mdash; ' +
    'and make it a habit.',
    helpBox(`<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#0b6664;letter-spacing:1px;text-transform:uppercase;">How Lingua Bud helps</p>
      ${optionHtml(learn.label ? `Free ${learn.label} lessons` : 'Free lessons, stories &amp; phrase guides',
        'Bite-sized lessons, short stories and phrase guides you can get through in a few minutes. ' +
        'And a quick daily message with your exchange partner counts too!',
        learn.url, learn.label ? `Start learning ${learn.label}` : 'Explore free resources')}`));

  const step3 = stepBlock(3, 'Immerse yourself in the language',
    'Surround yourself with the language outside of lessons. Switch your phone to it, listen to music and podcasts, ' +
    'watch your favorite shows with subtitles, and read short stories at your level. The more you hear it, the more natural it feels.',
    helpBox(`<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#0b6664;letter-spacing:1px;text-transform:uppercase;">How Lingua Bud helps</p>
      ${optionHtml('Learn from the people who live it',
        'Ask your exchange partner or instructor for their favorite songs, shows and slang. They&rsquo;re your inside guide to the culture, ' +
        'and our free short stories are a great way to start reading.',
        RESOURCES_URL, 'Find stories &amp; guides')}`));

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
            3 Simple Steps to Become Fluent
          </h1>
          <p style="margin:10px 0 0;color:#e0fffe;font-size:15px;">
            No secret tricks &mdash; just what really works.
          </p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td class="pad" style="background:#ffffff;padding:40px;">

          <p style="font-size:16px;color:#333;margin:0 0 8px;">Hi ${firstName},</p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 32px;">
            Becoming fluent in a new language can feel like a huge mountain to climb. The good news? The learners
            who get there aren&rsquo;t doing anything magical &mdash; they just stick to a few simple habits.
            Here are the three that make the biggest difference, and how Lingua Bud makes each one easy.
          </p>

          ${step1}
          ${step2}
          ${step3}

          <!-- Free trial banner -->
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 32px;">
            <tr>
              <td style="background:#113448;border-radius:10px;padding:28px 32px;text-align:center;">
                <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">
                  Start with step one today
                </p>
                <p style="margin:0 0 20px;font-size:14px;color:#b8d9e8;line-height:1.7;">
                  Language exchanges are <strong style="color:#ffffff;">always free</strong>, and every instructor offers a
                  <strong style="color:#ffffff;">free 15-minute trial lesson</strong>.<br />
                  Your first real conversation is just a click away.
                </p>
                <a href="${CONNECT_URL}"
                   style="display:inline-block;background:#20bcba;color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;margin:0 4px 8px;">
                  Find a Partner &rarr;
                </a>
                <a href="${INSTRUCTORS_URL}"
                   style="display:inline-block;background:#ffffff;color:#113448;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;margin:0 4px 8px;">
                  Book a Free Trial &rarr;
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
            Fluency doesn&rsquo;t happen overnight, but every conversation gets you a little closer.
            We&rsquo;re cheering you on!
          </p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 16px;">
            Happy learning,<br />
            <strong style="color:#113448;">The Lingua Bud Team</strong>
          </p>
          <p style="font-size:13px;color:#777;line-height:1.6;margin:0;">
            P.S. Not sure where to start? Just reply to this email and tell us what you&rsquo;re learning
            &mdash; we&rsquo;ll happily point you in the right direction.
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
  const learn    = learnPageFor(student.languages_learning);

  let instrBlock = '';
  for (const i of personalized.instructors) {
    const langs = formatLangs(i.languages_teaching);
    const price = formatPrice(i);
    instrBlock += `${displayName(i.name)}${langs ? ' — ' + langs : ''}${price ? ' | from ' + price : ''}\n`;
    instrBlock += `Book a free trial: ${trialUrl(i.id)}\n\n`;
  }

  return `Hi ${firstNameOf(student)},

Becoming fluent in a new language can feel like a huge mountain to climb. The good news? The learners who get there aren't doing anything magical. They just stick to a few simple habits. Here are the three that make the biggest difference, and how Lingua Bud makes each one easy.

1. SPEAK WITH A NATIVE SPEAKER
${line}
Apps and textbooks can teach you words, but fluency comes from real conversation. Speaking with a native speaker trains your ear for natural speed and accents, and teaches you the expressions people actually use.

How Lingua Bud helps:
- Free language exchange: match with a native speaker who's learning your language. You help them, they help you, completely free.
  ${CONNECT_URL}
- 1-on-1 lessons with a verified instructor: every instructor offers a free 15-minute trial.
  ${INSTRUCTORS_URL}

2. PRACTICE A LITTLE EVERY DAY
${line}
Consistency beats intensity. Fifteen minutes a day will take you further than a three-hour session once a month. Pick a time (your morning coffee, your commute) and make it a habit.

How Lingua Bud helps:
- ${learn.label ? `Free ${learn.label} lessons` : 'Free lessons, stories and phrase guides'}: bite-sized material you can get through in a few minutes. A quick daily message with your exchange partner counts too!
  ${learn.url}

3. IMMERSE YOURSELF IN THE LANGUAGE
${line}
Switch your phone to it, listen to music and podcasts, watch your favorite shows with subtitles, and read short stories at your level.

How Lingua Bud helps:
- Ask your exchange partner or instructor for their favorite songs, shows and slang. Our free short stories are a great way to start reading.
  ${RESOURCES_URL}

START WITH STEP ONE TODAY
${line}
Language exchanges are always free, and every instructor offers a free 15-minute trial lesson.
Find a partner: ${CONNECT_URL}
Book a free trial: ${INSTRUCTORS_URL}

${instrBlock ? `MEET A FEW OF OUR INSTRUCTORS\n${line}\n${instrBlock}` : ''}Fluency doesn't happen overnight, but every conversation gets you a little closer. We're cheering you on!

Happy learning,
The Lingua Bud Team

P.S. Not sure where to start? Just reply to this email and tell us what you're learning, and we'll happily point you in the right direction.

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
  const [pool, students] = await Promise.all([
    fetchBookableInstructors(),
    fetchEligibleStudents(),
  ]);
  console.log(`  ✓ ${pool.length} bookable instructors with photos`);
  console.log(`  ✓ ${students.length} eligible students`);

  if (isDryRun) {
    console.log(`\nDRY RUN — ${students.length} recipients. Sample:`);
    students.slice(0, 10).forEach((s, i) =>
      console.log(`  ${String(i + 1).padStart(2)}. ${s.email} — ${firstNameOf(s)} | learning: ${(s.languages_learning || []).join(', ') || 'none set'} | learn page: ${learnPageFor(s.languages_learning).url}`));
    for (const langs of [['Spanish'], ['English'], ['French'], ['German'], ['Polish'], ['Arabic'], []]) {
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
      fs.writeFileSync(path.join(renderDir, `fluency-${name}.html`), buildHtmlEmail(mock, p));
      fs.writeFileSync(path.join(renderDir, `fluency-${name}.txt`), buildPlainText(mock, p));
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
      html:    buildHtmlEmail(mock, p),
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
          html:    buildHtmlEmail(student, p),
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
