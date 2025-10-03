// ================================
// DOM ELEMENTS & GLOBAL STATE
// ================================

// --- App Elements ---
const masterPlay = document.getElementById('masterPlay');
const songSide = document.querySelector('.song_side');
const music = new Audio();
const poster_master_play = document.getElementById('poster_master_play');
const title = document.getElementById('title');

// --- Auth & Initial Load Elements ---
const preloader = document.getElementById('preloader');
const authContainer = document.getElementById('auth-container');
const authBox = document.querySelector('.auth-box');
const mainAppHeader = document.querySelector('header');

// --- API ---
const API_URL = 'https://resona-sc7k.onrender.com/api';

// --- State Variables ---
let allSongs = new Map();
let currentPlaylist = [];
let upNextQueue = [];
let index = null;
let isShuffle = false;
let repeatMode = 0;
let likedSongs = new Set();
let recentlyPlayed = [];
let recentSearches = [];
let userPlaylists = {};
let songToAddToPlaylist = null;
let bannerSlideshowInterval;
let lastActiveView = 'discovery_carousels';
let isSearchActive = false;
let sleepTimerId = null; 

// --- Authentication State ---
let authToken = null;
let currentUser = null; 

// --- Listen Together State ---
let socket = null;
let isHost = false;
let roomId = null;
let sessionActive = false;

// --- Modal Elements ---
const lyricsBtn = document.getElementById('lyrics_btn');
const lyricsModal = document.getElementById('lyrics_modal');
const closeLyricsModalBtn = document.getElementById('close_lyrics_modal');
const lyricsContent = document.getElementById('lyrics_content');
const lyricsSongTitle = document.getElementById('lyrics_song_title');
const addToPlaylistModal = document.getElementById('add_to_playlist_modal');
const closePlaylistModalBtn = document.getElementById('close_playlist_modal');
const playlistOptionsContainer = document.getElementById('playlist_options_container');
const createPlaylistBtn = document.getElementById('create_playlist_btn');
const newPlaylistNameInput = document.getElementById('new_playlist_name');

// ================================
// INITIALIZATION & AUTH FLOW
// ================================
window.onload = async () => {
    // Check for a token in the URL from Google OAuth redirect
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    const errorFromUrl = urlParams.get('error');

    if (tokenFromUrl) {
        localStorage.setItem('resona_token', tokenFromUrl);
        // Clean the URL so the token isn't visible on refresh
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (errorFromUrl) {
        showToast('Google Sign-In failed. Please try again.', 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    authToken = localStorage.getItem('resona_token');
    if (authToken) {
        // User is logged in, proceed to initialize the app
        document.body.classList.remove('logged-out');
        mainAppHeader.style.visibility = 'visible';
        authContainer.classList.add('hidden');
        
        await initializeApp();
        checkForSessionLink();

        preloader.classList.add('hidden');
    } else {
        // User is not logged in, show the login screen
        document.body.classList.add('logged-out');
        mainAppHeader.style.visibility = 'hidden';
        authContainer.classList.remove('hidden');
        renderLoginForm(); 
        preloader.classList.add('hidden');
    }
};

async function initializeApp() {
    showLoadingState();
    try {
        await loadState();
        
        const [telugu, hindi, english, tamil, artists, featuredAlbums] = await Promise.all([
            fetchSongsByQuery('latest telugu'),
            fetchSongsByQuery('latest hindi'),
            fetchSongsByQuery('latest english'),
            fetchSongsByQuery('latest tamil'),
            fetchPopularArtists(),
            fetchFeaturedAlbums(['Pushpa', 'Kalki 2898 AD', 'Animal', 'Jawan', 'RRR', 'Dune'])
        ]);

        [...telugu, ...hindi, ...english, ...tamil].forEach(song => { if (!allSongs.has(song.id)) allSongs.set(song.id, song); });
        const popularSongs = [...telugu.slice(0, 4), ...hindi.slice(0, 4), ...english.slice(0,2)];
        
        populateAllContentSections({ telugu, hindi, english, tamil, artists, popularSongs, featuredAlbums });
        
        if (popularSongs.length > 0) {
            startBannerSlideshow(popularSongs);
            setupBannerFunctionality(popularSongs);
        }

        currentPlaylist = [...allSongs.values()];
        setupScrollers();
        setupSearch();
        setupListenTogether();
        setupLyrics();
        setupPlaylistModal();
        setupSleepTimer();
        setupKeyboardShortcuts();
        populateRecentlyPlayedViews();
        restoreLastSong();
        attachAllEventListeners();

    } catch (error) {
        console.error("Initialization failed:", error);
        showErrorState();
    }
}

async function startAppAfterLogin() {
    authToken = localStorage.getItem('resona_token');
    authContainer.classList.add('hidden');
    document.body.classList.remove('logged-out');
    
    preloader.style.display = 'flex';
    preloader.classList.remove('hidden');
    
    mainAppHeader.style.visibility = 'visible';

    await initializeApp();
    checkForSessionLink();
    
    preloader.classList.add('hidden');
}

// ================================
// AUTHENTICATION & UI
// ================================

function renderLoginForm() {
    authBox.innerHTML = `
        <h3>Welcome Back</h3>
        <form id="login-form">
            <input type="text" id="login-username" placeholder="Username" required autocomplete="username">
            <input type="password" id="login-password" placeholder="Password" required autocomplete="current-password">
            <button type="submit">LOG IN</button>
        </form>
        <button id="google-signin-btn" class="google-btn">Sign in with Google</button>
        <p>Don't have an account? <a href="#" id="show-signup">Sign Up</a></p>
    `;
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('show-signup').addEventListener('click', (e) => { e.preventDefault(); renderSignupForm(); });
    
    document.getElementById('google-signin-btn').addEventListener('click', () => {
        window.location.href = `${API_URL}/auth/google`;
    });
}

function renderSignupForm() {
    authBox.innerHTML = `
        <h3>Create Account</h3>
        <form id="signup-form">
            <input type="text" id="signup-username" placeholder="Choose a Username" required autocomplete="username">
            <input type="password" id="signup-password" placeholder="Create a Password" required autocomplete="new-password">
            <button type="submit">SIGN UP</button>
        </form>
        <p>Already have an account? <a href="#" id="show-login">Log In</a></p>
    `;
    document.getElementById('signup-form').addEventListener('submit', handleSignup);
    document.getElementById('show-login').addEventListener('click', (e) => { e.preventDefault(); renderLoginForm(); });
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Login failed');
        
        localStorage.setItem('resona_token', data.token);
        showToast('Login successful! Loading your music...', 'success');
        await startAppAfterLogin();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const username = document.getElementById('signup-username').value;
    const password = document.getElementById('signup-password').value;
    try {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Signup failed');

        localStorage.setItem('resona_token', data.token);
        showToast('Account created! Welcome to Resona.', 'success');
        await startAppAfterLogin();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function handleLogout() {
    localStorage.removeItem('resona_token');
    localStorage.removeItem(`resona_local_settings_${currentUser?.userId}`);
    window.location.reload();
}

function updateUIForAuthState() {
    const userImg = document.querySelector('#user_profile_button img');
    const profileUsername = document.getElementById('profile_username');
    const profileEmail = document.getElementById('profile_email');
    const logoutBtn = document.getElementById('logout_btn');
    const profileModal = document.getElementById('profile_modal');
    const userProfileButton = document.getElementById('user_profile_button');

    if (currentUser) {
        const initial = currentUser.username.charAt(0).toUpperCase();
        userImg.src = `https://placehold.co/100x100/9146FF/FFF?text=${initial}`;
        profileUsername.textContent = currentUser.username;
        profileEmail.textContent = '';
        logoutBtn.onclick = handleLogout;
        userProfileButton.onclick = () => { profileModal.style.display = 'block'; };
    }
    updateProfileStats();
}

// ================================
// DATA PERSISTENCE (STATE MANAGEMENT)
// ================================
async function loadState() {
    try {
        if (!authToken) throw new Error("No auth token found.");
        const response = await fetch(`${API_URL}/data/all`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.status === 401 || response.status === 403) {
            handleLogout();
            return;
        }
        if (!response.ok) throw new Error("Could not fetch user data.");

        const data = await response.json();
        const tokenPayload = JSON.parse(atob(authToken.split('.')[1]));
        currentUser = { userId: tokenPayload.userId, username: tokenPayload.username };

        likedSongs = new Set(data.likedSongs || []);
        userPlaylists = data.userPlaylists || {};
        
        updateUIForAuthState();
    } catch (error) {
        showToast(error.message + " Logging you out.", 'error');
        setTimeout(handleLogout, 2000);
        throw error; // Propagate error to stop initialization
    }
    
    const localSettingsKey = `resona_local_settings_${currentUser?.userId}`;
    const localSettings = JSON.parse(localStorage.getItem(localSettingsKey)) || {};
    recentlyPlayed = localSettings.recentlyPlayed || [];
    recentSearches = localSettings.recentSearches || [];
    isShuffle = !!localSettings.isShuffle;
    repeatMode = localSettings.repeatMode || 0;
    music.volume = localSettings.volume ?? 1;
}

function saveLocalSettings() {
    if (currentUser) {
        const localSettingsKey = `resona_local_settings_${currentUser.userId}`;
        localStorage.setItem(localSettingsKey, JSON.stringify({
            lastSongId: index,
            recentlyPlayed,
            recentSearches,
            isShuffle,
            repeatMode,
            volume: music.volume
        }));
    }
}

async function syncLikeWithServer(songId, isLiked) {
    if (!authToken) return;
    try {
        await fetch(`${API_URL}/data/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`},
            body: JSON.stringify({ songId: songId, like: isLiked })
        });
    } catch (error) {
        console.error("Failed to sync like with server:", error);
        showToast("Could not sync with server", "error");
    }
}

// ================================
// UI ENHANCEMENT FUNCTIONS
// ================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast_container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
}

// Simple debounce utility to limit how often a function runs
function debounce(func, wait) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), wait);
    };
}

