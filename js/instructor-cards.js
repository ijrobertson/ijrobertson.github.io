// Instructor cards for the tutor landing pages (spanish-tutors, later
// english-tutors), 2026-11-18. The card, ordering and price helpers are
// copied verbatim from instructors.html so the cards look and behave the
// same; keep them in step if that page's card changes.
// Use: setAvailability(map) with instructor_availability docs by id, then
// createInstructorCard(instructor) and observeCardVideo(card).

let availabilityMap = {};
export function setAvailability(map) { availabilityMap = map || {}; }

// Intro videos load only when the card scrolls near the viewport.
const videoObserver = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const video = entry.target;
            if (video.dataset.src && !video.getAttribute('src')) video.src = video.dataset.src;
            obs.unobserve(video);
        });
    }, { rootMargin: '200px 0px' })
    : null;
export function observeCardVideo(card) {
    const v = card.querySelector('.card-video-el[data-src]');
    if (v && videoObserver) videoObserver.observe(v);
}

const VIDEO_PREVIEW_START_SECONDS = {
    'njp0QrFfRwhB76J7onZ3tt0YTym1': 0.5 // Melissa
};

const FEATURED_INSTRUCTOR_IDS = [
    'YQW6oZ5e9ycWsAWeDaet5vMOeic2', // B. Michael James Crowe
    'njp0QrFfRwhB76J7onZ3tt0YTym1', // Melissa
    '2zo8BNoviLfo8Ld9JbxJUV8gJb62', // Alicia Velásquez
    'E0ZH8A0BiQe51wwh2tuzaDkJUMd2'  // Sara Hoyos
];

const USD_RATES = { USD: 1, EUR: 1.1, GBP: 1.3, CAD: 0.73, AUD: 0.66 };

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' };

function getNextAvailableDate(availability) {
    if (!availability || !availability.weeklySchedule) return null;
    const dayKeys = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const blocked = availability.blockedDates || [];
    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        if (blocked.includes(iso)) continue;
        const slots = availability.weeklySchedule[dayKeys[d.getDay()]] || [];
        if (slots.length > 0) return d;
    }
    return null;
}

function formatNextAvailable(date) {
    if (!date) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const tom = new Date(today); tom.setDate(today.getDate() + 1);
    if (date.getTime() === today.getTime()) return 'Available Today';
    if (date.getTime() === tom.getTime()) return 'Available Tomorrow';
    return 'Available ' + date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isPaymentReady(instructor) {
    return (instructor.chargesEnabled === true && instructor.payoutsEnabled === true) ||
           ((instructor.payoutMethod === 'wise' && !!instructor.wiseEmail) || instructor.paymentReady === true);
}

function priceInUsd(instructor) {
    const price = parseFloat(instructor.price_per_lesson) || 0;
    const code = (instructor.currency || 'USD').trim();
    return price * (USD_RATES[code] || 1);
}

function formatPrice(instructor) {
    const price = instructor.price_per_lesson;
    if (!price) return '';
    const code = (instructor.currency || 'USD').trim();
    const symbol = CURRENCY_SYMBOLS[code];
    return symbol ? `${symbol}${price} / hour` : `${code} ${price} / hour`;
}

function renderStarsHtml(rating) {
    const r = rating || 0;
    const full = Math.floor(r);
    const half = r - full >= 0.5;
    let html = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= full) html += '<i class="fas fa-star" style="color:#f5a623;font-size:0.85em;"></i>';
        else if (i === full + 1 && half) html += '<i class="fas fa-star-half-alt" style="color:#f5a623;font-size:0.85em;"></i>';
        else html += '<i class="far fa-star" style="color:#ddd;font-size:0.85em;"></i>';
    }
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function recommendedScore(instructor) {
    const next = getNextAvailableDate(availabilityMap[instructor.id]);
    const rated = instructor.reviewCount > 0;
    const featuredIndex = FEATURED_INSTRUCTOR_IDS.indexOf(instructor.id);
    let score = 0;
    if (next) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const days = Math.round((next.getTime() - today.getTime()) / 86400000);
        score += 1000 + (days <= 1 ? 5 : days <= 3 ? 3 : 0);
        if (rated) score += 1000;
    }
    if (rated) score += 20 + (instructor.averageRating || 0) * 2 + Math.min(instructor.reviewCount, 10);
    if (featuredIndex !== -1 && score < 1500) score = 1500 - featuredIndex;
    if (instructor.intro_video_url) score += 10;
    return score;
}

