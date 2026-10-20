/*
  Lingua Bud PWA — page transition direction

  css/tokens.css fades between app pages by default (cross-document View
  Transitions). This tags each transition with a direction so moving
  *deeper* (Learn → Culture Guides → a guide) slides the new screen in from
  the right like an iOS push, and moving back up slides it away to the right
  again — while switching between bottom-nav tabs (same depth) keeps the
  plain fade. Depth comparison rather than "was this a Back press" means the
  header's back arrow, the browser/OS back gesture and in-page links all
  read the same way.

  A classic (non-module) script loaded in <head> on purpose: `pagereveal`
  fires at the new page's first render, and a module or async script isn't
  guaranteed to have run by then.
*/
(function () {
  // 0 = a bottom-nav tab's own page. Pages not listed (marketing site,
  // login, …) never get a direction, so they keep the default fade/cut.
  var DEPTH = {
    "home": 0, "connect": 0, "instructors": 0, "messages": 0, "bookings": 0,
    "dashboard": 0, "student-dashboard": 0, "earnings": 0,
    "notebook": 1, "vocab-quiz": 1, "travel-journey": 1, "culture-guides": 1,
    "friends": 1, "learner-profile": 1, "instructor-profile": 1, "adventures": 1,
    "culture-guide": 2, "adventure": 2,
    "culture-lesson": 3,
  };
  var KEY = "lb-current-page";

  function depthOf(path) {
    var page = (path || "").replace(/^\/+/, "").replace(/\.html$/, "") || "index";
    return Object.prototype.hasOwnProperty.call(DEPTH, page) ? DEPTH[page] : null;
  }

  window.addEventListener("pagereveal", function (e) {
    var here = location.pathname;
    var prev = null;
    try {
      prev = sessionStorage.getItem(KEY);
      sessionStorage.setItem(KEY, here);
    } catch (err) {}
    var vt = e.viewTransition;
    if (!vt || !vt.types || !prev || prev === here) return;
    var from = depthOf(prev);
    var to = depthOf(here);
    if (from === null || to === null || from === to) return;
    vt.types.add(to > from ? "lb-forward" : "lb-back");
  });
})();
