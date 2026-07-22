/*
  Lingua Bud PWA — Preview Service Worker (Phase 1)
  Registered only from pages under /docs/ (see pwa-preview.html). Its default
  scope, since this script is served from /docs/sw.js, is /docs/ — the browser
  will not let it control anything outside that directory without an explicit
  Service-Worker-Allowed header, which this repo does not send. It is
  structurally incapable of intercepting requests to the real site.

  Uses Workbox via importScripts from Google's hosted CDN — no build step,
  consistent with this repo's "no npm on the frontend" constraint. See
  docs/PWA_PRD.md §12.
*/

importScripts("https://storage.googleapis.com/workbox-cdn/releases/7.1.0/workbox-sw.js");

const CACHE_VERSION = "v1";

if (self.workbox) {
  workbox.core.setCacheNameDetails({ prefix: "lb-pwa-preview" });

  // Cache-first: the app shell itself (this preview's pages, styles, script, icons)
  workbox.precaching.precacheAndRoute([
    { url: "./pwa-preview.html", revision: CACHE_VERSION },
    { url: "./pwa-preview-notebook.html", revision: CACHE_VERSION },
    { url: "./offline.html", revision: CACHE_VERSION },
    { url: "./manifest.json", revision: CACHE_VERSION },
    { url: "../css/tokens.css", revision: CACHE_VERSION },
    { url: "../js/app-shell.js", revision: CACHE_VERSION },
    { url: "./icons/icon-192.png", revision: CACHE_VERSION },
    { url: "./icons/icon-512.png", revision: CACHE_VERSION },
    { url: "./icons/icon-maskable-192.png", revision: CACHE_VERSION },
    { url: "./icons/icon-maskable-512.png", revision: CACHE_VERSION },
  ]);

  // Stale-while-revalidate for any other in-scope navigation (future preview pages)
  workbox.routing.registerRoute(
    ({ request, url }) => request.mode === "navigate" && url.pathname.startsWith("/docs/"),
    new workbox.strategies.StaleWhileRevalidate({ cacheName: "lb-pwa-preview-pages" })
  );

  // Offline fallback: if a navigation within scope can't be served any other way.
  // Precached entries are stored under a revisioned cache key (a `?__WB_REVISION__=`
  // query param), so a plain caches.match() on the bare URL misses — matchPrecache()
  // knows the revisioned key and finds it.
  workbox.routing.setCatchHandler(async ({ event }) => {
    if (event.request.mode === "navigate") {
      const cached = await workbox.precaching.matchPrecache("./offline.html");
      if (cached) return cached;
    }
    return Response.error();
  });
} else {
  // eslint-disable-next-line no-console
  console.error("[lb-pwa-preview] Workbox failed to load from CDN — running with no caching.");
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
