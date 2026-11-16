/**
 * Announcement: "Lingua Bud is now an app on your phone".
 * One version for students, one for instructors.
 *
 * Usage (run from the functions/ directory):
 *   RESEND_API_KEY=<key> GOOGLE_APPLICATION_CREDENTIALS=<path> node send-app-launch-campaign.js --dry-run
 *   ... --render <dir>     write student.html/.txt + instructor.html/.txt previews
 *   ... --test             send both versions to ADMIN_EMAIL only
 *   ... --send --confirm   send to every eligible student and instructor
 *
 * Eligibility (same rule as every marketing send): has an email, not
 * @example.com, not marketingOptOut, not flagged. emailNotifications is NOT a
 * marketing filter. Instructors = users with role 'instructor' whose
 * instructors/{uid} doc is approved.
 */

const admin = require('firebase-admin');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── Config ──────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'ianjack1643@gmail.com';
const FROM        = 'Lingua Bud <notifications@linguabud.com>';
const REPLY_TO    = 'support@linguabud.com';
const DELAY_MS    = 300;

const APP_URL  = 'https://app.linguabud.com';
const ICON_URL = 'https://app.linguabud.com/icons/icon-192.png';
const UNSUBSCRIBE_BASE_URL =
  'https://us-central1-linguabud-9a942.cloudfunctions.net/unsubscribeMarketing';

const COPY = {
  student: {
    subject:   'Lingua Bud is now an app on your phone 📱',
    preheader: 'Quizzes, Adventures, language partners and lessons, all one tap away. Free, and no app store needed.',
    headline:  'Lingua Bud is now on your phone',
    tagline:   'Everything you love about Lingua Bud, one tap away.',
    intro:
      'We&rsquo;ve been working on something we&rsquo;re really excited about: the Lingua Bud app. ' +
      'It&rsquo;s free, it takes a few seconds to install, and it makes practicing a little every day ' +
      'easier than ever. Here&rsquo;s what you can do with it.',
    features: [
      ['Learn a little every day',
       'Quick daily quizzes, 36 interactive Adventures, Culture Guides about the countries that speak your language, ' +
       'and a notebook for the words you want to remember. Keep a daily streak going and watch your progress grow.'],
      ['Find language partners',
       'Use the Connect tab to meet native speakers who are learning your language. You help them, ' +
       'they help you, and it&rsquo;s always free.'],
      ['Chat and call from your phone',
       'Send messages, voice notes and photos to your partners and instructors, and start a video call ' +
       'right from the chat. Turn on notifications so you never miss a reply.'],
      ['Book lessons with verified instructors',
       'Browse instructors, book a lesson in a few taps, and join it from your phone. ' +
       'Every instructor offers a <strong style="color:#113448;">free 15-minute trial lesson</strong>.'],
      ['Use it in your language',
       'The app works in English, Spanish, Portuguese, French and Arabic. Pick yours in the menu.'],
    ],
    closing:
      'We built the app so practicing fits into a few spare minutes, on the bus or in a coffee line. ' +
      'We hope it helps you get to your next conversation faster.',
    signoff: 'Happy learning,',
    footerRole: 'student',
  },
  instructor: {
    subject:   'Lingua Bud is now an app: run your lessons from your phone 📱',
    preheader: 'Your calendar, students, video lessons and earnings in one place. Free, and no app store needed.',
    headline:  'Teach from your phone with the Lingua Bud app',
    tagline:   'Your calendar, students and earnings, one tap away.',
    intro:
      'We&rsquo;ve just launched the Lingua Bud app, and it&rsquo;s built to make teaching on Lingua Bud easier. ' +
      'It&rsquo;s free, it takes a few seconds to install, and it keeps everything you need for your lessons ' +
      'in your pocket. Here&rsquo;s what it does for you.',
    features: [
      ['Your lessons at a glance',
       'The Calendar tab shows your upcoming lessons with each student&rsquo;s name and the time in your own time zone, ' +
       'so you always know what&rsquo;s next. You can also send homework from there.'],
      ['Reply to students quickly',
       'Message your students, send voice notes and photos, and turn on notifications so you see ' +
       'new messages right away. Quick replies help turn free trials into regular students.'],
      ['Teach video lessons anywhere',
       'Join your lessons straight from the app with one tap, whether you&rsquo;re at your desk or on the go.'],
      ['Track your earnings',
       'The Earnings tab shows what you&rsquo;ve earned from your lessons and your payouts.'],
      ['Manage your profile and availability',
       'Update your profile, prices and weekly availability from Settings, so students can book the times that suit you.'],
    ],
    closing:
      'Being quick to respond and easy to reach makes a big difference to new students, ' +
      'and the app makes that much easier. Thank you for teaching with Lingua Bud!',
    signoff: 'Thank you,',
    footerRole: 'instructor',
  },
};

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

function firstNameOf(person) {
  const first = (person.name || '').trim().split(/\s+/)[0];
  if (!first) return 'there';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// HTML entities / tags → plain text for the text version
function toText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '-').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
}

