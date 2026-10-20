// Lingua Bud Adventures — shared helpers for adventures.html (the library)
// and adventure.html (one scenario). Content is curated JSON in
// data/adventures/ (format: data/adventures/README.md); per-user progress is
// one Firestore doc, adventureProgress/{uid}, the same single-owner-doc shape
// as cultureProgress (see js/culture-progress.js and firestore.rules):
//
//   {
//     completed: { [adventureId]: { completedAt, lastScore, bestScore, total, attempts } },
//     prefs:     { language, variety, difficulty }   // the library's last filters
//   }
//
// Saved phrases go into the existing `notebook` collection (no second
// vocabulary system), in the same shape vocab-quiz.html writes.

import {
  db, doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, serverTimestamp
} from '../lib/firebaseClient.js';

const DATA_DIR = 'data/adventures';
const ID_PATTERN = /^[a-z0-9-]+$/; // ids come from the URL — never let one reach a fetch path unchecked

// ── Content ─────────────────────────────────────────────────────────────

let cataloguePromise = null;

/** The catalogue (data/adventures/index.json) — fetched once per page. */
export function loadCatalogue() {
  if (!cataloguePromise) {
    cataloguePromise = fetch(`${DATA_DIR}/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Adventures catalogue: HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => (Array.isArray(data.adventures) ? data.adventures : []))
      .catch((err) => {
        cataloguePromise = null; // let a later call retry (e.g. after reconnecting)
        throw err;
      });
  }
  return cataloguePromise;
}

/** One full scenario, or null if the id is malformed or unknown. */
export async function loadAdventure(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  const res = await fetch(`${DATA_DIR}/${id}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Adventure ${id}: HTTP ${res.status}`);
  return res.json();
}

// ── Progress ────────────────────────────────────────────────────────────

export async function getAdventureProgress(uid) {
  const snap = await getDoc(doc(db, 'adventureProgress', uid));
  const data = snap.exists() ? snap.data() : {};
  return { completed: data.completed || {}, prefs: data.prefs || {} };
}

export function isCompleted(progress, adventureId) {
  return !!(progress && progress.completed && progress.completed[adventureId]);
}

/**
 * Records a finished run. Keeps the best score across attempts; returns the
 * updated entry. Writes only this adventure's key (merge), so it can't
 * clobber other completions or prefs.
 */
export async function recordCompletion(uid, adventureId, score, total) {
  const progress = await getAdventureProgress(uid);
  const previous = progress.completed[adventureId] || {};
  const entry = {
    completedAt: serverTimestamp(),
    lastScore: score,
    bestScore: Math.max(score, previous.bestScore || 0),
    total,
    attempts: (previous.attempts || 0) + 1,
  };
  await setDoc(doc(db, 'adventureProgress', uid), { completed: { [adventureId]: entry } }, { merge: true });
  return entry;
}

/** Remembers the library's filters, so the daily pick follows them on any device. */
export async function savePrefs(uid, prefs) {
  const clean = {
    language: prefs.language || null,
    variety: prefs.variety || null,
    difficulty: prefs.difficulty || null,
  };
  await setDoc(doc(db, 'adventureProgress', uid), { prefs: clean }, { merge: true });
}

// ── Daily recommendation ────────────────────────────────────────────────

// FNV-1a: a tiny, stable string hash. Same input → same number on every
// device, which is what makes the daily pick consistent without storing it.
function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function localDayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Narrow the pool by a preference only if something is left — a preference
// should steer the pick, never leave the user with nothing to do.
function narrow(pool, test) {
  const narrowed = pool.filter(test);
  return narrowed.length ? narrowed : pool;
}

/**
 * Today's recommended adventure for this user, or null if the catalogue is
 * empty. Steered by their saved filters, else the languages on their profile
 * (users.languages_learning). Picks among not-yet-completed adventures using
 * hash(uid + local date), so it's the same all day on every device and needs
 * no writes. Once everything matching is done, suggests replaying the one
 * with the lowest best score. Returns { adventure, reason: 'new' | 'replay' }.
 */
export function pickDailyAdventure({ catalogue, progress, uid, profileLanguages = [], date = new Date() }) {
  if (!Array.isArray(catalogue) || catalogue.length === 0) return null;
  const prefs = (progress && progress.prefs) || {};
  const completed = (progress && progress.completed) || {};

  let pool = catalogue;
  const languages = prefs.language ? [prefs.language] : profileLanguages;
  if (languages.length) pool = narrow(pool, (a) => languages.includes(a.language));
  if (prefs.variety) pool = narrow(pool, (a) => a.variety && a.variety.id === prefs.variety);
  if (prefs.difficulty) pool = narrow(pool, (a) => a.difficulty === prefs.difficulty);

  const seed = hashString(`${uid || 'guest'}|${localDayKey(date)}`);
  const fresh = pool.filter((a) => !completed[a.id]);
  if (fresh.length) return { adventure: fresh[seed % fresh.length], reason: 'new' };

  const ratio = (a) => {
    const c = completed[a.id] || {};
    return c.total ? (c.bestScore || 0) / c.total : 0;
  };
  const lowest = Math.min(...pool.map(ratio));
  const candidates = pool.filter((a) => ratio(a) === lowest);
  return { adventure: candidates[seed % candidates.length], reason: 'replay' };
}

// ── Notebook ────────────────────────────────────────────────────────────

function normaliseTerm(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sameLanguage(entry, language) {
  const entryLanguage = entry.language || entry.folder || '';
  return entryLanguage.trim().toLowerCase() === String(language || '').trim().toLowerCase();
}

/**
 * Whether this phrase is already in the user's Notebook (same text, same
 * language — ignoring case and extra spaces). Older entries without a
 * `language` field are matched on their folder, which holds the language
 * for quiz/Adventure saves.
 */
export async function findInNotebook(uid, language, text) {
  const wanted = normaliseTerm(text);
  // Reads the user's own Notebook (the same owner-only query notebook.html
  // uses — no extra index) and compares normalised text, so "Dale" and
  // "dale " count as the same phrase. A Notebook is at most a few hundred
  // small docs, so this stays cheap.
  const snap = await getDocs(query(collection(db, 'notebook'), where('userId', '==', uid)));
  const match = snap.docs.find((d) => {
    const e = d.data();
    return normaliseTerm(e.term) === wanted && sameLanguage(e, language);
  });
  return match ? match.id : null;
}

/**
 * The phrases from this adventure the user has already saved, as a Set of
 * phrase ids — lets the scenario page show "Saved" ticks on load with one
 * read of the user's Notebook.
 */
export async function savedPhraseIds(uid, adventure) {
  const snap = await getDocs(query(collection(db, 'notebook'), where('userId', '==', uid)));
  const saved = new Set();
  snap.forEach((d) => {
    const e = d.data();
    if (!sameLanguage(e, adventure.language)) return;
    const term = normaliseTerm(e.term);
    (adventure.phrases || []).forEach((p) => { if (normaliseTerm(p.text) === term) saved.add(p.id); });
  });
  return saved;
}

/**
 * Saves one of an adventure's phrases to the Notebook, unless it's already
 * there. Returns { status: 'saved' | 'exists', id }.
 */
export async function savePhraseToNotebook(uid, adventure, phrase) {
  const existingId = await findInNotebook(uid, adventure.language, phrase.text);
  if (existingId) return { status: 'exists', id: existingId };

  const variety = adventure.variety || {};
  const example = phrase.example
    ? (phrase.exampleTranslation ? `${phrase.example} (${phrase.exampleTranslation})` : phrase.example)
    : (phrase.note || '');
  const ref = await addDoc(collection(db, 'notebook'), {
    userId: uid,
    term: String(phrase.text).trim(),
    translation: phrase.translation,
    folder: adventure.language,       // the Notebook groups by folder; quiz saves use the language too
    language: adventure.language,
    variety: variety.id || null,
    tags: [variety.label, 'Adventures'].filter(Boolean),
    note: example,
    favorite: false,
    nextReviewAt: serverTimestamp(),  // due straight away, like every other save
    reviewCount: 0,
    source: {
      page: `adventure?id=${adventure.id}`,
      title: adventure.title,
      context: `${adventure.flag || ''} ${adventure.country || ''} · ${variety.label || adventure.language}`.trim(),
      adventureId: adventure.id,
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { status: 'saved', id: ref.id };
}
