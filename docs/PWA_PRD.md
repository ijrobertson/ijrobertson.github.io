# Lingua Bud PWA — Product Requirements & Technical Architecture

Status: Draft for review · Owner: Ian Jack · Prepared: 2026-07-06

This document defines the product requirements, UX architecture, design system, and technical plan for turning Lingua Bud into an installable, production-quality Progressive Web App. It is grounded in the current codebase (static HTML + Bootstrap 4, Firebase Cloud Functions v2, Firestore, Stripe Connect, Agora RTC, GitHub Pages — see `CLAUDE.md`), not a rewrite proposal. Every recommendation below is called out explicitly with its reasoning, separate from the baseline requirements you asked for.

---

## 0. Where this repo already is (audit summary)

Before proposing anything, here's what already exists and must be respected, not rebuilt:

| Area | Status | Key files / collections |
|---|---|---|
| Booking + payment | **Built.** Stripe Elements (Payment Element, inline, not redirect) via callable functions; slot picker + trial-lesson picker | `instructor-profile.html`, `bookings.html`, Firestore `bookings`, `instructor_availability`, `availability_overrides` |
| Messaging | **Built.** Two-pane conversations UI, realtime via `onSnapshot` | `messages.html`, Firestore `conversations` + `messages` subcollection |
| Video lessons | **Built.** Agora RTC, server-minted tokens, screen share, whiteboard | `video-call.html/js/css`, callable `generateAgoraToken`, Firestore `video_calls/{channel}/presence` |
| Language exchange | **Built.** Partner finder + friend requests | `connect.html`, `friends.html`, Firestore `friendRequests` |
| Roles/auth | **Built.** No custom claims — plain Firestore fields/collections | `users`, `instructors`, `admins` (existence-check pattern) |
| Email notifications | **Built.** Resend API, logged | `functions/index.js`, Firestore `emailLog` |
| PWA (manifest/SW/offline/push) | **Greenfield.** Nothing exists yet | — |
| Vocabulary notebook | **Greenfield.** No vocab/flashcard feature exists | — |
| Legacy content | ~100 static per-language lesson pages (`FrenchBasics.html`, etc.) — SEO assets, out of scope for the app shell but a retention lever (see §5.7) | repo root |

**Foundational architecture call:** This PWA should **not** be a SPA rewrite. Lingua Bud is a static multi-page site with no build tooling, and a framework rewrite would touch every revenue-critical page (booking, payments) at once — high risk for a live marketplace, for a UX win that can be achieved another way. The recommendation throughout this document is to make the **existing multi-page architecture feel like a single app** using an app-shell pattern (shared header/bottom-nav injected via a small JS module), the **Cross-Document View Transitions API** for native-feeling page transitions between real HTML documents, and a service worker for install/offline/push. This gets ~90% of the "feels like a native app" benefit at a fraction of the cost and risk of a rewrite, and keeps the "no build tools" constraint intact.

---

## 1. Personas & Goals

**1. Maya, the Casual Learner (Student).** Adult professional, learning Spanish for an upcoming trip. Books lessons in bursts, price-sensitive, mobile-only, churns easily if scheduling friction appears. *Goal: fit a lesson into a 20-minute gap between meetings.* *Retention risk: highest — no external forcing function to keep coming back.*

**2. Daniel, the Committed Achiever (Student).** Studying German for a work relocation with a deadline. Books recurring weekly slots with one instructor, wants visible progress, tolerates a bit more app complexity for better tracking. *Goal: prove to himself he's improving.*

**3. Sophie, the Professional Tutor (Instructor).** Relies on Lingua Bud for meaningful income. Cares most about calendar reliability, no-show minimization, and trusting that payouts happen. *Goal: keep her calendar full without babysitting the app.*

