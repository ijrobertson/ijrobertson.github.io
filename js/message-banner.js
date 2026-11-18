// New-message banner for the website (2026-11-18) — same look as the app's
// in-app alert (app: js/push-notifications.js showMessageBanner).
//
// The website has no push notifications, so this watches the signed-in
// person's conversations instead: when someone else's message raises your
// unread count, a card slides down from the top with their photo, name, a
// two-line preview and "now". Tap opens the chat; swipe up or wait 5 s to
// dismiss. Nothing shows on page load (only for messages that arrive while
// the page is open), and on the Messages page nothing shows for the chat
// that is already open there (window.__lbActiveConversationId).
//
// Loaded with <script type="module" src="js/message-banner.js"> on every
// page that has the Messages link.

import { auth, db, onAuthStateChanged, collection, query, where, onSnapshot, doc, getDoc } from '../lib/firebaseClient.js';

const BANNER_CSS = `
.lb-banner{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:3000;width:min(420px,calc(100vw - 24px));
  transform:translate(-50%,-140%);transition:transform 320ms cubic-bezier(.2,.9,.25,1),opacity 220ms ease;opacity:0;
  display:flex;align-items:center;gap:12px;padding:12px 14px;box-sizing:border-box;cursor:pointer;
  background:rgba(255,255,255,0.96);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);
  border:1px solid rgba(17,52,72,0.08);border-radius:18px;box-shadow:0 12px 32px -10px rgba(17,52,72,0.35),0 2px 6px rgba(17,52,72,0.08);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#113448;touch-action:none;user-select:none;-webkit-user-select:none;text-align:left}
.lb-banner.show{transform:translate(-50%,0);opacity:1}
.lb-banner-avatar{width:42px;height:42px;border-radius:50%;flex:0 0 42px;background:#e6f7f7;color:#0b6664;
  display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;overflow:hidden}
.lb-banner-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.lb-banner-main{flex:1;min-width:0}
.lb-banner-top{display:flex;align-items:baseline;gap:8px}
.lb-banner-title{flex:1;min-width:0;font-weight:700;font-size:15px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-banner-time{flex:0 0 auto;font-size:12px;color:#7a8a93}
.lb-banner-body{margin-top:2px;font-size:14px;line-height:1.35;color:#41545f;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
`;

export function showMessageBanner({ name, body, avatarUrl, href }) {
    if (!document.getElementById('lb-banner-style')) {
        const st = document.createElement('style');
        st.id = 'lb-banner-style';
        st.textContent = BANNER_CSS;
        document.head.appendChild(st);
    }
    document.querySelectorAll('.lb-banner').forEach((el) => el.remove());

    const banner = document.createElement('div');
    banner.className = 'lb-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <div class="lb-banner-avatar" aria-hidden="true"></div>
      <div class="lb-banner-main">
        <div class="lb-banner-top"><div class="lb-banner-title" translate="no"></div><div class="lb-banner-time">now</div></div>
        <div class="lb-banner-body" translate="no"></div>
      </div>`;
    const avatarEl = banner.querySelector('.lb-banner-avatar');
    banner.querySelector('.lb-banner-title').textContent = name || 'New message';
    const bodyEl = banner.querySelector('.lb-banner-body');
    if (body) bodyEl.textContent = body; else bodyEl.remove();
    avatarEl.textContent = ((name || '?').trim()[0] || '?').toUpperCase();
    if (avatarUrl) {
        const img = new Image();
        img.alt = '';
        img.onload = () => { avatarEl.textContent = ''; avatarEl.appendChild(img); };
        img.src = avatarUrl;
    }

    let timer = null;
    const dismiss = () => {
        clearTimeout(timer);
        banner.classList.remove('show');
        banner.style.transform = '';
        setTimeout(() => banner.remove(), 340);
    };
    let startY = null, dy = 0, moved = false;
    banner.addEventListener('pointerdown', (e) => {
        startY = e.clientY; dy = 0; moved = false;
        clearTimeout(timer);
        banner.style.transition = 'none';
        try { banner.setPointerCapture(e.pointerId); } catch (_) {}
    });
    banner.addEventListener('pointermove', (e) => {
        if (startY === null) return;
        dy = Math.min(0, e.clientY - startY);
        if (Math.abs(e.clientY - startY) > 6) moved = true;
        banner.style.transform = `translate(-50%, ${dy}px)`;
    });
    banner.addEventListener('pointerup', () => {
        if (startY === null) return;
        startY = null;
        banner.style.transition = '';
        if (dy < -30) { dismiss(); return; }
        banner.style.transform = '';
        if (!moved) { dismiss(); if (href) window.location.href = href; return; }
        timer = setTimeout(dismiss, 5000);
    });
    banner.addEventListener('pointercancel', () => {
        startY = null; banner.style.transition = ''; banner.style.transform = '';
        timer = setTimeout(dismiss, 5000);
    });

    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('show')));
    timer = setTimeout(dismiss, 5000);
}

async function senderInfo(conv, otherId) {
    const known = (conv.participantDetails && conv.participantDetails[otherId]) || {};
    let name = known.name || '';
    let avatarUrl = known.avatar_url || '';
    try {
        const [i, u] = await Promise.all([
            getDoc(doc(db, 'publicInstructors', otherId)).catch(() => null),
            getDoc(doc(db, 'publicUsers', otherId)).catch(() => null),
        ]);
        const d = (i && i.exists() && i.data()) || (u && u.exists() && u.data()) || {};
        name = d.name || name;
        avatarUrl = d.avatar_url || avatarUrl;
    } catch (_) { /* keep what the conversation knows */ }
    return { name: name || 'New message', avatarUrl };
}

let unsubscribe = null;
onAuthStateChanged(auth, (user) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!user) return;
    const uid = user.uid;
    const lastUnread = new Map(); // conversationId -> my unread count
    let primed = false;
    unsubscribe = onSnapshot(
        query(collection(db, 'conversations'), where('participants', 'array-contains', uid)),
        (snap) => {
            if (!primed) {
                snap.forEach((d) => lastUnread.set(d.id, (d.data().unreadCount || {})[uid] || 0));
                primed = true;
                return;
            }
            snap.docChanges().forEach(async (ch) => {
                if (ch.type === 'removed') { lastUnread.delete(ch.doc.id); return; }
                const conv = ch.doc.data();
                const now = (conv.unreadCount || {})[uid] || 0;
                const before = lastUnread.has(ch.doc.id) ? lastUnread.get(ch.doc.id) : 0;
                lastUnread.set(ch.doc.id, now);
                if (now <= before) return;
                if (window.__lbActiveConversationId === ch.doc.id) return; // already on screen
                const otherId = (conv.participants || []).find((id) => id !== uid);
                if (!otherId) return;
                const who = await senderInfo(conv, otherId);
                showMessageBanner({
                    name: who.name,
                    avatarUrl: who.avatarUrl,
                    body: conv.lastMessage || '',
                    href: 'messages?with=' + encodeURIComponent(otherId),
                });
            });
        },
        () => { /* signed out or offline: no banner */ }
    );
});