function createInstructorCard(instructor) {
    const spoken = instructor.languages_spoken || [];
    const teaching = instructor.languages_teaching || [];
    const priceDisplay = escapeHtml(formatPrice(instructor));
    const avatar = instructor.avatar_url || 'https://via.placeholder.com/100';
    const name = escapeHtml(instructor.name || 'Unnamed Instructor');
    const aboutMe = escapeHtml(instructor.about_me || 'No bio yet');
    const country = escapeHtml(instructor.native_country || 'Not specified');
    const hasVideo = !!instructor.intro_video_url;

    const card = document.createElement('div');
    card.className = 'instructor-card';

    const lessonsCount = Math.max(instructor.lessonsCount || 0, instructor.reviewCount || 0);
    const avail = availabilityMap[instructor.id];
    const nextDate = getNextAvailableDate(avail);
    const nextAvailLabel = formatNextAvailable(nextDate);

    const ratingHtml = instructor.reviewCount
        ? `<div class="instructor-card-rating">
               ${renderStarsHtml(instructor.averageRating)}
               <span class="rating-count">${instructor.averageRating.toFixed(1)} (${instructor.reviewCount})</span>
           </div>`
        : `<span class="new-instructor-badge"><i class="fas fa-star"></i> New</span>`;

    // A lesson count of zero is left off rather than shown as "0 lessons"
    const metaRowHtml = (lessonsCount > 0 || nextAvailLabel) ? `<div class="card-meta-row">
        ${lessonsCount > 0 ? `<span class="card-meta-item"><i class="fas fa-book-open"></i> ${lessonsCount} lesson${lessonsCount !== 1 ? 's' : ''}</span>` : ''}
        ${nextAvailLabel ? `<span class="card-meta-item next-avail"><i class="fas fa-calendar-check"></i> ${nextAvailLabel}</span>` : ''}
    </div>` : '';

    let cardHTML = hasVideo
        ? `<div class="card-video-container">
               <video class="card-video-el" data-src="${escapeHtml(instructor.intro_video_url)}" muted loop playsinline preload="metadata"></video>
               <div class="card-hover-overlay"><i class="fas fa-external-link-alt" style="margin-right:0.4rem;"></i> View Full Profile</div>
               <button class="card-play-btn" aria-label="Play intro video"><i class="fas fa-play"></i></button>
               <button class="card-mute-btn" aria-label="Toggle mute"><i class="fas fa-volume-off"></i></button>
           </div>
           <div class="instructor-card-header" style="padding-top:1rem;">
               <div class="instructor-card-name">${name}</div>
               ${priceDisplay ? `<div class="instructor-card-price">${priceDisplay}</div>` : ''}
               <div class="instructor-card-country"><i class="fas fa-map-marker-alt"></i> ${country}</div>
               ${ratingHtml}
               ${metaRowHtml}
           </div>
           <div class="instructor-card-body">`
        : `<div class="instructor-card-header">
               <div class="card-hover-overlay"><i class="fas fa-external-link-alt" style="margin-right:0.4rem;"></i> View Full Profile</div>
               <img class="instructor-card-avatar" src="${escapeHtml(avatar)}" alt="${name}" onerror="this.src='https://via.placeholder.com/100'">
               <div class="instructor-card-name">${name}</div>
               ${priceDisplay ? `<div class="instructor-card-price">${priceDisplay}</div>` : ''}
               <div class="instructor-card-country"><i class="fas fa-map-marker-alt"></i> ${country}</div>
               ${ratingHtml}
               ${metaRowHtml}
           </div>
           <div class="instructor-card-body">`;

    if (teaching.length > 0) {
        cardHTML += `
            <div class="language-section">
                <div class="language-section-title">Teaches</div>
                <div class="language-tags">
                    ${teaching.map(lang => `<span class="language-tag">${escapeHtml(lang)}</span>`).join('')}
                </div>
            </div>
        `;
    }

    if (spoken.length > 0) {
        cardHTML += `
            <div class="language-section">
                <div class="language-section-title">Speaks</div>
                <div class="language-tags">
                    ${spoken.map(lang => `<span class="language-tag">${escapeHtml(lang)}</span>`).join('')}
                </div>
            </div>
        `;
    }

    if (aboutMe && aboutMe !== 'No bio yet') {
        cardHTML += `
            <div class="language-section">
                <div class="language-section-title">About</div>
                <div class="about-preview">${aboutMe}</div>
            </div>
        `;
    }

    cardHTML += `
        </div>
        <div class="instructor-card-footer" style="flex-direction: column; align-items: stretch;">
            <a class="book-trial-btn" href="instructor-profile?id=${encodeURIComponent(instructor.id)}&book=trial">
                <i class="fas fa-gift"></i> Book Free Trial
            </a>
            <a class="view-profile-btn" href="instructor-profile?id=${encodeURIComponent(instructor.id)}" target="_blank" rel="noopener" data-instructor-id="${instructor.id}">
                View Full Profile
            </a>
        </div>
    `;

    card.innerHTML = cardHTML;

    // Card click → dedicated profile page in new tab
    card.addEventListener('click', () => {
        window.open(`instructor-profile?id=${instructor.id}`, '_blank');
    });

    // View Full Profile is a real link (crawlable); it opens the profile in a
    // new tab itself, so just keep the click from also triggering the card.
    const viewProfileBtn = card.querySelector('.view-profile-btn');
    viewProfileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    // Book Free Trial goes straight to the trial calendar on the profile page
    card.querySelector('.book-trial-btn').addEventListener('click', (e) => {
        e.stopPropagation();
    });

    if (hasVideo) {
        const videoEl  = card.querySelector('.card-video-el');
        const playBtn  = card.querySelector('.card-play-btn');
        const vidWrap  = card.querySelector('.card-video-container');
        videoEl.addEventListener('loadedmetadata', () => {
            if (videoEl.videoHeight > videoEl.videoWidth) {
                videoEl.style.objectFit = 'cover';
            }
            // Seek to first frame so mobile browsers render a thumbnail
            // instead of showing a black screen before the user hits play.
            videoEl.currentTime = VIDEO_PREVIEW_START_SECONDS[instructor.id] || 0.001;
        });
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (videoEl.dataset.src && !videoEl.getAttribute('src')) {
                videoEl.src = videoEl.dataset.src;
            }
            if (videoEl.paused) {
                videoEl.play().catch(() => {});
                playBtn.querySelector('i').className = 'fas fa-pause';
                playBtn.querySelector('i').style.marginLeft = '0';
                vidWrap.classList.add('is-playing');
            } else {
                videoEl.pause();
                playBtn.querySelector('i').className = 'fas fa-play';
                playBtn.querySelector('i').style.marginLeft = '3px';
                vidWrap.classList.remove('is-playing');
            }
        });
        const muteBtn = card.querySelector('.card-mute-btn');
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            videoEl.muted = !videoEl.muted;
            muteBtn.querySelector('i').className = videoEl.muted ? 'fas fa-volume-off' : 'fas fa-volume-up';
        });
    }

    return card;
}
// ── Spanish order (2026-11-18, Ian's choice) ─────────────────────────────
// On spanish-tutors, learn-spanish and instructors?language=Spanish: these
// six first, in this order, then every other Spanish instructor by most
// recent sign-in (publicUsers.lastActiveAt), so long-inactive instructors
// sink to the bottom and get fewer bookings they might miss.
export const SPANISH_PINNED_IDS = [
    'doxDE7putWSNb8FsQMJgctyVrHD3', // Ian Jack
    'OEujQqqzQmQYetsjExPUWFdcK552', // Melany Quintana
    'BnPoHjDVasZlWhhft8Ohr0eYJy22', // Veronica Monroy Martinez
    'njp0QrFfRwhB76J7onZ3tt0YTym1', // Melissa
    '2zo8BNoviLfo8Ld9JbxJUV8gJb62', // Alicia Velásquez
    'E0ZH8A0BiQe51wwh2tuzaDkJUMd2', // Sara Hoyos
];
// lastActive: { [uid]: milliseconds } — see lastActiveMapFrom().
export function sortSpanishRecommended(list, lastActive = {}) {
    const rank = (id) => { const i = SPANISH_PINNED_IDS.indexOf(id); return i === -1 ? Infinity : i; };
    return list.sort((a, b) => (rank(a.id) - rank(b.id))
        || ((lastActive[b.id] || 0) - (lastActive[a.id] || 0))
        || (recommendedScore(b) - recommendedScore(a)));
}
// Builds { uid: ms } from a publicUsers query snapshot (role == 'instructor').
export function lastActiveMapFrom(snapshot) {
    const map = {};
    snapshot.forEach((d) => {
        const t = d.data().lastActiveAt;
        map[d.id] = t && t.toMillis ? t.toMillis() : (t ? new Date(t).getTime() || 0 : 0);
    });
    return map;
}