function generateSkeletonCards(count) {
    let skeletonHTML = '<div class="skeleton-card-container">';
    for (let i = 0; i < count; i++) {
        skeletonHTML += `<li class="skeleton-card"><div class="skeleton skeleton-img"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text-sm"></div></li>`;
    }
    skeletonHTML += '</div>';
    return skeletonHTML;
}

function renderEmptyState(iconClass, title, message) {
    return `<div class="empty-state-container"><i class="bi ${iconClass} icon"></i><h3>${title}</h3><p>${message}</p></div>`;
}

// ================================
// LISTEN TOGETHER FUNCTIONS
// ================================
function setupListenTogether() {
    const modal = document.getElementById('listen_together_modal');
    const openBtn = document.getElementById('listen_together_btn');
    const closeBtn = document.getElementById('close_listen_modal');
    
    openBtn.addEventListener('click', () => {
        updateSessionUI();
        modal.style.display = 'block';
    });
    
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    document.getElementById('session_ui_container').addEventListener('click', (e) => {
        if (e.target.id === 'start_session_btn') connectWebSocket();
        if (e.target.id === 'leave_session_btn') leaveSession();
    });
}

function updateSessionUI() {
    const container = document.getElementById('session_ui_container');
    const icon = document.getElementById('listen_together_btn');

    if (sessionActive && roomId) {
        const shareLink = `${window.location.origin}${window.location.pathname}#listen/${roomId}`;
        container.innerHTML = `
            <div class="session-info">
                <p>Your session is active! Share this link:</p>
                <div class="room-id">${roomId}</div>
                <button id="copy_link_btn">Copy Invite Link</button>
                <small>The first person is the host.</small>
                <hr style="margin: 20px 0; border-color: #333;">
                <button id="leave_session_btn" style="background-color: #E50914;">Leave Session</button>
            </div>`;
        icon.classList.add('active');
        container.querySelector('#copy_link_btn').addEventListener('click', () => {
            navigator.clipboard.writeText(shareLink).then(() => showToast('Invite link copied!', 'success'));
        });
    } else {
        container.innerHTML = `
            <p style="color: #a4a8b4; text-align: center;">Start a session to listen in real-time with friends.</p>
            <button id="start_session_btn">Start a New Session</button>`;
        icon.classList.remove('active');
        document.getElementById('participant_list_container').innerHTML = '';
    }
}

function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return;
    const socketUrl = 'wss://resona-sc7k.onrender.com';
    socket = new WebSocket(socketUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established.');
        if (roomId && !sessionActive) { 
            isHost = false;
            socket.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId } }));
        } else { 
            isHost = true;
            socket.send(JSON.stringify({ type: 'CREATE_ROOM', payload: {} }));
        }
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const { type, payload } = data;
        switch (type) {
            case 'ROOM_CREATED':
                if (isHost) {
                    roomId = payload.roomId;
                    sessionActive = true;
                    upNextQueue = [];
                    updateSessionUI();
                }
                break;
            case 'USER_LIST_UPDATE':
                updateParticipantList(payload.participants);
                break;
            case 'QUEUE_UPDATE':
                upNextQueue = payload.queue;
                renderUpNextQueue();
                break;
            case 'CHANGE_SONG': if (!isHost) playSong(payload.songId, true); break;
            case 'PLAY': if (!isHost) music.play(); break;
            case 'PAUSE': if (!isHost) music.pause(); break;
            case 'SEEK': if (!isHost) music.currentTime = payload.currentTime; break;
            case 'GET_STATE_FOR_NEW_USER':
                if (isHost) {
                    const state = {
                        songId: index, currentTime: music.currentTime, isPlaying: !music.paused,
                        queue: upNextQueue, targetUserId: payload.newUserId
                    };
                    socket.send(JSON.stringify({ type: 'SYNC_STATE', payload: { ...state, roomId }}));
                }
                break;
            case 'SYNC_STATE':
                if (!isHost) {
                    upNextQueue = payload.queue;
                    renderUpNextQueue();
                    playSong(payload.songId, payload.isPlaying);
                    setTimeout(() => {
                        music.currentTime = payload.currentTime;
                        if (!payload.isPlaying) music.pause();
                    }, 500);
                }
                break;
            case 'ERROR': alert(`Session Error: ${payload.message}`); leaveSession(); break;
        }
    };
    socket.onerror = (error) => { console.error('WebSocket error:', error); alert('Could not connect to the listening session server.'); };
    socket.onclose = () => { console.log('WebSocket connection closed.'); leaveSession(); };
}

function leaveSession() {
    if (socket) { socket.close(); socket = null; }
    sessionActive = false; isHost = false; roomId = null; upNextQueue = [];
    renderUpNextQueue(); updateSessionUI();
    document.getElementById('listen_together_modal').style.display = 'none';
}

