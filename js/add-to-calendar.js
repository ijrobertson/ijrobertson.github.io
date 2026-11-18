// "Add to calendar" pop-up (2026-11-18).
//
// The booking pages call rememberBooking() right after a lesson or free
// trial is saved, then go to the Bookings page as before; the Bookings page
// calls showPendingCalendarPrompt(), which shows the pop-up once.
//   Google Calendar: opens Google's "new event" page, filled in.
//   Apple Calendar:  an .ics file (iPhone/iPad/Mac open it in Calendar; it
//                    also works with Outlook and most other calendar apps).
// Same file on the website (main) and in the app (PWA branch).

const KEY = 'lb-just-booked';
const MAX_AGE_MS = 10 * 60 * 1000; // ignore anything older (e.g. a stale tab)

export function rememberBooking({ id, start, minutes, instructorName, trial }) {
    try {
        sessionStorage.setItem(KEY, JSON.stringify({
            id: id || String(Date.now()),
            start: new Date(start).toISOString(),
            minutes: minutes || (trial ? 15 : 60),
            instructorName: instructorName || '',
            trial: !!trial,
            at: Date.now(),
        }));
    } catch (_) { /* private mode etc.: no pop-up, booking unaffected */ }
}

function takePending() {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        sessionStorage.removeItem(KEY);
        const b = JSON.parse(raw);
        if (!b || !b.start || Date.now() - (b.at || 0) > MAX_AGE_MS) return null;
        if (isNaN(new Date(b.start).getTime())) return null;
        return b;
    } catch (_) { return null; }
}

const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
const icsText = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function eventDetails(b) {
    const start = new Date(b.start);
    const end = new Date(start.getTime() + b.minutes * 60000);
    const who = b.instructorName || 'your instructor';
    const title = b.trial ? `Free Trial Lesson with ${who}` : `Language Lesson with ${who}`;
    const joinUrl = location.origin + '/bookings';
    const description = (b.trial ? `Free ${b.minutes}-minute trial lesson with ${who} on Lingua Bud.` : `Lingua Bud language lesson with ${who}.`)
        + ` Join from your Bookings page: ${joinUrl}`;
    return { start, end, title, description, joinUrl };
}

export function googleCalendarUrl(b) {
    const e = eventDetails(b);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
        + `&text=${encodeURIComponent(e.title)}`
        + `&dates=${icsDate(e.start)}/${icsDate(e.end)}`
        + `&details=${encodeURIComponent(e.description)}`
        + `&location=${encodeURIComponent(e.joinUrl)}`;
}

export function icsContent(b) {
    const e = eventDetails(b);
    return [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lingua Bud//linguabud.com//EN',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
        `UID:${b.id}@linguabud.com`, `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.end)}`,
        `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(e.description)}`,
        `LOCATION:${icsText(e.joinUrl)}`, `URL:${e.joinUrl}`, 'STATUS:CONFIRMED',
        'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
}

function openIcs(b) {
    const ics = icsContent(b);
    const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isApple) {
        // iOS shows its "Add to Calendar" sheet for a calendar document.
        window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
        return;
    }
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'lingua-bud-lesson.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function injectStyles() {
    if (document.getElementById('lb-cal-style')) return;
    const s = document.createElement('style');
    s.id = 'lb-cal-style';
    s.textContent = `
.lb-cal-backdrop{position:fixed;inset:0;z-index:20000;background:rgba(17,52,72,.55);display:flex;align-items:center;justify-content:center;padding:16px;animation:lbCalFade .2s ease}
.lb-cal{background:#fff;border-radius:18px;max-width:400px;width:100%;padding:28px 22px 20px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.25);font-family:inherit;animation:lbCalUp .25s ease}
.lb-cal-icon{width:58px;height:58px;border-radius:50%;background:#e6f7f7;color:#20bcba;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:28px}
.lb-cal h3{color:#113448;font-size:1.3rem;font-weight:700;margin:0 0 6px}
.lb-cal-when{color:#0b6664;font-weight:600;font-size:.98rem;margin:0 0 4px}
.lb-cal p.lb-cal-sub{color:#555;font-size:.92rem;margin:0 0 18px;line-height:1.5}
.lb-cal-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:48px;border-radius:12px;border:1.5px solid #d9eeee;background:#fff;color:#113448;font-weight:700;font-size:1rem;margin:0 0 10px;cursor:pointer;text-decoration:none;font-family:inherit}
.lb-cal-btn:hover{border-color:#20bcba;color:#113448;text-decoration:none}
.lb-cal-btn svg{width:22px;height:22px;flex:0 0 22px}
.lb-cal-skip{background:none;border:0;color:#666;font-size:.95rem;padding:10px 16px;margin-top:2px;cursor:pointer;font-family:inherit}
@keyframes lbCalFade{from{opacity:0}to{opacity:1}}
@keyframes lbCalUp{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
html[data-theme="night"] .lb-cal,html[data-theme="night"] .lb-cal{background:#1b2a33}
html[data-theme="night"] .lb-cal h3,html[data-theme="night"] .lb-cal h3,html[data-theme="night"] .lb-cal-btn,html[data-theme="night"] .lb-cal-btn{color:#e8f1f4}
html[data-theme="night"] .lb-cal-btn,html[data-theme="night"] .lb-cal-btn{background:#22343f;border-color:#2f4855}
html[data-theme="night"] .lb-cal p.lb-cal-sub,html[data-theme="night"] .lb-cal p.lb-cal-sub{color:#b9c7ce}`;
    document.head.appendChild(s);
}

const GOOGLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#4285F4" stroke-width="2"/><rect x="3" y="4" width="18" height="5" rx="2" fill="#4285F4"/><text x="12" y="18.5" text-anchor="middle" font-size="9" font-weight="700" fill="#34A853" font-family="Arial">31</text></svg>';
const APPLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#113448" stroke-width="2"/><rect x="3" y="4" width="18" height="5" rx="2" fill="#e8483f"/><text x="12" y="18.5" text-anchor="middle" font-size="9" font-weight="700" fill="#113448" font-family="Arial">31</text></svg>';

export function showCalendarPrompt(b) {
    if (!b || document.querySelector('.lb-cal-backdrop')) return;
    injectStyles();
    const when = new Date(b.start).toLocaleString(document.documentElement.lang || undefined, {
        weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const wrap = document.createElement('div');
    wrap.className = 'lb-cal-backdrop';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'lb-cal-title');
    wrap.innerHTML = `
      <div class="lb-cal">
        <div class="lb-cal-icon" aria-hidden="true">&#10003;</div>
        <h3 id="lb-cal-title"></h3>
        <p class="lb-cal-when" translate="no"></p>
        <p class="lb-cal-sub">Add it to your calendar so you don't miss it.</p>
        <a class="lb-cal-btn lb-cal-google" target="_blank" rel="noopener">${GOOGLE_ICON}<span>Google Calendar</span></a>
        <button type="button" class="lb-cal-btn lb-cal-apple">${APPLE_ICON}<span>Apple Calendar</span></button>
        <button type="button" class="lb-cal-skip">Not now</button>
      </div>`;
    wrap.querySelector('#lb-cal-title').textContent = b.trial ? 'Your free trial is booked!' : 'Your lesson is booked!';
    wrap.querySelector('.lb-cal-when').textContent = (b.instructorName ? b.instructorName + ' · ' : '') + when;
    wrap.querySelector('.lb-cal-google').href = googleCalendarUrl(b);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const track = (target) => { try { if (window.gtag) window.gtag('event', 'add_to_calendar', { calendar: target, booking_type: b.trial ? 'free_trial' : 'paid' }); } catch (_) {} };
    wrap.querySelector('.lb-cal-google').addEventListener('click', () => { track('google'); setTimeout(close, 300); });
    wrap.querySelector('.lb-cal-apple').addEventListener('click', () => { track('apple'); openIcs(b); setTimeout(close, 300); });
    wrap.querySelector('.lb-cal-skip').addEventListener('click', () => { track('skip'); close(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
}

export function showPendingCalendarPrompt() {
    const b = takePending();
    if (b) showCalendarPrompt(b);
}
