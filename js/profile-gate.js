/*
  Booking profile gate (2026-11-19).

  New accounts were booking free trials straight away and never showing up;
  almost all of them had no profile photo and no bio. Before a student can
  book a lesson or a free trial, they now need both (the same two fields the
  Settings page already requires on Save: users.avatar_url and
  users.about_me).

  Usage (from a page's booking button handler):
      const ok = await window.lbProfileGate.ensure({
          load: () => <the student's users/{uid} data, or null>,
          returnTo: 'instructor-profile?id=…'   // where Settings sends them back
      });
      if (!ok) return;   // the pop-up is showing; don't open the booking modal

  If the profile can't be read (network error), booking is allowed: a real
  student is never blocked by a hiccup. Plain DOM, no dependencies, so the
  same file works on the website and the app; in the app, js/i18n.js
  translates the English text below automatically.
*/
(function () {
  'use strict';

  var STYLE_ID = 'lb-profile-gate-style';
  var CSS = [
    '.lbpg-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(17,52,72,.55);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .18s ease-out;}',
    '.lbpg-backdrop.open{opacity:1;}',
    '.lbpg-card{background:#fff;color:#113448;width:100%;max-width:400px;border-radius:20px;padding:1.6rem 1.4rem 1.3rem;box-shadow:0 20px 50px -12px rgba(17,52,72,.45);text-align:center;font-family:inherit;transform:translateY(8px);transition:transform .18s ease-out;max-height:calc(100vh - 32px);overflow-y:auto;}',
    '.lbpg-backdrop.open .lbpg-card{transform:none;}',
    '.lbpg-icon{width:56px;height:56px;margin:0 auto .85rem;border-radius:50%;background:rgba(32,188,186,.14);color:#0b6664;display:flex;align-items:center;justify-content:center;font-size:1.5rem;}',
    '.lbpg-card h3{margin:0 0 .5rem;font-size:1.2rem;font-weight:800;color:#113448;line-height:1.3;}',
    '.lbpg-card p{margin:0 0 1rem;font-size:.93rem;line-height:1.5;color:#4a5a63;}',
    '.lbpg-list{list-style:none;margin:0 0 1.25rem;padding:0;text-align:start;}',
    '.lbpg-list li{display:flex;align-items:center;gap:.65rem;padding:.6rem .8rem;margin-bottom:.45rem;border-radius:12px;background:#f3f8f8;font-size:.93rem;font-weight:600;color:#113448;}',
    '.lbpg-list li i{width:20px;text-align:center;flex-shrink:0;}',
    '.lbpg-list li.todo i{color:#0b6664;}',
    '.lbpg-list li.done{color:#7b8a91;font-weight:500;}',
    '.lbpg-list li.done i{color:#20bcba;}',
    '.lbpg-go{display:block;width:100%;padding:.8rem 1rem;border:none;border-radius:999px;background:#0b6664;color:#fff !important;font-size:1rem;font-weight:700;text-decoration:none !important;cursor:pointer;margin:0 0 .5rem;}',
    '.lbpg-go:hover,.lbpg-go:focus{background:#20bcba;}',
    '.lbpg-later{display:block;width:100%;padding:.6rem;border:none;background:none;color:#5f6b72;font-size:.92rem;font-weight:600;cursor:pointer;min-width:0;margin:0;}',
    'html[data-theme="night"] .lbpg-card{background:#1b2a33;color:#e8eef0;}',
    'html[data-theme="night"] .lbpg-card h3{color:#e8eef0;}',
    'html[data-theme="night"] .lbpg-card p{color:#b4c2c8;}',
    'html[data-theme="night"] .lbpg-list li{background:#243742;color:#e8eef0;}',
    'html[data-theme="night"] .lbpg-list li.done{color:#8fa1a9;}',
    'html[data-theme="night"] .lbpg-list li.todo i{color:#4fd1cf;}',
    'html[data-theme="night"] .lbpg-later{color:#b4c2c8;}'
  ].join('\n');

  function hasText(v) { return typeof v === 'string' && v.trim() !== ''; }

  // What's missing from a users/{uid} document: 'photo' and/or 'bio'.
  function missing(profile) {
    var p = profile || {};
    var out = [];
    if (!hasText(p.avatar_url)) out.push('photo');
    if (!hasText(p.about_me)) out.push('bio');
    return out;
  }

  // Settings link that opens the profile fields and comes back afterwards.
  // returnTo must be a page on this site (no "//", no scheme).
  function settingsUrl(returnTo) {
    var url = 'student-dashboard?complete=booking';
    if (typeof returnTo === 'string' && /^[a-z0-9-]+(\?[^#]*)?$/i.test(returnTo)) {
      url += '&return=' + encodeURIComponent(returnTo);
    }
    return url;
  }

  var openEl = null;

  function close() {
    if (!openEl) return;
    var el = openEl;
    openEl = null;
    document.removeEventListener('keydown', onKey, true);
    el.classList.remove('open');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function item(done, icon, label) {
    var li = document.createElement('li');
    li.className = done ? 'done' : 'todo';
    var i = document.createElement('i');
    i.className = 'fas ' + (done ? 'fa-check-circle' : icon);
    i.setAttribute('aria-hidden', 'true');
    var span = document.createElement('span');
    span.textContent = label;
    li.appendChild(i);
    li.appendChild(span);
    return li;
  }

  function show(miss, returnTo) {
    close();
    if (!document.getElementById(STYLE_ID)) {
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    var backdrop = document.createElement('div');
    backdrop.className = 'lbpg-backdrop';
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });

    var card = document.createElement('div');
    card.className = 'lbpg-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'lbpg-title');

    var icon = document.createElement('div');
    icon.className = 'lbpg-icon';
    icon.innerHTML = '<i class="fas fa-user-edit" aria-hidden="true"></i>';

    var h = document.createElement('h3');
    h.id = 'lbpg-title';
    h.textContent = 'Finish your profile to book';

    var p = document.createElement('p');
    p.textContent = 'Instructors like to know who they’re meeting. Before you can book a lesson or a free trial, please add:';

    var list = document.createElement('ul');
    list.className = 'lbpg-list';
    list.appendChild(item(miss.indexOf('photo') === -1, 'fa-camera', 'A profile photo'));
    list.appendChild(item(miss.indexOf('bio') === -1, 'fa-pencil-alt', 'A short bio (About Me)'));

    var go = document.createElement('a');
    go.className = 'lbpg-go';
    go.href = settingsUrl(returnTo);
    go.textContent = 'Complete my profile';

    var later = document.createElement('button');
    later.type = 'button';
    later.className = 'lbpg-later';
    later.textContent = 'Not now';
    later.addEventListener('click', close);

    card.appendChild(icon);
    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(list);
    card.appendChild(go);
    card.appendChild(later);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    openEl = backdrop;
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(function () { backdrop.classList.add('open'); });
    setTimeout(function () { try { go.focus({ preventScroll: true }); } catch (e) {} }, 50);
  }

  // Resolves true when booking may continue, false when the pop-up is shown.
  async function ensure(opts) {
    opts = opts || {};
    var profile;
    try {
      profile = await opts.load();
    } catch (e) {
      console.warn('Profile check skipped (could not read profile):', e);
      return true;
    }
    var miss = missing(profile);
    if (!miss.length) return true;
    show(miss, opts.returnTo);
    return false;
  }

  window.lbProfileGate = { ensure: ensure, missing: missing, show: show, close: close, settingsUrl: settingsUrl };
})();
