# Lingua Bud Adventures — content format

Adventures are short, realistic scenarios set in a real place. Like Culture
Guides (`data/culture/`), they are plain JSON: adding or editing a scenario
never requires touching page code.

- `index.json` — the catalogue. One small entry per scenario, used by the
  library page for filtering, completion ticks and the daily recommendation.
- `{id}.json` — the full scenario, loaded only when someone opens it.

The `id` must match in both places and be unique. Convention:
`{language code}-{country code}-{short-slug}`, e.g. `es-mx-market-cdmx`.

## Catalogue entry (`index.json`)

| Field | Notes |
|---|---|
| `id` | Matches the scenario file name (without `.json`). |
| `title` | Short, specific: what you do and where. |
| `language` | Must match the language names used elsewhere in Lingua Bud ("Spanish", "French", …) so profile preferences and the Notebook line up. |
| `country`, `countryCode`, `flag` | Where the scenario takes place (ISO 3166 code). |
| `variety` | `{ id, label }` — the regional variety used, e.g. `{ "id": "es-MX", "label": "Mexican Spanish" }`. |
| `difficulty` | `beginner`, `intermediate` or `advanced`. |
| `estMinutes` | Rough time to complete. |
| `summary` | One sentence for the library card. |
| `tags` | Free-form topics (food, shopping, social…). |

## Scenario file (`{id}.json`)

Repeats the catalogue fields, plus:

| Field | Notes |
|---|---|
| `setting` | 1–3 sentences setting the scene. |
| `objectives` | What the learner will be able to do (3–4 short items). |
| `varietyNote` | Where/how this variety is spoken. **Never imply a country has only one way of speaking** — say "common in…", "you'll also hear…". |
| `phrases` | The target phrases (see below). |
| `cultureNotes` | Short, practical cultural points. |
| `steps` | The interactive scenario, in order (see below). |
| `related` | Optional links, e.g. `{ "cultureGuide": "mexico", "cultureLesson": "shopping" }`. |

### Phrases

```json
{
  "id": "price-per-kilo",
  "text": "¿A cómo el kilo?",
  "translation": "How much per kilo?",
  "example": "¿A cómo el kilo de mango?",
  "exampleTranslation": "How much is a kilo of mangoes?",
  "note": "Optional usage note.",
  "alsoHeard": [{ "text": "¿Cuánto cuesta el kilo?", "where": "Understood everywhere" }]
}
```

`id` is unique within the scenario. These are what learners save to their
Notebook (text → term, translation → translation, example → note, variety
label → tag, scenario → source).

### Steps

Three step types:

- `scene` — narration: `{ "type": "scene", "text": "…" }`
- `line` — someone speaks: `{ "type": "line", "speaker": "Waiter", "text": "…", "translation": "…" }`
- `choice` — a question with instant feedback:

```json
{
  "type": "choice",
  "skill": "respond",
  "prompt": "The waiter asks what you'd like. How do you order?",
  "options": [
    { "text": "…", "correct": true, "why": "Why this works." },
    { "text": "…", "why": "Why this one is off — explain the mistake, kindly." }
  ],
  "phraseIds": ["order-coffee"]
}
```

- Exactly one option has `"correct": true`. **Every option needs a `why`** —
  wrong answers explain *that specific* mistake, not just the right answer.
- `skill` is `respond` (what would you say), `meaning` (what does it mean)
  or `culture` (what's the right thing to do).
- `phraseIds` (optional) — phrases this question practises; missed ones are
  offered for saving on the completion screen.
- Option order is shuffled when shown, so the correct one can be listed first.

## Before publishing a scenario

Have a native speaker of that variety check the phrases, translations and
cultural notes. Slang and regional phrasing are easy to get subtly wrong.
