/**
 * Streak reminders (2026-11-18), Duolingo-style but gentle:
 *  - students only, who turned reminders on (users.dailyReminderEnabled) and
 *    allowed notifications (a push token);
 *  - at most one a day, around 7 pm in the student's own time zone, and only
 *    if they haven't practised yet that day (quiz, Adventure, Culture Guide
 *    lesson, saved word);
 *  - after 7 reminders without practice, the 7th says reminders will stop,
 *    then nothing until they practise again (the count resets then);
 *  - varied, fun wording in the student's interface language (users.uiLang).
 * Tapping opens a quick quiz. index.js runs processStreakReminders hourly.
 */
const REMINDER_HOUR = 19;      // local time
const MAX_REMINDERS = 7;       // per inactive stretch; the last one says goodbye
const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

// {n} = current streak, {m} = the milestone they'd reach today.
const MESSAGES = {
  en: {
    streak: [
      ['🔥 Keep your {n}-day streak!', 'One quick quiz keeps it alive. You’ve got this!'],
      ['Your {n}-day streak is waiting 🔥', 'Two minutes of practice is all it takes today.'],
      ['Don’t let the flame go out! 🔥', 'You’re on a {n}-day streak. A short quiz keeps it going.'],
    ],
    milestone: [
      ['🎉 Day {m} is within reach!', 'Practice today to hit a {m}-day streak.'],
      ['So close to {m} days! 🎉', 'One quick quiz today and your streak reaches {m}.'],
    ],
    restart: [
      ['Ready for a fresh start? 🌱', 'A 2-minute quiz gets you back on track.'],
      ['Your languages miss you 👋', 'Jump back in with a quick quiz today.'],
      ['Little steps add up 🌱', 'Start a new streak with one short quiz.'],
    ],
    final: [['We’ll pause your reminders 💛', 'Your progress is safe. Come back anytime and pick up right where you left off.']],
  },
  es: {
    streak: [
      ['🔥 ¡Mantén tu racha de {n} días!', 'Un quiz rápido la mantiene viva. ¡Tú puedes!'],
      ['Tu racha de {n} días te espera 🔥', 'Solo necesitas dos minutos de práctica hoy.'],
      ['¡No dejes que se apague la llama! 🔥', 'Llevas una racha de {n} días. Un quiz corto la mantiene.'],
    ],
    milestone: [
      ['🎉 ¡El día {m} está a tu alcance!', 'Practica hoy para llegar a una racha de {m} días.'],
      ['¡Ya casi llegas a {m} días! 🎉', 'Un quiz rápido hoy y tu racha llega a {m}.'],
    ],
    restart: [
      ['¿Empezamos de nuevo? 🌱', 'Un quiz de 2 minutos te pone otra vez en marcha.'],
      ['Tus idiomas te extrañan 👋', 'Vuelve hoy con un quiz rápido.'],
      ['Los pasos pequeños suman 🌱', 'Empieza una nueva racha con un quiz corto.'],
    ],
    final: [['Pausamos tus recordatorios 💛', 'Tu progreso está guardado. Vuelve cuando quieras y sigue donde lo dejaste.']],
  },
  pt: {
    streak: [
      ['🔥 Mantenha sua sequência de {n} dias!', 'Um quiz rápido mantém ela viva. Você consegue!'],
      ['Sua sequência de {n} dias está esperando 🔥', 'Só precisa de dois minutos de prática hoje.'],
      ['Não deixe a chama apagar! 🔥', 'Você está em uma sequência de {n} dias. Um quiz curto mantém ela.'],
    ],
    milestone: [
      ['🎉 O dia {m} está ao seu alcance!', 'Pratique hoje para chegar a uma sequência de {m} dias.'],
      ['Falta pouco para {m} dias! 🎉', 'Um quiz rápido hoje e sua sequência chega a {m}.'],
    ],
    restart: [
      ['Vamos recomeçar? 🌱', 'Um quiz de 2 minutos coloca você de volta nos trilhos.'],
      ['Seus idiomas estão com saudade 👋', 'Volte hoje com um quiz rápido.'],
      ['Pequenos passos fazem diferença 🌱', 'Comece uma nova sequência com um quiz curto.'],
    ],
    final: [['Vamos pausar seus lembretes 💛', 'Seu progresso está salvo. Volte quando quiser e continue de onde parou.']],
  },
  fr: {
    streak: [
      ['🔥 Gardez votre série de {n} jours !', 'Un petit quiz suffit pour la garder. Vous pouvez le faire !'],
      ['Votre série de {n} jours vous attend 🔥', 'Deux minutes de pratique aujourd’hui, c’est tout.'],
      ['Ne laissez pas la flamme s’éteindre ! 🔥', 'Vous êtes sur une série de {n} jours. Un petit quiz la prolonge.'],
    ],
    milestone: [
      ['🎉 Le jour {m} est à portée de main !', 'Pratiquez aujourd’hui pour atteindre une série de {m} jours.'],
      ['Plus que quelques pas avant {m} jours ! 🎉', 'Un petit quiz aujourd’hui et votre série atteint {m}.'],
    ],
    restart: [
      ['Envie de repartir ? 🌱', 'Un quiz de 2 minutes pour vous remettre sur les rails.'],
      ['Vos langues vous manquent 👋', 'Revenez aujourd’hui avec un petit quiz.'],
      ['Les petits pas comptent 🌱', 'Commencez une nouvelle série avec un petit quiz.'],
    ],
    final: [['Nous mettons vos rappels en pause 💛', 'Vos progrès sont enregistrés. Revenez quand vous voulez et reprenez là où vous en étiez.']],
  },
  ar: {
    streak: [
      ['🔥 حافظ على سلسلتك! (عدد الأيام: {n})', 'اختبار سريع واحد يكفي للحفاظ عليها. أنت قادر على ذلك!'],
      ['سلسلتك بانتظارك 🔥 (عدد الأيام: {n})', 'دقيقتان من التدريب اليوم تكفيان.'],
      ['لا تدع الشعلة تنطفئ! 🔥', 'عدد أيام سلسلتك الآن: {n}. اختبار قصير يحافظ عليها.'],
    ],
    milestone: [
      ['🎉 اليوم رقم {m} في متناولك!', 'تدرّب اليوم ليصل عدد أيام سلسلتك إلى {m}.'],
      ['اقتربت كثيرًا من اليوم رقم {m}! 🎉', 'اختبار سريع اليوم ويصل عدد أيام سلسلتك إلى {m}.'],
    ],
    restart: [
      ['مستعد لبداية جديدة؟ 🌱', 'اختبار مدته دقيقتان يعيدك إلى المسار.'],
      ['لغاتك تشتاق إليك 👋', 'عد اليوم مع اختبار سريع.'],
      ['الخطوات الصغيرة تصنع الفرق 🌱', 'ابدأ سلسلة جديدة باختبار قصير.'],
    ],
    final: [['سنوقف التذكيرات مؤقتًا 💛', 'تقدمك محفوظ. عد في أي وقت وتابع من حيث توقفت.']],
  },
};