**4. Kenji, the Exchange Partner (non-paying).** Wants free conversation practice, not a paid lesson — yet. *Goal: talk to someone tonight.* **Recommendation:** treat this persona explicitly as a **top-of-funnel acquisition and retention engine**, not a side feature. Exchange has no direct revenue, so its product value is retention (daily habit, zero cost to try) and conversion (funneling into paid lessons once trust is built). The IA, analytics, and notification strategy below all reflect this — e.g. a dedicated `exchange_to_paid_conversion` funnel metric (§15) and a "loved chatting? try a lesson" nudge after N exchange sessions (§5.6).

**5. Admin (internal).** Not a design focus; PWA install is optional for `admin.html`.

---

## 2. Information Architecture

```
Lingua Bud (marketing/SEO site — unchanged, ~100 pages)
│
└── App shell (installable PWA, role-aware)
    ├── Home (Today)                — next lesson, streak, quick actions
    ├── Explore / Book              — instructor directory → profile → booking
    │   └── (Instructor role sees "My Calendar" instead)
    ├── Messages                    — instructor threads + exchange threads, tabbed
    │   └── Video Lesson            — pre-call lobby → in-call → post-call
    ├── Exchange                    — partner matching, browse/filter, active chats
    ├── Notebook                    — folders, tags, favorites, review queue
    └── Profile
        ├── Settings (notifications, language goals, payment methods)
        ├── Earnings (instructor only)
        └── Referrals
```

**Recommendation:** Collapse today's `dashboard.html` and `student-dashboard.html` into one role-aware **Home**, and make it the PWA `start_url`. Right now a returning user's first stop is a profile-editing page, not an actionable "here's what's next" screen — that's a conversion and retention cost every single session. Home should answer one question instantly: *what should I do right now?*

---

## 3. Navigation Architecture

- **Bottom tab bar** (mobile, the primary surface): 5 items, role-aware labels/icons swapped server-side-known role, not client-guessed:
  - Student: Home · Book · Messages · Notebook · Profile
  - Instructor: Home · Calendar · Messages · Earnings · Profile
- **Header**: back/context title + notification bell (badge count) + (student only) streak flame with count.
- **Desktop/tablet (≥768px)**: bottom bar becomes a persistent left rail; content reflows to a max-width centered column (matches existing Bootstrap 4 grid, no new breakpoint system needed).
- **Modals vs. pages**: anything that interrupts a flow the user is likely to abandon (booking, payment) is a full page, not a modal, so back-button and reload behave predictably. Anything supplementary (filters, a single setting) is a bottom sheet on mobile / modal on desktop.
- **Deep links**: every screen has a stable URL (existing pages already do — preserve this) so push notifications and shared links land on the exact right screen, not just the app root.

---

## 4. User Flows

### 4.1 Onboarding (new user)
1. Land on marketing site → "Get Started" → role choice: *Learn a language* / *Teach* / *Just want to practice with people*.
2. Account creation (existing `login.html` flow) → **language goal capture** (target language, current level, motivation: travel/work/exam/fun). **Recommendation:** this 15-second step doesn't exist today and is high-leverage — it seeds personalization (instructor recommendations, notebook starter deck, Home copy) and is the single input every retention/gamification feature downstream depends on. Skippable, but skipping forfeits personalization (state this honestly in copy).
3. Contextual PWA install prompt — **not** on page load. Triggered after the first meaningful action (goal set, or first message sent), per §14 reasoning.
4. Land on Home with a clear first action: "Try a free 15-min trial lesson" (existing trial flow) or "Find a language exchange partner."

### 4.2 Discover & book a lesson
1. Explore → filter by language/price/availability/rating → instructor card (video intro thumbnail, rating, price, response time).
2. Instructor profile → slot picker (existing `#booking-calendar`) → review price breakdown (lesson + $1 platform fee, shown line-item, never surprise-added at the last step) → pay.
3. **Payment**: Stripe Payment Element (existing) + **Recommendation: add the Stripe Payment Request Button** for Apple Pay / Google Pay. On mobile — the primary surface for this app — one-tap wallet checkout measurably lifts completion vs. typing a card number, and Stripe Elements supports it as an additive component, not a rebuild.
4. Confirmation screen with calendar-add (`.ics`) and a clear cancellation-policy link (trust signal).
5. Reminder pushes at 60 and 10 minutes before (see §14).

