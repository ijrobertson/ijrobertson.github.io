/*
  Lingua Bud PWA — Shared App Shell
  Net-new file. See docs/PWA_PRD.md §3.

  Defines <lb-app-shell>: a header + bottom tab bar, role-aware, deep-linkable.
  Ships as a Custom Element with Shadow DOM so its styles cannot leak into or
  collide with Bootstrap 4 / existing site CSS. Reads design tokens from
  css/tokens.css via CSS custom properties (which pierce the shadow boundary),
  with inline fallbacks so this file also renders correctly on its own.

  Usage:
    <link rel="stylesheet" href="css/tokens.css">
    <script type="module" src="js/app-shell.js"></script>
    <lb-app-shell
      role="student"
      active="home"
      page-title="Home"
      notifications="2"
      streak="12"
      messages-unread="true"
    ></lb-app-shell>

  Header and nav are fixed to the viewport top/bottom (not sticky), so this
  element can be dropped anywhere in the DOM without controlling page layout.
  The consuming page is responsible for adding padding-top / padding-bottom
  to its own scrollable content equal to the header/nav height (~56px each)
  so content isn't hidden underneath — see docs/design-system-preview.html
  for a worked example.

  Tab destinations are intentionally configurable (see NAV_BY_ROLE above) rather
  than hardcoded, since some PWA screens (Notebook) don't exist yet per the
  phased plan. Set a `nav` property with a custom array of {id, label, href, icon}
  to override.

  The header's account menu (top-right profile icon) is configurable the same
  way via a `profileMenu` property — defaults to PROFILE_MENU_BY_ROLE above.
  Selecting "Logout" never navigates directly: it dispatches a bubbling,
  composed `lb-logout` CustomEvent so each page can reuse its own existing
  Firebase sign-out logic (`shell.addEventListener('lb-logout', ...)`) rather
  than this component importing Firebase itself.

  Early pages (Phase 2 pilot) kept the site's own fixed-top navbar and used
  `hide-header` to render only the bottom tab bar, avoiding a collision. Later
  pages hide that navbar via page-level CSS instead and let this header replace
  it outright — `hide-header` still exists for anywhere the old approach is
  still wanted.
*/

const ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" /><path d="M10 20v-6h4v6" />',
  book: '<rect x="4" y="4.5" width="16" height="15" rx="2" /><path d="M4 8.5h16" /><path d="M9 4.5v4" />',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9.5h16" /><path d="M8 3v3" /><path d="M16 3v3" />',
  messages: '<path d="M4 5.5h16v10H9.5L5 19v-3.5H4z" />',
  notebook: '<path d="M6 3.5h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" /><path d="M9 3.5v17" /><path d="M13 8h3" /><path d="M13 12h3" />',
  earnings: '<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9" /><path d="M14.5 9.8c0-1-1-1.8-2.5-1.8s-2.5.8-2.5 1.8 1 1.5 2.5 1.8c1.5.3 2.5.8 2.5 1.8s-1 1.8-2.5 1.8-2.5-.8-2.5-1.8" />',
  profile: '<circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />',
  bell: '<path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" /><path d="M10 18.5a2 2 0 0 0 4 0" />',
  flame: '<path d="M12 3.5c1 3-3 4-3 7.5a3 3 0 0 0 6 0c0-1-.5-1.5-.5-1.5 1.5.5 2.5 2.5 2.5 4.5a5 5 0 0 1-10 0c0-4 3.5-5.5 5-10.5Z" />',
  // Graduation cap — the "Instructors" tab (was "Book"; same destination, clearer label)
  instructors: '<path d="M12 5 3 9.5 12 14l9-4.5L12 5Z" /><path d="M7 11.5V16c0 1.5 2.5 3 5 3s5-1.5 5-3v-4.5" /><path d="M20 9.5v5" />',
  // Two overlapping circles — the "Connect" tab (language exchange)
  connect: '<circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" />',
  back: '<path d="M15 5l-7 7 7 7" />',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Tab structure per Ian's direction (2026-07-08): no separate "Home" tab —
