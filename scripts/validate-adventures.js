#!/usr/bin/env node
// Checks data/adventures/ against the format in data/adventures/README.md.
// Run before publishing new or edited scenarios:  node scripts/validate-adventures.js
// Exits non-zero (and lists every problem) if anything is wrong.

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data', 'adventures');
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const SKILLS = ['respond', 'meaning', 'culture'];
const STEP_TYPES = ['scene', 'line', 'choice'];
const CATALOGUE_FIELDS = ['id', 'title', 'language', 'country', 'countryCode', 'flag', 'variety', 'difficulty', 'estMinutes'];

const problems = [];
const problem = (where, msg) => problems.push(`${where}: ${msg}`);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    problem(file, `can't be read as JSON — ${e.message}`);
    return null;
  }
}

const index = readJson('index.json');
const entries = (index && Array.isArray(index.adventures)) ? index.adventures : [];
if (index && !Array.isArray(index.adventures)) problem('index.json', '"adventures" must be a list');

const seenIds = new Set();
for (const entry of entries) {
  const where = `index.json → ${entry.id || '(no id)'}`;
  for (const f of CATALOGUE_FIELDS) if (entry[f] == null || entry[f] === '') problem(where, `missing "${f}"`);
  if (seenIds.has(entry.id)) problem(where, 'duplicate id');
  seenIds.add(entry.id);
  if (entry.difficulty && !DIFFICULTIES.includes(entry.difficulty)) problem(where, `difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (entry.variety && (!isText(entry.variety.id) || !isText(entry.variety.label))) problem(where, 'variety needs an "id" and a "label"');
  if (entry.countryCode && !/^[A-Z]{2}$/.test(entry.countryCode)) problem(where, 'countryCode must be a 2-letter uppercase code');

  const file = `${entry.id}.json`;
  if (!fs.existsSync(path.join(dir, file))) { problem(where, `no scenario file ${file}`); continue; }
  const s = readJson(file);
  if (!s) continue;

  // The scenario must agree with its catalogue entry.
  for (const f of CATALOGUE_FIELDS) {
    if (JSON.stringify(s[f]) !== JSON.stringify(entry[f])) problem(file, `"${f}" differs from index.json`);
  }
  for (const f of ['setting', 'varietyNote']) if (!isText(s[f])) problem(file, `missing "${f}"`);
  if (!Array.isArray(s.objectives) || s.objectives.length === 0) problem(file, 'needs at least one objective');
  if (!Array.isArray(s.cultureNotes) || s.cultureNotes.length === 0) problem(file, 'needs at least one culture note');

  const phraseIds = new Set();
  (s.phrases || []).forEach((p, i) => {
    const pw = `${file} → phrases[${i}]`;
    if (!isText(p.id)) problem(pw, 'missing "id"');
    else if (phraseIds.has(p.id)) problem(pw, `duplicate phrase id "${p.id}"`);
    phraseIds.add(p.id);
    if (!isText(p.text)) problem(pw, 'missing "text"');
    if (!isText(p.translation)) problem(pw, 'missing "translation"');
    (p.alsoHeard || []).forEach((a, j) => {
      if (!isText(a.text) || !isText(a.where)) problem(pw, `alsoHeard[${j}] needs "text" and "where"`);
    });
  });
  if (phraseIds.size === 0) problem(file, 'needs at least one phrase');

  let choices = 0;
  (s.steps || []).forEach((st, i) => {
    const sw = `${file} → steps[${i}]`;
    if (!STEP_TYPES.includes(st.type)) { problem(sw, `type must be one of ${STEP_TYPES.join(', ')}`); return; }
    if (st.type === 'scene' && !isText(st.text)) problem(sw, 'scene needs "text"');
    if (st.type === 'line') {
      if (!isText(st.speaker) || !isText(st.text)) problem(sw, 'line needs "speaker" and "text"');
      if (!isText(st.translation)) problem(sw, 'line needs a "translation"');
      // The learner's own lines come from their answers to "respond"
      // questions (shown as their bubble); a "You" line would render as if
      // someone else said it. Use a scene step for things the learner says.
      if (/^(you|me)$/i.test(String(st.speaker).trim())) problem(sw, 'a line can\'t be spoken by "You" — use a scene step instead');
    }
    if (st.type === 'choice') {
      choices++;
      if (!isText(st.prompt)) problem(sw, 'choice needs a "prompt"');
      if (!SKILLS.includes(st.skill)) problem(sw, `skill must be one of ${SKILLS.join(', ')}`);
      const opts = st.options || [];
      if (opts.length < 2) problem(sw, 'needs at least 2 options');
      const correct = opts.filter(o => o.correct === true).length;
      if (correct !== 1) problem(sw, `needs exactly one correct option (has ${correct})`);
      opts.forEach((o, j) => {
        if (!isText(o.text)) problem(sw, `options[${j}] missing "text"`);
        if (!isText(o.why)) problem(sw, `options[${j}] missing "why" — every option needs an explanation`);
      });
      (st.phraseIds || []).forEach(id => { if (!phraseIds.has(id)) problem(sw, `phraseIds refers to unknown phrase "${id}"`); });
    }
  });
  if (choices === 0) problem(file, 'needs at least one choice step');

  // Optional Spanish/Portuguese explanations (see README "Translations").
  const OWN = { Spanish: 'es', Portuguese: 'pt' }[s.language];
  for (const [lang, o] of Object.entries(s.i18n || {})) {
    const iw = `${file} → i18n.${lang}`;
    if (!['es', 'pt'].includes(lang)) { problem(iw, 'language must be "es" or "pt"'); continue; }
    if (lang === OWN) problem(iw, `a ${s.language} scenario shouldn't be explained in ${s.language}`);
    for (const f of ['title', 'summary', 'setting', 'varietyNote']) if (!isText(o[f])) problem(iw, `missing "${f}"`);
    if (!Array.isArray(o.objectives) || o.objectives.length !== (s.objectives || []).length) problem(iw, 'objectives must match the English list item for item');
    if (!Array.isArray(o.cultureNotes) || o.cultureNotes.length !== (s.cultureNotes || []).length) problem(iw, 'cultureNotes must match the English list item for item');
    for (const p of s.phrases || []) {
      const po = (o.phrases || {})[p.id];
      if (!po) { problem(iw, `missing phrase "${p.id}"`); continue; }
      if (!isText(po.translation)) problem(iw, `phrase "${p.id}" needs a "translation"`);
      if (p.exampleTranslation && !isText(po.exampleTranslation)) problem(iw, `phrase "${p.id}" needs an "exampleTranslation"`);
      if (p.note && !isText(po.note)) problem(iw, `phrase "${p.id}" needs a "note"`);
      if ((p.alsoHeard || []).length !== (po.alsoHeard || []).length) problem(iw, `phrase "${p.id}" alsoHeard must match item for item`);
    }
    for (const id of Object.keys(o.phrases || {})) if (!phraseIds.has(id)) problem(iw, `unknown phrase "${id}"`);
    const steps = s.steps || [];
    if (!Array.isArray(o.steps) || o.steps.length !== steps.length) { problem(iw, `steps must match the English steps one for one (${steps.length})`); continue; }
    steps.forEach((st, i) => {
      const so = o.steps[i] || {};
      const sw = `${iw} → steps[${i}]`;
      if (st.type === 'scene' && !isText(so.text)) problem(sw, 'scene needs "text"');
      if (st.type === 'line' && !isText(so.translation)) problem(sw, 'line needs "translation"');
      if (st.type === 'choice') {
        if (!isText(so.prompt)) problem(sw, 'choice needs "prompt"');
        const opts = so.options || [];
        if (opts.length !== (st.options || []).length) { problem(sw, 'options must match the English options one for one'); return; }
        opts.forEach((oo, j) => {
          if (!isText(oo.why)) problem(sw, `options[${j}] needs "why"`);
          if (st.skill !== 'respond' && !isText(oo.text)) problem(sw, `options[${j}] needs "text" (a ${st.skill} question's options are explanations)`);
          if (st.skill === 'respond' && oo.text) problem(sw, `options[${j}] must not translate "text" — respond options are what the learner says`);
        });
      }
    });
    const ie = (entry.i18n || {})[lang];
    if (!ie || ie.title !== o.title || ie.summary !== o.summary) problem(`index.json → ${entry.id}`, `i18n.${lang} title/summary must match the scenario file`);
  }
}

// Scenario files with no catalogue entry would never be shown.
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.json') && f !== 'index.json' && !seenIds.has(f.replace(/\.json$/, ''))) {
    problem(f, 'not listed in index.json');
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in data/adventures:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ ${entries.length} adventure(s) OK`);
