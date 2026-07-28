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
const NAV_BY_ROLE = {
  student: [
    { id: "learn", label: "Learn", icon: "notebook", href: "home.html" },
    { id: "connect", label: "Connect", icon: "connect", href: "connect.html" },
    { id: "instructors", label: "Instructors", icon: "instructors", href: "instructors.html" },
    { id: "messages", label: "Messages", icon: "messages", href: "messages.html" },
    { id: "settings", label: "Settings", icon: "profile", href: "student-dashboard.html" },
  ],
  instructor: [
    { id: "learn", label: "Learn", icon: "notebook", href: "home.html" },
    { id: "calendar", label: "Calendar", icon: "calendar", href: "bookings.html" },
    { id: "messages", label: "Messages", icon: "messages", href: "messages.html" },
    { id: "earnings", label: "Earnings", icon: "earnings", href: "dashboard.html" },
    { id: "settings", label: "Settings", icon: "profile", href: "dashboard.html" },
  ],
};

// Replaces the marketing navbar's profile dropdown, minus Settings (that's now
// a primary bottom tab, see above — keeping it here too would just be a
// duplicate path to the same page). Logout is special-cased in
// _render()/menu click handling: it never navigates, it dispatches an
// `lb-logout` event so each page can reuse its own already-wired sign-out
// logic instead of this component depending on Firebase directly.
const PROFILE_MENU_BY_ROLE = {
  student: [
    { id: "my-profile", label: "My Profile", href: "learner-profile.html" },
    { id: "friends", label: "Friends", href: "friends.html" },
    { id: "logout", label: "Logout", href: "#" },
  ],
  instructor: [
    { id: "my-profile", label: "My Profile", href: "instructor-profile.html" },
    { id: "friends", label: "Friends", href: "friends.html" },
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
  /* Slides between tabs to show which one is active — see
     _positionTabIndicator() in _render() below. Positioned/sized entirely in
     JS (measured column width, like vocab-quiz.html's sizeQuizScreen()
     pattern) rather than CSS calc(), since it needs a real pixel value to
     animate the transform between two tabs, not just a static position. */
  .tab-indicator {
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 0;
    border-radius: 14px;
    background: rgba(11, 102, 100, 0.10);
    pointer-events: none;
    transition: transform var(--lb-duration-base, 280ms) var(--lb-ease-out, cubic-bezier(.4, 0, .2, 1));
    z-index: 0;
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
    font-weight: 500;
    transition: color var(--lb-duration-fast, 150ms) var(--lb-ease-out, ease-out);
  }
  a.tab svg { width: 22px; height: 22px; }
  /* font-weight jump (500 -> 800) is the actual "bold the active tab" signal —
     previously both states shared the same weight, so the only difference was
     a subtle color shift, which read as barely-there. */
  a.tab[aria-current="page"] { color: var(--action); font-weight: 800; }
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
    a.tab { transition: none; }
  }

  /* The bottom tab bar stays visible at every viewport size, including desktop.
     A dedicated desktop left-rail (see docs/PWA_PRD.md §3) is a real future
     improvement, not this component's job today — but once the header replaces
     the marketing navbar on app pages (see PROFILE_MENU_BY_ROLE above), hiding
     the bottom bar on desktop too would leave desktop users with zero way to
     navigate between app screens. Visible-everywhere is the safe interim state. */
`;

class LbAppShell extends HTMLElement {
  static get observedAttributes() {
    return ["role", "active", "page-title", "notifications", "streak", "hide-header", "messages-unread", "back-href"];
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._menuOpen = false;
    this._render();
    // Attached once (not per-render) so re-renders don't stack duplicate listeners.
    document.addEventListener("click", this._onDocumentClick = (e) => {
      if (!this._menuOpen) return;
      if (e.composedPath().includes(this)) return;
      this._menuOpen = false;
      this._render();
    });
  }

  disconnectedCallback() {
    if (this._onDocumentClick) document.removeEventListener("click", this._onDocumentClick);
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this._render();
  }

  get navItems() {
    return this._nav || NAV_BY_ROLE[this.getAttribute("role") || "student"];
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
    const role = this.getAttribute("role") === "instructor" ? "instructor" : "student";
    const active = this.getAttribute("active") || "home";
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
      <header>
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
      <nav aria-label="Primary">
        <div class="tab-indicator"></div>
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

    this._positionTabIndicator(active, items);

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
    });

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
        // Dispatched rather than importing Firebase here — keeps this component
        // backend-agnostic. Each page listens and reuses its own existing
        // sign-out logic (see docs/PWA_PRD.md §15).
        this.dispatchEvent(new CustomEvent("lb-logout", { bubbles: true, composed: true }));
      });
    }
  }

  // Slides the .tab-indicator pill to sit behind the active tab. Each page is
  // a full navigation (no client-side routing here), so there's no single
  // persisted <lb-app-shell> instance to animate across page loads the way a
  // real app would — this fakes that same "persistent tab bar" feel by
  // stashing the active tab id in sessionStorage, then on the NEXT page's
  // first render, starting the indicator at the OLD tab's position (no
  // transition) before immediately animating it over to the new one. Re-
  // renders within the same page load (e.g. a `messages-unread` attribute
  // flip) skip straight to the current position — nothing to slide from
  // there, since the active tab itself hasn't changed.
  _positionTabIndicator(active, items) {
    const nav = this.shadowRoot.querySelector("nav");
    const indicator = this.shadowRoot.querySelector(".tab-indicator");
    if (!nav || !indicator) return;
    const index = items.findIndex((item) => item.id === active);
    if (index === -1) {
      indicator.style.opacity = "0";
      return;
    }
    indicator.style.opacity = "1";
    const columnWidth = nav.getBoundingClientRect().width / items.length;
    indicator.style.width = `${columnWidth}px`;
    const targetX = index * columnWidth;

    const prevTabId = this._indicatorInitialized ? null : sessionStorage.getItem("lb-active-tab-id");
    const prevIndex = prevTabId ? items.findIndex((item) => item.id === prevTabId) : -1;

    if (!this._indicatorInitialized && prevIndex !== -1 && prevIndex !== index) {
      indicator.style.transition = "none";
      indicator.style.transform = `translateX(${prevIndex * columnWidth}px)`;
      indicator.getBoundingClientRect(); // force the "none" transition to commit before re-enabling it below
      indicator.style.transition = "";
      requestAnimationFrame(() => {
        indicator.style.transform = `translateX(${targetX}px)`;
      });
    } else {
      indicator.style.transition = "none";
      indicator.style.transform = `translateX(${targetX}px)`;
      indicator.getBoundingClientRect();
      indicator.style.transition = "";
    }

    this._indicatorInitialized = true;
    sessionStorage.setItem("lb-active-tab-id", active);
  }
}

if (!customElements.get("lb-app-shell")) {
  customElements.define("lb-app-shell", LbAppShell);
}

export { LbAppShell };
