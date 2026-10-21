/*
  Lingua Bud PWA — Night mode

  A classic (non-module) script loaded in <head> on every app page, so the
  saved theme is applied before the first paint — no white flash when moving
  between pages at night. Night mode is a per-device choice (localStorage),
  toggled from the account menu in js/app-shell.js via window.lbTheme.

  Night styles live in css/night.css, which is only loaded while night mode
  is on, and are all scoped under html[data-theme="night"].
*/
(function () {
  var KEY = "lb-theme";
  var NIGHT_STATUS_BAR = "#0e1a22";
  var root = document.documentElement;
  var defaultStatusBar = null;

  function read() {
    try { return localStorage.getItem(KEY) === "night"; } catch (e) { return false; }
  }

  function ensureStylesheet() {
    if (document.getElementById("lb-night-css")) return;
    var link = document.createElement("link");
    link.id = "lb-night-css";
    link.rel = "stylesheet";
    link.href = "css/night.css?v=1";
    // Last in <head> (or appended once the head exists) so it wins over page styles
    (document.head || root).appendChild(link);
  }

  function setStatusBar(night) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (defaultStatusBar === null) defaultStatusBar = meta.getAttribute("content");
    meta.setAttribute("content", night ? NIGHT_STATUS_BAR : defaultStatusBar);
  }

  function apply(night) {
    if (night) {
      ensureStylesheet();
      root.setAttribute("data-theme", "night");
    } else {
      root.removeAttribute("data-theme");
    }
    setStatusBar(night);
  }

  window.lbTheme = {
    isNight: read,
    set: function (night) {
      try { localStorage.setItem(KEY, night ? "night" : "day"); } catch (e) {}
      apply(night);
      window.dispatchEvent(new CustomEvent("lb-theme-change", { detail: { night: night } }));
    },
  };

  // Page name (e.g. "dashboard") — css/night.css scopes each page's own
  // overrides with it, since every page styles shared class names differently
  root.setAttribute("data-page", (location.pathname.split("/").pop() || "index").replace(/\.html$/, ""));

  apply(read());
  // The theme-color <meta> may come after this script in <head>
  if (read()) document.addEventListener("DOMContentLoaded", function () { setStatusBar(true); });
  // Another tab/window changed it
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(read()); });
})();