// "Learn" (the evolving vocabulary/learning hub, née "Notebook") is the app's
// real front door, folding in the old Home screen's "next lesson" summary.
// See docs/PWA_PRD.md and home.html for the Learn page itself.
// Hrefs are the clean, extensionless form deliberately — firebase.json
// redirects any "/:path*.html" request to "/:path*" (301), so a tab href
// ending in .html cost every single tap an extra network round trip for
// nothing (request .html, get redirected, then actually fetch the real
// clean-URL page) before this was fixed. Matches how the rest of the site
// already links internally.
const NAV_BY_ROLE = {
  student: [
    { id: "learn", label: "Learn", icon: "notebook", href: "home" },
    { id: "connect", label: "Connect", icon: "connect", href: "connect" },
    { id: "instructors", label: "Instructors", icon: "instructors", href: "instructors" },
    { id: "messages", label: "Messages", icon: "messages", href: "messages" },
    { id: "settings", label: "Settings", icon: "profile", href: "student-dashboard" },
  ],
  instructor: [
    { id: "learn", label: "Learn", icon: "notebook", href: "home" },
    { id: "calendar", label: "Calendar", icon: "calendar", href: "bookings" },
    { id: "messages", label: "Messages", icon: "messages", href: "messages" },
    { id: "earnings", label: "Earnings", icon: "earnings", href: "earnings" },
    { id: "settings", label: "Settings", icon: "profile", href: "dashboard" },
  ],
};

// Replaces the marketing navbar's profile dropdown, minus Settings (that's now
// a primary bottom tab, see above — keeping it here too would just be a
// duplicate path to the same page). Logout is special-cased in
// _render()/menu click handling: it never navigates, it dispatches an
// `lb-logout` event so each page can reuse its own already-wired sign-out
// logic instead of this component depending on Firebase directly.
// Same clean-URL reasoning as NAV_BY_ROLE above.
const PROFILE_MENU_BY_ROLE = {
  student: [
    { id: "my-profile", label: "My Profile", href: "learner-profile" },
    { id: "friends", label: "Friends", href: "friends" },
    { id: "logout", label: "Logout", href: "#" },
  ],
  instructor: [
    { id: "my-profile", label: "My Profile", href: "instructor-profile" },
    { id: "friends", label: "Friends", href: "friends" },
    { id: "logout", label: "Logout", href: "#" },
  ],
};