function checkForSessionLink() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#listen/')) {
        const potentialRoomId = hash.split('/')[1].toUpperCase();
        if (potentialRoomId) {
            roomId = potentialRoomId;
            connectWebSocket();
            window.history.replaceState("", document.title, window.location.pathname + window.location.search);
        }
    }
}

function updateParticipantList(participants) {
    const container = document.getElementById('participant_list_container');
    if (!sessionActive) { container.innerHTML = ''; return; }
    container.innerHTML = `<h4>In this session (${participants.length})</h4><div class="participants">${participants.map(p => `<span class="participant-badge ${p === 'Host' ? 'host' : ''}">${p}</span>`).join('')}</div>`;
}

// ================================
// LYRICS FUNCTIONS
// ================================
function setupLyrics() {
    lyricsBtn.addEventListener('click', () => {
        if (!index) return showToast("Please play a song first.");
        fetchAndShowLyrics(index);
    });
    closeLyricsModalBtn.addEventListener('click', () => { lyricsModal.style.display = 'none'; });
}

async function fetchAndShowLyrics(songId) {
    const songData = allSongs.get(songId);
    if (!songData) return;
    lyricsSongTitle.innerText = songData.songName.split('<br>')[0];
    lyricsContent.innerText = 'Fetching lyrics...';
    lyricsModal.style.display = 'block';
    try {
        const response = await fetch(`https://saavn.dev/api/songs/${songId}/lyrics`);
        const data = await response.json();
        lyricsContent.innerText = (data.success && data.data.lyrics) ? data.data.lyrics : (data.message || 'Sorry, lyrics are not available.');
    } catch (error) {
        console.error("Failed to fetch lyrics:", error);
        lyricsContent.innerText = 'Could not load lyrics. Please try again later.';
    }
}

// ================================
// PLAYLIST & QUEUE FUNCTIONS
// ================================
function setupPlaylistModal() {
    closePlaylistModalBtn.addEventListener('click', () => { addToPlaylistModal.style.display = 'none'; });
    createPlaylistBtn.addEventListener('click', () => {
        const playlistName = newPlaylistNameInput.value.trim();
        if (playlistName) {
            if (!userPlaylists[playlistName]) userPlaylists[playlistName] = [];
            addSongToPlaylist(playlistName);
            newPlaylistNameInput.value = '';
        }
    });
    playlistOptionsContainer.addEventListener('click', (e) => {
        const playlistOption = e.target.closest('.playlist-option');
        if (playlistOption) addSongToPlaylist(playlistOption.dataset.playlist);
    });
}

function openAddToPlaylistModal(songId) {
    songToAddToPlaylist = songId;
    playlistOptionsContainer.innerHTML = Object.keys(userPlaylists).map(name => `<div class="playlist-option" data-playlist="${name}">${name}</div>`).join('');
    addToPlaylistModal.style.display = 'block';
}

function addSongToPlaylist(playlistName) {
    if (songToAddToPlaylist && userPlaylists[playlistName]) {
        if (!userPlaylists[playlistName].includes(songToAddToPlaylist)) {
            userPlaylists[playlistName].push(songToAddToPlaylist);
            // TODO: Add API call to save playlist state to the database
            showToast(`Added to "${playlistName}"`, 'success');
        } else {
            showToast(`Song is already in "${playlistName}"`);
        }
        addToPlaylistModal.style.display = 'none';
        songToAddToPlaylist = null;
    }
}

function addSongToQueue(songId) {
    if (!allSongs.has(songId)) return;
    if (sessionActive) {
        if (isHost) {
            upNextQueue.push(songId);
            socket.send(JSON.stringify({ type: 'QUEUE_UPDATE', payload: { roomId, queue: upNextQueue } }));
            renderUpNextQueue();
        } else {
            socket.send(JSON.stringify({ type: 'ADD_TO_QUEUE', payload: { roomId, songId } }));
        }
    } else {
        upNextQueue.push(songId);
        renderUpNextQueue();
    }
    showToast("Added to queue");
}

function renderUpNextQueue() {
    const queueList = document.querySelector('.queue_list');
    if (upNextQueue.length === 0) {
        queueList.innerHTML = `<p style="font-size: 12px; color: #4c5262; padding: 10px 0;">Queue is empty.</p>`;
        return;
    }
    queueList.innerHTML = upNextQueue.map(songId => {
        const songData = allSongs.get(songId);
        if (!songData) return '';
        return `
            <div class="queue_item" data-id="${songId}">
                <img src="${songData.poster}" alt="">
                <div class="details">
                    ${songData.songName.split('<br>')[0]}
                    <div class="subtitle">${songData.songName.split('<div class="subtitle">')[1].replace('</div>', '')}</div>
                </div>
            </div>`;
    }).join('');
}

// ================================
// CORE PLAYER & MUSIC LOGIC
// ================================
function playSong(songId, autoPlay = true) {
    if (isHost && sessionActive && index !== songId) {
        socket.send(JSON.stringify({ type: 'CHANGE_SONG', payload: { roomId, songId } }));
    }
    index = String(songId);
    const songData = allSongs.get(index);
    if (!songData) return;
    addToRecentlyPlayed(songId);
    music.src = songData.audioUrl;
    poster_master_play.src = songData.poster;
    title.innerHTML = songData.songName;
    updateDynamicBackground(songData.poster);
    if (autoPlay) music.play().catch(e => console.error("Audio playback failed:", e));
    else syncPlayerUI();
    saveLocalSettings();
    if (window.innerWidth <= 930) {
        populateNowPlayingView(songData);
        showNowPlayingView();
    }
}

function togglePlayPause() {
    if (sessionActive && !isHost) return;
    if (!music.src) {
        if (currentPlaylist && currentPlaylist.length > 0) playSong(currentPlaylist[0].id);
        return;
    }
    if (music.paused) {
        music.play();
        if (isHost && sessionActive) socket.send(JSON.stringify({ type: 'PLAY', payload: { roomId } }));
    } else {
        music.pause();
        if (isHost && sessionActive) socket.send(JSON.stringify({ type: 'PAUSE', payload: { roomId } }));
    }
}

function toggleLike(songId) {
    if (!songId) return;
    const isCurrentlyLiked = likedSongs.has(songId);
    if (isCurrentlyLiked) {
        likedSongs.delete(songId);
        showToast("Removed from Liked Songs");
    } else {
        likedSongs.add(songId);
        showToast("Added to Liked Songs", "success");
    }
    syncLikeWithServer(songId, !isCurrentlyLiked);
    syncPlayerUI();
    if (document.querySelector('.playlist h4[data-playlist="liked"].active')) {
        populateLikedSongsView();
    }
    updateProfileStats();
}

function handleNextSong() {
    if (sessionActive && !isHost) return;
    if (upNextQueue.length > 0) {
        const nextSongId = upNextQueue.shift();
        renderUpNextQueue();
        if(sessionActive && isHost) socket.send(JSON.stringify({ type: 'QUEUE_UPDATE', payload: { roomId, queue: upNextQueue }}));
        playSong(nextSongId);
        return;
    }
    if (repeatMode === 2) {
        playSong(index);
        return;
    }
    if (isShuffle) {
        let randomIndex = Math.floor(Math.random() * currentPlaylist.length);
        playSong(currentPlaylist[randomIndex].id);
        return;
    }
    const currentIndex = currentPlaylist.findIndex(song => song && song.id == index);
    if (currentIndex === -1 || currentIndex === currentPlaylist.length - 1) {
        if (repeatMode === 1 && currentPlaylist.length > 0) playSong(currentPlaylist[0].id);
    } else {
        playSong(currentPlaylist[currentIndex + 1].id);
    }
}

