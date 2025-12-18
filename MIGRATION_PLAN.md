# Migration Plan: Supabase to Firebase + Cleanup

## Overview
Migrate Lingua Bud from Supabase to Firebase and clean up unnecessary files.

---

## Part A: Directory Cleanup

### High Priority (Do First)
1. **Delete empty `CSS/` directory** - Only contains `.DS_Store`
2. **Delete `oldresources.html`** - Exact duplicate of `Resources2.html`
3. **Delete `test.html`** - Debug file with no purpose
4. **Delete `lib/supabaseClient.js`** - Unused module (each file has inline Supabase)
5. **Delete PHP files** - Non-functional on GitHub Pages:
   - `php/callmeform-process.php`
   - `php/contactform-process.php`
   - `php/privacyform-process.php`
   - `php/phpmail.php`

### Medium Priority
6. **Review `landingpage.html` vs `index.html`** - Determine if both are needed
7. **Review `tutors.html` vs `newtutors.html`** - Remove outdated version

---

## Part B: Firebase Migration

### Step 1: Firebase Project Setup
- Create new Firebase project at console.firebase.google.com
- Enable Authentication (Email/Password provider)
- Create Firestore database
- Create Storage bucket for avatars
- Get Firebase config credentials

### Step 2: Create Firebase Client Module
Create `lib/firebaseClient.js` with:
```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js";

const firebaseConfig = {
  // Your Firebase config here
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
```

### Step 3: Migrate Files (5 total)

#### 3.1 `login.html` - Authentication
**Current Supabase code:**
- `supabase.auth.signUp()`
- `supabase.auth.signInWithPassword()`
- `supabase.from('users').select('role')`

**Firebase equivalent:**
- `createUserWithEmailAndPassword(auth, email, password)`
- `signInWithEmailAndPassword(auth, email, password)`
- `doc(db, 'users', uid)` + `getDoc()`

#### 3.2 `dashboard.html` - Instructor Profile
**Current Supabase code:**
- `supabase.auth.getUser()`
- `supabase.from('instructors').select()`
- `supabase.from('instructors').upsert()`
- `supabase.storage.from('avatars').upload()`

**Firebase equivalent:**
- `onAuthStateChanged(auth, ...)`
- `getDoc(doc(db, 'instructors', uid))`
- `setDoc(doc(db, 'instructors', uid), data)`
- `uploadBytes(ref(storage, 'avatars/' + uid), file)`

#### 3.3 `student-dashboard.html` - Student Profile
Same pattern as dashboard.html but for `users` collection

#### 3.4 `instructors.html` - Browse Instructors
**Current Supabase code:**
- `supabase.from('instructors').select('*')`

**Firebase equivalent:**
- `getDocs(collection(db, 'instructors'))`

#### 3.5 Delete `lib/supabaseClient.js`
Replace with `lib/firebaseClient.js`

### Step 4: Firestore Data Structure

```
/users/{userId}
  - name: string
  - native_country: string
  - about_me: string
  - avatar_url: string
  - role: "student"
  - email: string

/instructors/{userId}
  - name: string
  - languages_spoken: array
  - languages_teaching: array
  - price_per_lesson: number
  - currency: string
  - about_me: string
  - native_country: string
  - avatar_url: string
  - email: string
```

### Step 5: Firebase Security Rules

```javascript
// Firestore Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /instructors/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}

// Storage Rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /avatars/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## Implementation Order

1. [ ] **Cleanup** - Delete unnecessary files (Part A)
2. [ ] **Firebase Setup** - User creates Firebase project and provides config
3. [ ] **Create firebaseClient.js** - Central Firebase initialization
4. [ ] **Migrate login.html** - Authentication first
5. [ ] **Migrate dashboard.html** - Instructor profiles
6. [ ] **Migrate student-dashboard.html** - Student profiles
7. [ ] **Migrate instructors.html** - Instructor listing
8. [ ] **Test all flows** - Sign up, sign in, profile edit, browse
9. [ ] **Delete Supabase references** - Remove old code

---

## Benefits of Firebase over Supabase

1. **Simpler Documentation** - Firebase docs are more beginner-friendly
2. **Easier Setup** - Console is more intuitive
3. **Better Free Tier** - Generous limits for small projects
4. **No SQL Required** - Firestore is NoSQL/document-based
5. **Wider Adoption** - More tutorials and community support
6. **Google Integration** - Easy to add Google Sign-In later

---

## Questions Before Proceeding

1. Do you have a Firebase project already, or should I guide you through creating one?
2. Should we keep any existing user data from Supabase?
3. Are there any features you'd like to add during this migration?
