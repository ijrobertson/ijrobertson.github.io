/**
 * video-call.js — Lingua Bud Video Call
 * Modern Google Meet / Zoom inspired UI
 *
 * Preserves all original Agora + Firebase integration.
 * New: slide-in panels, auto-hide controls, keyboard shortcuts,
 *      dedicated Dice panel, modern dark video UI.
 */

import {
    auth, db, functions,
    onAuthStateChanged, signOut,
    doc, getDoc, setDoc, deleteDoc, addDoc, updateDoc,
    collection, getDocs, query, where,
    onSnapshot,
    httpsCallable
} from './lib/firebaseClient.js';

// ════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════

const APP_ID = 'dfd628e44de640e3b7717f422d1dc3e7';
const WB_THROTTLE_MS = 50;       // ~20 whiteboard writes/sec max
const CONTROLS_HIDE_DELAY = 3500; // ms before controls auto-hide
const RATING_LABELS = ['', 'Needs Improvement', 'Fair', 'Good', 'Very Good', 'Excellent!'];

// ════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════

const state = {
    // Agora
    client: null,
    localAudioTrack: null,
    localVideoTrack: null,
    remoteUsers: {},
    remoteUserNames: {},

    // Auth / User
    currentUser: null,
    currentUserName: 'Guest',
    isInstructor: false,

    // Call state
    isMuted: false,
    isCameraOff: false,
    channelName: '',
    wasCallActive: false,
    callStartTime: null,
    callTimerInterval: null,

    // Firebase refs / listeners
    presenceRef: null,
    wbRelayRef: null,
    wbUnsubscribe: null,
    promptRelayRef: null,
    chatCol: null,
    chatUnsubscribe: null,

    // Whiteboard
    wbTool: 'pen',
    wbColor: '#000000',
    wbStrokeWidth: 2,
    wbIsDrawing: false,
    wbLastX: 0, wbLastY: 0,
    wbLastSentX: 0, wbLastSentY: 0,
    wbLastSentTime: 0,
    wbMyUid: null,
    wbJoinTime: 0,

    // Dice panel
    currentPromptCat: 'all',

    // UI
    activePanel: null,
    controlsHideTimer: null,
    controlsVisible: true,

    // Post-call rating
    selectedRating: 0,
    selectedAnswers: {},

    // Nav warning
    pendingNavHref: null,
};

// ════════════════════════════════════════════════════════════
// CONVERSATION PROMPT DATA (52 prompts across 8 categories)
// ════════════════════════════════════════════════════════════