// ── Reviews-and-activity order (2026-11-18, English pages) ────────────────
// For english-tutors, learn-english and instructors?language=English:
// 1) reviewed AND signed in within the last 30 days, 2) recently active,
// 3) reviewed but not recently active, 4) everyone else. Within a group:
// higher rating first (reviewed groups), then most recent sign-in.
export function sortByReviewsAndActivity(list, lastActive = {}, recentDays = 30) {
    const cutoff = Date.now() - recentDays * 86400000;
    const reviewed = (i) => (i.reviewCount || 0) > 0;
    const active = (i) => (lastActive[i.id] || 0) >= cutoff;
    const group = (i) => (reviewed(i) && active(i) ? 0 : active(i) ? 1 : reviewed(i) ? 2 : 3);
    return list.sort((a, b) => (group(a) - group(b))
        || ((reviewed(a) && reviewed(b)) ? ((b.averageRating || 0) - (a.averageRating || 0)) || ((b.reviewCount || 0) - (a.reviewCount || 0)) : 0)
        || ((lastActive[b.id] || 0) - (lastActive[a.id] || 0))
        || (recommendedScore(b) - recommendedScore(a)));
}

export { FEATURED_INSTRUCTOR_IDS, isPaymentReady, priceInUsd, formatPrice, recommendedScore, createInstructorCard, getNextAvailableDate, escapeHtml };