function handlePreviousSong() {
    if (sessionActive && !isHost) return;
    if (!currentPlaylist || currentPlaylist.length === 0) return;
    const currentIndex = currentPlaylist.findIndex(song => song && song.id == index);
    if (currentIndex <= 0) {
        if (currentPlaylist.length > 0) playSong(currentPlaylist[currentPlaylist.length - 1].id);
    } else {
        playSong(currentPlaylist[currentIndex - 1].id);
    }
}

// ================================
// API FETCHING FUNCTIONS
// ================================
async function fetchSongsByQuery(query, limit = 20) {
    const apiUrl = `https://saavn.dev/api/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`;
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (!data.success || !data.data.results) return [];
        return data.data.results.map(song => ({ id: song.id, songName: `${song.name}<br><div class="subtitle">${song.artists.primary.map(a => a.name).join(', ')}</div>`, poster: song.image.find(img => img.quality === '500x500')?.url || song.image[0].url, audioUrl: song.downloadUrl.find(aud => aud.quality === '320kbps')?.url || song.downloadUrl[0].url }));
    } catch (error) { console.error(`Failed to fetch songs for query "${query}":`, error); return []; }
}

async function fetchPopularArtists() {
    const artistNames = ["Arijit Singh", "Shreya Ghoshal", "Anirudh Ravichander", "Sid Sriram", "Taylor Swift", "The Weeknd", "Pritam", "S. P. Balasubrahmanyam"];
    const artistPromises = artistNames.map(name => fetch(`https://saavn.dev/api/search/artists?query=${encodeURIComponent(name)}&limit=1`).then(res => res.json()));
    const results = await Promise.all(artistPromises);
    return results.filter(res => res.success && res.data.results.length > 0).map(res => { const artist = res.data.results[0]; return { id: artist.id, name: artist.name, image: artist.image.find(img => img.quality === '500x500')?.url || artist.image[0].url }; });
}

async function fetchArtistDetails(artistName) {
    try {
        const artistSearchUrl = `https://saavn.dev/api/search/artists?query=${encodeURIComponent(artistName)}`;
        const artistSearchRes = await fetch(artistSearchUrl);
        const artistSearchData = await artistSearchRes.json();
        if (!artistSearchData.success || artistSearchData.data.results.length === 0) throw new Error("Artist not found");
        const artistProfile = artistSearchData.data.results[0];
        const artistSongsUrl = `https://saavn.dev/api/artists/${artistProfile.id}/songs`;
        const artistSongsRes = await fetch(artistSongsUrl);
        const artistSongsData = await artistSongsRes.json();
        if (!artistSongsData.success) throw new Error("Could not fetch artist songs");
        const formattedSongs = artistSongsData.data.songs.map(song => {
            const formatted = { id: song.id, songName: `${song.name}<br><div class="subtitle">${song.artists.primary.map(a => a.name).join(', ')}</div>`, poster: song.image.find(img => img.quality === '500x500')?.url || song.image[0].url, duration: song.duration, audioUrl: song.downloadUrl.find(aud => aud.quality === '320kbps')?.url || song.downloadUrl[0].url };
            if (!allSongs.has(formatted.id)) allSongs.set(formatted.id, formatted);
            return allSongs.get(formatted.id);
        });
        return { profile: artistProfile, songs: formattedSongs };
    } catch (error) { console.error(`Failed to fetch details for artist "${artistName}":`, error); return null; }
}

async function fetchFeaturedAlbums(albumNames) {
    const albumPromises = albumNames.map(name => fetch(`https://saavn.dev/api/search/albums?query=${encodeURIComponent(name)}&limit=1`).then(res => res.json()).then(data => (data.success && data.data.results.length > 0) ? data.data.results[0] : null));
    const results = await Promise.all(albumPromises);
    return results.filter(Boolean).map(album => ({ id: album.id, name: album.name, poster: album.image.find(img => img.quality === '500x500')?.url || album.image[0].url }));
}

async function fetchAlbumDetails(albumId) {
    try {
        const albumUrl = `https://saavn.dev/api/albums?id=${albumId}`;
        const albumResponse = await fetch(albumUrl);
        const albumData = await albumResponse.json();
        if (!albumData.success) throw new Error("Failed to fetch album data");
        albumData.data.songs.forEach(song => {
            const formattedSong = { id: song.id, songName: `${song.name}<br><div class="subtitle">${song.artists.primary.map(a => a.name).join(', ')}</div>`, poster: albumData.data.image.find(img => img.quality === '500x500')?.url || song.image.find(img => img.quality === '500x500')?.url, duration: song.duration, audioUrl: song.downloadUrl.find(aud => aud.quality === '320kbps')?.url || song.downloadUrl[0].url };
            if (!allSongs.has(formattedSong.id)) allSongs.set(formattedSong.id, formattedSong);
        });
        return albumData.data;
    } catch (error) { console.error(`Failed to fetch album details for ID "${albumId}":`, error); return null; }
}

