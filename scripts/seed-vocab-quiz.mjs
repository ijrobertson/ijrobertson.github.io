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
  let s = decodeEntities(str).replace(/<[^>]+>/g, '').trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).trim();
  return s;
}


// Languages with scrapeable lesson pages (word-pair/vocab-item markup already
// on the site). Arabic/Chinese/Greek have no lesson pages at all — they're
// hand-authored directly in their data/vocab/*.json files (see LANGUAGES
// below for the full list this script's manifest step covers).
const LANGUAGE_FILES = {
  French: 'French', German: 'German', Italian: 'Italian',
  Portuguese: 'Portuguese', Russian: 'Russian', Spanish: 'Spanish', Swedish: 'Swedish',
};
// Every language the manifest (index.json) should report on, scraped or not.
const LANGUAGES = [...Object.keys(LANGUAGE_FILES), 'Arabic', 'Chinese', 'Greek'];
const TOPICS = ['Basics', 'Hotel', 'Airport', 'Restaurant'];

// Russian's term cell carries an optional transliteration sub-div alongside
// the term, in one of two shapes:
//  - "nested": inside the term's own closing tag, e.g. word-pair —
//    <div class="word-es">Привет<div class="word-translit">Privet</div></div>
//  - "sibling": as its own div between the term and translation cells, e.g.
//    verb-card — <div class="verb-es">T</div><div class="verb-translit">X</div><div class="verb-en">...
// translitClass + translitPosition make that middle group explicit in the
// pattern (rather than relying on backtracking to lump it into the term
// capture) so it can be pulled out as its own field.
function extractPairs(html, tag, termClass, translationClass, translitClass, translitPosition) {
  const translitGroup = translitClass ? `(?:<div class="${translitClass}">(.*?)<\\/div>)?` : '';
  const pattern = translitPosition === 'sibling'
    ? `<div class="${tag}">\\s*<div class="${termClass}">(.*?)<\\/div>${translitGroup}\\s*<div class="${translationClass}">(.*?)<\\/div>\\s*<\\/div>`
    : `<div class="${tag}">\\s*<div class="${termClass}">(.*?)${translitGroup}<\\/div>\\s*<div class="${translationClass}">(.*?)<\\/div>\\s*<\\/div>`;
  const re = new RegExp(pattern, 'gs');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    if (translitClass) out.push([clean(m[1]), clean(m[3]), m[2] ? clean(m[2]) : null]);
    else out.push([clean(m[1]), clean(m[2]), null]);
  }
  return out;
}

function extractVocabItems(html) {
  const re = /<div class="vocab-item">\s*<i[^>]*><\/i>\s*<div><span class="vocab-[a-z]{2}">(.*?)<\/span>\s*&mdash;\s*<span class="vocab-en">(.*?)<\/span><\/div>\s*<\/div>/gs;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push([clean(m[1]), clean(m[2]), null]);
  return out;
}

function scrapeLanguage(language) {
  const entries = [];
  let index = 0;
  const seenTerms = new Set();

  function add(term, translation, transliteration, source) {
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
      transliteration: transliteration || null,
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
      for (const [term, translation, translit] of extractPairs(html, 'word-pair', 'word-es', 'word-en', 'word-translit', 'nested')) add(term, translation, translit, sourceTag);
      for (const [term, translation, translit] of extractPairs(html, 'number-chip', 'number-es', 'number-en')) add(term, translation, translit, sourceTag);
      // verb-card has an extra <span class="verb-icon">...</span> before the term/translation divs,
      // and (for Russian) an optional sibling verb-translit div between them.
      const verbRe = /<div class="verb-card"><span class="verb-icon">.*?<\/span><div><div class="verb-es">(.*?)<\/div>(?:<div class="verb-translit">(.*?)<\/div>)?<div class="verb-en">(.*?)<\/div><\/div><\/div>/gs;
      let vm;
      while ((vm = verbRe.exec(html))) add(clean(vm[1]), clean(vm[3]), vm[2] ? clean(vm[2]) : null, sourceTag);
    } else {
      for (const [term, translation, translit] of extractVocabItems(html)) add(term, translation, translit, sourceTag);
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

for (const language of LANGUAGES) {
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