const WB_PROMPTS = [
    // Speaking
    { cat:'speaking', icon:'⏱️', title:'60-Second Food Description', text:'Describe your favorite meal in 60 seconds — what does it look, smell, and taste like? Your partner takes notes on any errors to review together after.' },
    { cat:'speaking', icon:'⏱️', title:'Memorable Travel Story', text:'Talk about the most memorable trip or travel experience you have ever had. Use as many descriptive words as possible — your partner will ask three follow-up questions.' },
    { cat:'speaking', icon:'⏱️', title:'Ideal Day', text:'Describe your perfect day from the moment you wake up to when you go to sleep. Your partner will ask at least three follow-up questions to keep the conversation going.' },
    { cat:'speaking', icon:'⏱️', title:'90-Second Debate', text:'Pick a side: "Social media is more harmful than helpful." You have 90 seconds to make your argument — then swap sides and try to argue the opposite!' },
    { cat:'speaking', icon:'⏱️', title:'Speed Adjectives', text:'Name 10 adjectives that describe your own personality in 30 seconds. Your partner writes them down and then gives you honest feedback — do they agree?' },
    { cat:'speaking', icon:'⏱️', title:'Explain Your Job Simply', text:'Explain what your job (or studies) involves to someone who knows nothing about it. Use simple, everyday language — absolutely no jargon or technical terms!' },
    { cat:'speaking', icon:'⏱️', title:'Future Plans', text:'Describe where you see yourself in 5 years. Talk about your career, lifestyle, travel hopes, and personal goals — try to use future tense forms naturally throughout.' },
    { cat:'speaking', icon:'⏱️', title:'Childhood Hobby', text:'Tell your partner about a hobby or activity you loved as a child. Why did you love it? Do you still do it? Your partner asks at least two follow-up questions.' },
    // Vocabulary
    { cat:'vocab', icon:'📚', title:'Word Association', text:'Take turns — one person says a word, the other immediately says the first word that comes to mind. Keep going for 2 minutes without repeating or hesitating!' },
    { cat:'vocab', icon:'📚', title:'Category Sprint', text:'Name as many foods as you can in 45 seconds. Then switch — your partner tries to beat your score! Try again with: animals, furniture, emotions, or clothing.' },
    { cat:'vocab', icon:'📚', title:'Synonym Challenge', text:'Your partner picks any common word. Give 3 different synonyms for it without repeating. Then swap — who can find more? Check a dictionary together if needed.' },
    { cat:'vocab', icon:'📚', title:'Opposites Game', text:'Take turns saying a word. Your partner must immediately say the exact opposite. No hesitating — if they pause for more than 3 seconds, they lose a point!' },
    { cat:'vocab', icon:'📚', title:'Word in Context', text:'Your partner gives you any vocabulary word. Use it in a natural, meaningful sentence within 10 seconds. Swap after 5 rounds — who used the words most naturally?' },
    { cat:'vocab', icon:'📚', title:'Around the Room', text:'Look around wherever you are. Name 10 objects you can see, then describe what each one is used for — in a complete sentence for each one.' },
    { cat:'vocab', icon:'📚', title:'Taboo!', text:'Think of a word and describe it to your partner WITHOUT saying the word itself or any obvious related words. Your partner guesses! Take turns — 5 words each.' },
    { cat:'vocab', icon:'📚', title:'Collocations Challenge', text:'Your partner says a noun (e.g. "time," "money," "decision"). You must give 3 natural verbs or adjectives that go with it. Focus on natural word combinations!' },
    // Storytelling
    { cat:'stories', icon:'📖', title:'Three-Word Story', text:'Build a story together — take turns adding one sentence at a time. The story must include: a dog, a bus, and a mysterious letter. See where it goes!' },
    { cat:'stories', icon:'📖', title:'Finish the Story', text:'"It was the strangest morning of my life. I woke up and found a key on my pillow that I had never seen before…" Take turns adding sentences to continue the story!' },
    { cat:'stories', icon:'📖', title:'Twisted Fairy Tale', text:'Retell a classic fairy tale — but completely change the ending! Take turns adding sentences. Use as much past tense as you can and make it as dramatic as possible.' },
    { cat:'stories', icon:'📖', title:'Headline News', text:'Invent the most outrageous but detailed news headline you can, then tell the full story behind it. Your partner plays the journalist and asks probing questions.' },
    { cat:'stories', icon:'📖', title:'First Memory', text:'Share your earliest childhood memory in as much detail as possible. Use sensory language — what did you see, hear, smell, and feel? Your partner asks follow-up questions.' },
    { cat:'stories', icon:'📖', title:'Alternative Life', text:'Tell the story of what your life might look like if you had made one major decision differently. Your partner asks questions to keep the story moving forward.' },
    { cat:'stories', icon:'📖', title:'Story Dice', text:'Each person says 5 random nouns or adjectives. Together, you must build a coherent story using ALL 10 words — take turns sentence by sentence. No skipping words!' },
    // Role Play
    { cat:'roleplay', icon:'🎭', title:'At the Restaurant', text:'One person is the server, one is the customer. Order a meal, ask for recommendations — then the kitchen is out of your first choice. Handle it naturally and politely!' },
    { cat:'roleplay', icon:'🎭', title:'Lost Tourist', text:'One person is a tourist who is lost and speaks the local language poorly. The other is a friendly local. Help the tourist find a famous landmark using clear directions.' },
    { cat:'roleplay', icon:'🎭', title:'Job Interview', text:'One person interviews the other for a dream job of your choice. Use formal language, polite expressions, and full sentences. Swap roles after 5 minutes.' },
    { cat:'roleplay', icon:'🎭', title:"Doctor's Visit", text:'One person is a patient with a strange or funny set of symptoms. The other is the doctor — diagnose and recommend treatment using appropriate medical vocabulary.' },
    { cat:'roleplay', icon:'🎭', title:'Hotel Check-In', text:'One person calls to book a hotel. The other is the receptionist — but there is a complication (wrong room type, overbooked, or a billing issue). Resolve it politely.' },
    { cat:'roleplay', icon:'🎭', title:'Meeting a New Neighbor', text:'You have just moved in and meet your neighbor for the first time. Introduce yourself, ask about the neighborhood, and make small talk. Keep it warm and natural.' },
    { cat:'roleplay', icon:'🎭', title:'At the Airport', text:'One person has missed their flight and needs help at the service desk. The other is the airline employee. Rebook the ticket, discuss compensation, and stay calm!' },
    // Grammar
    { cat:'grammar', icon:'✏️', title:'Tense Switching', text:'Tell a 2-minute story about your day — but every other sentence must switch tenses (past → present → past). Your partner corrects any mistakes as you go.' },
    { cat:'grammar', icon:'✏️', title:'No Filler Words', text:'Have a 2-minute conversation on any topic — but you are NOT allowed to say "um," "uh," "like," or "you know." Your partner calls it out every single time!' },
    { cat:'grammar', icon:'✏️', title:'No Yes or No', text:'Your partner asks you 10 questions in a row. Answer each one in a full sentence WITHOUT using "yes" or "no." Then swap — who keeps it up longest?' },
    { cat:'grammar', icon:'✏️', title:'Conditional Challenge', text:'Take turns making "If… then…" sentences. Try to use all three forms: present conditional, past conditional, and perfect conditional.' },
    { cat:'grammar', icon:'✏️', title:'Connector Challenge', text:'Have a conversation on any topic — but every sentence you say must BEGIN with a different connector: however, therefore, meanwhile, although, despite, furthermore…' },
    { cat:'grammar', icon:'✏️', title:'Passive Voice Drill', text:'Describe everything that happened to you this morning using ONLY passive voice sentences ("I was woken up by…"). Your partner corrects anything that sounds unnatural.' },
    { cat:'grammar', icon:'✏️', title:'Question Master', text:'Have a full 3-minute conversation using ONLY questions — no statements allowed! Every single thing you say must be a question. It is harder than it sounds!' },
    // Culture
    { cat:'culture', icon:'🌍', title:'Holiday Traditions', text:'Each person shares their favorite holiday or festival from their own culture. What do people eat, wear, and do? What is the history behind it? Compare traditions!' },
    { cat:'culture', icon:'🌍', title:'Food Tour', text:'Name three dishes from your country that your partner absolutely must try. Describe each one in detail — ingredients, when people eat it, and why it matters to you.' },
    { cat:'culture', icon:'🌍', title:'Proverb Exchange', text:'Share a famous saying or proverb from your culture and explain what it means in practice. Does your partner\'s language have a similar one? Compare and discuss.' },
    { cat:'culture', icon:'🌍', title:'Music Recommendation', text:'Recommend a song in the target language. Explain the theme, why you like it, and what the lyrics mean. If you feel bold — sing or hum part of it!' },
    { cat:'culture', icon:'🌍', title:'Dream Destination', text:'Describe a place in your partner\'s country you would most love to visit. Why that place? What would you do there? Your partner gives you insider tips and local advice.' },
    { cat:'culture', icon:'🌍', title:'Daily Life Swap', text:'Compare a typical weekday in your life with what you imagine your partner\'s typical weekday looks like. Ask each other questions — you might be very surprised!' },
    { cat:'culture', icon:'🌍', title:'Untranslatable Words', text:'Think of a word or concept from your language that is very hard to translate. Explain it to your partner. Do they have something similar in their language?' },
    // Pronunciation
    { cat:'pronunciation', icon:'🎤', title:'Read Aloud', text:'Each person finds a paragraph from any website or article in the target language and reads it aloud. Give each other honest, constructive feedback on pronunciation.' },
    { cat:'pronunciation', icon:'🎤', title:'Minimal Pairs', text:'Your partner says a word. You repeat it back. They then change just ONE sound — can you hear the difference? Practice with words that sound almost identical.' },
    { cat:'pronunciation', icon:'🎤', title:'Dictation Challenge', text:'One person slowly reads 3–4 sentences from any text; the other types or writes exactly what they hear. Compare results and discuss the gaps or mishearings.' },
    { cat:'pronunciation', icon:'🎤', title:'Shadowing Practice', text:'Find a short video or audio clip in the target language (30–60 seconds). Both of you listen, then each tries to repeat what the speaker said as closely as possible.' },
    { cat:'pronunciation', icon:'🎤', title:'Intonation Shift', text:'Say the sentence "I never said she stole the money" — stress a DIFFERENT word each time. Notice how the meaning shifts! Discuss how intonation works in each language.' },
    { cat:'pronunciation', icon:'🎤', title:'Accent Analysis', text:'Speak 5 natural sentences. Your partner describes your accent — which region or influence do they hear? Discuss what sounds are trickiest for each of you to produce.' },
    { cat:'pronunciation', icon:'🎤', title:'Slow to Fast', text:'Pick a tongue twister or complex sentence in the target language. Say it slowly three times, then gradually speed up. Your partner scores you 1–10 on clarity!' },
    // Games
    { cat:'games', icon:'🎮', title:'20 Questions', text:'One person thinks of a famous person, animal, or object. The other asks up to 20 yes/no questions to guess it. Take turns — play two rounds each. All questions must be in full sentences!' },
    { cat:'games', icon:'🎮', title:'Two Truths and a Lie', text:'Each person says three statements about themselves — two true, one a lie. Your partner must guess which one is false. Try to make all three sound equally believable!' },
    { cat:'games', icon:'🎮', title:'Word Chain', text:'One person says any word. The next must say a word that BEGINS with the last letter of the previous word. No repeating! Hesitate for more than 5 seconds — you lose a point.' },
    { cat:'games', icon:'🎮', title:'Hot Seat', text:'One person sits in the "hot seat" and must answer any question their partner asks — truthfully, in full sentences. Swap after 10 questions. Great for practicing question forms!' },
    { cat:'games', icon:'🎮', title:'Pictionary Twist', text:'Use the whiteboard! One person draws something — no letters or numbers. The other must describe what they see in the target language and then guess what it is.' },
    { cat:'games', icon:'🎮', title:'Celebrity Guess', text:'Think of a famous person. Describe their appearance, personality, and career WITHOUT saying their name. Your partner asks yes/no questions to guess who it is. Swap after 3 rounds.' },
    { cat:'games', icon:'🎮', title:'Alphabet Story', text:'Together, build a story where each sentence starts with the next letter of the alphabet — A, B, C… all the way to Z. Take turns, one sentence each. Full sentences only!' },
];

// ════════════════════════════════════════════════════════════
// DOM ELEMENT REFS
// ════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

// Pre-join
const channelInput   = $('channelName');
const joinBtn        = $('joinBtn');
const copyRoomBtn    = $('copyRoomBtn');
const pjStatus       = $('pj-status');

// In-call
const screenCall     = $('screen-call');
const vcRoomName     = $('vc-room-name');
const vcCopyRoom     = $('vc-copy-room');
const callDuration   = $('callDuration');
const vcQuality      = $('vc-quality');
const vcQualityLabel = $('vc-quality-label');
const remoteStream   = $('vc-remote-stream');
const remoteName     = $('vc-remote-name');
const vcWaiting      = $('vc-waiting');
const localPip       = $('vc-local-pip');
const localStream    = $('vc-local-stream');
const localName      = $('vc-local-name');
const vcControls     = $('vc-controls');
const vcTopBar       = $('vc-top-bar');