// ================================
// UI POPULATION & RENDERING
// ================================
function showLoadingState() { document.querySelectorAll('#telugu_songs_container, #hindi_songs_container, #english_songs_container, #tamil_songs_container, #pop_song_container, #artists_container, #featured_albums_container').forEach(c => { if(c) c.innerHTML = generateSkeletonCards(8); }); }
function showErrorState() { console.error("Failed to load content."); }
function hideAllMainViews() { document.querySelectorAll('#discovery_carousels, #library_view, #album_view, #artist_view, #search_results_view, #now_playing_view').forEach(v => v.classList.add('hidden')); }
function populateAllContentSections({ telugu, hindi, english, tamil, artists, popularSongs, featuredAlbums }) {
    populateSongSection(document.getElementById('telugu_songs_container'), telugu);
    populateSongSection(document.getElementById('hindi_songs_container'), hindi);
    populateSongSection(document.getElementById('english_songs_container'), english);
    populateSongSection(document.getElementById('tamil_songs_container'), tamil);
    populateArtistsSection(document.getElementById('artists_container'), artists);
    populateSongSection(document.getElementById('pop_song_container'), popularSongs);
    populateFeaturedAlbums(document.getElementById('featured_albums_container'), featuredAlbums);
}
function populateSongSection(container, songList) {
    if (!container || !songList) return;
    container.innerHTML = songList.map(song => `
        <li class="songitem" data-id="${song.id}">
            <div class="img_play"><img src="${song.poster}" alt=""><i class="bi playlistplay bi-play-circle-fill"></i></div>
            <h5>${song.songName}</h5>
            <div class="action-icons">
                <i class="bi bi-plus-lg action-icon" data-action="add-to-playlist" title="Add to Playlist"></i>
                <i class="bi bi-music-note-list action-icon" data-action="add-to-queue" title="Add to Queue"></i>
            </div>
        </li>`).join('');
}
function populateArtistsSection(container, artists) { if (!container || !artists) return; container.innerHTML = artists.map(a => `<li class="artist_card" data-artist-name="${a.name}"><img src="${a.image}" alt="${a.name}"><h5>${a.name}</h5></li>`).join(''); }
function populateFeaturedAlbums(container, albums) { if (!container || !albums) return; container.innerHTML = albums.map(a => `<li class="album_card" data-album-id="${a.id}"><img src="${a.poster}" alt="${a.name}"><h5>${a.name}</h5></li>`).join(''); }
function populateArtistView(artistData) {
    const view = document.getElementById('artist_view');
    view.innerHTML = `<div id="artist_view_header"><img id="artist_art" src="${artistData.profile.image.find(img=>img.quality==='500x500')?.url}" alt="${artistData.profile.name}"><div id="artist_details"><p>Artist</p><h1>${artistData.profile.name}</h1><div><button class="play_artist_btn"><i class="bi bi-play-fill"></i> Play</button><button class="start_artist_radio_btn" data-artist-name="${artistData.profile.name}"><i class="bi bi-broadcast"></i> Start Radio</button></div></div></div><ol class="playlist-view">${artistData.songs.map(s => renderSongListItem(s)).join('')}</ol>`;
    view.querySelector('.play_artist_btn').onclick = () => { currentPlaylist = artistData.songs; if (currentPlaylist.length) playSong(currentPlaylist[0].id); };
}
function populateAlbumView(albumData) {
    const view = document.getElementById('album_view');
    const songs = albumData.songs.map(s => allSongs.get(s.id));
    view.innerHTML = `<div id="album_view_header"><img id="album_art" src="${albumData.image.find(img=>img.quality==='500x500')?.url}" alt="${albumData.name}"><div id="album_details"><p>Album</p><h1>${albumData.name}</h1><p>${albumData.artists.primary.map(a=>a.name).join(', ')}</p><button class="play_album_btn"><i class="bi bi-play-fill"></i> Play</button></div></div><ol class="playlist-view">${songs.map(s => renderSongListItem(s)).join('')}</ol>`;
    view.querySelector('.play_album_btn').onclick = () => { currentPlaylist = songs; if (currentPlaylist.length) playSong(currentPlaylist[0].id); };
}
function populateNowPlayingView(songData) {
    const view = document.getElementById('now_playing_view');
    view.innerHTML = `<div class="np-header"><i class="bi bi-chevron-down" id="back_to_list_btn"></i></div><div class="np-main-content"><img src="${songData.poster}" alt="${songData.songName}" id="np_poster"><div id="np_title_wrapper"><h3 id="np_title">${songData.songName.split('<br>')[0]}</h3><p id="np_subtitle">${songData.songName.split('<div class="subtitle">')[1].replace('</div>','')}</p></div></div><div id="np_controls_wrapper"><div class="seek-container" id="np_seek_container"><span id="np_currentStart">0:00</span><div class="bar"><input type="range" id="np_seek" min="0" max="100" value="0"><div class="bar2" id="np_bar2"></div><div class="dot"></div></div><span id="np_currentEnd">0:00</span></div><div class="buttons-container" id="np_buttons_container"><i class="bi bi-shuffle" id="np_shuffle"></i><i class="bi bi-skip-start-fill" id="np_back"></i><i class="bi bi-play-circle-fill" id="np_masterPlay"></i><i class="bi bi-skip-end-fill" id="np_next"></i><i class="bi bi-repeat" id="np_repeat"></i></div><div id="np_side_controls"><i class="bi bi-heart" id="np_like"></i></div></div>`;
    view.style.setProperty('--bg-image', `url(${songData.poster})`);
    view.classList.add('has-bg');
    view.querySelector('#back_to_list_btn').onclick = hideNowPlayingView;
    view.querySelector('#np_masterPlay').onclick = togglePlayPause;
    view.querySelector('#np_next').onclick = () => document.getElementById('next').click();
    view.querySelector('#np_back').onclick = () => document.getElementById('back').click();
    view.querySelector('#np_shuffle').onclick = () => document.getElementById('shuffle').click();
    view.querySelector('#np_repeat').onclick = () => document.getElementById('repeat').click();
    view.querySelector('#np_like').onclick = () => { if (index) toggleLike(index); };
    const npSeek = view.querySelector('#np_seek');
    npSeek.addEventListener('change', () => { if (music.duration) music.currentTime = (npSeek.value * music.duration) / 100; });
}
function populateLikedSongsView() {
    const container = document.getElementById('library_view');
    const songs = [...likedSongs].map(id => allSongs.get(id)).filter(Boolean).reverse();
    let html = `<div class="song-list-header"><h1>Liked Songs</h1>${songs.length ? `<button id="play_all_liked"><i class="bi bi-play-fill"></i> Play All</button>`:''}</div>`;
    html += songs.length ? `<ol class="playlist-view">${songs.map(s => renderSongListItem(s, {playlistName:'liked'})).join('')}</ol>` : renderEmptyState('bi-heart','Songs you like appear here','Save songs by tapping the heart icon.');
    container.innerHTML = html;
    const playAllBtn = container.querySelector('#play_all_liked');
    if (playAllBtn) playAllBtn.onclick = () => { currentPlaylist = songs; if (currentPlaylist.length) playSong(currentPlaylist[0].id); };
}
function populateLibraryView() {
    const container = document.getElementById('library_view');
    let html = `<div class="song-list-header"><h1>Your Library</h1><button id="new_playlist_from_library">+ New Playlist</button></div>`;
    const playlists = Object.keys(userPlaylists);
    if (playlists.length > 0) {
        html += `<div class="playlist-grid">${playlists.map(name => `
            <div class="playlist-card" data-name="${name}">
                <i class="bi bi-trash-fill delete-playlist-btn" title="Delete Playlist"></i>
                <div class="playlist-art"><i class="bi bi-music-note-beamed"></i></div>
                <h5>${name}</h5><p>${userPlaylists[name].length} songs</p>
            </div>`).join('')}</div>`;
    } else {
        html += renderEmptyState('bi-music-note-list', 'Create your first playlist', 'Just click the button to get started.');
    }
    container.innerHTML = html;
    container.querySelector('#new_playlist_from_library').onclick = () => {
        const name = prompt("Enter a name for your new playlist:");
        if (name && !userPlaylists[name]) {
            userPlaylists[name] = [];
            // TODO: Add API Call to create playlist
            populateLibraryView();
        } else if (name) alert("A playlist with that name already exists.");
    };
}
function deletePlaylist(playlistName) {
    if (userPlaylists[playlistName]) {
        delete userPlaylists[playlistName];
        // TODO: Add API Call to delete playlist
        populateLibraryView();
        showToast(`Playlist "${playlistName}" was deleted.`);
    }
}
function populatePlaylistView(playlistName) {
    hideAllMainViews();
    const libraryView = document.getElementById('library_view');
    libraryView.classList.remove('hidden');
    const songs = (userPlaylists[playlistName] || []).map(id => allSongs.get(id)).filter(Boolean);
    let html = `<div class="song-list-header"><h1>${playlistName}</h1>${songs.length ? `<button id="play_all_playlist"><i class="bi bi-play-fill"></i> Play All</button>`:''}</div>`;
    html += songs.length ? `<ol class="playlist-view">${songs.map(s => renderSongListItem(s,{playlistName})).join('')}</ol>` : renderEmptyState('bi-music-note-beamed','This playlist is empty','Find songs to add.');
    libraryView.innerHTML = html;
    const playAllBtn = libraryView.querySelector('#play_all_playlist');
    if (playAllBtn) playAllBtn.onclick = () => { currentPlaylist = songs; if (currentPlaylist.length) playSong(currentPlaylist[0].id); };
}
function removeSongFromPlaylist(songId, playlistName) {
    if (!confirm("Are you sure you want to remove this song?")) return;
    if (playlistName === 'liked') {
        toggleLike(songId);
    } else if (userPlaylists[playlistName]) {
        userPlaylists[playlistName] = userPlaylists[playlistName].filter(id => id !== songId);
        // TODO: Add API call to remove song from playlist
        populatePlaylistView(playlistName);
        showToast(`Removed from "${playlistName}"`);
    }
}
function renderSongListItem(song, context = {}) {
    if (!song) return '';
    let actionIconsHTML = `<i class="bi bi-plus-lg action-icon" data-action="add-to-playlist" title="Add to Playlist"></i><i class="bi bi-music-note-list action-icon" data-action="add-to-queue" title="Add to Queue"></i>`;
    if (context.playlistName) {
        actionIconsHTML = `<i class="bi bi-trash-fill action-icon" data-action="remove-from-playlist" data-playlist-name="${context.playlistName}" title="Remove"></i>`;
    }
    return `
        <li class="songitem" data-id="${song.id}">
            <img src="${song.poster}" alt="" class="track_poster">
            <div class="song_details">
                ${song.songName.split('<br>')[0]}
                <div class="subtitle">${song.songName.split('<div class="subtitle">')[1].replace('</div>','')}</div>
            </div>
            <div class="action-icons">${actionIconsHTML}</div>
        </li>`;
}
function populateRecentlyPlayedListView() {
    const container = document.getElementById('library_view');
    const songs = recentlyPlayed.map(id => allSongs.get(id)).filter(Boolean);
    let html = `<div class="song-list-header"><h1>Recently Played</h1>${songs.length ? `<button id="play_all_recent"><i class="bi bi-play-fill"></i> Play All</button>`:''}</div>`;
    html += songs.length ? `<ol class="playlist-view">${songs.map(s => renderSongListItem(s)).join('')}</ol>` : '<p style="color: #a4a8b4;">No recently played songs.</p>';
    container.innerHTML = html;
    const playAllBtn = container.querySelector('#play_all_recent');
    if (playAllBtn) playAllBtn.onclick = () => { currentPlaylist = songs; if (currentPlaylist.length) playSong(currentPlaylist[0].id); };
}
function updateProfileStats() {
    const el = document.getElementById('liked_songs_count');
    if (el) el.innerText = likedSongs.size;
}
function addToRecentlyPlayed(songId) {
    recentlyPlayed = recentlyPlayed.filter(id => id !== songId);
    recentlyPlayed.unshift(songId);
    if (recentlyPlayed.length > 50) recentlyPlayed = recentlyPlayed.slice(0, 50);
    saveLocalSettings();
}
function populateRecentlyPlayedViews() {}
function setupScrollers() {
    setupScroller('pop_song_container', 'pop_song_left', 'pop_song_right');
    setupScroller('featured_albums_container', 'album_left', 'album_right');
    setupScroller('telugu_songs_container', 'telugu_song_left', 'telugu_song_right');
    setupScroller('hindi_songs_container', 'hindi_song_left', 'hindi_song_right');
    setupScroller('english_songs_container', 'english_song_left', 'english_song_right');
    setupScroller('tamil_songs_container', 'tamil_song_left', 'tamil_song_right');
    setupScroller('artists_container', 'pop_artist_left', 'pop_artist_right');
}
function setupScroller(containerId, leftBtnId, rightBtnId) {
    const container = document.getElementById(containerId);
    const leftBtn = document.getElementById(leftBtnId);
    const rightBtn = document.getElementById(rightBtnId);
    if (!container || !leftBtn || !rightBtn) return;
    leftBtn.onclick = () => container.scrollLeft -= 330;
    rightBtn.onclick = () => container.scrollLeft += 330;
}
function startBannerSlideshow(bannerPlaylist) {
    let i = 0; const update = () => updateBanner(bannerPlaylist[i]); update();
    clearInterval(bannerSlideshowInterval);
    bannerSlideshowInterval = setInterval(() => { i = (i + 1) % bannerPlaylist.length; const banner = document.querySelector('#discovery_carousels .content'); if(banner) { banner.classList.add('fade-out'); setTimeout(() => { update(); banner.classList.remove('fade-out'); }, 300); } }, 5000);
}
function updateBanner(song) {
    if (!song) return;
    const banner = document.querySelector('#discovery_carousels .content');
    if (!banner) return;
    banner.querySelector('h1').textContent = song.songName.split('<br>')[0];
    banner.querySelector('p').textContent = song.songName.split('<div class="subtitle">')[1].replace('</div>', '');
    banner.style.backgroundImage = `url(${song.poster})`;
}
function setupBannerFunctionality(bannerPlaylist) {
    const banner = document.querySelector('#discovery_carousels .content');
    if (!banner) return;
    banner.querySelector('.buttons button:first-child').onclick = () => { currentPlaylist = bannerPlaylist; if (bannerPlaylist.length) playSong(bannerPlaylist[0].id); };
    banner.onmouseenter = () => clearInterval(bannerSlideshowInterval);
    banner.onmouseleave = () => startBannerSlideshow(bannerPlaylist);
}
function updateDynamicBackground(posterUrl) { if (posterUrl) songSide.style.setProperty('--bg-image', `url(${posterUrl})`); songSide.classList.toggle('has-bg', !!posterUrl); }
function updateNowPlayingIndicator() {
    document.querySelectorAll('.songitem.playing').forEach(item => item.classList.remove('playing'));
    if (index) document.querySelectorAll(`.songitem[data-id="${index}"]`).forEach(item => item.classList.add('playing'));
}
function showNowPlayingView() {
    if (window.innerWidth <= 930 && index) {
        document.querySelectorAll('#discovery_carousels, #library_view, #album_view, #artist_view, #search_results_view').forEach(v => {
            if (!v.classList.contains('hidden')) { lastActiveView = v.id; v.classList.add('hidden'); }
        });
        document.getElementById('now_playing_view').classList.remove('hidden');
        document.body.classList.add('now-playing-active');
    }
}
function hideNowPlayingView() {
    document.getElementById('now_playing_view').classList.add('hidden');
    document.getElementById(lastActiveView).classList.remove('hidden');
    document.body.classList.remove('now-playing-active');
}
function syncPlayerUI() {
    const isPlaying = !music.paused && music.currentTime > 0;
    document.querySelectorAll('#masterPlay, #np_masterPlay').forEach(i => { if (i) { i.classList.toggle('bi-play-circle-fill', !isPlaying); i.classList.toggle('bi-pause-circle-fill', isPlaying); i.title = isPlaying ? 'Pause' : 'Play'; } });
    const { currentTime, duration } = music;
    const progress = duration ? (currentTime / duration) * 100 : 0;
    document.querySelectorAll('#seek, #np_seek').forEach(b => { if(b) b.value = progress; });
    document.querySelectorAll('#bar2, #np_bar2').forEach(b => { if(b) b.style.width = `${progress}%`; });
    const formatTime = (t) => t ? `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}` : '0:00';
    document.querySelectorAll('#currentStart, #np_currentStart').forEach(e => { if(e) e.innerText = formatTime(currentTime || 0); });
    document.querySelectorAll('#currentEnd, #np_currentEnd').forEach(e => { if(e) e.innerText = formatTime(duration); });
    document.querySelectorAll('#shuffle, #np_shuffle').forEach(b => { if(b) b.classList.toggle('active', isShuffle); });
    document.querySelectorAll('#repeat, #np_repeat').forEach(b => { if(b) b.classList.toggle('active', repeatMode !== 0); });
    const isLiked = likedSongs.has(index);
    document.querySelectorAll('#like_master, #np_like').forEach(i => { if(i) { i.classList.toggle('liked', isLiked); i.classList.toggle('bi-heart-fill', isLiked); i.classList.toggle('bi-heart', !isLiked); } });
    updateNowPlayingIndicator();
}

