// Mock "AI" Travel Journey planner. Deterministic and rule-based — no real
// model call — operating over the same Learning Modules library Culture
// Guides already uses (data/culture/{countryId}.json). Swapping this for a
// real AI service later only means replacing generateJourney()'s body; the
// itinerary shape it returns is what travel-journey.html renders.

// Maps a user-selected interest to the closest module `category` this
// prototype's content actually has. A couple of interests (museums,
// nightlife, nature) don't have a dedicated category yet, so they fall back
// to the nearest existing bucket rather than silently doing nothing.
const INTEREST_CATEGORY_MAP = {
  food: 'food',
  culture: 'culture',
  shopping: 'shopping',
  museums: 'culture',
  nightlife: 'food',
  nature: 'transportation',
};

const PURPOSE_CATEGORY_BOOST = {
  business: { greetings: 2, language: 1, shopping: -1 },
  vacation: { food: 1, culture: 1, shopping: 1 },
  study: { language: 2, culture: 1 },
  family: { greetings: 1, food: 1 },
  moving: { safety: 2, transportation: 1, language: 1 },
};

export const DEFAULT_CHECKLIST_ITEMS = [
  'Download an offline map of your destination',
  'Save your emergency phrases and local emergency number',
  'Check your power adapter / plug type',
  'Let your bank know you\'re traveling',
  'Save a few key phrases as photos or notes for offline access',
];

/**
 * guideData: the parsed data/culture/{countryId}.json module library.
 * options: { days, interests: string[], purpose: string, level: string }
 * Returns an itinerary { countryId, countryName, flag, beforeYouLeave: [moduleId], days: [{dayNumber, type, moduleId?}] }
 */
export function generateJourney(guideData, { days, interests = [], purpose = '' }) {
  const modules = guideData.lessons || [];
  const beforeYouLeave = modules.filter(m => m.beforeYouLeave);
  const mainPool = modules.filter(m => !m.beforeYouLeave);

  const interestCategories = new Set(interests.map(i => INTEREST_CATEGORY_MAP[i] || i));
  const purposeBoost = PURPOSE_CATEGORY_BOOST[purpose] || {};

  const scored = mainPool.map((module, order) => ({
    module,
    order,
    score: (interestCategories.has(module.category) ? 2 : 0) + (purposeBoost[module.category] || 0),
  }));
  // Stable by original module order within equal scores, so a neutral
  // request (no matching interests/purpose) reproduces the guide's natural
  // curriculum order.
  scored.sort((a, b) => (b.score - a.score) || (a.order - b.order));

  const mainDaysCount = Math.max(1, days - 2); // last 2 days reserved for instructor practice + final checklist
  const selected = scored.slice(0, Math.min(mainDaysCount, scored.length)).map(s => s.module);

  const itineraryDays = selected.map((m, i) => ({ dayNumber: i + 1, type: 'module', moduleId: m.id }));
  itineraryDays.push({ dayNumber: itineraryDays.length + 1, type: 'instructor' });
  itineraryDays.push({ dayNumber: itineraryDays.length + 1, type: 'checklist' });

  return {
    countryId: guideData.id,
    countryName: guideData.name,
    flag: guideData.flag,
    beforeYouLeave: beforeYouLeave.map(m => m.id),
    days: itineraryDays,
  };
}
