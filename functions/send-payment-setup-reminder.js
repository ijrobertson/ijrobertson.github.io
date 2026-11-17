/**
 * Reminder to approved instructors who haven't finished payment setup
 * (Stripe or Wise), so they can be booked. Each recipient gets a tracking
 * token (emailRecipients/{token}) so the admin page can show who opened,
 * clicked, and then finished setting up payments.
 *
 * Usage (run from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=<path> node send-payment-setup-reminder.js --dry-run
 *   RESEND_API_KEY=<key> ... node send-payment-setup-reminder.js --test     both versions to ADMIN_EMAIL
 *   RESEND_API_KEY=<key> ... node send-payment-setup-reminder.js --send --confirm
 *
 * Audience: instructors/{uid} with status 'approved' that are not payment-ready
 * (chargesEnabled && payoutsEnabled, or payoutMethod 'wise' with wiseEmail),
 * excluding PayPal (manualPayout 'paypal' / paypalEmail), marketingOptOut, and
 * Ian's / Bruce's own accounts.
 */
const admin = require('firebase-admin');
const { Resend } = require('resend');
const crypto = require('crypto');

admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const CAMPAIGN = 'payment-setup-2026-11';
const ADMIN_EMAIL = 'ianjack1643@gmail.com';
const FROM = 'Lingua Bud <notifications@linguabud.com>';
const REPLY_TO = 'support@linguabud.com';
const TRACK_URL = 'https://us-central1-linguabud-9a942.cloudfunctions.net/emailTrack';
const EXCLUDED_IDS = new Set(['doxDE7putWSNb8FsQMJgctyVrHD3', 'wm4cc01q5ORiIIOPimlrxphhz1h1']); // Ian Jack, Bruce Robertson
const DELAY_MS = 400;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isTest = args.includes('--test');
const isSend = args.includes('--send') && args.includes('--confirm');
if (!isDryRun && !isTest && !isSend) { console.log('Usage: --dry-run | --test | --send --confirm'); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function firstName(name) {
  const f = String(name || '').trim().split(/\s+/)[0] || 'there';
  return f === f.toUpperCase() ? f.charAt(0) + f.slice(1).toLowerCase() : f;
}
const isReady = (x) => (x.chargesEnabled === true && x.payoutsEnabled === true) || (x.payoutMethod === 'wise' && !!x.wiseEmail);

async function audience() {
  const snap = await db.collection('instructors').where('status', '==', 'approved').get();
  const out = [];
  for (const d of snap.docs) {
    const x = d.data();
    if (isReady(x) || x.manualPayout === 'paypal' || x.paypalEmail || EXCLUDED_IDS.has(d.id)) continue;
    const u = (await db.doc('users/' + d.id).get()).data() || {};
    if (u.marketingOptOut === true || x.flagged === true) continue;
    const email = x.email || u.email;
    if (!email || email.endsWith('@example.com')) continue;
    out.push({ uid: d.id, name: x.name || u.name || '', email, startedStripe: !!x.stripeAccountId });
  }
  return out;
}

// Links: tracked when a token is given, plain otherwise (previews before the
// tracker exists).
const link = (token, to, plain) => (token ? `${TRACK_URL}?t=${token}&a=click&to=${to}` : plain);

function buildHtml(r, token) {
  const name = esc(firstName(r.name));
  const settings = link(token, 'settings', 'https://linguabud.com/dashboard');
  const app = link(token, 'app', 'https://app.linguabud.com');
  const intro = r.startedStripe
    ? `You started connecting your Stripe account, but the setup wasn't finished, so <strong style="color:#113448;">students can't book lessons with you yet</strong>. It only takes a few minutes to pick up where you left off.`
    : `Your profile is approved, but your payment setup isn't finished yet, so <strong style="color:#113448;">students can't book lessons with you</strong>. It only takes about 5 minutes.`;
  const step = (n, t, b) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>
    <td width="40" valign="top"><div style="width:28px;height:28px;line-height:28px;border-radius:50%;background:#20bcba;color:#fff;font-weight:700;font-size:14px;text-align:center;">${n}</div></td>
    <td valign="top" style="font-size:14px;color:#555;line-height:1.6;"><strong style="color:#113448;">${t}</strong><br />${b}</td></tr></table>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Finish your payment setup</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f7f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:100%;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">
<tr><td style="background:#20bcba;padding:32px 40px;text-align:center;">
  <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:46px;display:block;margin:0 auto 14px;" />
  <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.3;">One last step before students can book you</h1>
</td></tr>
<tr><td style="background:#ffffff;padding:36px 40px;font-size:15px;color:#444;line-height:1.7;">
  <p style="margin:0 0 16px;">Hi ${name},</p>
  <p style="margin:0 0 16px;">${intro}</p>
  <p style="margin:0 0 20px;">Until it's done, your profile isn't shown in the instructor listings on our website, and the <em>Book Lesson</em> button on your profile says <em>Payment Setup Pending</em>. Once it's finished, students can find you, book paid lessons, and book a free 15-minute trial with you.</p>
  <div style="background:#f0fffe;border:1px solid #d9eeee;border-left:4px solid #20bcba;border-radius:8px;padding:18px 20px;margin:0 0 24px;">
    <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#0b6664;letter-spacing:1px;text-transform:uppercase;">How to finish (about 5 minutes)</p>
    ${step(1, 'Sign in and open your Settings', 'Log in to Lingua Bud with your usual email and password.')}
    ${step(2, 'Choose how you want to be paid', '<strong>Stripe</strong> sends your earnings straight to your bank account. <strong>Wise</strong> only needs the email address of your Wise account.')}
    ${step(3, "That's it", "You'll appear in the listings and can start receiving bookings right away.")}
  </div>
  <p style="margin:0 0 28px;text-align:center;"><a href="${settings}" style="display:inline-block;background:#20bcba;color:#ffffff;padding:14px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px;">Finish Payment Setup &rarr;</a></p>
  <p style="margin:0 0 16px;">Tip: install the free Lingua Bud app at <a href="${app}" style="color:#0b6664;font-weight:700;text-decoration:none;">app.linguabud.com</a> and turn on notifications, so you hear right away when a student books a lesson or sends you a message.</p>
  <p style="margin:0 0 16px;">If anything isn't clear, or Stripe and Wise aren't available in your country, just reply to this email and we'll help you.</p>
  <p style="margin:24px 0 0;">Thank you for teaching with Lingua Bud!<br /><strong style="color:#113448;">Ian &amp; the Lingua Bud Team</strong></p>
</td></tr>
<tr><td style="background:#113448;padding:22px 40px;text-align:center;font-size:13px;color:#ffffff;line-height:1.8;">
  The Lingua Bud Team<br />
  <a href="https://linguabud.com" style="color:#20bcba;text-decoration:none;">linguabud.com</a> &nbsp;|&nbsp;
  <a href="mailto:support@linguabud.com" style="color:#20bcba;text-decoration:none;">support@linguabud.com</a>
  <p style="margin:10px 0 0;font-size:12px;color:#8aaabb;">You're receiving this because you have an approved instructor account on Lingua Bud.</p>
</td></tr></table></td></tr></table>
${token ? `<img src="${TRACK_URL}?t=${token}&a=open" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />` : ''}
</body></html>`;
}

function buildText(r, token) {
  const settings = link(token, 'settings', 'https://linguabud.com/dashboard');
  const intro = r.startedStripe
    ? "You started connecting your Stripe account, but the setup wasn't finished, so students can't book lessons with you yet. It only takes a few minutes to pick up where you left off."
    : "Your profile is approved, but your payment setup isn't finished yet, so students can't book lessons with you. It only takes about 5 minutes.";
  return `Hi ${firstName(r.name)},

${intro}

Until it's done, your profile isn't shown in the instructor listings on our website, and the Book Lesson button on your profile says "Payment Setup Pending". Once it's finished, students can find you, book paid lessons, and book a free 15-minute trial with you.

HOW TO FINISH (ABOUT 5 MINUTES)
1. Sign in and open your Settings.
2. Choose how you want to be paid: Stripe sends your earnings straight to your bank account; Wise only needs the email address of your Wise account.
3. That's it. You'll appear in the listings and can start receiving bookings right away.

Finish payment setup: ${settings}

Tip: install the free Lingua Bud app at https://app.linguabud.com and turn on notifications, so you hear right away when a student books a lesson or sends you a message.

If anything isn't clear, or Stripe and Wise aren't available in your country, just reply to this email and we'll help you.

Thank you for teaching with Lingua Bud!
Ian & the Lingua Bud Team

linguabud.com | support@linguabud.com
You're receiving this because you have an approved instructor account on Lingua Bud.`;
}

const SUBJECT = 'Finish your payment setup so students can book you on Lingua Bud';

(async () => {
  if ((isTest || isSend) && !resend) { console.error('RESEND_API_KEY is not set'); process.exit(1); }
  if (isTest) {
    for (const [label, r] of [['not started', { name: 'Ian', startedStripe: false }], ['started Stripe', { name: 'Ian', startedStripe: true }]]) {
      const res = await resend.emails.send({ from: FROM, to: ADMIN_EMAIL, replyTo: REPLY_TO,
        subject: `[TEST PREVIEW – ${label}] ${SUBJECT}`, html: buildHtml(r, null), text: buildText(r, null) });
      console.log(label, res.error ? 'FAILED ' + JSON.stringify(res.error) : 'sent ' + (res.data && res.data.id));
      await sleep(DELAY_MS);
    }
    process.exit(0);
  }
  const list = await audience();
  console.log(`${list.length} instructors (${list.filter((r) => r.startedStripe).length} started Stripe)`);
  if (isDryRun) { list.forEach((r) => console.log(' ', r.startedStripe ? '[started Stripe]' : '[not started]   ', r.name, '-', r.email)); process.exit(0); }

  let sent = 0, failed = 0;
  for (const r of list) {
    const already = await db.collection('emailRecipients').where('campaign', '==', CAMPAIGN).where('uid', '==', r.uid).limit(1).get();
    if (!already.empty) { console.log('  skip (already sent):', r.name); continue; }
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('emailRecipients').doc(token).set({
      campaign: CAMPAIGN, uid: r.uid, name: r.name, email: r.email, startedStripe: r.startedStripe,
      sentAt: admin.firestore.FieldValue.serverTimestamp(), opens: 0, clicks: 0,
    });
    try {
      const res = await resend.emails.send({ from: FROM, to: r.email, replyTo: REPLY_TO, subject: SUBJECT, html: buildHtml(r, token), text: buildText(r, token) });
      if (res.error) { failed++; console.log('  ✗', r.email, JSON.stringify(res.error)); await db.collection('emailRecipients').doc(token).update({ sendError: JSON.stringify(res.error) }); }
      else { sent++; await db.collection('emailRecipients').doc(token).update({ resendId: res.data && res.data.id }); }
    } catch (e) { failed++; console.log('  ✗', r.email, e.message); }
    await sleep(DELAY_MS);
  }
  console.log(`Done. Sent ${sent}, failed ${failed}.`);
  process.exit(0);
})();
