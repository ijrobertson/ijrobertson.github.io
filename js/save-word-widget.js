/*
  Lingua Bud — "Save word" capture widget for legacy lesson pages and chat.
  Net-new, additive file. See docs/PWA_PRD.md §4.6.

  Turns the ~100 static per-language lesson pages (FrenchBasics.html, etc.)
  AND chat message bubbles on messages.html into a capture point for the
  Learn tab's vocabulary notebook: select (long-press on mobile) any text,
  tap "Save word", add a translation, and it's written to the same
  `notebook` Firestore collection notebook.html reads from. One shared
  mechanism for both — a chat bubble is just more selectable text on the
  page, so no separate long-press implementation was needed.

  Self-contained on purpose — imports Firebase directly and injects its own
  <style> tag, rather than depending on each page's own (slightly varying)
  inline auth script or a shared stylesheet link. That means rolling this
  out to a page is a single added <script type="module"> tag.

  Not signed in? Selecting text still shows the "Save word" pill (it's the
  acquisition/retention hook described in the PRD), but tapping it prompts
  to sign in instead of opening the save form.
*/

import { auth, db, onAuthStateChanged, collection, addDoc, serverTimestamp } from '../lib/firebaseClient.js';

const KNOWN_LANGUAGES = ['French', 'German', 'Italian', 'Portuguese', 'Russian', 'Spanish', 'Swedish', 'English'];

// A handful of legacy story/reference pages don't carry their language in
// the filename the way e.g. FrenchBasics.html does.
const LANGUAGE_BY_FILE = {
  'LesTroisPetitCochons.html': 'French',
  'TortueLievre.html': 'French',
  'french-accent-marks.html': 'French',
  'LosTresCerditosNew.html': 'Spanish',
  'TortugaLiebre.html': 'Spanish',
  'Porcellini.html': 'Italian',
  'OsTresPorquinhos.html': 'Portuguese',
  'TartarugaLebre.html': 'Portuguese',
  'russian-alphabet.html': 'Russian',
};

function detectLanguage() {
  const file = location.pathname.split('/').pop() || '';
  const fileNoExt = file.replace(/\.html?$/i, '');
  return KNOWN_LANGUAGES.find(l => fileNoExt.startsWith(l)) || LANGUAGE_BY_FILE[file] || 'General';
}