// ── Recipients ───────────────────────────────────────────────────────────────

function isEligible(u) {
  if (!u.email)                         return false;
  if (u.email.endsWith('@example.com')) return false;
  if (u.marketingOptOut === true)       return false;
  if (u.flagged === true)               return false;
  return true;
}

async function fetchRecipients() {
  const [usersSnap, instSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('instructors').get(),
  ]);
  const instStatus = new Map(instSnap.docs.map(d => [d.id, d.data().status]));
  const instName   = new Map(instSnap.docs.map(d => [d.id, d.data().name]));
  const students = [], instructors = [], skipped = { optOut: 0, flagged: 0, noEmail: 0, unapprovedInstructor: 0, otherRole: 0 };
  const seen = new Set();
  for (const d of usersSnap.docs) {
    const u = { uid: d.id, ...d.data() };
    if (!u.email) { skipped.noEmail++; continue; }
    if (u.marketingOptOut === true) { skipped.optOut++; continue; }
    if (u.flagged === true) { skipped.flagged++; continue; }
    if (!isEligible(u)) continue;
    const key = u.email.trim().toLowerCase();
    if (seen.has(key)) continue;            // one email per address
    if (u.role === 'student') { students.push(u); seen.add(key); }
    else if (u.role === 'instructor') {
      if (!u.name && instName.get(u.uid)) u.name = instName.get(u.uid); // some instructors only have a name on their instructors doc
      if (instStatus.get(u.uid) === 'approved') { instructors.push(u); seen.add(key); }
      else skipped.unapprovedInstructor++;
    } else skipped.otherRole++;
  }
  return { students, instructors, skipped };
}

// ── Email HTML ───────────────────────────────────────────────────────────────

function featureRow(title, body) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;">
  <tr>
    <td width="30" valign="top" style="padding-top:2px;">
      <div style="width:22px;height:22px;line-height:22px;border-radius:50%;background:#20bcba;color:#ffffff;font-weight:700;font-size:13px;text-align:center;">&#10003;</div>
    </td>
    <td valign="top">
      <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#113448;">${title}</p>
      <p style="margin:0;font-size:14px;color:#555;line-height:1.65;">${body}</p>
    </td>
  </tr>
</table>`;
}

function installBox() {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 30px;">
  <tr>
    <td style="background:#f0fffe;border:1px solid #d9eeee;border-left:4px solid #20bcba;border-radius:8px;padding:18px 20px;">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#0b6664;letter-spacing:1px;text-transform:uppercase;">How to install it (about 10 seconds)</p>
      <p style="margin:0 0 10px;font-size:14px;color:#333;line-height:1.6;">
        On your phone, open <a href="${APP_URL}" style="color:#0b6664;font-weight:700;text-decoration:none;">app.linguabud.com</a>. Then:
      </p>
      <p style="margin:0 0 8px;font-size:14px;color:#555;line-height:1.6;">
        <strong style="color:#113448;">iPhone:</strong> open the link in Safari, tap the Share button, then <strong style="color:#113448;">Add to Home Screen</strong>.
      </p>
      <p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.6;">
        <strong style="color:#113448;">Android:</strong> tap <strong style="color:#113448;">Install</strong> on the page (or Chrome&rsquo;s menu &rarr; Install app).
      </p>
      <p style="margin:0;font-size:13px;color:#777;line-height:1.6;">
        No app store and no download to wait for. Just log in with your usual Lingua Bud email and password.
      </p>
    </td>
  </tr>
</table>`;
}