// ================================
// SEARCH FUNCTIONS
// ================================
function setupSearch() {
    const searchInput = document.querySelector('.search input');
    const backBtn = document.getElementById('back_to_main_view_btn');
    searchInput.onfocus = showSearchPage;
    backBtn.onclick = hideSearchPage;
    
    // Live search as user types (debounced)
    const runLiveSearch = debounce(() => {
        const term = searchInput.value.trim();
        if (term.length >= 2) {
            executeSearchAndShowResults(term, { updateRecents: false });
        } else {
            populateRecentSearchesView();
        }
    }, 350);
    
    searchInput.addEventListener('input', () => {
        if (!isSearchActive) showSearchPage();
        runLiveSearch();
    });
    searchInput.onkeydown = (e) => { if (e.key === 'Enter') { const term = searchInput.value.trim(); if(term) executeSearchAndShowResults(term); } };
    document.getElementById('search_results_view').addEventListener('click', (e) => {
        const item = e.target.closest('.recent-search-item');
        if (item) {
            e.preventDefault();
            const term = item.dataset.term;
            searchInput.value = term;
            executeSearchAndShowResults(term);
        }
    });
}
function showSearchPage() {
    if (isSearchActive) return; isSearchActive = true; songSide.classList.add('search-active');
    hideAllMainViews(); document.getElementById('search_results_view').classList.remove('hidden');
    populateRecentSearchesView();
}
function hideSearchPage() {
    if (!isSearchActive) return; isSearchActive = false; songSide.classList.remove('search-active');
    document.querySelector('.search input').value = ''; hideAllMainViews();
    document.getElementById(lastActiveView)?.classList.remove('hidden');
}
function populateRecentSearchesView() {
    const container = document.getElementById('search_results_view');
    let html = '<h1>Recent Searches</h1>';
    html += recentSearches.length ? `<ul class="recent-searches-list">${recentSearches.map(t => `<li class="recent-search-item" data-term="${t}"><i class="bi bi-clock-history"></i><span>${t}</span></li>`).join('')}</ul>` : '<p style="color: #a4a8b4;">Search for songs or artists.</p>';
    container.innerHTML = html;
}
async function executeSearchAndShowResults(searchTerm, options = { updateRecents: true }) {
    if (!searchTerm) return;
    if (options.updateRecents) {
        recentSearches = recentSearches.filter(t => t.toLowerCase() !== searchTerm.toLowerCase());
        recentSearches.unshift(searchTerm);
        if (recentSearches.length > 10) recentSearches = recentSearches.slice(0, 10);
        saveLocalSettings();
    }
    const view = document.getElementById('search_results_view');
    view.innerHTML = `<h1 style="color: #a4a8b4;">Searching for "${searchTerm}"...</h1>`;
    const results = await fetchSongsByQuery(searchTerm, 50);
    populateSearchResultsView(results, searchTerm);
}
function populateSearchResultsView(songs, query) {
    const container = document.getElementById('search_results_view');
    let html = `<h1><span>Results for:</span> ${query}</h1>`;
    if (songs && songs.length) {
        songs.forEach(s => { if (!allSongs.has(s.id)) allSongs.set(s.id, s); });
        html += `<ol class="playlist-view">${songs.map(s => renderSongListItem(s)).join('')}</ol>`;
    } else {
        html += `<p style="color: #a4a8b4;">No results found for "${query}".</p>`;
    }
    container.innerHTML = html;
}