// Control buttons
const btnMute        = $('btn-mute');
const btnCamera      = $('btn-camera');
const btnLeave       = $('btn-leave');
const btnParticipants= $('btn-participants');
const btnChat        = $('btn-chat');
const btnDice        = $('btn-dice');
const btnWhiteboard  = $('btn-whiteboard');
const btnPip         = $('btn-pip');

// Panels
const panelBackdrop  = $('panel-backdrop');
const participantBadge = $('participant-badge');
const chatBadge      = $('chat-badge');

// Chat
const chatMessages   = $('chat-messages');
const chatInput      = $('chat-input');
const chatSendBtn    = $('chat-send-btn');

// Dice
const diceRollBtn    = $('dice-roll-btn');
const diceEmptyState = $('dice-empty-state');
const dicePromptContent = $('dice-prompt-content');
const diceCatLabel   = $('dice-prompt-cat-label');
const diceTitle      = $('dice-prompt-title');
const diceText       = $('dice-prompt-text');
const diceBy         = $('dice-prompt-by');
const diceCard       = $('dice-prompt-card');

// Whiteboard
const wbCanvas       = $('whiteboard-canvas');
const wbCtx          = wbCanvas.getContext('2d');
const wbPenBtn       = $('wb-pen-btn');
const wbEraserBtn    = $('wb-eraser-btn');
const wbClearBtn     = $('wb-clear-btn');

// Rating
const ratingPopup    = $('ratingPopup');
const starRatingEl   = $('starRating');
const ratingLabel    = $('ratingLabel');
const ratingSubmitBtn= $('ratingSubmitBtn');
const ratingSkipBtn  = $('ratingSkipBtn');

// Nav warning
const navWarning     = $('call-nav-warning');

// ════════════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════════════

/** Switch between screens */
function showScreen(id) {
    ['screen-prejoin', 'screen-loading', 'screen-call'].forEach(s => {
        const el = $(s);
        if (el) el.classList.toggle('hidden', s !== id);
    });
}