### 4.3 Take the lesson
1. Pre-call lobby (new): camera/mic check, "waiting for instructor" state, one-tap into `video-call.html`'s existing Agora room.
2. In-call (existing functionality: screen share, whiteboard).
3. **Post-call screen (new, high-value gap today):** rate the lesson → optional note to self → **"Book your next lesson with [Instructor]" CTA with the same slot next week pre-selected.** This is the single highest-intent moment for rebooking and currently has no dedicated UI — flagged as the top conversion recommendation in this document (see §15 for the `lesson_rebooked_immediately` event to validate it).

### 4.4 Message an instructor or exchange partner
1. Messages → thread (existing schema) → compose. **Recommendation:** add voice notes (MediaRecorder API → Firebase Storage) — disproportionately valuable for language learners practicing pronunciation, and a natural differentiator vs. generic chat.
2. Exchange-specific: **tap-to-reveal translation** on a received message (calls a translation API, shows original + translation) — keeps exchange conversations from stalling on a vocabulary wall, directly serving persona 4's retention goal.
3. Offline: message composes into a local queue (IndexedDB) and sends via Background Sync when connectivity returns; UI shows a pending/sent/failed state per message (like SMS).

### 4.5 Language exchange matching
1. Browse/filter partners by language pair, level, availability → send request (existing `friendRequests`) → accept → thread opens in Messages.
2. **Recommendation:** after 3 exchange sessions (measurable via message-count or call-duration), show a one-time, dismissible nudge: "You're getting the hang of this — ready to accelerate with a tutor?" linking to Explore, pre-filtered to the exchange partner's language. This is the concrete mechanism behind the exchange-to-paid funnel named in §1.

### 4.6 Vocabulary notebook
1. Add a word manually, or **long-press a word in any chat message → "Add to Notebook"**, or (recommendation) a lightweight "Save word" affordance injected into the ~100 legacy static lesson pages, writing into the same `notebook` collection — this turns an existing SEO-only asset into an acquisition funnel for the app itself, at very low cost since those pages already exist.
2. Organize into folders, tag, favorite.
3. Review reminders (push, spaced — simple due-date field now; full SRS/flashcards is a stated future phase, so the data model should carry a `nextReviewAt` and `reviewCount` field from day one even before flashcard UI ships, to avoid a migration later).

### 4.7 Instructor side
1. Calendar (availability set/override — existing) → booking notification (push, not just email) → pre-lesson reminder → post-lesson: mark complete, leave a note, see earnings update in near-real-time.
2. **Recommendation:** surface a "reliability score" (on-time %, response time) privately to the instructor, before ever making it public — gives instructors a reason to open the app daily even without a lesson scheduled, which is a retention lever specific to the supply side that's currently missing.

---

## 5. Screen-by-Screen Wireframes

### 5.1 Home (student)
```
┌─────────────────────────────┐
│ ☰  Lingua Bud        🔔 🔥12│  ← streak flame + count
├─────────────────────────────┤
│  Next lesson                │
│  ┌─────────────────────────┐│
│  │ Sophie · German · 3:00pm││  ← tappable → lesson detail
│  │ [Join] enabled 10m before││
│  └─────────────────────────┘│
│  This week's goal   ▓▓▓░ 3/4│
│  ─ Quick actions ─          │
│  [Book a lesson] [Find a partner]│
│  Continue your notebook →   │  ← 3 due-for-review words
│  Recent activity feed       │
├─────────────────────────────┤
│ Home  Book  Msgs  Notebook  Me│ ← bottom tabs
└─────────────────────────────┘
```

