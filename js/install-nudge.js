/*
  "Add Lingua Bud to your home screen" reminder card (Home / Learn tab).

  Shown only when ALL of these are true:
    - on an iPhone/iPad or Android phone, in a normal browser (not already
      the installed app, not an Instagram/Facebook-style in-app browser);
    - the person has used the app for real: sent a message or finished a
      quiz (messages.html / vocab-quiz.html set localStorage "lb-engaged"),
      or opened Home on 3 different days;
    - they haven't tapped "Not now" in the last 30 days.
  Android with an install prompt available gets a one-tap Install button;
  everyone else gets "Show me how" → the install page (/get-app).

  Needs <div id="installNudgeSlot"></div> on the page; styles live in
  home.html (.install-nudge). Text is plain English; js/i18n.js translates it.
*/
(function () {
  var DISMISS_KEY = 'lb-install-nudge-dismissed';
  var DAYS_KEY = 'lb-home-days';
  var DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (standalone) return;
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|LinkedInApp|Snapchat|TikTok|musical_ly|BytedanceWebview|Pinterest|GSA\//.test(ua);
  if ((!isIOS && !isAndroid) || inApp) return;

  // Count distinct days Home was opened (kept to the last 10).
  var today = new Date().toISOString().slice(0, 10);
  var days = [];
  try { days = JSON.parse(store(DAYS_KEY) || '[]'); } catch (e) { days = []; }
  if (days.indexOf(today) === -1) { days.push(today); days = days.slice(-10); store(DAYS_KEY, JSON.stringify(days)); }

  var engaged = store('lb-engaged') === '1' || days.length >= 3;
  var dismissedAt = Number(store(DISMISS_KEY) || 0);
  if (!engaged || (dismissedAt && Date.now() - dismissedAt < DISMISS_FOR_MS)) return;

  var deferredPrompt = null;
  var card = null;

  function render() {
    var slot = document.getElementById('installNudgeSlot');
    if (!slot || card) return;
    card = document.createElement('div');
    card.className = 'install-nudge';
    card.innerHTML =
      '<button type="button" class="install-nudge-close" aria-label="Not now"><i class="fas fa-times" aria-hidden="true"></i></button>' +
      '<img class="install-nudge-icon" src="icons/icon-192.png" alt="" width="48" height="48">' +
      '<div class="install-nudge-text">' +
        '<h3>Add Lingua Bud to your home screen</h3>' +
        '<p>Get message alerts and open Lingua Bud in one tap.</p>' +
        '<div class="install-nudge-actions">' +
          '<a class="install-nudge-btn" href="get-app">Show me how</a>' +
          '<button type="button" class="install-nudge-later">Not now</button>' +
        '</div>' +
      '</div>';
    slot.appendChild(card);
    card.querySelector('.install-nudge-close').addEventListener('click', dismiss);
    card.querySelector('.install-nudge-later').addEventListener('click', dismiss);
    if (deferredPrompt) useInstallButton();
  }

  function dismiss() {
    store(DISMISS_KEY, String(Date.now()));
    if (card) { card.remove(); card = null; }
  }

  // Android: swap "Show me how" for the browser's own one-tap install.
  function useInstallButton() {
    if (!card) return;
    var old = card.querySelector('.install-nudge-btn');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'install-nudge-btn';
    btn.textContent = 'Install the app';
    btn.addEventListener('click', function () {
      var p = deferredPrompt;
      if (!p) { location.href = 'get-app'; return; }
      deferredPrompt = null;
      p.prompt();
      p.userChoice.then(function (c) { if (c && c.outcome === 'accepted') { if (card) { card.remove(); card = null; } } else { location.href = 'get-app'; } }).catch(function () {});
    });
    old.replaceWith(btn);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    useInstallButton();
  });
  window.addEventListener('appinstalled', function () { if (card) { card.remove(); card = null; } });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