// 'YYYY-MM-DD' for a Date in an IANA time zone (falls back to UTC).
function dayKeyIn(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}
function hourIn(date, timeZone) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date), 10) % 24;
  } catch (e) {
    return date.getUTCHours();
  }
}
// Whole days between two 'YYYY-MM-DD' keys.
function dayDiff(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
function prevDay(key) {
  return new Date(Date.parse(key + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}
const toDate = (v) => (v && v.toDate ? v.toDate() : (v ? new Date(v) : null));

// All days (in the student's time zone) with learning activity.
async function activeDayKeys(db, uid, user, timeZone) {
  const days = new Set(Object.keys(user.activeDays || {}));
  const add = (d) => { if (d && !isNaN(d)) days.add(dayKeyIn(d, timeZone)); };
  const [quizzes, words, adv, culture] = await Promise.all([
    db.collection('quizAttempts').where('userId', '==', uid).get().catch(() => null),
    db.collection('notebook').where('userId', '==', uid).get().catch(() => null),
    db.collection('adventureProgress').doc(uid).get().catch(() => null),
    db.collection('cultureProgress').doc(uid).get().catch(() => null),
  ]);
  quizzes && quizzes.forEach((d) => add(toDate(d.data().completedAt)));
  words && words.forEach((d) => add(toDate(d.data().createdAt)));
  if (adv && adv.exists) Object.values(adv.data().completed || {}).forEach((e) => add(toDate(e && e.completedAt)));
  if (culture && culture.exists) Object.values(culture.data() || {}).forEach((c) => add(toDate(c && c.updatedAt)));
  return days;
}

function pick(list, seed) {
  return list[Math.abs(seed) % list.length];
}

/**
 * Decides what (if anything) to send one student right now. Pure apart from
 * the reads; returns { send: false, reason } or { send: true, title, body, state }.
 */
async function planReminder(db, uid, user, now) {
  if (user.role && user.role !== 'student') return { send: false, reason: 'not_student' };
  const timeZone = user.timezone || 'UTC';
  if (hourIn(now, timeZone) !== REMINDER_HOUR) return { send: false, reason: 'not_reminder_hour' };
  const today = dayKeyIn(now, timeZone);
  const state = user.streakReminder || {};
  if (state.lastSentDay === today) return { send: false, reason: 'already_sent_today' };

  const days = await activeDayKeys(db, uid, user, timeZone);
  if (days.has(today)) return { send: false, reason: 'practised_today' };

  // Last active day (or sign-up day for someone who never practised).
  const past = [...days].filter((k) => k < today).sort();
  const created = toDate(user.createdAt);
  const lastActive = past.length ? past[past.length - 1] : (created ? dayKeyIn(created, timeZone) : null);

  // Reminders sent since that last activity; resets when they practise again.
  const count = state.sinceActive === lastActive ? (state.count || 0) : 0;
  if (count >= MAX_REMINDERS) return { send: false, reason: 'stopped_after_7' };

  // Streak through yesterday.
  let streak = 0;
  for (let k = prevDay(today); days.has(k); k = prevDay(k)) streak++;

  const lang = MESSAGES[user.uiLang] ? user.uiLang : 'en';
  const m = MESSAGES[lang];
  const seed = dayDiff(today, '2026-01-01') + uid.charCodeAt(0);
  let kind, tpl;
  if (count === MAX_REMINDERS - 1) { kind = 'final'; tpl = pick(m.final, seed); }
  else if (streak > 0 && MILESTONES.includes(streak + 1)) { kind = 'milestone'; tpl = pick(m.milestone, seed); }
  else if (streak > 0) { kind = 'streak'; tpl = pick(m.streak, seed); }
  else { kind = 'restart'; tpl = pick(m.restart, seed); }
  const fill = (s) => s.replace(/\{n\}/g, String(streak)).replace(/\{m\}/g, String(streak + 1));

  return {
    send: true, kind, streak, lang,
    title: fill(tpl[0]), body: fill(tpl[1]),
    state: { sinceActive: lastActive, count: count + 1, lastSentDay: today },
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {(uid: string, data: object) => Promise<{sent: boolean}>} sendPush
 * @param {{ now?: Date, dryRun?: boolean }} [opts]
 */
async function processStreakReminders(db, sendPush, { now = new Date(), dryRun = false } = {}) {
  const results = { sent: 0, skipped: 0, failed: 0, details: [] };
  const snap = await db.collection('users').where('dailyReminderEnabled', '==', true).get();
  for (const docSnap of snap.docs) {
    const uid = docSnap.id;
    try {
      const plan = await planReminder(db, uid, docSnap.data(), now);
      if (!plan.send) { results.skipped++; if (plan.reason !== 'not_reminder_hour') results.details.push({ uid, status: plan.reason }); continue; }
      if (dryRun) { results.details.push({ uid, status: 'would_send', kind: plan.kind, title: plan.title }); continue; }
      const push = await sendPush(uid, { title: plan.title, body: plan.body, url: '/vocab-quiz', tag: 'lb-streak-reminder' });
      if (push && push.sent === false) { results.skipped++; results.details.push({ uid, status: 'no_device' }); continue; }
      await docSnap.ref.update({ streakReminder: plan.state });
      results.sent++;
      results.details.push({ uid, status: 'sent', kind: plan.kind, streak: plan.streak, lang: plan.lang });
    } catch (err) {
      results.failed++;
      results.details.push({ uid, status: 'failed', error: err.message });
    }
  }
  return results;
}

module.exports = { processStreakReminders, planReminder, MESSAGES, REMINDER_HOUR, MAX_REMINDERS };