// messages.html has no language in its filename, but does show the other
// party's name in its chat header — use that for a friendlier source label
// than just "messages" when the save came from a conversation.
function detectChatContext() {
  const name = document.querySelector('.chat-header-info h3')?.textContent?.trim();
  return name ? `Chat with ${name}` : null;
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .lb-savewd-pill {
      position: fixed; z-index: 2147483000; transform: translate(-50%, -100%);
      background: #0b6664; color: #fff; border-radius: 999px;
      font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex; align-items: stretch;
      box-shadow: 0 8px 20px -6px rgba(11,102,100,0.55);
      animation: lb-savewd-pop 120ms ease-out;
    }
    .lb-savewd-pill-save {
      background: none; border: none; color: inherit; cursor: pointer;
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px 8px 16px; font-size: 13px; font-weight: 700; font-family: inherit;
    }
    .lb-savewd-pill-save:hover { color: #d7f5f4; }
    /* Separate, always-tappable close affordance — re-selecting text on a
       touch device can land back on the pill itself (it sits right above the
       word), which previously left the old pill stuck with no way to dismiss
       it short of navigating away. This gives an explicit escape hatch that
       doesn't depend on tapping "outside" landing correctly. */
    .lb-savewd-pill-close {
      background: none; border: none; border-left: 1px solid rgba(255,255,255,0.35);
      color: inherit; opacity: 0.8; cursor: pointer; font-size: 16px; line-height: 1;
      padding: 8px 14px 8px 10px; font-family: inherit;
    }
    .lb-savewd-pill-close:hover { opacity: 1; }
    @keyframes lb-savewd-pop { from { opacity: 0; transform: translate(-50%, -90%) scale(0.9); } to { opacity: 1; transform: translate(-50%, -100%) scale(1); } }

    .lb-savewd-overlay {
      position: fixed; inset: 0; z-index: 2147483001; background: rgba(17,52,72,0.45);
      display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .lb-savewd-modal {
      background: #fbfbfb; border-radius: 20px; border: 2px solid #e7e9e7; max-width: 360px; width: 100%;
      padding: 1.4rem 1.4rem 1.1rem; box-shadow: 0 20px 48px -16px rgba(17,52,72,0.5);
      font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .lb-savewd-modal h3 { margin: 0 0 0.9rem; font-size: 1.15rem; font-weight: 800; color: #113448; }
    .lb-savewd-modal label { display: block; font-size: 0.8rem; font-weight: 700; color: #113448; margin: 0.7rem 0 0.3rem; }
    .lb-savewd-modal input, .lb-savewd-modal textarea {
      width: 100%; box-sizing: border-box; border: 2px solid #e7e9e7; border-radius: 10px;
      padding: 0.5rem 0.7rem; font-size: 0.92rem; font-family: inherit;
    }
    .lb-savewd-modal input:focus, .lb-savewd-modal textarea:focus { outline: none; border-color: #20bcba; }
    .lb-savewd-actions { display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.1rem; }
    .lb-savewd-btn { border: none; border-radius: 999px; padding: 0.5rem 1.1rem; font-weight: 700; font-size: 0.88rem; cursor: pointer; font-family: inherit; }
    .lb-savewd-btn-cancel { background: #eef1f0; color: #5f6b72; }
    .lb-savewd-btn-save { background: #0b6664; color: #fff; }
    .lb-savewd-btn-save:disabled { opacity: 0.6; cursor: default; }
    .lb-savewd-error { color: #c93636; font-size: 0.82rem; margin-top: 0.5rem; display: none; }

    .lb-savewd-signin-tip {
      position: fixed; z-index: 2147483000; transform: translate(-50%, -100%);
      background: #113448; color: #fff; border-radius: 12px; padding: 10px 14px; font-size: 13px;
      font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      box-shadow: 0 8px 20px -6px rgba(17,52,72,0.55); text-align: center;
    }
    .lb-savewd-signin-tip a { color: #7fe3e0; font-weight: 700; text-decoration: none; }

    .lb-savewd-toast {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
      background: #113448; color: #fff; padding: 10px 18px; border-radius: 999px; font-size: 13px; font-weight: 700;
      font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      z-index: 2147483002; box-shadow: 0 8px 20px -6px rgba(17,52,72,0.5);
      opacity: 0; transition: opacity 200ms ease;
    }
    .lb-savewd-toast.show { opacity: 1; }
  `;
  document.head.appendChild(style);
}

function withinExcludedRegion(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!el?.closest('nav, header, input, textarea, select, .navbar, #wordModal, .lb-savewd-modal');
}

function removeExisting(selector) {
  document.querySelectorAll(selector).forEach(el => el.remove());
}

function showSignInTip(rect) {
  removeExisting('.lb-savewd-signin-tip');
  const tip = document.createElement('div');
  tip.className = 'lb-savewd-signin-tip';
  tip.style.left = `${rect.left + rect.width / 2}px`;
  tip.style.top = `${Math.max(rect.top - 10, 48)}px`;
  const text = document.createElement('span');
  text.textContent = 'Sign in to save words — ';
  const link = document.createElement('a');
  link.href = 'login';
  link.textContent = 'Sign in';
  tip.appendChild(text);
  tip.appendChild(link);
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 4000);
}

function showToast(message) {
  removeExisting('.lb-savewd-toast');
  const toast = document.createElement('div');
  toast.className = 'lb-savewd-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}

function openSaveModal(term) {
  removeExisting('.lb-savewd-overlay');

  const overlay = document.createElement('div');
  overlay.className = 'lb-savewd-overlay';

  const modal = document.createElement('div');
  modal.className = 'lb-savewd-modal';

  const heading = document.createElement('h3');
  heading.textContent = 'Save to Notebook';
  modal.appendChild(heading);

  function field(labelText, inputEl) {
    const label = document.createElement('label');
    label.textContent = labelText;
    modal.appendChild(label);
    modal.appendChild(inputEl);
    return inputEl;
  }

  const termInput = document.createElement('input');
  termInput.type = 'text';
  termInput.value = term;
  termInput.maxLength = 200;
  field('Word or phrase', termInput);

  const translationInput = document.createElement('input');
  translationInput.type = 'text';
  translationInput.placeholder = 'Translation';
  translationInput.maxLength = 200;
  field('Translation', translationInput);

  const folderInput = document.createElement('input');
  folderInput.type = 'text';
  folderInput.value = detectLanguage();
  folderInput.maxLength = 60;
  field('Folder', folderInput);

  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.placeholder = 'comma separated, e.g. food, travel';
  tagsInput.maxLength = 200;
  field('Tags', tagsInput);

  const errorEl = document.createElement('div');
  errorEl.className = 'lb-savewd-error';
  modal.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.className = 'lb-savewd-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'lb-savewd-btn lb-savewd-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'lb-savewd-btn lb-savewd-btn-save';
  saveBtn.textContent = 'Save';
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  translationInput.focus();

  function close() { overlay.remove(); }
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  saveBtn.addEventListener('click', async () => {
    const termVal = termInput.value.trim();
    const translationVal = translationInput.value.trim();
    if (!termVal || !translationVal) {
      errorEl.textContent = 'Please fill in both the word and its translation.';
      errorEl.style.display = 'block';
      return;
    }
    const tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
    saveBtn.disabled = true;
    try {
      await addDoc(collection(db, 'notebook'), {
        userId: auth.currentUser.uid,
        term: termVal,
        translation: translationVal,
        folder: folderInput.value.trim() || 'General',
        tags,
        note: '',
        favorite: false,
        nextReviewAt: serverTimestamp(), // due immediately — see notebook.html's review flow
        reviewCount: 0,
        source: { page: location.pathname.split('/').pop() || '', title: document.title, context: detectChatContext() },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      close();
      showToast('Saved to your notebook!');
    } catch (e) {
      console.error('Save word error:', e);
      errorEl.textContent = 'Something went wrong saving this word. Please try again.';
      errorEl.style.display = 'block';
      saveBtn.disabled = false;
    }
  });
}

function showPill(rect, term) {
  removeExisting('.lb-savewd-pill');
  const pill = document.createElement('div');
  pill.className = 'lb-savewd-pill';
  pill.style.left = `${rect.left + rect.width / 2}px`;
  pill.style.top = `${Math.max(rect.top - 10, 48)}px`;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'lb-savewd-pill-save';
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '+';
  const label = document.createElement('span');
  label.textContent = 'Save word';
  saveBtn.appendChild(icon);
  saveBtn.appendChild(label);

  // Explicit dismiss button — see the CSS comment above for why relying on
  // "tap outside" alone wasn't reliable enough to clear a stale pill.
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'lb-savewd-pill-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '×';

  pill.appendChild(saveBtn);
  pill.appendChild(closeBtn);

  pill.addEventListener('mousedown', (e) => e.preventDefault()); // don't clear the selection
  saveBtn.addEventListener('click', () => {
    removeExisting('.lb-savewd-pill');
    if (auth.currentUser) {
      openSaveModal(term);
    } else {
      showSignInTip(rect);
    }
  });
  closeBtn.addEventListener('click', () => {
    removeExisting('.lb-savewd-pill');
    window.getSelection()?.removeAllRanges();
  });
  document.body.appendChild(pill);
}

function handleSelectionEnd(e) {
  // A tap on the pill itself is a real mouseup/touchend too (its mousedown only
  // preserves the selection, it doesn't stop propagation) — without this guard,
  // that event re-runs this handler while the old selection is still live,
  // which swaps in a brand-new pill mid-click and swallows the tap.
  if (e && e.target && e.target.closest && e.target.closest('.lb-savewd-pill, .lb-savewd-overlay, .lb-savewd-signin-tip')) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) { removeExisting('.lb-savewd-pill'); return; }

  const text = selection.toString().trim();
  if (!text || text.length > 80 || withinExcludedRegion(selection.anchorNode)) {
    removeExisting('.lb-savewd-pill');
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return;
  showPill(rect, text);
}

function init() {
  injectStyles();
  document.addEventListener('mouseup', handleSelectionEnd);
  document.addEventListener('touchend', handleSelectionEnd);
  document.addEventListener('scroll', () => removeExisting('.lb-savewd-pill'), { passive: true });
  // touchstart alongside mousedown: on touch devices a tap elsewhere doesn't
  // reliably synthesize a mousedown while a selection is active, which used
  // to leave a stale pill from a previous (incomplete) selection with no way
  // to dismiss it by tapping away.
  const dismissIfOutside = (e) => {
    if (!e.target.closest('.lb-savewd-pill')) removeExisting('.lb-savewd-pill');
  };
  document.addEventListener('mousedown', dismissIfOutside);
  document.addEventListener('touchstart', dismissIfOutside, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

onAuthStateChanged(auth, () => {}); // keep auth.currentUser fresh for click handlers above