// ============================================
// ARTIST RADIO LOGIC
// ============================================
async function startArtistRadio(artistName) {
    showToast(`Starting radio for ${artistName}...`);
    
    const similarArtistsMap = {
        "Arijit Singh": ["Pritam", "Atif Aslam"],
        "Anirudh Ravichander": ["Yuvan Shankar Raja", "Harris Jayaraj"],
        "Sid Sriram": ["G. V. Prakash Kumar", "Santhosh Narayanan"],
        "Taylor Swift": ["Olivia Rodrigo", "Ed Sheeran"],
        "The Weeknd": ["Post Malone", "Drake"]
    };

    try {
        const mainArtistSongs = await fetchSongsByQuery(artistName, 10);
        const similarArtistNames = similarArtistsMap[artistName] || [];
        const similarSongsPromises = similarArtistNames.map(name => fetchSongsByQuery(name, 5));
        const similarSongsArrays = await Promise.all(similarSongsPromises);
        const similarSongs = similarSongsArrays.flat();

        let radioPlaylist = [...mainArtistSongs, ...similarSongs];
        radioPlaylist.sort(() => Math.random() - 0.5); 

        if (radioPlaylist.length === 0) {
            showToast(`Could not create radio for ${artistName}.`, 'error');
            return;
        }

        currentPlaylist = radioPlaylist;
        playSong(currentPlaylist[0].id);

    } catch (error) {
        console.error("Error creating artist radio:", error);
        showToast("Failed to start artist radio.", "error");
    }
}

// ========================================
// SLEEP TIMER LOGIC
// ========================================
function setupSleepTimer() {
    const timerBtn = document.getElementById('sleep_timer_btn');
    const timerModal = document.getElementById('sleep_timer_modal');
    const cancelBtn = document.getElementById('cancel_sleep_timer_btn');

    timerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        timerModal.classList.toggle('hidden');
    });

    document.body.addEventListener('click', () => {
        if (!timerModal.classList.contains('hidden')) {
            timerModal.classList.add('hidden');
        }
    });

    timerModal.addEventListener('click', (e) => {
        e.stopPropagation();
        const minutes = e.target.dataset.minutes;
        if (minutes) {
            setSleepTimer(parseInt(minutes, 10));
            timerModal.classList.add('hidden');
        }
    });

    cancelBtn.addEventListener('click', () => {
        cancelSleepTimer();
        timerModal.classList.add('hidden');
    });
}

function setSleepTimer(minutes) {
    if (sleepTimerId) clearTimeout(sleepTimerId);

    const milliseconds = minutes * 60 * 1000;
    sleepTimerId = setTimeout(() => {
        music.pause();
        showToast(`Sleep timer finished. Music paused.`);
        cancelSleepTimer(); 
    }, milliseconds);

    document.getElementById('sleep_timer_btn').classList.add('active');
    document.getElementById('cancel_sleep_timer_btn').classList.remove('hidden');
    showToast(`Music will stop in ${minutes} minutes.`, 'success');
}

function cancelSleepTimer() {
    if (sleepTimerId) {
        clearTimeout(sleepTimerId);
        sleepTimerId = null;
        document.getElementById('sleep_timer_btn').classList.remove('active');
        document.getElementById('cancel_sleep_timer_btn').classList.add('hidden');
        showToast("Sleep timer cancelled.");
    }
}

