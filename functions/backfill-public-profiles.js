/**
 * One-time (re-runnable) fill of publicUsers/ and publicInstructors/ from
 * users/ and instructors/, using the same allowlists as the sync triggers.
 *   GOOGLE_APPLICATION_CREDENTIALS=<path> node backfill-public-profiles.js [--dry-run]
 */
const admin = require('firebase-admin');
const { publicUserCopy, publicInstructorCopy } = require('./publicProfiles');
admin.initializeApp({ projectId: 'linguabud-9a942' });
const db = admin.firestore();
const dry = process.argv.includes('--dry-run');

(async () => {
  for (const [src, dest, copy] of [['users', 'publicUsers', publicUserCopy], ['instructors', 'publicInstructors', publicInstructorCopy]]) {
    const snap = await db.collection(src).get();
    let batch = db.batch(), n = 0, total = 0;
    for (const d of snap.docs) {
      const data = copy(d.data());
      const at = Object.keys(data).filter((k) => typeof data[k] === 'string' && /\S+@\S+\.\S+/.test(data[k]));
      if (at.length) console.warn(`  note: ${src}/${d.id} has an email-like text in ${at.join(', ')} (written by the person themselves)`);
      if (!dry) batch.set(db.collection(dest).doc(d.id), data);
      n++; total++;
      if (n === 400) { if (!dry) await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n && !dry) await batch.commit();
    console.log(`${dry ? '[dry run] ' : ''}${src} -> ${dest}: ${total} docs`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