### 5.2 Explore / Instructor profile / Booking
- Explore: search bar + filter chips (language, price range, availability today, rating) over a scrollable instructor card grid (2-col mobile). Sticky filter bar on scroll.
- Instructor profile: hero video/photo, name, languages taught, rate, rating + review count, bio, availability calendar inline (not a separate tap), "Book trial" (if eligible) vs. "Book lesson" as two distinct CTAs (don't bury the free trial).
- Booking sheet (bottom sheet on mobile): date strip → time slots (existing) → price breakdown → pay button → Payment Element inline, with a wallet-pay button above the card form.

### 5.3 Video lesson lobby
```
┌─────────────────────────────┐
│  Lesson with Sophie          │
│  [ camera preview ]          │
│  🎤 ● Mic OK   🎥 ● Cam OK    │
│  Starts in 4:32               │
│  [ Join lesson ]  (disabled   │
│    until 10 min before start) │
└─────────────────────────────┘
```
Post-call screen: full-screen, non-dismissible until rated (low friction: tap 1–5 stars, optional text, "Skip" always available) → immediately followed by the rebooking card described in §4.3.

### 5.4 Messages
- Segmented control at top: **Instructors** / **Exchange** (two very different conversational contexts — mixing them in one undifferentiated list was flagged as a UX risk; separating them also lets exchange-specific affordances like translate-tap live only where relevant).
- Thread list: avatar w/ presence dot, name, last message preview, unread badge, relative timestamp.
- Thread view: standard bubble layout, composer with text/voice-note toggle, translate-tap on incoming bubbles for Exchange tab only.

### 5.5 Notebook
- Folder grid (default folders: "Favorites", "This week", + user-created) → word list inside a folder: term, translation, tags, source (which chat/lesson it came from), due-for-review indicator.
- Add-word sheet: term, translation (optional auto-suggest), tags, folder, note.

### 5.6 Profile / Settings
- Standard account settings + **notification preferences with granular toggles** (lesson reminders, messages, streak nudges, weekly recap) — not a single on/off switch, since over-broad opt-outs (someone disabling all push because one category annoyed them) are a common, avoidable retention loss.

---

## 6. UI Design System

### 6.1 Color
Grounded in the existing brand (logo, `css/styles.css`), with one correction: **the primary brand teal `#20bcba` fails WCAG AA contrast** as either text-on-white or white-text-on-fill (computed contrast ratio ≈2.34:1 against white; AA requires 4.5:1 for normal text, 3:1 for large text/UI components — this fails both). This is a real, existing issue on the live site's buttons, not a hypothetical.

**Recommendation:** keep `#20bcba` as a *decorative* accent (badges, illustrations, backgrounds behind white icons) but introduce a darker **action teal `#0b6664`** (contrast ≈6.8:1 on white) for anything with text — primary buttons, links, focus rings. Same hue family, so the brand still reads as "Lingua Bud teal," but it's now legible and accessible.

| Token | Hex | Use |
|---|---|---|
| `--brand-accent` | `#20bcba` | decorative fills, badges, illustration accents only — never as text or under text |
| `--brand-action` | `#0b6664` | primary buttons, links, focus rings, icons that carry meaning |
| `--ink-900` | `#113448` | headings, primary text |
| `--ink-700` | `#2a5d77` | secondary text |
| `--ink-500` | `#39728f` | tertiary text, placeholders |
| `--surface-0` | `#fbfbfb` | app background |
| `--surface-100` | `#ffffff` | cards |
| `--neutral-300` | `#e7e9e7` | dividers, borders |
| `--success` | `#2f9e58` | confirmed, paid, online status |
| `--warning` | `#d98a3d` | streak-at-risk, pending states |
| `--danger` | `#d64545` | cancellations, payment failures |

### 6.2 Typography
**Recommendation:** use a **system-font stack only** (`-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`), not a webfont. Reasoning: this app's performance budget (§9) is tight, and a webfont is pure download/render cost for zero functional gain on a marketplace where speed itself is a trust and conversion signal. Hierarchy comes from weight, size, and color, not typeface personality.

Type scale (px / line-height): 12/16 caption · 14/20 body-small · 16/24 body (default) · 18/26 body-large · 22/28 h3 · 28/34 h2 · 34/40 h1. Prices, timers, and countdowns use `font-variant-numeric: tabular-nums` so digits don't jitter.

### 6.3 Spacing
4px base unit: 4, 8, 12, 16, 24, 32, 48, 64. No arbitrary one-off values in new components.

### 6.4 Iconography
**Recommendation:** standardize on one open-source stroke-icon set (e.g. Phosphor or Lucide), self-hosted as individual SVG files — no CDN dependency, no build step, drop-in with existing static-file workflow. Today's icons are ad hoc (mixed Bootstrap glyphs/inline SVGs); a single consistent stroke weight is a cheap, high-impact "feels premium" win.

### 6.5 Components
Button (primary/secondary/ghost/destructive, all using `--brand-action` not `--brand-accent`), Card (instructor card, booking card, notebook word card), Bottom tab bar, Bottom sheet (mobile) / Modal (desktop), Toast (transient, auto-dismiss, swipe-to-dismiss), Badge/chip, Avatar with presence dot, Slot picker, Star rating, Skeleton loader (used for anything backed by a Firestore listener, never a blank flash), Empty state (illustration + one clear action, never just "No data").

---

## 7. Motion & Animation Guidelines

- Micro-interactions (button press, toggle, tab switch): 150–200ms ease-out.
- **Recommendation:** use the **Cross-Document View Transitions API** for navigation between app pages — assign shared `view-transition-name` to the header and bottom nav so they appear to persist across full page loads, with the content area cross-fading/sliding. This is the specific mechanism that lets an MPA feel like a single app (see §0) without a SPA rewrite, and it's now supported in Chromium and Safari.
- Celebratory moments (streak milestone, badge earned) get a single tasteful one-shot animation, never a looping/repeated one — and are fully suppressed under `prefers-reduced-motion`, which also downgrades all page transitions to an instant cut.
- Loading states use skeletons, not spinners, wherever content shape is known in advance (nearly everywhere here, since Firestore documents have predictable shapes).

---

## 8. Accessibility Requirements

- Target: **WCAG 2.2 AA**, verified with automated (axe-core) + manual screen-reader passes on the three highest-stakes flows: booking+payment, messaging, notebook review.
- All interactive elements reachable and operable by keyboard; visible focus ring using `--brand-action` (not the inaccessible `--brand-accent`).
- Color is never the sole carrier of meaning (e.g. booking status uses an icon + text label, not just a colored dot).
- Live regions (`aria-live="polite"`) for incoming chat messages and toasts, so screen-reader users aren't ambushed by a message mid-sentence but still hear it.
- Video lesson UI: captions are out of scope for v1 (Agora doesn't provide this natively) but should be flagged as a known gap in the accessibility statement, with a note to revisit if a captioning add-on becomes feasible.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` everywhere (dark mode is not in scope for v1 per user priorities, but the token system in §6.1 should be structured so adding it later is a token swap, not a rewrite).

---

## 9. Performance Targets

Measured on a mid-tier Android device, throttled 4G, from GitHub Pages:

| Metric | Target |
|---|---|
| LCP | < 2.0s |
| INP | < 200ms |
| CLS | < 0.1 |
| TTFB | < 0.6s |
| Lighthouse PWA score | 100 |
| Per-page JS (excluding on-demand Firebase/Agora chunks) | < 150KB gzipped |
| Time to installable/interactive after first load | < 3s |

**Recommendation:** keep using Firebase's modular (v9+) SDK imports so unused Firebase products are tree-shaken per page (e.g. `video-call.html` shouldn't ship Firestore-heavy code it doesn't need) — this is already the stated pattern in `lib/firebaseClient.js` per the existing stack notes; the PWA work should audit that it's actually followed page-by-page as new screens are added, since it's easy for per-page imports to silently grow over time.

---

## 10. Security Requirements

- **Recommendation: adopt Firebase App Check** (reCAPTCHA v3 on web) on all callable functions, especially `getStripeConfig`, the PaymentIntent-creation callable, and `generateAgoraToken`. These are public-facing marketplace endpoints; App Check is a low-effort way to ensure calls originate from the real app, not a scripted abuser.
- Continue the existing pattern of **never handling raw card data** — Stripe Elements/Payment Element keeps PCI scope minimal; any new payment surface (e.g. a future lesson-package/subscription product) must use the same pattern, not a custom card form.
- Agora tokens: already server-minted and short-lived (correct) — add explicit token-refresh handling for lessons that run long, so a call doesn't silently drop mid-lesson.
- **Recommendation: basic trust & safety for messaging/exchange.** Exchange pairs strangers directly — a genuinely new trust surface compared to the existing instructor-marketplace flows. Extend the existing `userReports` collection into a real block/report flow reachable from any thread, and add a lightweight abuse-pattern rate limit on message sends (protects both against spam and against a compromised account being used to harass).
- Firestore rules: continue the existing least-privilege pattern (server-only writes for `earnings`, `emailLog`, etc.); any new collection (`notebook`, `fcmTokens`, message read-receipts) should be added with the same discipline — client can write its own data, nothing else.

---

## 11. Error Handling Strategy

- **Inline validation** for anything the user typed (forms), shown next to the field, in plain language ("Enter a valid email" not "Invalid input: field 2").
- **Toast + retry** for transient/network failures on non-critical actions (e.g. a like, a notebook save) — auto-retry once silently, then show a toast with a manual retry action if it still fails.
- **Full-page error state** only for hard failures where there's nothing useful left on screen (e.g. instructor profile failed to load at all) — always with a retry button, never a dead end.
- **Payment-specific messaging**: distinguish card-declined (show the decline reason Stripe returns, if user-safe) vs. network failure (offer retry) vs. 3D Secure required (hand off to the Stripe-provided flow, don't build a custom one).
- **Recommendation: handle the booking-slot race condition explicitly.** Today, two students could plausibly select the same slot before either completes payment. The booking flow should re-validate slot availability at PaymentIntent-creation time (server-side, in the callable function) and, on conflict, surface a friendly "That slot was just booked — here are the next available times" state rather than a generic payment error. This is a real edge case in the current architecture, not a hypothetical.
- **Offline-aware messaging**: explicitly distinguish "you're offline" (via `navigator.onLine` + online/offline listeners) from "something went wrong" — these require completely different user reactions and should never share a generic error toast.

---

## 12. Offline & Caching Strategy

**Recommendation: enable Firestore's built-in offline persistence** (`enableIndexedDbPersistence`) — it ships in the SDK already in use, costs almost nothing to turn on, and gives messages, bookings, and notebook data automatic offline read/write-queue behavior without hand-rolled sync logic. This pairs naturally with PWA installability and should be treated as a near-free win, not a separate build.

Service worker strategy (via Workbox, loaded through `importScripts` from Google's hosted CDN inside `sw.js` — no build step required, consistent with the "no npm on frontend" constraint):

| Content | Strategy | Reasoning |
|---|---|---|
| App shell HTML/CSS/JS, icons | Cache-first, versioned | Static, safe to serve instantly, update on new SW activation |
| Instructor directory / profile pages | Stale-while-revalidate | Read-mostly; instant paint from cache, background-refreshed |
| Legacy lesson content pages (~100 pages) | Stale-while-revalidate, low priority (not precached) | Benefits repeat visits without bloating install size |
| Booking / payment endpoints, Firestore writes | Network-only, never cached | Correctness over speed; Firestore's own offline queue (above) handles true offline writes safely, not the SW cache |
| Video call | No offline support (expected/inherent limitation) — but the lobby UI and instructions shell should still cache so a flaky-connection user at least sees a clear "reconnecting" state instead of a blank page |

Notebook offline: reads/writes go through Firestore persistence; UI shows a small "changes will sync" indicator when `navigator.onLine` is false, so users aren't confused about why a save looks instant but hasn't reached the server yet.

---

## 13. Push Notification Strategy

Built on **Firebase Cloud Messaging (Web Push)** — no new vendor, since the backend is already Firebase Cloud Functions, and this mirrors the existing Resend-email trigger pattern (`emailLog`) with a parallel `fcmTokens` collection and matching Cloud Function triggers.

| Trigger | Notification | Cap/rule |
|---|---|---|
| Booking confirmed | "Your lesson with Sophie is confirmed for 3:00pm Tue" | Immediate |
| Lesson reminder | 60 min and 10 min before | Both, always |
| New message | "Sophie sent you a message" | Debounced/batched — one push per thread per few minutes, not per message |
| Reschedule/cancellation | Instructor or student initiated | Immediate |
| Streak at risk | "Keep your 12-day streak — 2 hours left today" | Opt-in, max 1/day, only sent in local evening if no activity recorded that day |
| Weekly recap | Lessons taken, words reviewed, streak status | Weekly, opt-in |
| Referral credit earned | Ties into existing referral program | Immediate |

**Recommendation: never request notification permission on page load.** Use a contextual "soft ask" — an in-app explainer with a button — timed to a moment of clear value (e.g. immediately after a booking confirms: "Want a reminder before your lesson?"). Reasoning: browsers permanently remember a denied native prompt as blocked, with no easy re-ask; a soft ask lets you delay the one-shot native prompt until the user is primed to say yes, which materially changes the accept rate.

**Recommendation: honest, non-coercive streak mechanics.** No fake urgency, no shame-based copy, and include a "streak freeze"/vacation-mode option. Reasoning: this is a paid-tutoring marketplace serving working adults, not a free app monetized by ad attention — the instructor side of the business depends on the platform being trusted as professional, so retention mechanics should feel supportive, not manipulative. This also keeps notification opt-out rates low, since nagging is the single fastest way to lose the "message received" channel that actually matters for bookings.

---

## 14. Analytics & Event Taxonomy

Naming convention: `object_action`, snake_case, fired client + mirrored server-side for revenue events (never trust client-only for money).

**Funnel events:** `signup_started`, `signup_completed`, `goal_set`, `instructor_profile_viewed`, `booking_slot_selected`, `booking_payment_started`, `booking_payment_succeeded`, `booking_payment_failed`, `trial_lesson_booked`, `lesson_joined`, `lesson_completed`, **`lesson_rebooked_immediately`** (fired specifically from the post-call CTA in §4.3 — the key metric validating that recommendation), `pwa_install_prompted`, `pwa_installed`, `push_permission_soft_asked`, `push_permission_granted`, `push_notification_opened`.

**Engagement events:** `message_sent`, `voice_note_sent`, `translate_tap_used`, `exchange_partner_matched`, `exchange_to_lesson_click` (the nudge from §4.5), `notebook_word_added`, `notebook_word_added_source` (chat / legacy-page / manual — to measure the legacy-content funnel specifically), `notebook_review_completed`, `streak_incremented`, `streak_broken`, `streak_freeze_used`.

**North-star metrics:** Weekly Active Learners; **7-day lesson rebooking rate** (the single metric most tied to the stated "book more lessons" goal); D1/D7/D30 retention; **exchange-to-paid conversion rate** (validates persona 4's funnel role); instructor calendar fill rate.

---

## 15. Phased Implementation Plan

Each phase ends with an explicit testing gate before moving on — no phase is "done" on code-complete alone.

| Phase | Scope | Testing gate |
|---|---|---|
| 0 — Foundations (2–3 wk) | Design tokens, icon set, shared header/bottom-nav shell component injected across existing pages | Visual QA across breakpoints; Lighthouse baseline captured |
| 1 — Installability (2 wk) | `manifest.json`, icons, `sw.js` (Workbox, static+shell caching only), View Transitions for in-app nav | Installable on Android/iOS/desktop Chrome; Lighthouse PWA checklist 100; offline fallback page verified |
| 2 — Navigation & Home (2 wk) | Merge `dashboard.html`/`student-dashboard.html` into role-aware Home; wire bottom tabs to real pages | Click-testing with 5 real users (mixed roles); zero dead links |
| 3 — Booking & Payments Polish (3 wk) | Slot-picker redesign, wallet-pay button, booking-conflict handling, post-lesson rebooking CTA | Full Stripe test-mode matrix (success/decline/3DS/network fail); two-tab race-condition test |
| 4 — Messaging Upgrade (2–3 wk) | Offline compose/queue, voice notes, translate-tap, message push | Offline send/receive test; cross-device push delivery test |
| 5 — Video Lesson Experience (2 wk) | Pre-call lobby/device check, reconnect handling, post-call review+rebook | Real call test across throttled 3G / packet loss / Wi-Fi; device check on 3 phone models |
| 6 — Vocabulary Notebook (3 wk) | Folders/tags/favorites/review reminders, save-from-chat, save-from-legacy-page widget, curated vocabulary quiz (`vocab-quiz.html`) by language + difficulty with save-to-notebook | Content-capture test across 5 legacy lesson pages; review-scheduling correctness test; quiz round + save-to-notebook end-to-end test |
| 7 — Gamification & Retention (2 wk) | Streaks, badges, weekly goals, streak-at-risk/recap pushes | Copy review for coercive language; event instrumentation verified end-to-end |
| 8 — Accessibility & Performance Hardening (2 wk) | Full WCAG pass, perf-budget enforcement, screen-reader pass on 3 core flows | axe-core zero criticals; manual screen-reader walkthrough signed off |
| 9 — Launch Readiness (1–2 wk) | App Check rollout, security review, analytics QA, staged rollout | `/security-review` run; full regression pass; staged rollout monitored before 100% |

**Total: ~20–24 weeks.** Phases 3–6 are independently shippable and can reorder based on business priority (e.g. move Notebook earlier if it's a stronger differentiator than expected) — the sequencing above optimizes for de-risking payments first, since that's the revenue-critical surface.

---

## Summary: recommendations beyond the original brief

For scanability, the material additions to what was originally asked, in priority order:

1. **Post-lesson rebooking CTA** — the highest-leverage single UI addition for the stated "book more lessons" goal; currently a gap.
2. **Fix the brand teal's accessibility failure** (`#20bcba` ≈2.34:1 contrast) with a darker `--brand-action` token — a real, evidence-based bug, not a style preference.
3. **App-shell + View Transitions instead of a SPA rewrite** — gets the "feels like a native app" outcome without the risk of rewriting a live payment flow.
4. **Firestore offline persistence + Workbox via CDN** — near-zero-cost offline wins using capabilities already in the stack.
5. **Wallet pay (Apple/Google Pay) via Stripe's Payment Request Button** — mobile conversion lift, additive to existing Elements integration.
6. **Exchange-to-paid nudge and its dedicated funnel metric** — makes the free exchange feature earn its keep strategically, not just as a nice-to-have.
7. **Legacy lesson pages → notebook capture widget** — turns 100 existing SEO pages into an app acquisition funnel.
8. **Booking slot-race handling** and **soft-ask push permission pattern** — two specific, currently-unaddressed edge cases with outsized user-trust impact.
9. **Non-coercive gamification (streak freeze, honest copy)** — a deliberate positioning choice given the instructor side needs the platform to read as professional.