/** Show a brief toast notification */
function showToast(msg, type = 'info', duration = 3200) {
    const container = $('vc-toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `vc-toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

/** Update the loading screen message */
function setLoadingMsg(msg) {
    const el = $('loading-msg');
    if (el) el.textContent = msg;
}

/** Show the pre-join status area */
function showPjStatus(msg, type = 'info') {
    pjStatus.textContent = msg;
    pjStatus.className = `pj-status ${type}`;
    pjStatus.classList.remove('hidden');
    if (type === 'success' || type === 'info') {
        setTimeout(() => pjStatus.classList.add('hidden'), 5000);
    }
}

/** Format elapsed call seconds as MM:SS or H:MM:SS */
function formatDuration(elapsed) {
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const p = n => String(n).padStart(2, '0');
    return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function updateCallTimer() {
    if (!state.callStartTime) return;
    const elapsed = Math.floor((Date.now() - state.callStartTime) / 1000);
    callDuration.textContent = formatDuration(elapsed);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════════════════════
// CONTROL BAR AUTO-HIDE
// ════════════════════════════════════════════════════════════

function showControls() {
    if (!state.controlsVisible) {
        state.controlsVisible = true;
        vcControls.classList.remove('controls-hidden');
        vcTopBar.classList.remove('controls-hidden');
    }
    resetHideTimer();
}

function hideControls() {
    // Don't hide if a panel is open
    if (state.activePanel) return;
    state.controlsVisible = false;
    vcControls.classList.add('controls-hidden');
    vcTopBar.classList.add('controls-hidden');
}

function resetHideTimer() {
    clearTimeout(state.controlsHideTimer);
    state.controlsHideTimer = setTimeout(hideControls, CONTROLS_HIDE_DELAY);
}

function setupControlsAutoHide() {
    // Show on any mouse movement or touch
    screenCall.addEventListener('mousemove', showControls);
    screenCall.addEventListener('touchstart', showControls, { passive: true });
    screenCall.addEventListener('click', showControls);
    // Don't auto-hide when hovering the control bar
    vcControls.addEventListener('mouseenter', () => clearTimeout(state.controlsHideTimer));
    vcControls.addEventListener('mouseleave', resetHideTimer);
}

// ════════════════════════════════════════════════════════════
// PANEL MANAGEMENT
// ════════════════════════════════════════════════════════════

const PANEL_IDS = ['participants', 'chat', 'dice', 'whiteboard'];

function openPanel(panelId) {
    // Close any open panel first
    if (state.activePanel && state.activePanel !== panelId) {
        _closePanel(state.activePanel, false);
    }
    state.activePanel = panelId;

    const panel = $(`panel-${panelId}`);
    if (panel) panel.classList.add('panel-open');

    panelBackdrop.classList.remove('hidden');
    showControls(); // always show controls when panel opens

    // On desktop, push the video area
    if (window.innerWidth > 768) {
        const isWide = panelId === 'whiteboard';
        screenCall.classList.toggle('panel-open-wide', isWide);
        screenCall.classList.toggle('panel-open-narrow', !isWide);
    }

    // Mark button active
    const btn = $(`btn-${panelId}`);
    if (btn) btn.classList.add('btn-active');
}

function closePanel(panelId) {
    _closePanel(panelId, true);
}

function _closePanel(panelId, clearActive) {
    const panel = $(`panel-${panelId}`);
    if (panel) panel.classList.remove('panel-open');

    if (clearActive) {
        state.activePanel = null;
        panelBackdrop.classList.add('hidden');
        screenCall.classList.remove('panel-open-wide', 'panel-open-narrow');
        resetHideTimer();
    }

    const btn = $(`btn-${panelId}`);
    if (btn) btn.classList.remove('btn-active');
}

function closeAllPanels() {
    PANEL_IDS.forEach(id => _closePanel(id, false));
    state.activePanel = null;
    panelBackdrop.classList.add('hidden');
    screenCall.classList.remove('panel-open-wide', 'panel-open-narrow');
    resetHideTimer();
}

function togglePanel(panelId) {
    if (state.activePanel === panelId) {
        closePanel(panelId);
    } else {
        openPanel(panelId);
    }
}

// Wire up panel toggle buttons and close buttons
function setupPanels() {
    // Toggle buttons in control bar
    [btnParticipants, btnChat, btnDice, btnWhiteboard].forEach(btn => {
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panelId = btn.dataset.panel;
            togglePanel(panelId);
        });
    });

    // Close buttons inside panels
    document.querySelectorAll('.panel-close-btn').forEach(btn => {
        btn.addEventListener('click', () => closePanel(btn.dataset.panel));
    });

    // Backdrop click closes
    panelBackdrop.addEventListener('click', closeAllPanels);
}

// ════════════════════════════════════════════════════════════
// AGORA — JOIN / LEAVE
// ════════════════════════════════════════════════════════════

async function initAgora() {
    state.client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    state.client.on('user-published',   handleUserPublished);
    state.client.on('user-unpublished', handleUserUnpublished);
    state.client.on('user-left',        handleUserLeft);
}

async function joinChannel() {
    const channel = channelInput.value.trim();
    if (!channel) { showPjStatus('Please enter a room code.', 'error'); return; }

    showScreen('screen-loading');
    setLoadingMsg('Generating secure token…');

    try {
        if (!state.client) await initAgora();

        // Generate Agora token via Firebase Cloud Function
        const generateToken = httpsCallable(functions, 'generateAgoraToken');
        const result = await generateToken({ channelName: channel, uid: state.currentUser.uid });
        if (!result.data?.token) throw new Error('Failed to get token from server');

        setLoadingMsg('Joining channel…');
        const actualUid = await state.client.join(APP_ID, channel, result.data.token, result.data.uid);

        state.channelName    = channel;
        state.wasCallActive  = true;
        state.wbMyUid        = String(actualUid);
        state.wbJoinTime     = Date.now();

        setLoadingMsg('Starting camera & microphone…');
        [state.localAudioTrack, state.localVideoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();

        // Play local video in self-PiP
        state.localVideoTrack.play(localStream);
        localName.textContent = state.currentUserName;

        // Publish to channel
        await state.client.publish([state.localAudioTrack, state.localVideoTrack]);

        // Register presence & whiteboard relay
        await registerPresence(actualUid, channel);
        setupWhiteboardRelay(channel);
        setupChatListener(channel);

        // Start call timer
        state.callStartTime = Date.now();
        state.callTimerInterval = setInterval(updateCallTimer, 1000);
        updateCallTimer();

        // Update UI
        vcRoomName.textContent = channel;
        showScreen('screen-call');
        setupControlsAutoHide();
        resetHideTimer();
        updateParticipantsList();
        showToast('Connected to call', 'success');

        // Monitor connection quality
        setupQualityMonitor();

    } catch (err) {
        console.error('Join error:', err);
        showScreen('screen-prejoin');
        let msg = `Could not join: ${err.message}`;
        if (err.message?.includes('CAN_NOT_GET_GATEWAY_SERVER')) {
            msg = 'Token error — please check the Agora console configuration.';
        }
        showPjStatus(msg, 'error');
    }
}

async function leaveChannel() {
    clearTimeout(state.controlsHideTimer);
    clearInterval(state.callTimerInterval);
    state.callStartTime = null;
    callDuration.textContent = '00:00';

    // Stop local tracks
    if (state.localAudioTrack) { state.localAudioTrack.close(); state.localAudioTrack = null; }
    if (state.localVideoTrack) { state.localVideoTrack.close(); state.localVideoTrack = null; }

    // Teardown whiteboard
    if (state.wbUnsubscribe) { state.wbUnsubscribe(); state.wbUnsubscribe = null; }
    if (state.wbRelayRef)    { deleteDoc(state.wbRelayRef).catch(() => {}); state.wbRelayRef = null; }
    state.wbMyUid = null;

    // Teardown chat
    if (state.chatUnsubscribe) { state.chatUnsubscribe(); state.chatUnsubscribe = null; }
    state.chatCol = null;
    state.promptRelayRef = null;

    // Clear presence
    await clearPresence();

    // Leave Agora channel
    if (state.client) {
        state.remoteUsers = {};
        await state.client.leave();
    }

    // Reset UI
    closeAllPanels();
    remoteName.textContent = '';
    vcWaiting.style.display = 'flex';
    localName.textContent = '';
    remoteStream.innerHTML = '';
    localStream.innerHTML = '';
    chatMessages.innerHTML = `<div class="chat-empty"><i class="fas fa-comment-slash"></i><p>No messages yet. Start the conversation!</p></div>`;
    chatInput.value = '';
    wbInitCanvas();
    state.isMuted = false;
    state.isCameraOff = false;
    updateMuteUI();
    updateCameraUI();
    navWarning.classList.add('hidden');
    _closePipOverlay();

    const hadActiveCall = state.wasCallActive;
    state.wasCallActive = false;

    showScreen('screen-prejoin');
    channelInput.disabled = false;
    joinBtn.disabled = false;

    if (hadActiveCall) {
        maybeShowRatingPopup().catch(console.error);
    }
}

// ════════════════════════════════════════════════════════════
// AGORA EVENT HANDLERS
// ════════════════════════════════════════════════════════════

async function handleUserPublished(user, mediaType) {
    state.remoteUsers[user.uid] = user;
    await state.client.subscribe(user, mediaType);

    if (mediaType === 'video') {
        // Look up display name
        if (!state.remoteUserNames[user.uid]) {
            state.remoteUserNames[user.uid] = await lookupRemoteName(user.uid) || 'Guest';
        }
        // Show remote video in main area
        vcWaiting.style.display = 'none';
        remoteStream.innerHTML = '';
        user.videoTrack.play(remoteStream);
        remoteName.textContent = state.remoteUserNames[user.uid];
    }
    if (mediaType === 'audio') {
        user.audioTrack.play();
    }

    updateParticipantsList();
}

function handleUserUnpublished(user, mediaType) {
    if (mediaType === 'video') {
        // If this was our main remote user, show waiting overlay
        if (!Object.values(state.remoteUsers).some(u => u.uid !== user.uid && u.videoTrack)) {
            vcWaiting.style.display = 'flex';
            remoteName.textContent = '';
        }
    }
}

function handleUserLeft(user) {
    delete state.remoteUsers[user.uid];
    delete state.remoteUserNames[user.uid];
    if (Object.keys(state.remoteUsers).length === 0) {
        vcWaiting.style.display = 'flex';
        remoteName.textContent = '';
        remoteStream.innerHTML = '';
    }
    updateParticipantsList();
    showToast(`${state.remoteUserNames[user.uid] || 'Participant'} left the call`);
}

// ════════════════════════════════════════════════════════════
// MUTE / CAMERA CONTROLS
// ════════════════════════════════════════════════════════════

function toggleMute() {
    if (!state.localAudioTrack) return;
    state.isMuted = !state.isMuted;
    state.localAudioTrack.setMuted(state.isMuted);
    updateMuteUI();
    showToast(state.isMuted ? 'Microphone muted' : 'Microphone on');
}

function toggleCamera() {
    if (!state.localVideoTrack) return;
    state.isCameraOff = !state.isCameraOff;
    state.localVideoTrack.setMuted(state.isCameraOff);
    updateCameraUI();
    showToast(state.isCameraOff ? 'Camera off' : 'Camera on');
}

function updateMuteUI() {
    const muted = state.isMuted;
    btnMute.classList.toggle('btn-off', muted);
    btnMute.querySelector('i').className = muted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
    btnMute.title = muted ? 'Unmute (M)' : 'Mute (M)';
    const pipMute = $('pip-mute-btn');
    if (pipMute) {
        pipMute.classList.toggle('muted', muted);
        pipMute.querySelector('i').className = muted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
    }
}

function updateCameraUI() {
    const off = state.isCameraOff;
    btnCamera.classList.toggle('btn-off', off);
    btnCamera.querySelector('i').className = off ? 'fas fa-video-slash' : 'fas fa-video';
    btnCamera.title = off ? 'Show Camera (V)' : 'Hide Camera (V)';
    const pipCam = $('pip-camera-btn');
    if (pipCam) {
        pipCam.classList.toggle('cam-off', off);
        pipCam.querySelector('i').className = off ? 'fas fa-video-slash' : 'fas fa-video';
    }
}

// ════════════════════════════════════════════════════════════
// PARTICIPANTS LIST
// ════════════════════════════════════════════════════════════

function updateParticipantsList() {
    const list = $('participants-list');
    if (!list) return;

    list.innerHTML = '';

    // Local user
    list.appendChild(createParticipantItem(state.currentUserName, true, state.isMuted, state.isCameraOff));

    // Remote users
    Object.values(state.remoteUsers).forEach(user => {
        const name = state.remoteUserNames[user.uid] || 'Guest';
        list.appendChild(createParticipantItem(name, false, false, false));
    });

    // Update count badge on button
    const total = 1 + Object.keys(state.remoteUsers).length;
    participantBadge.textContent = total;
    participantBadge.classList.toggle('hidden', total <= 1);
}

function createParticipantItem(name, isLocal, muted, camOff) {
    const item = document.createElement('div');
    item.className = 'participant-item';
    const initial = (name || '?')[0].toUpperCase();
    item.innerHTML = `
        <div class="participant-avatar">${escapeHtml(initial)}</div>
        <span class="participant-name">${escapeHtml(name)}</span>
        ${isLocal ? '<span class="participant-you">You</span>' : ''}
        <div class="participant-icons">
            ${muted  ? '<i class="fas fa-microphone-slash muted" title="Muted"></i>' : '<i class="fas fa-microphone" title="Mic on"></i>'}
            ${camOff ? '<i class="fas fa-video-slash muted" title="Camera off"></i>' : ''}
        </div>`;
    return item;
}

// ════════════════════════════════════════════════════════════
// FIREBASE PRESENCE
// ════════════════════════════════════════════════════════════

async function registerPresence(agoraUid, channel) {
    if (!state.currentUser || state.currentUser.uid.startsWith('guest-')) return;
    try {
        state.presenceRef = doc(db, 'video_calls', channel, 'presence', String(agoraUid));
        await setDoc(state.presenceRef, {
            name: state.currentUserName,
            userId: state.currentUser.uid,
            joinedAt: Date.now()
        });
    } catch (e) { console.warn('Presence register failed:', e); }
}

async function clearPresence() {
    if (!state.presenceRef) return;
    try { await deleteDoc(state.presenceRef); } catch (e) { /* non-critical */ }
    state.presenceRef = null;
}

async function lookupRemoteName(agoraUid) {
    try {
        if (!state.channelName) return null;
        const snap = await getDoc(doc(db, 'video_calls', state.channelName, 'presence', String(agoraUid)));
        return snap.exists() ? snap.data().name || null : null;
    } catch (e) { return null; }
}

// ════════════════════════════════════════════════════════════
// CHAT (uses whiteboard textboard collection)
// ════════════════════════════════════════════════════════════

function setupChatListener(channel) {
    state.chatCol = collection(db, 'whiteboard', channel, 'textboard');
    state.chatUnsubscribe = onSnapshot(state.chatCol, (snap) => {
        snap.docChanges().forEach(change => {
            if (change.type !== 'added') return;
            const data = change.doc.data();
            if (data.ts && data.ts < state.wbJoinTime) return;
            // Skip own messages — rendered locally on send
            if (data.senderUid && data.senderUid === state.currentUser?.uid) return;
            renderChatMessage(data, false);
        });
    });
}

function renderChatMessage(data, isOwn) {
    // Remove empty state if present
    const empty = chatMessages.querySelector('.chat-empty');
    if (empty) empty.remove();

    const time = data.ts ? new Date(data.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const div = document.createElement('div');
    div.className = `chat-message ${isOwn ? 'own' : 'other'}`;
    div.innerHTML = `
        <div class="chat-msg-sender">${escapeHtml(data.sender || 'Guest')}</div>
        <div class="chat-msg-bubble">${escapeHtml(data.text || '')}</div>
        <div class="chat-msg-time">${time}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Unread badge when chat is closed
    if (state.activePanel !== 'chat' && !isOwn) {
        const current = parseInt(chatBadge.textContent || '0', 10);
        chatBadge.textContent = current + 1;
        chatBadge.classList.remove('hidden');
    }
}

async function sendChatMessage() {
    if (!state.chatCol) return;
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Render locally immediately
    renderChatMessage({ text, sender: state.currentUserName, senderUid: state.currentUser?.uid, ts: Date.now() }, true);

    try {
        await addDoc(state.chatCol, {
            text,
            sender: state.currentUserName,
            senderUid: state.currentUser?.uid,
            ts: Date.now()
        });
    } catch (e) { console.warn('Chat send error:', e); }
}

// ════════════════════════════════════════════════════════════
// DICE / CONVERSATION CHALLENGE
// ════════════════════════════════════════════════════════════

function generatePrompt() {
    const pool = state.currentPromptCat === 'all'
        ? WB_PROMPTS
        : WB_PROMPTS.filter(p => p.cat === state.currentPromptCat);
    if (!pool.length) return;

    const prompt = pool[Math.floor(Math.random() * pool.length)];
    showPrompt(prompt, state.currentUserName, false);

    // Sync to remote via Firebase
    if (state.promptRelayRef) {
        setDoc(state.promptRelayRef, {
            t: 'prompt',
            icon: prompt.icon,
            title: prompt.title,
            text: prompt.text,
            generatedBy: state.currentUserName,
            ts: Date.now()
        }).catch(e => console.warn('Prompt sync error:', e));
    }
}

function showPrompt(prompt, generatedBy, fromRemote) {
    diceEmptyState.classList.add('hidden');
    dicePromptContent.classList.remove('hidden');

    const catMap = {
        speaking: '⏱️ Speaking', vocab: '📚 Vocabulary',
        stories: '📖 Storytelling', roleplay: '🎭 Role Play',
        grammar: '✏️ Grammar', culture: '🌍 Culture',
        pronunciation: '🎤 Pronunciation', games: '🎮 Games'
    };
    const catKey = WB_PROMPTS.find(p => p.title === prompt.title)?.cat || '';
    diceCatLabel.textContent = catMap[catKey] || '';
    diceTitle.textContent = (prompt.icon || '') + ' ' + (prompt.title || '');
    diceText.textContent  = prompt.text || '';
    diceBy.textContent    = generatedBy ? `Rolled by ${generatedBy}` : '';

    // Animate the card
    diceCard.classList.remove('rolled');
    void diceCard.offsetWidth; // trigger reflow
    diceCard.classList.add('rolled');

    // Auto-open dice panel for remote participants
    if (fromRemote && state.activePanel !== 'dice') {
        openPanel('dice');
        showToast(`${generatedBy} rolled a new challenge!`, 'info', 4000);
    }
}

// ════════════════════════════════════════════════════════════
// WHITEBOARD
// ════════════════════════════════════════════════════════════

function setupWhiteboardRelay(channel) {
    state.wbRelayRef     = doc(db, 'whiteboard', channel, 'relay', state.wbMyUid);
    state.promptRelayRef = doc(db, 'whiteboard', channel, 'relay', 'current-prompt');
    const relayCol       = collection(db, 'whiteboard', channel, 'relay');

    state.wbUnsubscribe = onSnapshot(relayCol, (snap) => {
        snap.docChanges().forEach(change => {
            if (change.type !== 'added' && change.type !== 'modified') return;
            if (change.doc.id === state.wbMyUid) return; // skip own
            const data = change.doc.data();
            if (data.t === 'prompt') { wbHandleRemoteAction(data); return; }
            if (data.ts && data.ts < state.wbJoinTime) return;
            wbHandleRemoteAction(data);
        });
    });
}

function wbGetPos(e) {
    const rect   = wbCanvas.getBoundingClientRect();
    const scaleX = wbCanvas.width  / rect.width;
    const scaleY = wbCanvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top)  * scaleY
    };
}

function wbDrawSegment(x1, y1, x2, y2, color, width, isErase) {
    wbCtx.beginPath();
    wbCtx.moveTo(x1, y1);
    wbCtx.lineTo(x2, y2);
    wbCtx.strokeStyle = isErase ? '#ffffff' : color;
    wbCtx.lineWidth   = width;
    wbCtx.lineCap     = 'round';
    wbCtx.lineJoin    = 'round';
    wbCtx.stroke();
}

function wbSend(msgObj, toX, toY) {
    if (!state.wbRelayRef) return;
    const now = Date.now();
    if (now - state.wbLastSentTime < WB_THROTTLE_MS) return;
    state.wbLastSentTime = now;
    state.wbLastSentX = toX;
    state.wbLastSentY = toY;
    setDoc(state.wbRelayRef, { ...msgObj, ts: now }).catch(e => console.warn('WB send error:', e));
}

function wbHandleRemoteAction(msg) {
    if (msg.t === 'd' || msg.t === 'e') {
        wbDrawSegment(
            msg.x1 * wbCanvas.width,  msg.y1 * wbCanvas.height,
            msg.x2 * wbCanvas.width,  msg.y2 * wbCanvas.height,
            msg.c, msg.w, msg.t === 'e'
        );
    } else if (msg.t === 'cl') {
        wbInitCanvas();
    } else if (msg.t === 'prompt') {
        showPrompt({ icon: msg.icon, title: msg.title, text: msg.text }, msg.generatedBy, true);
    }
}

function wbInitCanvas() {
    wbCtx.fillStyle = '#ffffff';
    wbCtx.fillRect(0, 0, wbCanvas.width, wbCanvas.height);
}

// Canvas mouse events
wbCanvas.addEventListener('mousedown', e => {
    state.wbIsDrawing = true;
    const pos = wbGetPos(e);
    state.wbLastX = state.wbLastSentX = pos.x;
    state.wbLastY = state.wbLastSentY = pos.y;
});

wbCanvas.addEventListener('mousemove', e => {
    if (!state.wbIsDrawing) return;
    const pos    = wbGetPos(e);
    const isErase = state.wbTool === 'eraser';
    const sw     = isErase ? state.wbStrokeWidth * 4 : state.wbStrokeWidth;
    wbDrawSegment(state.wbLastX, state.wbLastY, pos.x, pos.y, state.wbColor, sw, isErase);
    wbSend({
        t:  isErase ? 'e' : 'd',
        x1: parseFloat((state.wbLastSentX / wbCanvas.width).toFixed(4)),
        y1: parseFloat((state.wbLastSentY / wbCanvas.height).toFixed(4)),
        x2: parseFloat((pos.x / wbCanvas.width).toFixed(4)),
        y2: parseFloat((pos.y / wbCanvas.height).toFixed(4)),
        c:  state.wbColor,
        w:  sw
    }, pos.x, pos.y);
    state.wbLastX = pos.x;
    state.wbLastY = pos.y;
});

wbCanvas.addEventListener('mouseup',    () => { state.wbIsDrawing = false; });
wbCanvas.addEventListener('mouseleave', () => { state.wbIsDrawing = false; });

// Canvas touch events
wbCanvas.addEventListener('touchstart', e => {
    e.preventDefault();
    state.wbIsDrawing = true;
    const pos = wbGetPos(e);
    state.wbLastX = state.wbLastSentX = pos.x;
    state.wbLastY = state.wbLastSentY = pos.y;
}, { passive: false });

wbCanvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!state.wbIsDrawing) return;
    const pos    = wbGetPos(e);
    const isErase = state.wbTool === 'eraser';
    const sw     = isErase ? state.wbStrokeWidth * 4 : state.wbStrokeWidth;
    wbDrawSegment(state.wbLastX, state.wbLastY, pos.x, pos.y, state.wbColor, sw, isErase);
    wbSend({
        t:  isErase ? 'e' : 'd',
        x1: parseFloat((state.wbLastSentX / wbCanvas.width).toFixed(4)),
        y1: parseFloat((state.wbLastSentY / wbCanvas.height).toFixed(4)),
        x2: parseFloat((pos.x / wbCanvas.width).toFixed(4)),
        y2: parseFloat((pos.y / wbCanvas.height).toFixed(4)),
        c:  state.wbColor,
        w:  sw
    }, pos.x, pos.y);
    state.wbLastX = pos.x;
    state.wbLastY = pos.y;
}, { passive: false });

wbCanvas.addEventListener('touchend',   () => { state.wbIsDrawing = false; });
wbCanvas.addEventListener('touchcancel',() => { state.wbIsDrawing = false; });

// ════════════════════════════════════════════════════════════
// CONNECTION QUALITY MONITOR
// ════════════════════════════════════════════════════════════

function setupQualityMonitor() {
    if (!state.client) return;
    setInterval(async () => {
        if (!state.client || !state.client.getRTCStats) return;
        try {
            const stats = state.client.getRTCStats();
            // Simple heuristic: RTT > 300ms = poor, > 150ms = fair
            const rtt = stats.RTT || 0;
            const el = $('vc-quality');
            const label = $('vc-quality-label');
            if (!el || !label) return;
            if (rtt > 300) {
                el.className = 'vc-quality poor';
                label.textContent = 'Poor';
            } else if (rtt > 150) {
                el.className = 'vc-quality fair';
                label.textContent = 'Fair';
            } else {
                el.className = 'vc-quality';
                label.textContent = 'Good';
            }
        } catch (e) { /* ignore */ }
    }, 5000);
}

// ════════════════════════════════════════════════════════════
// PiP (POP OUT)
// ════════════════════════════════════════════════════════════

async function enterPiP() {
    // Toggle off existing in-page overlay
    if ($('pip-overlay')) { _closePipOverlay(); return; }

    // 1. Document PiP (Chrome 116+)
    if ('documentPictureInPicture' in window) {
        try {
            const pipW = await window.documentPictureInPicture.requestWindow({ width: 480, height: 270 });
            [...document.styleSheets].forEach(sheet => {
                try {
                    const style = pipW.document.createElement('style');
                    style.textContent = [...sheet.cssRules].map(r => r.cssText).join('');
                    pipW.document.head.appendChild(style);
                } catch (e) { /* cross-origin */ }
            });
            pipW.document.body.style.cssText = 'margin:0;padding:0;background:#000;width:100%;height:100vh;overflow:hidden;';
            const clone = remoteStream.cloneNode(true);
            pipW.document.body.appendChild(clone);
            return;
        } catch (e) { /* fall through */ }
    }

    // 2. Video element PiP
    if (document.pictureInPictureEnabled) {
        const vid = remoteStream.querySelector('video');
        if (vid) {
            try { await vid.requestPictureInPicture(); return; } catch (e) { /* fall through */ }
        }
    }

    // 3. In-page draggable overlay
    _showPipOverlay();
}

function _showPipOverlay() {
    const overlay  = document.createElement('div');
    overlay.id     = 'pip-overlay';

    const header   = document.createElement('div');
    header.id      = 'pip-overlay-header';
    header.innerHTML = `<span><i class="fas fa-video" style="margin-right:5px;color:#20bcba;"></i>Live Video</span>
                        <button id="pip-close-btn" title="Close">✕</button>`;

    const vidWrap  = document.createElement('div');
    vidWrap.id     = 'pip-overlay-video';

    // Clone the remote stream video element
    const vid = remoteStream.querySelector('video');
    if (vid) vidWrap.appendChild(vid.cloneNode(true));

    overlay.appendChild(header);
    overlay.appendChild(vidWrap);
    document.body.appendChild(overlay);

    $('pip-close-btn').addEventListener('click', _closePipOverlay);

    // Drag support
    let isDragging = false, dx = 0, dy = 0, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
        isDragging = true; dx = e.clientX; dy = e.clientY;
        const r = overlay.getBoundingClientRect();
        ox = r.left; oy = r.top;
        overlay.style.right = 'auto'; overlay.style.bottom = 'auto';
        overlay.style.left = ox + 'px'; overlay.style.top = oy + 'px';
    });
    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        overlay.style.left = (ox + e.clientX - dx) + 'px';
        overlay.style.top  = (oy + e.clientY - dy) + 'px';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
}

function _closePipOverlay() {
    const o = $('pip-overlay');
    if (o) o.remove();
}

// ════════════════════════════════════════════════════════════
// SELF-VIDEO PiP DRAG (the corner self-view)
// ════════════════════════════════════════════════════════════

function setupLocalPipDrag() {
    let dragging = false, startX, startY, startRight, startBottom;

    localPip.addEventListener('mousedown', e => {
        if (e.target.closest('.vc-pip-btn')) return; // don't drag on buttons
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = localPip.getBoundingClientRect();
        startRight  = window.innerWidth  - rect.right;
        startBottom = window.innerHeight - rect.bottom;
        localPip.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const newRight  = startRight  - (e.clientX - startX);
        const newBottom = startBottom - (e.clientY - startY);
        localPip.style.right  = Math.max(8, Math.min(window.innerWidth  - 80, newRight))  + 'px';
        localPip.style.bottom = Math.max(8, Math.min(window.innerHeight - 40, newBottom)) + 'px';
    });

    document.addEventListener('mouseup', () => {
        dragging = false;
        localPip.classList.remove('dragging');
    });

    // Touch drag
    localPip.addEventListener('touchstart', e => {
        if (e.target.closest('.vc-pip-btn')) return;
        dragging = true;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        const rect = localPip.getBoundingClientRect();
        startRight  = window.innerWidth  - rect.right;
        startBottom = window.innerHeight - rect.bottom;
        localPip.classList.add('dragging');
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!dragging) return;
        const t = e.touches[0];
        const newRight  = startRight  - (t.clientX - startX);
        const newBottom = startBottom - (t.clientY - startY);
        localPip.style.right  = Math.max(8, Math.min(window.innerWidth  - 80, newRight))  + 'px';
        localPip.style.bottom = Math.max(8, Math.min(window.innerHeight - 40, newBottom)) + 'px';
    }, { passive: true });

    document.addEventListener('touchend', () => {
        dragging = false;
        localPip.classList.remove('dragging');
    });
}

// ════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
        // Don't fire shortcuts when typing in an input/textarea
        if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
        // Must be in-call
        if (!state.channelName) return;

        const key = e.key.toLowerCase();
        if (key === 'm') { e.preventDefault(); toggleMute();   }
        if (key === 'v') { e.preventDefault(); toggleCamera(); }
        if (key === 'd') { e.preventDefault(); togglePanel('dice'); if (state.activePanel === 'dice') generatePrompt(); }
        if (key === 'c') { e.preventDefault(); togglePanel('chat'); }
        if (key === 'w') { e.preventDefault(); togglePanel('whiteboard'); }
    });
}

// ════════════════════════════════════════════════════════════
// NAVIGATION WARNING
// ════════════════════════════════════════════════════════════

function setupNavWarning() {
    // Intercept in-call link clicks that would navigate away
    function interceptLink(link) {
        if (link.target === '_blank') return;
        link.addEventListener('click', e => {
            if (state.channelName && state.client?.connectionState === 'CONNECTED') {
                e.preventDefault();
                state.pendingNavHref = link.href;
                navWarning.classList.remove('hidden');
            }
        });
    }

    // Logo link in top bar
    const logoLink = $('vc-logo-link');
    if (logoLink) {
        logoLink.addEventListener('click', e => {
            if (state.channelName) {
                e.preventDefault();
                state.pendingNavHref = 'index';
                navWarning.classList.remove('hidden');
            }
        });
    }

    $('warn-stay').addEventListener('click', () => {
        navWarning.classList.add('hidden');
        state.pendingNavHref = null;
    });

    $('warn-newtab').addEventListener('click', () => {
        if (state.pendingNavHref) window.open(state.pendingNavHref, '_blank');
        navWarning.classList.add('hidden');
        state.pendingNavHref = null;
    });

    $('warn-leave').addEventListener('click', () => {
        const href = state.pendingNavHref;
        navWarning.classList.add('hidden');
        state.pendingNavHref = null;
        leaveChannel().then(() => { if (href) window.location.href = href; }).catch(() => {
            if (href) window.location.href = href;
        });
    });

    window.addEventListener('beforeunload', e => {
        if (state.client?.connectionState === 'CONNECTED') {
            leaveChannel();
            e.preventDefault();
            return (e.returnValue = 'You are still in a video call. Are you sure you want to leave?');
        }
    });
}

// ════════════════════════════════════════════════════════════
// POST-CALL RATING POPUP
// ════════════════════════════════════════════════════════════

async function maybeShowRatingPopup() {
    if (state.isInstructor || !state.channelName || !state.currentUser ||
        state.currentUser.uid.startsWith('guest-')) return;

    const parts = state.channelName.split('-');
    if (parts.length !== 2) return;

    const otherUid = parts.find(p => p !== state.currentUser.uid);
    if (!otherUid) return;

    const instrSnap = await getDoc(doc(db, 'instructors', otherUid));
    if (!instrSnap.exists()) return;

    const instrName = instrSnap.data().name || 'Your Instructor';
    showRatingPopup(otherUid, instrName);
}

function showRatingPopup(instructorUid, instructorName) {
    ratingPopup._instructorUid  = instructorUid;
    ratingPopup._instructorName = instructorName;
    $('ratingInstructorName').textContent = instructorName;

    state.selectedRating  = 0;
    state.selectedAnswers = {};
    $('ratingReviewText').value = '';
    document.querySelectorAll('.rating-star').forEach(s => s.style.color = '#ddd');
    ratingLabel.textContent = '';
    document.querySelectorAll('.rating-yn-btn').forEach(b => b.classList.remove('yn-yes','yn-no'));
    ratingSubmitBtn.disabled = true;
    ratingSubmitBtn.textContent = 'Submit Review';

    ratingPopup.classList.remove('hidden');
}

async function submitReview() {
    const instructorUid  = ratingPopup._instructorUid;
    const instructorName = ratingPopup._instructorName;
    if (!state.selectedRating || !instructorUid) return;

    ratingSubmitBtn.disabled = true;
    ratingSubmitBtn.textContent = 'Submitting…';

    try {
        await addDoc(collection(db, 'reviews'), {
            instructorId:    instructorUid,
            instructorName:  instructorName,
            studentId:       state.currentUser.uid,
            studentName:     state.currentUserName,
            channelName:     state.channelName,
            rating:          state.selectedRating,
            lessonStructure: state.selectedAnswers.lessonStructure ?? null,
            clarity:         state.selectedAnswers.clarity ?? null,
            engagement:      state.selectedAnswers.engagement ?? null,
            progress:        state.selectedAnswers.progress ?? null,
            wouldRecommend:  state.selectedAnswers.wouldRecommend ?? null,
            review:          $('ratingReviewText').value.trim(),
            createdAt:       new Date()
        });

        // Recalculate instructor aggregate
        const allSnap = await getDocs(query(collection(db, 'reviews'), where('instructorId', '==', instructorUid)));
        const ratings = allSnap.docs.map(d => d.data().rating).filter(r => typeof r === 'number');
        const avg     = ratings.reduce((s, r) => s + r, 0) / ratings.length;
        await updateDoc(doc(db, 'instructors', instructorUid), {
            averageRating: Math.round(avg * 10) / 10,
            reviewCount:   ratings.length
        });

        ratingPopup.classList.add('hidden');
        showPjStatus('Thank you for your feedback!', 'success');
    } catch (e) {
        console.error('Review submit error:', e);
        ratingSubmitBtn.disabled = false;
        ratingSubmitBtn.textContent = 'Submit Review';
    }
}

// ════════════════════════════════════════════════════════════
// NOTIFICATION BADGES (navbar)
// ════════════════════════════════════════════════════════════

function loadNotifications(uid) {
    let msgs = 0, reqs = 0, books = 0;

    const updateBadge = () => {
        const total = msgs + reqs + books;
        const badge = $('notificationBadge');
        if (badge) {
            badge.textContent = total > 9 ? '9+' : total;
            badge.classList.toggle('hidden', total === 0);
        }
        const uc = $('unreadCount');
        if (uc) { uc.textContent = msgs > 99 ? '99+' : msgs; uc.classList.toggle('hidden', msgs === 0); }
        const bc = $('bookingsCount');
        if (bc) { bc.textContent = books; bc.classList.toggle('hidden', books === 0); }
        const fc = $('friendsCount');
        if (fc) { fc.textContent = reqs; fc.classList.toggle('hidden', reqs === 0); }
    };

    onSnapshot(query(collection(db,'conversations'), where('participants','array-contains',uid)), snap => {
        msgs = 0;
        snap.forEach(d => { const c = d.data(); if (c.unreadCount?.[uid]) msgs += c.unreadCount[uid]; });
        updateBadge();
    });
    onSnapshot(query(collection(db,'friendRequests'), where('toId','==',uid)), snap => {
        reqs = snap.docs.filter(d => d.data().status === 'pending').length;
        updateBadge();
    });
    onSnapshot(query(collection(db,'bookings'), where('instructorId','==',uid)), snap => {
        books = snap.docs.filter(d => d.data().instructorSeen === false).length;
        updateBadge();
    });
}

// ════════════════════════════════════════════════════════════
// AUTHENTICATION
// ════════════════════════════════════════════════════════════

onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;

        // Load profile from Firestore (prefer instructors collection)
        try {
            const [userSnap, instrSnap] = await Promise.all([
                getDoc(doc(db, 'users', user.uid)),
                getDoc(doc(db, 'instructors', user.uid))
            ]);
            state.isInstructor = instrSnap.exists();
            const data = state.isInstructor ? instrSnap.data()
                       : userSnap.exists()  ? userSnap.data() : null;
            if (data) {
                if (data.name)       state.currentUserName = data.name;
                if (data.avatar_url) {
                    const av = $('navProfilePic');
                    if (av) av.src = data.avatar_url;
                    localStorage.setItem('nav_avatar', data.avatar_url);
                }
            }
        } catch (e) { console.warn('Profile load error:', e); }

        // Show profile nav, hide sign-in
        $('pj-nav-profile')?.classList.remove('hidden');
        $('pj-nav-signin')?.classList.add('hidden');

        // Load notification badges
        loadNotifications(user.uid);

    } else {
        // Guest mode
        state.currentUser    = { email: 'Guest', uid: 'guest-' + Date.now() };
        state.currentUserName = 'Guest';
        $('pj-nav-profile')?.classList.add('hidden');
        $('pj-nav-signin')?.classList.remove('hidden');
    }
});

// Restore cached avatar instantly (before Firestore loads)
const _cachedAvatar = localStorage.getItem('nav_avatar') || localStorage.getItem('instructor_avatar');
if (_cachedAvatar) {
    const av = $('navProfilePic');
    if (av) av.src = _cachedAvatar;
}

// ════════════════════════════════════════════════════════════
// EVENT LISTENERS SETUP
// ════════════════════════════════════════════════════════════

function setupEventListeners() {

    // Pre-join: join button
    joinBtn.addEventListener('click', joinChannel);

    // Pre-join: Enter key
    channelInput.addEventListener('keypress', e => {
        if (e.key === 'Enter' && !joinBtn.disabled) joinChannel();
    });

    // Pre-join: copy room code
    copyRoomBtn.addEventListener('click', () => {
        const code = channelInput.value.trim();
        if (!code) { showPjStatus('Enter a room code to copy.', 'error'); return; }
        navigator.clipboard.writeText(code).then(() => {
            copyRoomBtn.classList.add('copied');
            copyRoomBtn.innerHTML = '<i class="fas fa-check"></i>';
            showPjStatus('Room code copied!', 'success');
            setTimeout(() => {
                copyRoomBtn.classList.remove('copied');
                copyRoomBtn.innerHTML = '<i class="fas fa-copy"></i>';
            }, 2500);
        }).catch(() => showPjStatus('Copy failed — please copy manually.', 'error'));
    });

    // In-call: copy room from top bar
    vcCopyRoom?.addEventListener('click', () => {
        navigator.clipboard.writeText(state.channelName).then(() => showToast('Room code copied!', 'success'));
    });

    // In-call: waiting overlay copy button
    $('vc-waiting-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(state.channelName).then(() => showToast('Room code copied!', 'success'));
    });

    // Control bar buttons
    btnMute.addEventListener('click', toggleMute);
    btnCamera.addEventListener('click', toggleCamera);
    btnLeave.addEventListener('click', leaveChannel);
    btnPip.addEventListener('click', enterPiP);

    // PiP self-view buttons
    $('pip-mute-btn')?.addEventListener('click', e => { e.stopPropagation(); toggleMute(); });
    $('pip-camera-btn')?.addEventListener('click', e => { e.stopPropagation(); toggleCamera(); });

    // Profile dropdown toggle (avatar click on mobile)
    $('pj-avatar-wrap')?.addEventListener('click', () => {
        $('pjDropdown')?.classList.toggle('show');
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('#pj-nav-profile')) {
            $('pjDropdown')?.classList.remove('show');
        }
    });

    // Logout
    $('logoutLink')?.addEventListener('click', async e => {
        e.preventDefault();
        await signOut(auth);
        window.location.href = 'index';
    });

    // Chat: send on button click
    chatSendBtn.addEventListener('click', sendChatMessage);

    // Chat: send on Enter (Shift+Enter for newline)
    chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });

    // Chat: auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });

    // Clear unread badge when chat panel opens
    btnChat.addEventListener('click', () => {
        chatBadge.textContent = '0';
        chatBadge.classList.add('hidden');
    });

    // Dice: roll button
    diceRollBtn.addEventListener('click', () => {
        diceRollBtn.querySelector('i').style.animation = '';
        void diceRollBtn.querySelector('i').offsetWidth;
        diceRollBtn.querySelector('i').style.animation = 'spinDice 0.4s ease-out';
        generatePrompt();
    });

    // Dice: category filter
    $('dice-categories')?.addEventListener('click', e => {
        const btn = e.target.closest('.dice-cat-btn');
        if (!btn) return;
        document.querySelectorAll('.dice-cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentPromptCat = btn.dataset.cat;
    });

    // Whiteboard: pen tool
    wbPenBtn.addEventListener('click', () => {
        state.wbTool = 'pen';
        wbPenBtn.classList.add('wb-tool-active');
        wbEraserBtn.classList.remove('wb-tool-active');
        wbCanvas.classList.remove('wb-eraser-cursor');
    });

    // Whiteboard: eraser
    wbEraserBtn.addEventListener('click', () => {
        state.wbTool = 'eraser';
        wbEraserBtn.classList.add('wb-tool-active');
        wbPenBtn.classList.remove('wb-tool-active');
        wbCanvas.classList.add('wb-eraser-cursor');
    });

    // Whiteboard: color swatches
    document.querySelectorAll('.wb-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.wbColor = btn.dataset.color;
            document.querySelectorAll('.wb-color-btn').forEach(b => b.classList.remove('wb-color-active'));
            btn.classList.add('wb-color-active');
            state.wbTool = 'pen';
            wbPenBtn.classList.add('wb-tool-active');
            wbEraserBtn.classList.remove('wb-tool-active');
            wbCanvas.classList.remove('wb-eraser-cursor');
        });
    });

    // Whiteboard: stroke widths
    document.querySelectorAll('.wb-stroke-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.wbStrokeWidth = parseInt(btn.dataset.width, 10);
            document.querySelectorAll('.wb-stroke-btn').forEach(b => b.classList.remove('wb-stroke-active'));
            btn.classList.add('wb-stroke-active');
        });
    });

    // Whiteboard: clear (sync to remote)
    wbClearBtn.addEventListener('click', () => {
        wbInitCanvas();
        if (state.wbRelayRef) {
            setDoc(state.wbRelayRef, { t: 'cl', ts: Date.now() }).catch(e => console.warn('WB clear error:', e));
        }
    });

    // Rating: star hover/click
    starRatingEl.addEventListener('mouseover', e => {
        const s = e.target.closest('.rating-star');
        if (s) renderStars(parseInt(s.dataset.star, 10));
    });
    starRatingEl.addEventListener('mouseleave', () => renderStars(state.selectedRating));
    starRatingEl.addEventListener('click', e => {
        const s = e.target.closest('.rating-star');
        if (s) {
            state.selectedRating = parseInt(s.dataset.star, 10);
            renderStars(state.selectedRating);
            ratingSubmitBtn.disabled = false;
        }
    });

    document.querySelectorAll('.rating-yn-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const q = btn.dataset.q, val = btn.dataset.val === 'true';
            state.selectedAnswers[q] = val;
            document.querySelectorAll(`.rating-yn-btn[data-q="${q}"]`).forEach(b => b.classList.remove('yn-yes','yn-no'));
            btn.classList.add(val ? 'yn-yes' : 'yn-no');
        });
    });

    ratingSubmitBtn.addEventListener('click', submitReview);
    ratingSkipBtn.addEventListener('click', () => ratingPopup.classList.add('hidden'));
}

function renderStars(n) {
    document.querySelectorAll('.rating-star').forEach((s, i) => {
        s.style.color = i < n ? '#f59e0b' : '#ddd';
    });
    ratingLabel.textContent = RATING_LABELS[n] || '';
}

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════

function init() {
    // Check URL for channel param (from messages page)
    const urlParams = new URLSearchParams(window.location.search);
    const channelFromUrl = urlParams.get('channel');
    if (channelFromUrl) {
        channelInput.value = channelFromUrl;
        showPjStatus('Room code loaded. Click "Join Call" when ready.', 'info');
    }

    // Initialize whiteboard canvas
    wbInitCanvas();

    // Set up all listeners
    setupEventListeners();
    setupPanels();
    setupKeyboardShortcuts();
    setupNavWarning();
    setupLocalPipDrag();
}

init();