const STYLE = `
  :host {
    --action: var(--lb-color-action, #0b6664);
    --action-ink: var(--lb-color-action-ink, #ffffff);
    --ink-900: var(--lb-color-ink-900, #113448);
    --ink-500: var(--lb-color-ink-500, #39728f);
    --surface: var(--lb-color-surface-100, #ffffff);
    --border: var(--lb-color-border, #e7e9e7);
    --warning: var(--lb-color-warning, #d98a3d);
    --danger: var(--lb-color-danger, #d64545);
    --accent: var(--lb-color-accent, #20bcba);
    font-family: var(--lb-font-sans, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    display: block;
    color: var(--ink-900);
  }

  header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: var(--lb-z-shell, 1000);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    padding-top: calc(12px + env(safe-area-inset-top, 0));
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    /* Forces its own compositing layer — the standard, long-documented fix
       for a real WebKit bug where fixed-position elements can detach and
       start scrolling with page content after enough scroll interaction,
       especially in iOS PWA/standalone contexts. Without this, header/nav
       positioning is left to WebKit's normal (buggy) fixed-position
       recalculation on scroll. */
    transform: translateZ(0);
    will-change: transform;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .back-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 4px;
    margin-left: -4px;
    color: var(--ink-900);
    cursor: pointer;
    flex-shrink: 0;
  }
  .back-btn svg { width: 22px; height: 22px; }
  .title {
    font-size: var(--lb-text-lg-size, 18px);
    font-weight: 700;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-shrink: 0;
  }
  .icon-btn {
    position: relative;
    display: inline-flex;
    background: none;
    border: none;
    padding: 4px;
    color: var(--ink-900);
    cursor: pointer;
  }
  .icon-btn svg { width: 22px; height: 22px; }
  .badge {
    position: absolute;
    top: -2px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--danger);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }
  .streak {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--lb-text-sm-size, 14px);
    font-weight: 700;
    color: var(--action);
    font-variant-numeric: tabular-nums;
  }
  .streak svg { width: 18px; height: 18px; }

  .profile-menu-wrap { position: relative; }
  .profile-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 180px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--lb-radius-md, 10px);
    box-shadow: var(--lb-shadow-card, 0 8px 24px -8px rgba(17,52,72,0.25));
    padding: 6px;
    display: none;
    flex-direction: column;
  }
  .profile-dropdown.open { display: flex; }
  .profile-dropdown a, .profile-dropdown button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 10px;
    border-radius: 6px;
    border: none;
    background: none;
    color: var(--ink-900);
    text-decoration: none;
    font-size: var(--lb-text-sm-size, 14px);
    font-family: inherit;
    cursor: pointer;
  }
  .profile-dropdown a:hover, .profile-dropdown button:hover { background: var(--lb-color-surface-0, #fbfbfb); }
  .profile-dropdown .menu-logout { color: var(--danger); border-top: 1px solid var(--border); margin-top: 4px; padding-top: 10px; }

  nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: var(--lb-z-shell, 1000);
    display: flex;
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom, 0);
    /* Same compositing-layer fix as header above — see that comment. This is
       the element reported to drift/scroll away from the bottom after
       extended scrolling on a real device. */
    transform: translateZ(0);
    will-change: transform;
  }
  /* The sliding "glider" pill behind the active tab's icon (see _placeGlider()).
     One tab-width wide so translateX(N * 100%) lands exactly on tab N with no
     measuring; the visible pill is centered inside it. */
  .glider {
    position: absolute;
    top: 3px;
    left: 0;
    width: calc(100% / var(--tab-count, 5));
    height: 32px;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .glider.hidden { visibility: hidden; }
  .glider-pill {
    width: 60px;
    height: 100%;
    border-radius: 999px;
    background: rgba(32, 188, 186, 0.18); /* brand teal #20bcba, tinted */
  }
  a.tab {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px 10px;
    text-decoration: none;
    color: var(--ink-500);
    font-size: 11px;
    font-weight: 600;
    transition: color var(--lb-duration-fast, 150ms) var(--lb-ease-out, ease-out);
  }
  a.tab svg {
    width: 22px;
    height: 22px;
    transition: transform var(--lb-duration-fast, 150ms) var(--lb-ease-out, ease-out);
  }
  a.tab[aria-current="page"] { color: var(--action); font-weight: 700; }
  a.tab.tab-tapped svg { transform: scale(0.88); }
  /* Set via the messages-unread attribute (see js/unread-messages.js) —
     takes precedence over aria-current so it's visible even while the
     Messages tab happens to already be the active one mid-transition. */
  a.tab.unread { color: var(--danger); }
  /* Immediate tap feedback (see pointerdown/up wiring in _render()) — a tab is
     a real <a href>, so the actual navigation can take a moment on a slow
     load; this gives instant confirmation the tap registered, distinct from
     (and taking precedence over) the steady "you are here"/unread colors
     above. Cleared on navigation regardless, since the page unloads. */
  a.tab.tab-tapped { color: var(--accent); }
  a.tab:focus-visible {
    outline: 2px solid var(--action);
    outline-offset: -2px;
    border-radius: 6px;
  }

  @media (prefers-reduced-motion: reduce) {
    a.tab, a.tab svg { transition: none; }
  }

  /* The bottom tab bar stays visible at every viewport size, including desktop.
     A dedicated desktop left-rail (see docs/PWA_PRD.md §3) is a real future
     improvement, not this component's job today — but once the header replaces
     the marketing navbar on app pages (see PROFILE_MENU_BY_ROLE above), hiding
     the bottom bar on desktop too would leave desktop users with zero way to
     navigate between app screens. Visible-everywhere is the safe interim state. */
`;

const ROLE_STORAGE_KEY = "lb-shell-role";
const GLIDE_STORAGE_KEY = "lb-tab-glide";
const GLIDE_EASING = "cubic-bezier(0.2, 0.9, 0.1, 1)";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

// ── Glider hand-off between pages ───────────────────────────────────────
// Every tab is a separate page load, so the slide that starts on tap would
// otherwise be cut off when the old page unloads. The old page records the
// pill's position (on tap, then again on pagehide); the next page's shell
// starts its glider there and finishes the slide. Keyed to the destination
// href so an entry left by a tap that ended somewhere else (e.g. a redirect
// to login) can't animate an unrelated later page.
function saveGlide(toId, pos, href) {
  try {
    sessionStorage.setItem(GLIDE_STORAGE_KEY, JSON.stringify({ toId, pos, href, at: Date.now() }));
  } catch (e) {}
}

