/*
  Lingua Bud — Site Service Worker (Phase 2, promoted from the /docs/ sandbox)
  See docs/PWA_PRD.md §12. Registered only from home.html, notebook.html,
  vocab-quiz.html, bookings.html, dashboard.html, student-dashboard.html,
  messages.html, instructors.html, instructor-profile.html, connect.html,
  friends.html, learner-profile.html for now — other pages get no
  <link rel=manifest> or registration script, so they can't trigger an install.

  Once this SW is active (scope "/"), it intercepts navigation to every page
  on the site, including ones that never registered it. The rules below are
  deliberately conservative so that's safe:

  1. Same-origin only. Every route below checks `url.origin === self.location.origin`
     before doing anything, so requests to Firebase/Firestore/Stripe/Agora/Google
     Fonts/GTM (all cross-origin) are never touched — they hit the network exactly
     as if this service worker didn't exist.
  2. Only GET requests are ever handled (Workbox's default; bookings/payments are
     POST-style callable functions to a different origin anyway, so this is a
     second, redundant safety net, not the only one).
  3. Nothing HTML is precache/cache-first anymore (see CACHE_VERSION history below
     for why) — every page, precached-install-target or not, goes through
     stale-while-revalidate on navigation: loads from the network like normal,
     quietly caches a copy, and self-heals to the latest version within one extra
     reload after any edit. No manual step required, unlike the old scheme.

  History: this used to precache the app-shell HTML pages cache-first, keyed on
  a manually-bumped CACHE_VERSION string — but that requires remembering to bump
  it on every edit to any of those pages, which failed twice in one week (2026-07-10)
  and left returning users on stale, sometimes badly-out-of-date versions with no
  way to self-correct. Precache is now reserved for icons/manifest.json only —
  install-critical, effectively-static assets where cache-first's offline-before-
  first-visit guarantee is worth keeping and the "remember to bump" risk is low
  because they almost never change.
*/

importScripts("https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-sw.js");

const CACHE_VERSION = "v6";
const SAME_ORIGIN = ({ url }) => url.origin === self.location.origin;

if (self.workbox) {
  workbox.core.setCacheNameDetails({ prefix: "linguabud" });

  // Cache-first: only truly static, install-critical assets — see history note above
  // for why HTML pages and app-shell.js/tokens.css were moved off this list.
  workbox.precaching.precacheAndRoute([
    { url: "/offline.html", revision: CACHE_VERSION }, // must stay precached — see setCatchHandler() below, which reads it via matchPrecache()
    { url: "/manifest.json", revision: CACHE_VERSION },
    { url: "/icons/icon-192.png", revision: CACHE_VERSION },
    { url: "/icons/icon-512.png", revision: CACHE_VERSION },
    { url: "/icons/icon-maskable-192.png", revision: CACHE_VERSION },
    { url: "/icons/icon-maskable-512.png", revision: CACHE_VERSION },
  ]);

  // Stale-while-revalidate for ANY same-origin page navigation. Loads from the
  // network like normal on first visit, quietly caches a copy, and any later
  // edit shows up within one extra reload — no manual versioning needed.
  workbox.routing.registerRoute(
    ({ request, url }) => request.mode === "navigate" && SAME_ORIGIN({ url }),
    new workbox.strategies.StaleWhileRevalidate({ cacheName: "linguabud-pages" })
  );

  // Cache-first for same-origin static assets (shared CSS/JS libraries, app-shell.js,
  // tokens.css, images, webfonts) — but bounded to 1 day, so even these self-heal
  // without a manual step if one of them changes (same history as above).
  //
  // Cache name bumped to v2 on 2026-07-22: lib/firebaseClient.js (a shared,
  // universally-imported script that lives in this exact cache bucket) gained
  // new named exports (app/getMessaging/getToken) for push notifications. A
  // client with the pre-change file still cached had every page that imports
  // the new js/push-notifications.js fail at module-resolution time with "does
  // not provide an export named ...", silently — since ES module import
  // failures are atomic, that took down each page's ENTIRE inline script,
  // including the auth listener that hides the "Loading your dashboard"
  // overlay, leaving it stuck forever instead of erroring visibly. The 24h
  // expiry would have self-healed this on its own, but renaming the cache
  // bucket here forces every client to treat all previously cached assets as
  // gone and refetch fresh immediately, rather than waiting out the window.
  //
  // Bumped again to v3 on 2026-07-23: js/app-shell.js (same cache bucket,
  // "script" destination) gained the messages-unread indicator. Anyone who'd
  // already loaded a page with the pre-change app-shell.js cached would keep
  // getting served that stale copy — silently missing the new attribute/CSS
  // entirely, with no visible error — for up to the 24h expiry. Same fix as
  // above: rename the bucket so every client refetches immediately.
  workbox.routing.registerRoute(
    ({ request, url }) =>
      SAME_ORIGIN({ url }) &&
      ["style", "script", "image", "font"].includes(request.destination),
    new workbox.strategies.CacheFirst({
      cacheName: "linguabud-assets-v3",
      plugins: [new workbox.expiration.ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60, maxEntries: 200 })],
    })
  );

  // Offline fallback: only for same-origin navigations with no network and no cache.
  workbox.routing.setCatchHandler(async ({ event }) => {
    if (event.request.mode === "navigate" && SAME_ORIGIN({ url: new URL(event.request.url) })) {
      const cached = await workbox.precaching.matchPrecache("/offline.html");
      if (cached) return cached;
    }
    return Response.error();
  });
} else {
  // eslint-disable-next-line no-console
  console.error("[linguabud-sw] Workbox failed to load from CDN — running with no caching.");
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Drop orphaned asset caches left behind by the renames above — otherwise
      // they just sit in Cache Storage unused, taking up space.
      caches.delete("linguabud-assets"),
      caches.delete("linguabud-assets-v2"),
    ])
  );
});

// ── Push notifications ───────────────────────────────────────────────────
// Raw Push API, not the Firebase Messaging SW SDK — see js/push-notifications.js
// for why (avoids a second copy of firebaseConfig in a different SDK flavor,
// and known foreground/background double-notification pitfalls when mixing
// `notification`+`data` payloads). The server always sends data-only FCM
// messages, so this handler is always the one in control of what's shown.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let raw;
  try {
    raw = event.data.json();
  } catch {
    return;
  }
  // Defensive: handle both "payload fields at top level" (the expected shape
  // for a data-only admin-SDK send) and "payload nested under .data" in case
  // that assumption is ever wrong for a given browser/FCM delivery path.
  // Kept as the whole object (not destructured to a fixed field list) so any
  // extra fields a sender adds later (e.g. conversationId) pass through to
  // the page without needing another service worker edit.
  const payload = raw.data || raw;
  if (!payload.title) return;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const focused = clients.find((c) => c.focused);
      if (focused) {
        // Foreground: let the open page show its own in-app toast instead of
        // a redundant OS-level notification — see js/push-notifications.js.
        focused.postMessage({ type: "lb-push-foreground", payload });
        return null;
      }
      return self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        // Keep the whole payload (not just .url) — conversationId etc. need
        // to survive into notificationclick below so it can deep-link
        // instead of just landing on the generic page.
        data: payload,
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let url = data.url || "/";
  // Message pushes carry a conversationId alongside url:'/messages' — fold it
  // in as a query param so the destination page knows which thread to open,
  // instead of just landing on the generic messages list.
  if (data.conversationId) {
    url += (url.includes("?") ? "&" : "?") + "conversationId=" + encodeURIComponent(data.conversationId);
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
