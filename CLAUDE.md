# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lingua Bud (linguabud.com) is a static website for language learning resources and instructor services. The site is hosted on GitHub Pages and provides:
- Free language learning resources for 8+ languages (Spanish, French, Portuguese, Italian, German, Russian, Swedish, English)
- Short stories and lessons in each language
- Instructor profiles and dashboard
- Student dashboard
- Firebase-based authentication and data storage

## Technology Stack

- **Frontend**: Static HTML/CSS/JavaScript (no build process)
- **CSS Framework**: Bootstrap 4
- **JavaScript Libraries**: jQuery, Swiper, Magnific Popup, Isotope
- **Backend**: Firebase (Authentication, Firestore)
- **Hosting**: GitHub Pages with custom domain (linguabud.com)

## Architecture

### Firebase Integration

The site uses Firebase SDK loaded from CDN (ES modules pattern):
- **lib/firebaseClient.js**: Centralized Firebase configuration and exports
  - Uses ES module imports from `gstatic.com/firebasejs/10.7.0/`
  - Exports auth, db, and Firestore functions for use by other pages
  - **IMPORTANT**: Firebase config with API keys is intentionally public (standard for client-side Firebase apps)

Pages using Firebase import as ES modules:
```javascript
import { auth, db, onAuthStateChanged, ... } from './lib/firebaseClient.js';
// or '../lib/firebaseClient.js' depending on file location
```

### Page Structure

The site has three main types of pages:

1. **Language Hub Pages** (New[Language]Page.html):
   - Landing pages for each language (e.g., NewFrenchPage.html, NewSpanishPage.html)
   - ~1280 lines each with consistent structure
   - Link to specific lessons and resources for that language

2. **Lesson Pages** ([Language][Topic].html):
   - Individual lessons by topic (e.g., FrenchBasics.html, SpanishAirport.html)
   - Topics include: Basics, Airport, Hotel, Restaurant, Day, Duck, Jack, King, Aladdin
   - Additional resources: Accents, Tortoise/Hare stories, Three Little Pigs

3. **Platform Pages**:
   - **index.html**: Main landing page with service descriptions and instructor showcase
   - **dashboard.html**: Instructor profile management (Firebase integrated)
   - **student-dashboard.html**: Student profile management (Firebase integrated)
   - **connect.html**: Language learning partner finder (Firebase integrated)
   - **login.html**: Authentication page (Firebase integrated)
   - **instructors.html**: Public instructor directory (Firebase integrated)
   - **Resources2.html**: Comprehensive resource index across all languages

### Navigation Pattern

All pages share a consistent Bootstrap navbar structure:
- Fixed-top navbar with logo (images/NewLogo8.png)
- Navigation: HOME, ABOUT, SERVICES, RESOURCES, INSTRUCTORS, CONNECT, LANGUAGES dropdown
- Languages dropdown links to New[Language]Page.html for 8 languages
- Language hub pages link back to index.html sections using hash anchors (index.html#header, index.html#services, etc.)
- CONNECT link navigates to connect.html for finding language learning partners

### Static Assets Organization

```
/
├── css/               # Styles (Bootstrap, Font Awesome, Swiper, Magnific Popup, custom)
├── js/                # JavaScript libraries (jQuery, Bootstrap, Swiper, etc.)
├── lib/               # Custom modules (firebaseClient.js)
├── images/            # Images and flags
├── Audio/             # Audio files for language lessons
├── webfonts/          # Font files
└── [Language]*.html   # Language-specific pages
```

## Common Development Tasks

### Working with Firebase-integrated pages

When modifying dashboard.html, login.html, student-dashboard.html, or instructors.html:
- These use ES module imports from lib/firebaseClient.js
- Must use `type="module"` in script tags
- Path to firebaseClient.js varies: `./lib/` for root pages, `../lib/` if nested
- Firebase operations are asynchronous (use async/await)

### Adding a new language lesson

1. Follow the naming convention: `[Language][Topic].html`
2. Copy structure from existing lesson in the same language
3. Maintain consistent navbar with proper links to hub page
4. Update the language hub page (New[Language]Page.html) to link to the new lesson
5. Consider adding to Resources2.html if it's a major resource

### Modifying shared navigation

The navbar is duplicated across ~100+ HTML files. Changes to navigation require:
- Updating the navbar section in affected pages
- Maintaining consistency in dropdown menu structure
- Ensuring proper relative paths (some pages link to `index.html#section`, others to `#section`)

### Working with instructor profiles

Instructor data is stored in Firebase Firestore:
- Collection: `instructors`
- Document ID: user's UID from Firebase Auth
- Fields include: name, avatar_url, languages_spoken, languages_teaching, price, currency, country, about_me

### Working with user profiles (Connect page)

Student/user data is stored in Firebase Firestore:
- Collection: `users`
- Document ID: user's UID from Firebase Auth
- Fields include:
  - name: User's full name
  - avatar_url: Profile picture URL (stored in Firebase Storage)
  - languages_spoken: Array of languages the user speaks
  - languages_learning: Array of languages the user is learning
  - country: User's native country
  - about_me: User bio/description
  - role: 'student' (distinguishes from instructors)
  - email: User's email address

The **connect.html** page:
- Displays all users from the 'users' collection as cards
- Filters by languages_learning, languages_spoken, and country
- Shows user profile modal when a card is clicked
- Requires authentication (redirects to login.html if not logged in)
- Excludes the current user from the results
- Future: Will include friend request and messaging functionality

The **student-dashboard.html** page allows users to:
- Set up their profile with name, country, and bio
- Add languages they speak and languages they're learning
- Upload a profile picture (stored in Firebase Storage)
- View and edit their existing profile

## Local Development

To run the site locally, use two separate terminals:

1. **Terminal 1 - Local Web Server**:
   ```bash
   npm run serve
   ```
   This serves the static HTML/CSS/JS files on a local development server (typically http://localhost:3000)

2. **Terminal 2 - Firebase Emulators**:
   ```bash
   npm run emulator
   ```
   This runs the Firebase emulators for Authentication, Firestore, and Storage locally

   **Data Persistence**: Emulator data now persists between sessions automatically. When you stop the emulator, all data (auth accounts, Firestore documents, Storage files) is exported to `firebase-emulator-data/` and automatically imported on the next startup.

Both must be running simultaneously for full functionality when testing Firebase-integrated pages (dashboard, login, student-dashboard, instructors, connect).

**Alternative**: You can try `npm run dev` to start both simultaneously, though running in separate terminals is more reliable.

**Reset Emulator Data**: To start fresh, delete the `firebase-emulator-data/` directory.

## Deployment

The site is deployed automatically via GitHub Pages:
- Branch: `main`
- Custom domain: linguabud.com (configured in CNAME)
- No build process - all changes to HTML/CSS/JS are immediately live after push

## Important Notes

- **No build tools**: This is a static site with no npm, webpack, or compilation
- **Inline scripts**: Most JavaScript is embedded in HTML files, not separate .js files (except for libraries)
- **Firebase config is public**: The API keys in lib/firebaseClient.js are safe to commit (client-side Firebase apps use security rules, not secret keys)
- **Browser imports**: Use ES module imports with full URLs for Firebase SDK
- **XSS prevention**: When displaying user-generated content (like instructor profiles), ensure proper escaping to prevent XSS attacks