function readGlideArrival() {
  let entry = null;
  try {
    entry = JSON.parse(sessionStorage.getItem(GLIDE_STORAGE_KEY) || "null");
    sessionStorage.removeItem(GLIDE_STORAGE_KEY);
  } catch (e) {}
  if (!entry || Date.now() - entry.at > 5000) return null;
  const page = location.pathname.replace(/^\/+/, "").replace(/\.html$/, "") || "index";
  if (entry.href !== page) return null;
  return entry;
}

class LbAppShell extends HTMLElement {
  static get observedAttributes() {
    return ["role", "active", "page-title", "notifications", "streak", "hide-header", "messages-unread", "back-href"];
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._menuOpen = false;
    // Arriving via a tab tap on the previous page: show that tab as active
    // right away (most pages start at active="none" until auth resolves) and
    // continue the glider from wherever it was when the old page unloaded.
    const arrival = readGlideArrival();
    let arrivalPos = null;
    if (arrival) {
      this._activeOverride = arrival.toId;
      arrivalPos = arrival.pos;
    }
    this._render();
    if (arrival) this._placeGlider(arrivalPos);
    this._connected = true;
    // Attached once (not per-render) so re-renders don't stack duplicate listeners.
    document.addEventListener("click", this._onDocumentClick = (e) => {
      if (!this._menuOpen) return;
      if (e.composedPath().includes(this)) return;
      this._menuOpen = false;
      this._render();
    });
    // See prefetchSiblingTabs below — warms the SW cache for every other
    // bottom-nav tab while the user is idle on this one.
    prefetchSiblingTabs(this.navItems, this._activeId());

    // Remember where the glider is as this page goes away, so the next page's
    // shell can pick the slide up from that exact spot (see readGlideArrival).
    window.addEventListener("pagehide", this._onPageHide = () => {
      if (this._overrideHref) saveGlide(this._activeOverride, this._gliderPos(), this._overrideHref);
    });
    // Back/forward-cache restore: this page comes back exactly as it was left,
    // glider sitting on the tab that was tapped. Slide it back home.
    window.addEventListener("pageshow", this._onPageShow = (e) => {
      if (!e.persisted || !this._overrideHref) return;
      const from = this._gliderPos();
      this._activeOverride = this._overrideHref = null;
      this._render();
      this._placeGlider(from);
    });
  }