// =============================================
// KEYBOARD SHORTCUTS LOGIC
// =============================================
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.code) {
            case 'Space': e.preventDefault(); togglePlayPause(); break;
            case 'ArrowRight': handleNextSong(); break;
            case 'ArrowLeft': handlePreviousSong(); break;
            case 'KeyM':
                const volIcon = document.getElementById('vol_icon');
                const volInput = document.getElementById('vol');
                if (music.volume > 0) {
                    music.volume = 0;
                    volInput.value = 0;
                    volIcon.classList.replace('bi-volume-up-fill', 'bi-volume-mute-fill');
                } else {
                    music.volume = 1;
                    volInput.value = 100;
                    volIcon.classList.replace('bi-volume-mute-fill', 'bi-volume-up-fill');
                }
                break;
        }
    });
}

// ================================
// EVENT LISTENERS
// ================================
function attachAllEventListeners() {
    document.body.addEventListener('click', async (e) => {
        const songItem = e.target.closest('.songitem');
        const actionIcon = e.target.closest('.action-icon');
        const playlistCard = e.target.closest('.playlist-card');
        const deletePlaylistBtn = e.target.closest('.delete-playlist-btn');
        const artistCard = e.target.closest('.artist_card');
        const albumCard = e.target.closest('.album_card');
        const radioBtn = e.target.closest('.start_artist_radio_btn');

        if (radioBtn) { startArtistRadio(radioBtn.dataset.artistName); return; }
        if (deletePlaylistBtn) { e.stopPropagation(); const name = deletePlaylistBtn.closest('.playlist-card').dataset.name; if (confirm(`Delete playlist "${name}"?`)) deletePlaylist(name); return; }
        if (actionIcon) { e.stopPropagation(); const id = actionIcon.closest('.songitem, .pop_song li')?.dataset.id; const action = actionIcon.dataset.action; if (action === 'add-to-playlist') openAddToPlaylistModal(id); else if (action === 'add-to-queue') addSongToQueue(id); else if (action === 'remove-from-playlist') removeSongFromPlaylist(id, actionIcon.dataset.playlistName); return; }
        if (songItem) { const id = songItem.dataset.id; const parentList = e.target.closest('.playlist-view, .pop_song'); if (parentList) { const items = Array.from(parentList.querySelectorAll('.songitem, .pop_song li')); if(items.length) { currentPlaylist = items.map(el => allSongs.get(el.dataset.id)).filter(Boolean); } } if (index !== id) playSong(id); else togglePlayPause(); }
        if (artistCard) { const name = artistCard.dataset.artistName; hideAllMainViews(); const view = document.getElementById('artist_view'); view.classList.remove('hidden'); lastActiveView = 'artist_view'; view.innerHTML = `<p style="padding: 20px;">Loading artist...</p>`; const data = await fetchArtistDetails(name); if (data) { populateArtistView(data); currentPlaylist = data.songs; } else view.innerHTML = `<p style="padding: 20px;">Could not load artist.</p>`; }
        if (albumCard) { const id = albumCard.dataset.albumId; hideAllMainViews(); const view = document.getElementById('album_view'); view.classList.remove('hidden'); lastActiveView = 'album_view'; view.innerHTML = `<p style="padding: 20px;">Loading album...</p>`; const data = await fetchAlbumDetails(id); if (data) { populateAlbumView(data); currentPlaylist = data.songs.map(s => allSongs.get(s.id)); } else view.innerHTML = `<p style="padding: 20px;">Could not load album.</p>`; }
        if (playlistCard) { populatePlaylistView(playlistCard.dataset.name); }
    });
    
    document.querySelectorAll('.playlist h4').forEach(menuItem => {
        menuItem.addEventListener('click', (e) => {
            hideSearchPage(); clearInterval(bannerSlideshowInterval);
            document.querySelector('.playlist h4.active')?.classList.remove('active');
            e.currentTarget.classList.add('active');
            const type = e.currentTarget.dataset.playlist;
            hideAllMainViews();
            const libView = document.getElementById('library_view');
            if (type === 'all') { lastActiveView = 'discovery_carousels'; document.getElementById('discovery_carousels').classList.remove('hidden'); startBannerSlideshow([...allSongs.values()].slice(0,8)); }
            else { libView.classList.remove('hidden'); lastActiveView = 'library_view'; if (type === 'liked') populateLikedSongsView(); else if (type === 'library') populateLibraryView(); else if (type === 'recent') populateRecentlyPlayedListView(); }
            if (window.innerWidth <= 930) closeMenu();
        });
    });

    document.getElementById('masterPlay').onclick = togglePlayPause;
    document.getElementById('next').addEventListener('click', handleNextSong);
    document.getElementById('back').addEventListener('click', handlePreviousSong);
    document.getElementById('shuffle').addEventListener('click', () => { isShuffle = !isShuffle; syncPlayerUI(); saveLocalSettings(); });
    document.getElementById('repeat').addEventListener('click', () => { repeatMode = (repeatMode + 1) % 3; syncPlayerUI(); saveLocalSettings(); });
    document.getElementById('like_master').addEventListener('click', () => { if (index) toggleLike(index); });
    document.getElementById('seek').onchange = () => { if (music.duration) music.currentTime = (document.getElementById('seek').value * music.duration) / 100; };
}

music.onplay = syncPlayerUI; music.onpause = syncPlayerUI; music.ontimeupdate = syncPlayerUI;
music.onloadeddata = syncPlayerUI; music.addEventListener('ended', handleNextSong);

const menu_list_icon = document.getElementById('menu_list');
const menu_side = document.querySelector('.menu_side');
const menu_overlay = document.getElementById('menu_overlay');
const profileModal = document.getElementById('profile_modal');
const closeModalButton = document.getElementById('close_modal');

function closeMenu() { menu_side.classList.remove('active'); menu_overlay.style.display = 'none'; }
if (menu_list_icon) menu_list_icon.onclick = () => { menu_side.classList.add('active'); menu_overlay.style.display = 'block'; };
if (menu_overlay) menu_overlay.onclick = closeMenu;
if (closeModalButton) closeModalButton.onclick = () => profileModal.style.display = 'none';

window.addEventListener('click', (e) => { 
    if (e.target == profileModal) profileModal.style.display = 'none';
    if (e.target == lyricsModal) lyricsModal.style.display = 'none';
    if (e.target == addToPlaylistModal) addToPlaylistModal.style.display = 'none';
    if (e.target == document.getElementById('listen_together_modal')) document.getElementById('listen_together_modal').style.display = 'none';
});

async function restoreLastSong() {
    const settings = JSON.parse(localStorage.getItem(`resona_local_settings_${currentUser?.userId}`)) || {};
    if (settings.lastSongId) {
        let songData = allSongs.get(settings.lastSongId);
        if (!songData) {
            try {
                const res = await fetch(`https://saavn.dev/api/songs?id=${settings.lastSongId}`);
                const data = await res.json();
                if (data.success && data.data.length > 0) {
                    const s = data.data[0];
                    songData = { id:s.id, songName:`${s.name}<br><div class="subtitle">${s.artists.primary.map(a=>a.name).join(', ')}</div>`, poster:s.image.find(i=>i.quality==='500x500')?.url, audioUrl:s.downloadUrl.find(a=>a.quality==='320kbps')?.url };
                    allSongs.set(songData.id, songData);
                }
            } catch (e) { console.error("Could not restore last song", e); }
        }
        if (songData) playSong(songData.id, false);
    }
}