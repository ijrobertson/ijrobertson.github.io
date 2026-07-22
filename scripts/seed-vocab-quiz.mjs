// One-off bootstrap script for the vocabulary quiz feature.
// Scrapes the existing .word-pair/.number-chip/.verb-card (Basics pages) and
// .vocab-item (Hotel/Airport/Restaurant pages) markup that's already
// published on the site's per-language lesson pages into Beginner-level
// data/vocab/{language}.json seed files, instead of hand-authoring ~50
// entries per language from scratch.
//
// Run manually, once, from the repo root: `node scripts/seed-vocab-quiz.mjs`.
// Not wired into any build/deploy step (this repo has none) — after running,
// the generated JSON is a normal content file, hand-edited/reviewed like any
// other file in the repo.
//
// Re-running regenerates the "scraped" entries from scratch (stable ids are
// derived from language+source+index), but preserves any hand-authored
// entries already present in the target file (identified by an id that
// doesn't start with "scraped-").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NAMED_ENTITIES = {
  amp: '&', apos: "'", quot: '"', lt: '<', gt: '>',
  nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  bull: '•', copy: '©', larr: '←', iquest: '¿',
  Aacute: 'Á', Agrave: 'À', Aring: 'Å', Auml: 'Ä',
  Ccedil: 'Ç', Eacute: 'É', Ecirc: 'Ê', Egrave: 'È',
  aacute: 'á', agrave: 'à', aring: 'å', atilde: 'ã', auml: 'ä',
  ccedil: 'ç', eacute: 'é', ecirc: 'ê', egrave: 'è',
  iacute: 'í', icirc: 'î', igrave: 'ì',
  ntilde: 'ñ', oacute: 'ó', ocirc: 'ô', ograve: 'ò',
  ouml: 'ö', szlig: 'ß', uacute: 'ú', ucirc: 'û',
  ugrave: 'ù', uuml: 'ü',
};

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&([A-Za-z]+);/g, (m, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : m));
}

function clean(str) {
  // Russian's word-pair term cell nests a transliteration sub-div
  // (e.g. <div class="word-es">Привет<div class="word-translit">Privet</div></div>) —
  // drop it entirely rather than concatenating its text into the term.
  let s = str.replace(/<div class="word-translit">.*?<\/div>/gs, '');
  s = decodeEntities(s).replace(/<[^>]+>/g, '').trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).trim();
  return s;
}

// { language: [ [file, topic tag], ... ] }
const LANGUAGE_FILES = {
  French: 'French', German: 'German', Italian: 'Italian',
  Portuguese: 'Portuguese', Russian: 'Russian', Spanish: 'Spanish', Swedish: 'Swedish',
};
const TOPICS = ['Basics', 'Hotel', 'Airport', 'Restaurant'];

function extractPairs(html, tag, termClass, translationClass) {
  const re = new RegExp(
    `<div class="${tag}">\\s*<div class="${termClass}">(.*?)<\\/div>\\s*<div class="${translationClass}">(.*?)<\\/div>\\s*<\\/div>`,
    'gs'
  );
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push([clean(m[1]), clean(m[2])]);
  return out;
}

function extractVocabItems(html) {
  const re = /<div class="vocab-item">\s*<i[^>]*><\/i>\s*<div><span class="vocab-[a-z]{2}">(.*?)<\/span>\s*&mdash;\s*<span class="vocab-en">(.*?)<\/span><\/div>\s*<\/div>/gs;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push([clean(m[1]), clean(m[2])]);
  return out;
}

function scrapeLanguage(language) {
  const entries = [];
  let index = 0;
  const seenTerms = new Set();

  function add(term, translation, source) {
    if (!term || !translation) return;
    const key = term.toLowerCase();
    if (seenTerms.has(key)) return;
    seenTerms.add(key);
    index += 1;
    entries.push({
      id: `scraped-${language.toLowerCase()}-${String(index).padStart(3, '0')}`,
      level: 'beginner',
      term,
      translation,
      example: null,
      tags: [source],
      audio: null,
    });
  }

  for (const topic of TOPICS) {
    const file = path.join(ROOT, `${language}${topic}.html`);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const sourceTag = topic.toLowerCase();

    if (topic === 'Basics') {
      for (const [term, translation] of extractPairs(html, 'word-pair', 'word-es', 'word-en')) add(term, translation, sourceTag);
      for (const [term, translation] of extractPairs(html, 'number-chip', 'number-es', 'number-en')) add(term, translation, sourceTag);
      // verb-card has an extra <span class="verb-icon">...</span> before the term/translation divs
      const verbRe = /<div class="verb-card"><span class="verb-icon">.*?<\/span><div><div class="verb-es">(.*?)<\/div><div class="verb-en">(.*?)<\/div><\/div><\/div>/gs;
      let vm;
      while ((vm = verbRe.exec(html))) add(clean(vm[1]), clean(vm[2]), sourceTag);
    } else {
      for (const [term, translation] of extractVocabItems(html)) add(term, translation, sourceTag);
    }
  }

  return entries;
}

function loadExisting(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const outDir = path.join(ROOT, 'data', 'vocab');
fs.mkdirSync(outDir, { recursive: true });

const manifest = { languages: {} };

for (const language of Object.keys(LANGUAGE_FILES)) {
  const outFile = path.join(outDir, `${language.toLowerCase()}.json`);
  const existing = loadExisting(outFile);
  const handAuthored = existing ? existing.words.filter(w => !w.id.startsWith('scraped-')) : [];

  const scraped = scrapeLanguage(language);
  const words = [...scraped, ...handAuthored];

  fs.writeFileSync(outFile, JSON.stringify({ language, words }, null, 2) + '\n');

  const levels = {};
  for (const w of words) levels[w.level] = (levels[w.level] || 0) + 1;
  manifest.languages[language] = levels;

  console.log(`${language}: ${scraped.length} scraped + ${handAuthored.length} hand-authored = ${words.length} total`);
}

fs.writeFileSync(
  path.join(outDir, 'index.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

console.log('\nWrote data/vocab/index.json manifest.');