  disconnectedCallback() {
    if (this._onDocumentClick) document.removeEventListener("click", this._onDocumentClick);
    if (this._onPageHide) window.removeEventListener("pagehide", this._onPageHide);
    if (this._onPageShow) window.removeEventListener("pageshow", this._onPageShow);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "role" && newValue) {
      try { localStorage.setItem(ROLE_STORAGE_KEY, newValue); } catch (e) {}
    }
    // The page's own script has now decided which tab is active (usually
    // after auth resolves) — that wins over the optimistic arrival guess,
    // but not over a tab the user has just tapped on their way out.
    if (name === "active" && this._connected && !this._overrideHref) this._activeOverride = null;
    if (this.shadowRoot) this._render();
  }

  // Pages only set role once auth + a Firestore lookup resolve, so until then
  // fall back to the last role this device saw instead of always "student" —
  // otherwise instructors watch their tab bar swap sets on every page load.
  get _role() {
    let role = this.getAttribute("role");
    if (!role) {
      try { role = localStorage.getItem(ROLE_STORAGE_KEY); } catch (e) {}
    }
    return role === "instructor" ? "instructor" : "student";
  }

  get navItems() {
    return this._nav || NAV_BY_ROLE[this._role];
  }

  _activeId() {
    if (this._activeOverride && this.navItems.some((item) => item.id === this._activeOverride)) {
      return this._activeOverride;
    }
    return this.getAttribute("active") || "home";
  }

  // Current glider position in tab units (0 = first tab, may be fractional
  // mid-slide), or null when there's no visible glider to continue from.
  _gliderPos() {
    const glider = this.shadowRoot?.querySelector(".glider");
    if (!glider || glider.classList.contains("hidden") || !glider.offsetWidth) return null;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(glider).transform);
    return matrix.m41 / glider.offsetWidth;
  }

  // Puts the glider under the active tab, sliding there from `fromPos` (tab
  // units) when given. Called after every render, so a re-render mid-slide
  // (e.g. messages-unread flipping as Firestore loads) carries on from the
  // pill's current spot instead of snapping.
  _placeGlider(fromPos) {
    const glider = this.shadowRoot.querySelector(".glider");
    if (!glider) return;
    const items = this.navItems;
    const index = items.findIndex((item) => item.id === this._activeId());
    glider.getAnimations().forEach((a) => a.cancel());
    glider.style.setProperty("--tab-count", items.length);
    glider.classList.toggle("hidden", index < 0);
    if (index < 0) return;
    glider.style.transform = `translateX(${index * 100}%)`;
    if (REDUCED_MOTION.matches || fromPos == null) return;
    const distance = Math.abs(index - fromPos);
    if (distance < 0.01) return;
    const duration = Math.min(220 + 70 * distance, 460);
    glider.animate(
      [{ transform: `translateX(${fromPos * 100}%)` }, { transform: `translateX(${index * 100}%)` }],
      { duration, easing: GLIDE_EASING }
    );
    // Stretch along the direction of travel, then settle — reads as one
    // fluid object moving rather than a box being repositioned.
    glider.querySelector(".glider-pill").animate(
      [{ transform: "scaleX(1)" }, { transform: `scaleX(${1 + Math.min(0.45, 0.18 * distance)})`, offset: 0.35 }, { transform: "scaleX(1)" }],
      { duration, easing: "ease-out" }
    );
  }

  set nav(items) {
    this._nav = items;
    if (this.shadowRoot) this._render();
  }

  set profileMenu(items) {
    this._profileMenu = items;
    if (this.shadowRoot) this._render();
  }

  _render() {
    const role = this._role;
    const active = this._activeId();
    const gliderFrom = this._gliderPos();
    const pageTitle = this.getAttribute("page-title") || "Lingua Bud";
    const notifications = parseInt(this.getAttribute("notifications") || "0", 10);
    const streak = parseInt(this.getAttribute("streak") || "0", 10);
    const hideHeader = this.hasAttribute("hide-header");
    const messagesUnread = this.getAttribute("messages-unread") === "true";
    // Opt-in: absent on every existing page until that page's script sets it,
    // so this can't change behavior anywhere it isn't explicitly wired up.
    // An explicit URL rather than history.back() — pages reached via a deep
    // link (push notification, bookmark) may have no history entry to pop.
    const backHref = this.getAttribute("back-href");
    const items = this._nav || NAV_BY_ROLE[role];
    const menuItems = this._profileMenu || PROFILE_MENU_BY_ROLE[role];

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      ${hideHeader ? "" : `
      <header part="header">
        <div class="header-left">
          ${backHref ? `<a class="back-btn" href="${backHref}" aria-label="Back">${icon("back")}</a>` : ""}
          <p class="title">${pageTitle}</p>
        </div>
        <div class="header-right">
          ${role === "student" && streak > 0
            ? `<span class="streak">${icon("flame")}${streak}</span>`
            : ""
          }
          <button class="icon-btn" type="button" aria-label="Notifications">
            ${icon("bell")}
            ${notifications > 0 ? `<span class="badge">${notifications > 9 ? "9+" : notifications}</span>` : ""}
          </button>
          <div class="profile-menu-wrap">
            <button class="icon-btn" type="button" id="profileMenuBtn" aria-label="Account menu" aria-expanded="${this._menuOpen ? "true" : "false"}">
              ${icon("profile")}
            </button>
            <div class="profile-dropdown${this._menuOpen ? " open" : ""}" role="menu">
              ${menuItems
                .map((item) => `<a href="${item.href}" role="menuitem" data-id="${item.id}" class="${item.id === "logout" ? "menu-logout" : ""}">${item.label}</a>`)
                .join("")}
            </div>
          </div>
        </div>
      </header>`}
      <nav part="nav" aria-label="Primary">
        <span class="glider" aria-hidden="true"><span class="glider-pill"></span></span>
        ${items
          .map(
            (item) => `
          <a class="tab${item.id === "messages" && messagesUnread ? " unread" : ""}" href="${item.href}" data-id="${item.id}" ${item.id === active ? 'aria-current="page"' : ""}>
            ${icon(item.icon)}
            <span>${item.label}</span>
          </a>`
          )
          .join("")}
      </nav>
    `;

    // Tap feedback (see the .tab-tapped rule above) — pointerdown/up rather
    // than relying on CSS :active, which iOS Safari doesn't reliably apply on
    // a tap without a touch listener present. pointerup/cancel/leave all
    // clear it so a tap that starts on a tab but doesn't complete as a real
    // click (e.g. dragged off before release) never leaves it stuck lit.
    this.shadowRoot.querySelectorAll("a.tab").forEach((tab) => {
      const clear = () => tab.classList.remove("tab-tapped");
      tab.addEventListener("pointerdown", () => tab.classList.add("tab-tapped"));
      tab.addEventListener("pointerup", clear);
      tab.addEventListener("pointercancel", clear);
      tab.addEventListener("pointerleave", clear);
      // Slide the glider the instant a tab is tapped, while the next page
      // loads — updated in place rather than re-rendered, since replacing
      // the <a> mid-click could cancel its navigation. Tapping the tab
      // you're already on keeps its old behavior (plain reload).
      tab.addEventListener("click", (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const id = tab.dataset.id;
        if (id === this._activeId()) return;
        const from = this._gliderPos();
        this._activeOverride = id;
        this._overrideHref = tab.getAttribute("href");
        this.shadowRoot.querySelectorAll("a.tab").forEach((t) => {
          if (t === tab) t.setAttribute("aria-current", "page");
          else t.removeAttribute("aria-current");
        });
        this._placeGlider(from);
        saveGlide(id, from, this._overrideHref);
      });
    });
    this._placeGlider(gliderFrom);

    if (!hideHeader) {
      const menuBtn = this.shadowRoot.getElementById("profileMenuBtn");
      menuBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        this._menuOpen = !this._menuOpen;
        this._render();
      });

      this.shadowRoot.querySelector(".menu-logout")?.addEventListener("click", (e) => {
        e.preventDefault();
        this._menuOpen = false;
        this._render();
        try { localStorage.removeItem(ROLE_STORAGE_KEY); } catch (err) {}
        // Dispatched rather than importing Firebase here — keeps this component
        // backend-agnostic. Each page listens and reuses its own existing
        // sign-out logic (see docs/PWA_PRD.md §15).
        this.dispatchEvent(new CustomEvent("lb-logout", { bubbles: true, composed: true }));
      });
    }
  }
}

// ── Idle-time prefetch of sibling tabs ──────────────────────────────────
// The single biggest thing making tab-to-tab navigation *feel* slow: this
// is a multi-page app, so every tap is a cold full-page load — network
// fetch, parse, and a fresh Firebase re-init, even on a fast connection.
// sw.js already makes a *second* visit to any page fast (StaleWhileRevalidate,
// cache "linguabud-pages-v4") — this warms that exact cache for every other
// tab's page while the user is sitting idle on the current one, so by the
// time they actually tap a tab it's already a "second visit" as far as the
// service worker is concerned. Written directly into the SW's own cache
// bucket via the same Cache Storage API its StaleWhileRevalidate route
// reads from, rather than <link rel=prefetch> — iOS Safari (this app's
// primary target, see docs/PWA_PRD.md) doesn't reliably support prefetch
// link hints, but the Cache API and fetch() are both solid there.
// MUST stay in sync with sw.js's pages cache name if that's ever bumped —
// a mismatch just makes this silently a no-op, not a functional break.
const PAGES_CACHE_NAME = "linguabud-pages-v15"; // MUST match sw.js's pages cacheName exactly — see its own history comments

function prefetchSiblingTabs(items, activeId) {
  if (!("caches" in window) || !("serviceWorker" in navigator)) return;
  const hrefs = items.filter((item) => item.id !== activeId).map((item) => item.href);
  const run = () => {
    caches.open(PAGES_CACHE_NAME).then((cache) => {
      hrefs.forEach((href) => {
        cache.match(href).then((existing) => {
          if (existing) return; // already warm from an earlier visit/prefetch
          cache.add(href).catch(() => {}); // best-effort — never worth surfacing a prefetch failure
        });
      });
    });
  };
  // iOS Safari has never implemented requestIdleCallback — setTimeout is the
  // fallback there. Either way this is deliberately delayed, not immediate:
  // it must never compete with the current page's own real network activity
  // (auth check, live listeners, images) for bandwidth/CPU right when it matters most.
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 1500);
}

// ── Force a stuck installed PWA to actually pick up a new deploy ────────
// Every page registers sw.js on load, but the browser only re-checks that
// file for changes when a *fresh navigation fetch* happens. An installed
// iOS PWA that's merely backgrounded (not force-quit) is typically
// suspended and resumed by the OS with no navigation and therefore no
// update check at all — see sw.js's own history comments. That's exactly
// how a cache-bucket-version fix (bumped and deployed correctly) can still
// look "not fixed" to a specific user days later: their already-open app
// instance never had a chance to notice the new sw.js existed. This runs
// on every PWA-shell page (via this shared module) to close that gap
// without needing an active-update-nag UI, since every past cache bump on
// this app has always meant "everyone should just get the fresh copy":
//   1. Whenever the app is foregrounded again (visibilitychange, or pageshow
//      firing from a back/forward-cache restore), ask the existing
//      registration to check the network for a new sw.js right away,
//      instead of waiting on the browser's own update timer.
//   2. The moment a new service worker actually takes control of this page
//      (controllerchange — fires once, after step 1 finds and activates a
//      newer sw.js), reload once so this tab is guaranteed to be running
//      the fresh HTML/JS/CSS immediately rather than only on some later visit.
if ("serviceWorker" in navigator) {
  let reloadedForNewWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForNewWorker) return;
    reloadedForNewWorker = true;
    window.location.reload();
  });
  const checkForUpdate = () => {
    navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update().catch(() => {}));
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  window.addEventListener("pageshow", checkForUpdate);
}

// ── Press feedback on everything tappable ───────────────────────────────
// Native apps answer a touch instantly (the thing under your finger dips,
// then springs back on release) before any navigation or loading happens;
// most of this app's buttons and cards did nothing visible until the next
// page appeared. Applied page-wide from here rather than per element, since
// these pages have hundreds of buttons/cards, many wired up in JS.
// Uses the `scale` property via the Web Animations API, which composes with
// (instead of replacing) any transform an element already has — e.g. the
// cards' hover lift — and doesn't fight the pages' own CSS transitions.
const PRESS_SKIP = "input, select, textarea, video, iframe, [contenteditable], lb-app-shell";
let pressedEl = null;

// The element a press on `target` should animate, or null: the nearest real
// control, else — for cards made clickable in JS, visible only as
// cursor:pointer — the outermost element of that pointer-cursor run.
function pressTargetFor(target) {
  if (!(target instanceof Element) || target.closest(PRESS_SKIP)) return null;
  let el = target.closest('a[href], button, [role="button"], label[for], summary');
  if (!el) {
    for (let cur = target; cur && cur !== document.body && getComputedStyle(cur).cursor === "pointer"; cur = cur.parentElement) {
      el = cur;
    }
  }
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return null;
  const style = getComputedStyle(el);
  // Inline elements (links in running text) can't be scaled; fixed ones are
  // usually overlays/backdrops; and anything covering the whole screen would
  // read as the page lurching rather than a press. (Tall cards are fine —
  // instructor cards are ~90% of a phone screen.)
  if (style.display === "inline" || style.position === "fixed") return null;
  const rect = el.getBoundingClientRect();
  if (rect.width >= innerWidth && rect.height >= innerHeight) return null;
  return el;
}

function pressIn(el) {
  const rect = el.getBoundingClientRect();
  // Same few pixels of travel whatever the size: small buttons dip visibly,
  // big cards and full-width rows only slightly.
  const scale = Math.min(0.98, Math.max(0.93, 1 - 8 / Math.max(rect.width, rect.height)));
  el._lbPress?.cancel();
  el._lbPress = el.animate([{ scale: "1" }, { scale: String(scale) }], { duration: 110, easing: "ease-out", fill: "forwards" });
}

function pressOut() {
  const el = pressedEl;
  if (!el) return;
  pressedEl = null;
  const from = getComputedStyle(el).scale;
  el._lbPress?.cancel();
  el._lbPress = el.animate([{ scale: from }, { scale: "1" }], { duration: 280, easing: "cubic-bezier(0.34, 1.5, 0.64, 1)" });
}

document.addEventListener("pointerdown", (e) => {
  if (REDUCED_MOTION.matches || !e.isPrimary || e.button !== 0) return;
  pressOut();
  const el = pressTargetFor(e.target);
  if (!el) return;
  pressedEl = el;
  pressIn(el);
}, { passive: true });
// pointercancel covers a touch that turns into a scroll; scroll covers the
// rest (e.g. momentum on a mouse wheel mid-press).
["pointerup", "pointercancel", "dragstart"].forEach((type) => document.addEventListener(type, pressOut, { passive: true }));
document.addEventListener("scroll", pressOut, { passive: true, capture: true });

if (!customElements.get("lb-app-shell")) {
  customElements.define("lb-app-shell", LbAppShell);
}

export { LbAppShell };