function ctaButton(label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 30px;">
  <tr><td align="center">
    <a href="${APP_URL}" style="display:inline-block;background:#20bcba;color:#ffffff;padding:15px 34px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">
      ${label} &rarr;
    </a>
  </td></tr>
</table>`;
}

function buildHtmlEmail(person, kind) {
  const c         = COPY[kind];
  const firstName = escapeHtml(firstNameOf(person));
  const year      = new Date().getFullYear();
  const unsubUrl  = `${UNSUBSCRIBE_BASE_URL}?uid=${encodeURIComponent(person.uid)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(c.subject)}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .pad { padding-left: 24px !important; padding-right: 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f7f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f7f6;">${escapeHtml(c.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7f6;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"
           style="max-width:100%;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">

      <!-- Header -->
      <tr>
        <td class="pad" style="background:#20bcba;padding:36px 40px;text-align:center;">
          <img src="${ICON_URL}" alt="Lingua Bud app" width="76" height="76"
               style="width:76px;height:76px;border-radius:18px;display:block;margin:0 auto 16px;box-shadow:0 4px 14px rgba(0,0,0,0.18);" />
          <h1 style="margin:0;color:#ffffff;font-size:27px;font-weight:700;line-height:1.3;">${c.headline}</h1>
          <p style="margin:10px 0 0;color:#e0fffe;font-size:15px;">${c.tagline}</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td class="pad" style="background:#ffffff;padding:40px;">
          <p style="font-size:16px;color:#333;margin:0 0 8px;">Hi ${firstName},</p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 28px;">${c.intro}</p>

          ${c.features.map(([t, b]) => featureRow(t, b)).join('\n')}

          ${installBox()}
          ${ctaButton('Get the App')}

          <hr style="border:none;border-top:1px solid #eee;margin:0 0 24px;" />
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 16px;">${c.closing}</p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 16px;">
            ${c.signoff}<br />
            <strong style="color:#113448;">The Lingua Bud Team</strong>
          </p>
          <p style="font-size:13px;color:#777;line-height:1.6;margin:0;">
            P.S. Questions or ideas for the app? Just reply to this email. We read every message.
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
            You&rsquo;re receiving this because you have a Lingua Bud ${c.footerRole} account.<br />
            <a href="${unsubUrl}" style="color:#8aaabb;text-decoration:underline;">Unsubscribe from marketing emails</a>
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

function buildPlainText(person, kind) {
  const c        = COPY[kind];
  const year     = new Date().getFullYear();
  const unsubUrl = `${UNSUBSCRIBE_BASE_URL}?uid=${encodeURIComponent(person.uid)}`;
  const line     = '─'.repeat(44);
  return `Hi ${firstNameOf(person)},

${toText(c.intro)}

${c.features.map(([t, b]) => `- ${toText(t).toUpperCase()}\n  ${toText(b)}`).join('\n\n')}

HOW TO INSTALL IT (ABOUT 10 SECONDS)
${line}
On your phone, open ${APP_URL}. Then:
iPhone: open the link in Safari, tap the Share button, then Add to Home Screen.
Android: tap Install on the page (or Chrome's menu > Install app).
No app store and no download to wait for. Just log in with your usual Lingua Bud email and password.

Get the app: ${APP_URL}

${toText(c.closing)}

${c.signoff}
The Lingua Bud Team

P.S. Questions or ideas for the app? Just reply to this email. We read every message.

${line}
linguabud.com | support@linguabud.com
You're receiving this because you have a Lingua Bud ${c.footerRole} account.
Unsubscribe from marketing emails: ${unsubUrl}
© ${year} Lingua Bud`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function sendOne(to, person, kind, subjectPrefix = '') {
  return resend.emails.send({
    from: FROM, to, replyTo: REPLY_TO,
    subject: subjectPrefix + COPY[kind].subject,
    html: buildHtmlEmail(person, kind),
    text: buildPlainText(person, kind),
    headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_BASE_URL}?uid=${encodeURIComponent(person.uid)}>` },
  });
}

async function main() {
  if ((isTest || isSend) && !resend) {
    console.error('Error: RESEND_API_KEY environment variable is not set.');
    process.exit(1);
  }

  if (renderDir) {
    fs.mkdirSync(renderDir, { recursive: true });
    for (const kind of ['student', 'instructor']) {
      const mock = { uid: 'preview', name: 'Ian' };
      fs.writeFileSync(path.join(renderDir, `${kind}.html`), buildHtmlEmail(mock, kind));
      fs.writeFileSync(path.join(renderDir, `${kind}.txt`), buildPlainText(mock, kind));
    }
    console.log(`Rendered previews to ${renderDir}`);
    return;
  }

  if (isTest) {
    for (const kind of ['student', 'instructor']) {
      const r = await sendOne(ADMIN_EMAIL, { uid: 'test-preview-uid', name: 'Ian' }, kind, `[TEST PREVIEW – ${kind}] `);
      console.log(kind, r.error ? `FAILED: ${JSON.stringify(r.error)}` : `sent (${r.data && r.data.id})`);
      await sleep(DELAY_MS);
    }
    return;
  }

  console.log('\nFetching recipients from Firestore...');
  const { students, instructors, skipped } = await fetchRecipients();
  console.log(`  ✓ ${students.length} students, ${instructors.length} approved instructors`);
  console.log('  skipped:', JSON.stringify(skipped));

  if (isDryRun) {
    console.log('\nStudents (first 10):');
    students.slice(0, 10).forEach(s => console.log('  ', s.email, '-', firstNameOf(s)));
    console.log('\nInstructors:');
    instructors.forEach(s => console.log('  ', s.email, '-', firstNameOf(s)));
    return;
  }

  if (isSend) {
    let sent = 0, failed = 0;
    for (const [list, kind] of [[students, 'student'], [instructors, 'instructor']]) {
      for (const p of list) {
        try {
          const r = await sendOne(p.email, p, kind);
          if (r.error) { failed++; console.log(`  ✗ ${p.email}: ${JSON.stringify(r.error)}`); }
          else { sent++; }
        } catch (e) { failed++; console.log(`  ✗ ${p.email}: ${e.message}`); }
        await sleep(DELAY_MS);
      }
    }
    console.log(`\nDone. Sent ${sent}, failed ${failed}.`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
