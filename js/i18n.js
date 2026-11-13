/*
  Lingua Bud PWA — interface language (English / Español / Português)

  A plain (classic) <script> in each app page's <head>, after
  js/i18n-strings.js and before js/app-shell.js, so the page is already in
  the chosen language when it first appears.

  How it works: the pages are written in English, and the English text
  itself is the lookup key. When the chosen language isn't English, this
  watches the page (MutationObserver) and swaps any text node, placeholder,
  title, aria-label or alt whose whole text has a translation in
  js/i18n-strings.js — including text the page's own scripts add later
  (status messages, empty states, cards). Nothing is translated piecemeal:
  text without an exact entry (or a matching pattern) stays as it is.

  Safety:
  - In English this does nothing at all (no observer, no DOM changes).
  - It never touches what people type (input/textarea values) or anything
    inside translate="no" — used on user-written content such as names,
    bios and messages, so a person called "Jordan" never becomes "Jordania".
  - Only display text changes; ids, values, hrefs and event handlers stay
    exactly as they were, so every button and form works as before.

  Choice is stored per device in localStorage "lb-lang"; first visit
  follows the phone's language (Spanish → es, Portuguese → pt, else en).
*/
(function () {
  var LANGS = {
    en: { flag: "🇺🇸", name: "English", htmlLang: "en" },
    es: { flag: "🇪🇸", name: "Español", htmlLang: "es" },
    pt: { flag: "🇧🇷", name: "Português", htmlLang: "pt-BR" },
  };
  var KEY = "lb-lang";

  function detect() {
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    if (stored && LANGS[stored]) return stored;
    var prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < prefs.length; i++) {
      var code = String(prefs[i] || "").toLowerCase().slice(0, 2);
      if (code === "en") return "en";
      if (LANGS[code]) return code;
    }
    return "en";
  }

  var lang = detect();
  var all = window.LB_I18N_STRINGS || {};
  var table = lang === "en" ? null : (all[lang] || null);
  var dict = (table && table.text) || {};
  var mixed = (table && table.mixed) || {};
  var patterns = ((table && table.patterns) || []).map(function (p) { return [new RegExp(p[0]), p[1]]; });
  var reverse = {};
  Object.keys(dict).forEach(function (k) { reverse[dict[k]] = k; });

  // Country and language names: a fixed, reviewed table per language in
  // js/i18n-strings.js (not the browser's own name data, which differs
  // between iPhone and Android versions).
  var nameMap = (table && table.names) || {};
  function name(s) {
    if (!table) return s;
    return nameMap[s] || s;
  }
  // In Spanish and Portuguese, language names are lowercase inside a
  // sentence ("Hablas inglés") but capitalised on their own (labels, tags).
  function lower(s) { return s ? s.charAt(0).toLocaleLowerCase(LANGS[lang].htmlLang) + s.slice(1) : s; }
  // "Italian, German or French" -> each name translated, "or" in the
  // interface language.
  var OR = { en: " or ", es: " o ", pt: " ou " };
  function nameList(s, inSentence) {
    return s.split(/(,\s*|\s+or\s+)/).map(function (x, i) {
      if (i % 2) return /or/.test(x) ? OR[lang] : ", ";
      var n = name(x.trim());
      return inSentence && n !== x.trim() ? lower(n) : n;
    }).join("");
  }

  function norm(s) { return s.replace(/\s+/g, " ").trim(); }

  // Exact entry, then patterns (whose captured parts are translated too).
  function lookup(key) {
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    for (var i = 0; i < patterns.length; i++) {
      var m = key.match(patterns[i][0]);
      if (!m) continue;
      return patterns[i][1].replace(/\$(\d)|\$n(\d)|\$l(\d)/g, function (_, g, gn, gl) {
        if (gn) return nameList(m[+gn] || "", false);
        if (gl) return nameList(m[+gl] || "", true);
        var part = m[+g] || "";
        return Object.prototype.hasOwnProperty.call(dict, part) ? dict[part] : part;
      });
    }
    return null;
  }

  function t(s) {
    if (!table || s == null) return s;
    var key = norm(String(s));
    var tr = lookup(key);
    return tr == null ? s : tr;
  }

  // Original English for text this has translated (used by code that reads
  // a status message back to decide what to do, e.g. Settings' field finder).
  function toEnglish(s) {
    if (!table || s == null) return s;
    var key = norm(String(s));
    return Object.prototype.hasOwnProperty.call(reverse, key) ? reverse[key] : s;
  }

  // A whole sentence with {slots}, e.g. f("Full refund of {amount}", {amount: "$25"}).
  // In English this is just the template with the values filled in.
  function f(template, vars) {
    var s = table && Object.prototype.hasOwnProperty.call(dict, template) ? dict[template] : template;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return vars && k in vars ? vars[k] : m; });
  }

  window.lbI18n = {
    lang: lang,
    langs: LANGS,
    // Locale for dates and numbers, or null in English (pages then keep
    // their existing formatting exactly).
    locale: lang === "en" ? null : LANGS[lang].htmlLang,
    t: t,
    f: f,
    name: name,
    nameInSentence: function (s) { return table ? lower(name(s)) : s; },
    toEnglish: toEnglish,
    set: function (code) {
      if (!LANGS[code]) return;
      try { localStorage.setItem(KEY, code); } catch (e) {}
      location.reload();
    },
  };

  document.documentElement.setAttribute("lang", LANGS[lang].htmlLang);
  if (!table) return; // English: nothing else to do

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "alt", "label"];
  var done = new WeakMap(); // text node -> the value this set

  // Placeholders etc. on a text box are translated even though what's typed
  // in it never is.
  function attrsSkipped(el) {
    if (el.getAttribute("translate") === "no") return true;
    return el.parentElement ? skipped(el.parentElement) : false;
  }

  function skipped(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP[n.tagName] || n.isContentEditable) return true;
      if (n.getAttribute("translate") === "no") return true;
    }
    return false;
  }

  function doText(node) {
    var v = node.nodeValue;
    if (!v || done.get(node) === v || !/[A-Za-z]/.test(v)) return;
    var parent = node.parentElement;
    if (!parent || skipped(parent)) return;
    var key = norm(v);
    var nameEl = parent.tagName === "OPTION" ? parent : parent.closest("[data-i18n-name]");
    var tr = nameEl ? name(key) : null;
    // data-i18n-name="lower": the name sits inside a sentence ("tus pruebas de español").
    if (tr && tr !== key && nameEl.getAttribute("data-i18n-name") === "lower") tr = lower(tr);
    if (tr === key) tr = null;
    // data-i18n-name="strict": something a person named (e.g. a notebook
    // folder) — only an exact language/country name is shown translated,
    // never an ordinary word that happens to be in the interface table.
    if (tr == null && nameEl && nameEl.getAttribute("data-i18n-name") === "strict") { done.set(node, v); return; }
    if (tr == null) tr = lookup(key);
    if (tr == null || tr === key) { done.set(node, v); return; }
    var lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
    var out = lead + tr + trail;
    done.set(node, out);
    node.nodeValue = out;
  }

  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (a === "label" && el.tagName !== "OPTGROUP") continue; // dropdown group headings only
      var v = el.getAttribute(a);
      if (!v || !/[A-Za-z]/.test(v)) continue;
      var mark = "data-i18n-" + a;
      if (el.getAttribute(mark) === v) continue;
      var tr = lookup(norm(v));
      if (tr != null && tr !== v) {
        el.setAttribute(mark, tr);
        el.setAttribute(a, tr);
      } else {
        el.setAttribute(mark, v);
      }
    }
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) {
      var tv = lookup(norm(el.value));
      if (tv != null) el.value = tv;
    }
  }

  // Sentences with a link or bold word inside, e.g.
  // "Browse <a>instructors</a> to book your first lesson!" — the template
  // marks the original child elements as {0}…{/0}, which are moved (not
  // copied) into the new sentence, so links keep their href and handlers.
  var INLINE = { A: 1, STRONG: 1, B: 1, EM: 1, I: 1, SPAN: 1, BR: 1, U: 1, SMALL: 1 };
  function doMixed(el) {
    if (!el.firstElementChild || el.hasAttribute("data-i18n-mixed") || skipped(el)) return false;
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if (!INLINE[kids[i].tagName] || kids[i].firstElementChild && kids[i].tagName !== "A") return false;
    }
    var key = norm(el.textContent);
    if (!Object.prototype.hasOwnProperty.call(mixed, key)) return false;
    var tpl = mixed[key];
    var children = Array.prototype.slice.call(kids);
    var frag = document.createDocumentFragment();
    var re = /\{(\d)\}([\s\S]*?)\{\/\1\}/g, last = 0, m;
    while ((m = re.exec(tpl))) {
      if (m.index > last) frag.appendChild(document.createTextNode(tpl.slice(last, m.index)));
      var child = children[+m[1]];
      if (child) {
        if (!child.firstElementChild) child.textContent = m[2];
        frag.appendChild(child);
      }
      last = re.lastIndex;
    }
    if (last < tpl.length) frag.appendChild(document.createTextNode(tpl.slice(last)));
    el.textContent = "";
    el.appendChild(frag);
    el.setAttribute("data-i18n-mixed", "");
    return true;
  }

  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (root.tagName === "TEXTAREA" && !attrsSkipped(root)) { doAttrs(root); return; }
      if (skipped(root)) return;
      if (doMixed(root)) return;
      doAttrs(root);
    }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && n.tagName === "TEXTAREA" && n.getAttribute("translate") !== "no") doAttrs(n);
        if (n.nodeType === 1 && (SKIP[n.tagName] || n.getAttribute("translate") === "no")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n, els = [];
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else els.push(n);
    }
    for (var i = 0; i < els.length; i++) {
      if (!doMixed(els[i])) doAttrs(els[i]);
    }
  }

  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes") { if (r.target.nodeType === 1 && !attrsSkipped(r.target)) doAttrs(r.target); }
      else {
        for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        if (r.target.nodeType === 1 && r.target.firstElementChild && !skipped(r.target)) doMixed(r.target);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ATTRS,
  });
  if (document.body) walk(document.body);
  document.addEventListener("DOMContentLoaded", function () { walk(document.documentElement); });
  // Also translate everything parsed so far right before the first frames
  // are drawn: Safari can paint part of the page before the observer above
  // has been told about it, which showed as a flash of English. pagereveal
  // fires just before the first frame (and with page-change animations);
  // the requestAnimationFrame loop covers the first frames everywhere else.
  // Text already handled is skipped, so these repeat walks are cheap.
  window.addEventListener("pagereveal", function () { walk(document.documentElement); });
  var frames = 0;
  (function beforeFrame() {
    requestAnimationFrame(function () {
      walk(document.documentElement);
      if (++frames < 10 || document.readyState === "loading") beforeFrame();
    });
  })();

  // Messages shown with alert()/confirm() by the pages' scripts.
  var nativeAlert = window.alert, nativeConfirm = window.confirm;
  window.alert = function (msg) { return nativeAlert.call(window, t(msg)); };
  window.confirm = function (msg) { return nativeConfirm.call(window, t(msg)); };
})();
