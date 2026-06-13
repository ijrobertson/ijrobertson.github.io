#!/usr/bin/env node
// Fetch instructor data + referral tokens and print personalised email drafts.
// Run from the functions/ directory: node gen-referral-emails.js

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();

const TARGET_NAMES = [
  'Alann De Vuyst',
  'B. Michael James Crowe',
  'Bruce Robertson',
  'Claudia Caputo',
  'Dave Baker',
  'Ezeka Jacinta',
  'Federica Campisi',
  'Francesca Fourie',
  'John Alexander Becerra Gonzalez',
  'Jordan Sharp',
];

function fmtLangs(arr) {
  if (!arr || arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr.join(' and ');
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}

function buildEmail(instr, referralUrl, profileUrl) {
  const firstName = instr.name.split(' ')[0];
  const langs = fmtLangs(instr.languages_teaching || instr.languages || []);
  const langLine = langs
    ? `you almost certainly know people who want to learn ${langs}.`
    : 'you almost certainly know people who are looking for a great language instructor.';
  const socialLangLine = langs
    ? `Whether you want to improve your ${langs}, prep for travel, or just finally commit to learning, I'd love to be your instructor.`
    : `Whether you're looking to improve your language skills, prep for travel, or finally commit to learning, I'd love to be your instructor.`;

  return `
Hi ${firstName},

First — thank you for being one of our founding instructors. The 10% commission structure you locked in is something we're honored to protect, and we want to make sure your schedule fills up as quickly as possible.

Here's something worth thinking about: ${langLine} Former students, friends, coworkers, family members who've mentioned wanting to finally get serious about their studies. They just haven't found the right place yet.

We'd love your help connecting them to Lingua Bud — and we want to make it genuinely worth your while.

Here's how the referral program works:

Share your personal referral link with anyone you think would benefit from lessons. If they sign up and complete their first paid lesson with you, we'll credit you one commission-free lesson with that student — meaning you keep 100% of what you earned on that lesson, no platform cut.

You can earn up to 10 of these credits for students you refer in the next 6 months. There's no awkward pitch required — every new student gets a free 15-minute trial before committing to anything, so sharing your link is genuinely low-pressure for both of you.

Here is Your Referral Link: ${referralUrl}

Want to reach even more potential students?

We've put together a quick social media post you can copy and share right now. It takes 30 seconds and links directly to your instructor profile:

"I'm now taking new students on Lingua Bud — a platform I'm proud to teach on. ${socialLangLine} There's a free 15-minute trial with no commitment. Book here: ${profileUrl}"

You're welcome to personalize it however you'd like — your voice will always come across better than ours.

We're building Lingua Bud one great instructor at a time, and the founding cohort is what makes it real. Thank you for being part of it from the beginning.

Warm regards,
Ian Robertson
Lingua Bud
`;
}

async function main() {
  const snap = await db.collection('instructors').get();
  const instructors = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Normalise names for matching (trim + lower)
  const normalise = s => (s || '').trim().toLowerCase();
  const targetSet = new Set(TARGET_NAMES.map(normalise));

  const found = instructors.filter(i => targetSet.has(normalise(i.name)));

  // Also fetch referralTokens for each found instructor
  const tokenSnap = await db.collection('referralTokens').get();
  // referralTokens docs: docId = token, data = { instructorId, ... }
  const tokensByInstructor = {};
  tokenSnap.docs.forEach(d => {
    const data = d.data();
    if (data.instructorId) tokensByInstructor[data.instructorId] = d.id;
  });

  // Print results sorted by TARGET_NAMES order
  const foundMap = {};
  found.forEach(i => { foundMap[normalise(i.name)] = i; });

  const BASE = 'https://linguabud.com';

  console.log('\n========== REFERRAL EMAIL DRAFTS ==========\n');

  for (const name of TARGET_NAMES) {
    const instr = foundMap[normalise(name)];
    if (!instr) {
      console.log(`\n[WARNING] Not found in Firestore: "${name}"\n`);
      console.log('─'.repeat(60));
      continue;
    }

    const token = tokensByInstructor[instr.id];
    const profileUrl = `${BASE}/instructor-profile?id=${instr.id}`;
    const referralUrl = token
      ? `${BASE}/instructor-profile?id=${instr.id}&ref=${token}`
      : `[NO TOKEN — visit admin panel and click Refresh to generate]`;

    console.log(`TO: ${instr.name} <${instr.email || '(no email on record)'}>`.trim());
    console.log('SUBJECT: Your personal referral link — earn commission-free lessons');
    console.log(buildEmail(instr, referralUrl, profileUrl));
    console.log('═'.repeat(60));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
