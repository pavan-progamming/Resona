// ================================
// DOM ELEMENTS & GLOBAL STATE
// ================================
const masterPlay = document.getElementById('masterPlay');
const wave = document.getElementById('wave');
const poster_master_play = document.getElementById('poster_master_play');
const title = document.getElementById('title');
const songSide = document.querySelector('.song_side');
const music = new Audio();

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

// LISTEN TOGETHER STATE
let socket = null;
let isHost = false;
let roomId = null;
let sessionActive = false;

// MODAL ELEMENTS
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
// INITIALIZATION
// ================================
window.onload = () => {
    loadState();
    initializeApp();
    checkForSessionLink();
};

async function initializeApp() {
    showLoadingState();
    try {
        const [telugu, hindi, artists, featuredAlbums] = await Promise.all([
            fetchSongsByQuery('latest telugu'),
            fetchSongsByQuery('latest hindi'),
            fetchPopularArtists(),
            fetchFeaturedAlbums(['Pushpa', 'Kalki 2898 AD', 'Animal', 'Jawan', 'RRR'])
        ]);

        [...telugu, ...hindi].forEach(song => { if (!allSongs.has(song.id)) allSongs.set(song.id, song); });
        
        const popularSongs = [...telugu.slice(0, 4), ...hindi.slice(0, 4)];
        
        populateAllContentSections({ telugu, hindi, artists, popularSongs, featuredAlbums });
        
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
        updateProfileStats();
        populateRecentlyPlayedViews();
        restoreLastSong();
    } catch (error) {
        console.error("Initialization failed:", error);
        showErrorState();
    }
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
            </div>
        `;
        icon.classList.add('active');
        container.querySelector('#copy_link_btn').addEventListener('click', () => {
            navigator.clipboard.writeText(shareLink).then(() => alert('Invite link copied!'));
        });
    } else {
        container.innerHTML = `
            <p style="color: #a4a8b4; text-align: center;">Start a session to listen in real-time with friends.</p>
            <button id="start_session_btn">Start a New Session</button>
        `;
        icon.classList.remove('active');
        document.getElementById('participant_list_container').innerHTML = '';
    }
}

function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const socketUrl = `${wsProtocol}${window.location.host}`;
    
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
            case 'CHANGE_SONG':
                if (!isHost) playSong(payload.songId, true);
                break;
            case 'PLAY':
                if (!isHost) music.play();
                break;
            case 'PAUSE':
                if (!isHost) music.pause();
                break;
            case 'SEEK':
                if (!isHost) music.currentTime = payload.currentTime;
                break;
            case 'GET_STATE_FOR_NEW_USER':
                if (isHost) {
                    const state = {
                        songId: index,
                        currentTime: music.currentTime,
                        isPlaying: !music.paused,
                        queue: upNextQueue,
                        targetUserId: payload.newUserId
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
            case 'ERROR':
                alert(`Session Error: ${payload.message}`);
                leaveSession();
                break;
        }
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Could not connect to the listening session server.');
    };
    
    socket.onclose = () => {
        console.log('WebSocket connection closed.');
        leaveSession();
    };
}

function leaveSession() {
    if (socket) {
        socket.close();
        socket = null;
    }
    sessionActive = false;
    isHost = false;
    roomId = null;
    upNextQueue = [];
    renderUpNextQueue();
    updateSessionUI();
    document.getElementById('listen_together_modal').style.display = 'none';
}

function checkForSessionLink() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#listen/')) {
        const potentialRoomId = hash.split('/')[1].toUpperCase();
        if (potentialRoomId) {
            roomId = potentialRoomId;
            connectWebSocket();
            window.history.pushState("", document.title, window.location.pathname + window.location.search);
        }
    }
}

function updateParticipantList(participants) {
    const container = document.getElementById('participant_list_container');
    if (!sessionActive) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <h4>In this session (${participants.length})</h4>
        <div class="participants">
            ${participants.map(p => 
                `<span class="participant-badge ${p === 'Host' ? 'host' : ''}">${p}</span>`
            ).join('')}
        </div>
    `;
}

// ================================
// LYRICS FUNCTIONS
// ================================
function setupLyrics() {
    lyricsBtn.addEventListener('click', () => {
        if (!index) {
            alert("Please play a song first.");
            return;
        }
        fetchAndShowLyrics(index);
    });
    closeLyricsModalBtn.addEventListener('click', () => {
        lyricsModal.style.display = 'none';
    });
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

        if (data.success && data.data.lyrics) {
            lyricsContent.innerText = data.data.lyrics;
        } else {
            lyricsContent.innerText = data.message || 'Sorry, lyrics for this song are not available.';
        }
    } catch (error) {
        console.error("Failed to fetch lyrics:", error);
        lyricsContent.innerText = 'Could not load lyrics. Please try again later.';
    }
}

// ================================
// PLAYLIST & QUEUE FUNCTIONS
// ================================
function setupPlaylistModal() {
    closePlaylistModalBtn.addEventListener('click', () => {
        addToPlaylistModal.style.display = 'none';
    });
    createPlaylistBtn.addEventListener('click', () => {
        const playlistName = newPlaylistNameInput.value.trim();
        if (playlistName) {
            if (!userPlaylists[playlistName]) {
                userPlaylists[playlistName] = [];
            }
            addSongToPlaylist(playlistName);
            newPlaylistNameInput.value = '';
        }
    });
    playlistOptionsContainer.addEventListener('click', (e) => {
        const playlistOption = e.target.closest('.playlist-option');
        if (playlistOption) {
            addSongToPlaylist(playlistOption.dataset.playlist);
        }
    });
}

function openAddToPlaylistModal(songId) {
    songToAddToPlaylist = songId;
    playlistOptionsContainer.innerHTML = Object.keys(userPlaylists).map(name => `
        <div class="playlist-option" data-playlist="${name}">${name}</div>
    `).join('');
    addToPlaylistModal.style.display = 'block';
}

function addSongToPlaylist(playlistName) {
    if (songToAddToPlaylist && userPlaylists[playlistName]) {
        if (!userPlaylists[playlistName].includes(songToAddToPlaylist)) {
            userPlaylists[playlistName].push(songToAddToPlaylist);
            saveState();
        }
        addToPlaylistModal.style.display = 'none';
        songToAddToPlaylist = null;
    }
}

function addSongToQueue(songId) {
    const songData = allSongs.get(songId);
    if (!songData) return;
    
    if (sessionActive) {
        if(isHost) {
            upNextQueue.push(songId);
            socket.send(JSON.stringify({ type: 'QUEUE_UPDATE', payload: { roomId, queue: upNextQueue }}));
            renderUpNextQueue();
        } else {
            socket.send(JSON.stringify({ type: 'ADD_TO_QUEUE', payload: { roomId, songId }}));
        }
    } else {
        upNextQueue.push(songId);
        renderUpNextQueue();
    }
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
                    <div class="subtitle">${songData.songName.split('<div class="subtitle">')[1].replace('</div>','')}</div>
                </div>
            </div>
        `;
    }).join('');
}


// ================================
// MODIFIED CORE PLAYER FUNCTIONS
// ================================

function playSong(songId, autoPlay = true) {
    if (isHost && sessionActive && index !== songId) {
        socket.send(JSON.stringify({ type: 'CHANGE_SONG', payload: { roomId, songId }}));
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
    saveState();
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
        if (isHost && sessionActive) {
            socket.send(JSON.stringify({ type: 'PLAY', payload: { roomId } }));
        }
    } else {
        music.pause();
        if (isHost && sessionActive) {
            socket.send(JSON.stringify({ type: 'PAUSE', payload: { roomId } }));
        }
    }
}

document.getElementById('seek').addEventListener('change', () => {
    if (sessionActive && !isHost) {
        document.getElementById('seek').value = (music.currentTime / music.duration) * 100 || 0;
        return;
    };

    if (music.duration) {
        const newTime = (document.getElementById('seek').value * music.duration) / 100;
        music.currentTime = newTime;
        if (isHost && sessionActive) {
            socket.send(JSON.stringify({ type: 'SEEK', payload: { roomId, currentTime: newTime } }));
        }
    }
});

// ================================
// API FETCHING FUNCTIONS
// ================================
async function fetchArtistDetails(artistName) {
    try {
        const artistSearchUrl = `https://saavn.dev/api/search/artists?query=${encodeURIComponent(artistName)}`;
        const artistSearchRes = await fetch(artistSearchUrl);
        const artistSearchData = await artistSearchRes.json();
        if (!artistSearchData.success || artistSearchData.data.results.length === 0) throw new Error("Artist not found");
        const artistProfile = artistSearchData.data.results[0];
        const artistSongsUrl = `https://saavn.dev/api/artists/${artistProfile.id}/songs`;
        const artistSongsRes = await fetch(artistSongsUrl);
        const artistSongsData = await artistSearchRes.json();
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
    const artistNames = ["Arijit Singh", "Shreya Ghoshal", "Anirudh Ravichander", "Sid Sriram"];
    const artistPromises = artistNames.map(name => fetch(`https://saavn.dev/api/search/artists?query=${encodeURIComponent(name)}&limit=1`).then(res => res.json()));
    const results = await Promise.all(artistPromises);
    return results.filter(res => res.success && res.data.results.length > 0).map(res => { const artist = res.data.results[0]; return { id: artist.id, name: artist.name, image: artist.image.find(img => img.quality === '500x500')?.url || artist.image[0].url }; });
}


// =================================================================
// UI POPULATION & RENDERING FUNCTIONS
// =================================================================
function showLoadingState() {
    ['telugu', 'hindi', 'pop_song'].forEach(type => { 
        const container = document.getElementById(`${type}_songs_container`); 
        if (container) container.innerHTML = `<p style="padding: 10px; color: #a4a8b4;">Loading...</p>`; 
    });
}
function showErrorState() { 
    console.error("Failed to load content."); 
}
function hideAllMainViews() {
    document.querySelectorAll('#discovery_carousels, #library_view, #album_view, #artist_view, #search_results_view, #now_playing_view').forEach(v => v.classList.add('hidden'));
}
function populateAllContentSections({ telugu, hindi, artists, popularSongs, featuredAlbums }) {
    populateSongSection(document.getElementById('telugu_songs_container'), telugu);
    populateSongSection(document.getElementById('hindi_songs_container'), hindi);
    populateArtistsSection(document.getElementById('artists_container'), artists);
    populateSongSection(document.getElementById('pop_song_container'), popularSongs);
    populateFeaturedAlbums(document.getElementById('featured_albums_container'), featuredAlbums);
    attachAllEventListeners();
}
function populateSongSection(container, songList) {
    if (!container || !songList) return;
    container.innerHTML = songList.map(song => `
        <li class="songitem" data-id="${song.id}">
            <div class="img_play">
                <img src="${song.poster}" alt="">
                <i class="bi playlistplay bi-play-circle-fill"></i>
            </div>
            <h5>${song.songName}</h5>
            <div class="action-icons">
                <i class="bi bi-plus-lg action-icon" data-action="add-to-playlist" title="Add to Playlist"></i>
                <i class="bi bi-music-note-list action-icon" data-action="add-to-queue" title="Add to Queue"></i>
            </div>
        </li>
    `).join('');
}
function populateArtistsSection(container, artists) { if (!container || !artists || artists.length === 0) return; container.innerHTML = artists.map(artist => `<li class="artist_card" data-artist-name="${artist.name}"><img src="${artist.image}" alt="${artist.name}"><h5>${artist.name}</h5></li>`).join(''); }
function populateFeaturedAlbums(container, albums) { if (!container || !albums || albums.length === 0) return; container.innerHTML = albums.map(album => `<li class="album_card" data-album-id="${album.id}"><img src="${album.poster}" alt="${album.name}"><h5>${album.name}</h5></li>`).join(''); }
function populateArtistView(artistData) {
    const artistView = document.getElementById('artist_view');
    const artistSongs = artistData.songs;
    artistView.innerHTML = `<div id="artist_view_header"><img id="artist_art" src="${artistData.profile.image.find(img => img.quality === '500x500')?.url}" alt="${artistData.profile.name}"><div id="artist_details"><p>Artist</p><h1>${artistData.profile.name}</h1><button class="play_artist_btn"><i class="bi bi-play-fill"></i> Play</button></div></div><ol class="playlist-view">${artistSongs.map((song) => renderSongListItem(song)).join('')}</ol>`;
    artistView.querySelector('.play_artist_btn').addEventListener('click', () => { currentPlaylist = artistSongs; if (artistSongs.length > 0) playSong(artistSongs[0].id); });
}
function populateAlbumView(albumData) {
    const albumView = document.getElementById('album_view');
    const albumSongs = albumData.songs.map(song => allSongs.get(song.id));
    albumView.innerHTML = `<div id="album_view_header"><img id="album_art" src="${albumData.image.find(img => img.quality === '500x500')?.url}" alt="${albumData.name}"><div id="album_details"><p>Album</p><h1>${albumData.name}</h1><p>${albumData.artists.primary.map(a => a.name).join(', ')}</p><button class="play_album_btn"><i class="bi bi-play-fill"></i> Play</button></div></div><ol class="playlist-view">${albumSongs.map((song) => renderSongListItem(song)).join('')}</ol>`;
    albumView.querySelector('.play_album_btn').addEventListener('click', () => { currentPlaylist = albumSongs; if (albumSongs.length > 0) playSong(albumSongs[0].id); });
}
function populateNowPlayingView(songData) {
    const nowPlayingView = document.getElementById('now_playing_view');
    nowPlayingView.innerHTML = `<div class="np-header"><i class="bi bi-chevron-down" id="back_to_list_btn"></i></div><div class="np-main-content"><img src="${songData.poster}" alt="${songData.songName}" id="np_poster"><div id="np_title_wrapper"><h3 id="np_title">${songData.songName.split('<br>')[0]}</h3><p id="np_subtitle">${songData.songName.split('<div class="subtitle">')[1].replace('</div>','')}</p></div></div><div id="np_controls_wrapper"><div class="seek-container" id="np_seek_container"><span id="np_currentStart">0:00</span><div class="bar"><input type="range" id="np_seek" min="0" max="100" value="0"><div class="bar2" id="np_bar2"></div><div class="dot"></div></div><span id="np_currentEnd">0:00</span></div><div class="buttons-container" id="np_buttons_container"><i class="bi bi-shuffle" id="np_shuffle" title="Shuffle"></i><i class="bi bi-skip-start-fill" id="np_back" title="Previous"></i><i class="bi bi-play-circle-fill" id="np_masterPlay" title="Play"></i><i class="bi bi-skip-end-fill" id="np_next" title="Next"></i><i class="bi bi-repeat" id="np_repeat" title="Repeat"></i></div><div id="np_side_controls"><i class="bi bi-heart" id="np_like" title="Like"></i></div></div>`;
    nowPlayingView.style.setProperty('--bg-image', `url(${songData.poster})`);
    nowPlayingView.classList.add('has-bg');
    nowPlayingView.querySelector('#back_to_list_btn').addEventListener('click', hideNowPlayingView);
    nowPlayingView.querySelector('#np_masterPlay').onclick = togglePlayPause;
    nowPlayingView.querySelector('#np_next').onclick = () => document.getElementById('next').click();
    nowPlayingView.querySelector('#np_back').onclick = () => document.getElementById('back').click();
    nowPlayingView.querySelector('#np_shuffle').onclick = () => document.getElementById('shuffle').click();
    nowPlayingView.querySelector('#np_repeat').onclick = () => document.getElementById('repeat').click();
    nowPlayingView.querySelector('#np_like').onclick = () => { if (index) toggleLike(index); };
    const npSeek = nowPlayingView.querySelector('#np_seek');
    npSeek.addEventListener('change', () => { if (music.duration) music.currentTime = (npSeek.value * music.duration) / 100; });
}
function attachAllEventListeners() {
    document.body.addEventListener('click', async (e) => {
        const songItem = e.target.closest('.songitem');
        const actionIcon = e.target.closest('.action-icon');
        
        if (actionIcon) {
            e.stopPropagation();
            const songId = actionIcon.closest('.songitem').dataset.id;
            const actionType = actionIcon.dataset.action;
            if (actionType === 'add-to-playlist') {
                openAddToPlaylistModal(songId);
            } else if (actionType === 'add-to-queue') {
                addSongToQueue(songId);
            }
            return;
        }

        if (songItem) {
            const clickedId = songItem.dataset.id;
            if (e.target.closest('.playlist-view')) {
                const playlistIds = Array.from(e.target.closest('.playlist-view').querySelectorAll('.songitem')).map(el => el.dataset.id);
                currentPlaylist = playlistIds.map(id => allSongs.get(id));
            }
            
            if (index !== clickedId) {
                playSong(clickedId);
            } else {
                togglePlayPause();
            }
        }

        const artistCard = e.target.closest('.artist_card');
        if (artistCard) {
            const artistName = artistCard.dataset.artistName;
            hideAllMainViews();
            const artistView = document.getElementById('artist_view');
            artistView.classList.remove('hidden');
            lastActiveView = 'artist_view';
            artistView.innerHTML = `<p style="padding: 20px; color: #a4a8b4;">Loading artist...</p>`;
            const artistData = await fetchArtistDetails(artistName);
            if (artistData) { populateArtistView(artistData); currentPlaylist = artistData.songs; } 
            else { artistView.innerHTML = `<p style="padding: 20px; color: #fff;">Could not load artist.</p>`; }
        }

        const albumCard = e.target.closest('.album_card');
        if (albumCard) {
            const albumId = albumCard.dataset.albumId;
            hideAllMainViews();
            const albumView = document.getElementById('album_view');
            albumView.classList.remove('hidden');
            lastActiveView = 'album_view';
            albumView.innerHTML = `<p style="padding: 20px; color: #a4a8b4;">Loading album...</p>`;
            const albumData = await fetchAlbumDetails(albumId);
            if (albumData) { populateAlbumView(albumData); currentPlaylist = albumData.songs.map(s => allSongs.get(s.id)); } 
            else { albumView.innerHTML = `<p style="padding: 20px; color: #fff;">Could not load album.</p>`; }
        }
        
        const playlistCard = e.target.closest('.playlist-card');
        if (playlistCard) {
            const playlistName = playlistCard.dataset.name;
            populatePlaylistView(playlistName);
        }
    });
    
    document.querySelectorAll('.playlist h4').forEach(menuItem => {
        menuItem.addEventListener('click', (e) => {
            hideSearchPage();
            clearInterval(bannerSlideshowInterval);
            const activeItem = document.querySelector('.playlist h4.active');
            if (activeItem) activeItem.classList.remove('active');
            e.currentTarget.classList.add('active');
            const playlistType = e.currentTarget.dataset.playlist;
            hideAllMainViews();
            const libraryView = document.getElementById('library_view');

            if (playlistType === 'all') {
                lastActiveView = 'discovery_carousels';
                document.getElementById('discovery_carousels').classList.remove('hidden'); 
                startBannerSlideshow([...allSongs.values()].slice(0, 8));
            } else {
                libraryView.classList.remove('hidden');
                lastActiveView = 'library_view';
                switch (playlistType) {
                    case 'liked': populateLikedSongsView(); break;
                    case 'library': populateLibraryView(); break;
                    case 'recent': populateRecentlyPlayedListView(); break;
                }
            }
            if (window.innerWidth <= 930) { closeMenu(); }
        });
    });

    document.getElementById('masterPlay').onclick = togglePlayPause;
    document.getElementById('next').addEventListener('click', handleNextSong);
    document.getElementById('back').addEventListener('click', handlePreviousSong);
    document.getElementById('shuffle').addEventListener('click', () => { isShuffle = !isShuffle; syncPlayerUI(); saveState(); });
    document.getElementById('repeat').addEventListener('click', () => { repeatMode = (repeatMode + 1) % 3; syncPlayerUI(); saveState(); });
    document.getElementById('like_master').addEventListener('click', () => { if (index) toggleLike(index); });
}

music.onplay = syncPlayerUI;
music.onpause = syncPlayerUI;
music.ontimeupdate = syncPlayerUI;
music.onloadeddata = syncPlayerUI;
music.addEventListener('ended', handleNextSong);

function handleNextSong() {
    if (sessionActive && !isHost) return;
    
    if (upNextQueue.length > 0) {
        const nextSongId = upNextQueue.shift();
        renderUpNextQueue();
        if(sessionActive && isHost) {
            socket.send(JSON.stringify({ type: 'QUEUE_UPDATE', payload: { roomId, queue: upNextQueue }}));
        }
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
        if (repeatMode === 1 && currentPlaylist.length > 0) {
            playSong(currentPlaylist[0].id);
        }
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

function toggleLike(songId) {
    if (likedSongs.has(songId)) {
        likedSongs.delete(songId);
    } else {
        likedSongs.add(songId);
    }
    saveState();
    syncPlayerUI();
    if (document.querySelector('.playlist h4[data-playlist="liked"].active')) {
        populateLikedSongsView();
    }
}

function saveState() {
    localStorage.setItem("playerState", JSON.stringify({
        lastSongId: index,
        likedSongs: [...likedSongs],
        recentlyPlayed: recentlyPlayed,
        recentSearches: recentSearches,
        userPlaylists: userPlaylists,
        isShuffle,
        repeatMode,
        volume: music.volume
    }));
}
function loadState() {
    try {
        const state = JSON.parse(localStorage.getItem("playerState"));
        if (!state) return;
        likedSongs = new Set(state.likedSongs || []);
        recentlyPlayed = state.recentlyPlayed || [];
        recentSearches = state.recentSearches || [];
        userPlaylists = state.userPlaylists || {};
        isShuffle = !!state.isShuffle;
        repeatMode = state.repeatMode || 0;
        music.volume = state.volume ?? 1;
    } catch (e) { console.warn("Could not load state", e); }
}
async function restoreLastSong() {
    const state = JSON.parse(localStorage.getItem("playerState"));
    if (state && state.lastSongId) {
        let lastSongData = allSongs.get(state.lastSongId);
        if (!lastSongData) {
            try {
                const songSearchUrl = `https://saavn.dev/api/songs?id=${state.lastSongId}`;
                const res = await fetch(songSearchUrl);
                const data = await res.json();
                if(data.success && data.data.length > 0) {
                    const song = data.data[0];
                    const formatted = { id: song.id, songName: `${song.name}<br><div class="subtitle">${song.artists.primary.map(a => a.name).join(', ')}</div>`, poster: song.image.find(img => img.quality === '500x500')?.url || song.image[0].url, audioUrl: song.downloadUrl.find(aud => aud.quality === '320kbps')?.url || song.downloadUrl[0].url };
                    lastSongData = formatted;
                    allSongs.set(lastSongData.id, lastSongData);
                }
            } catch(e) { console.error("Could not restore last song", e); }
        }
        if (lastSongData) playSong(lastSongData.id, false);
    }
}
function updateProfileStats() { const el = document.getElementById('liked_songs_count'); if (el) el.innerText = likedSongs.size; }
function populateLikedSongsView() {
    const container = document.getElementById('library_view');
    const likedSongIds = [...likedSongs];
    const songs = likedSongIds.map(id => allSongs.get(id)).filter(Boolean).reverse();
    let html = `<div class="song-list-header"><h1>Liked Songs</h1><button id="play_all_liked"><i class="bi bi-play-fill"></i> Play All</button></div>`;
    if (songs.length > 0) {
        html += `<ol class="playlist-view">` + songs.map(song => renderSongListItem(song)).join('') + `</ol>`;
    } else {
        html += `<p style="color: #a4a8b4;">Songs you like will appear here.</p>`;
    }
    container.innerHTML = html;
    const playAllBtn = container.querySelector('#play_all_liked');
    if(playAllBtn) {
        playAllBtn.addEventListener('click', () => { 
            currentPlaylist = songs; 
            if (currentPlaylist.length > 0) playSong(currentPlaylist[0].id); 
        });
    }
}
function populateLibraryView() {
    const container = document.getElementById('library_view');
    let html = `<div class="song-list-header"><h1>Your Library</h1><button id="new_playlist_from_library">+ New Playlist</button></div>`;
    const playlists = Object.keys(userPlaylists);
    if (playlists.length > 0) {
        html += `<div class="playlist-grid">`;
        html += playlists.map(name => `
            <div class="playlist-card" data-name="${name}">
                <div class="playlist-art"><i class="bi bi-music-note-beamed"></i></div>
                <h5>${name}</h5>
                <p>${userPlaylists[name].length} songs</p>
            </div>
        `).join('');
        html += `</div>`;
    } else {
        html += `<p style="color: #a4a8b4;">Create your first playlist!</p>`;
    }
    container.innerHTML = html;
    container.querySelector('#new_playlist_from_library').addEventListener('click', () => {
        const name = prompt("Enter a name for your new playlist:");
        if(name && !userPlaylists[name]) {
            userPlaylists[name] = [];
            saveState();
            populateLibraryView();
        } else if(name) {
            alert("A playlist with that name already exists.");
        }
    });
}
function populatePlaylistView(playlistName) {
    hideAllMainViews();
    const libraryView = document.getElementById('library_view');
    libraryView.classList.remove('hidden');
    const songIds = userPlaylists[playlistName] || [];
    const songs = songIds.map(id => allSongs.get(id)).filter(Boolean);

    let html = `<div class="song-list-header"><h1>${playlistName}</h1><button id="play_all_playlist"><i class="bi bi-play-fill"></i> Play All</button></div>`;
    if (songs.length > 0) {
        html += `<ol class="playlist-view">` + songs.map(song => renderSongListItem(song)).join('') + `</ol>`;
    } else {
        html += `<p style="color: #a4a8b4;">Add some songs to this playlist.</p>`;
    }
    libraryView.innerHTML = html;
    const playAllBtn = libraryView.querySelector('#play_all_playlist');
    if(playAllBtn) {
        playAllBtn.addEventListener('click', () => { 
            currentPlaylist = songs; 
            if (currentPlaylist.length > 0) playSong(currentPlaylist[0].id); 
        });
    }
}
function renderSongListItem(song) {
    if (!song) return '';
    return `
        <li class="songitem" data-id="${song.id}">
            <img src="${song.poster}" alt="" class="track_poster">
            <div class="song_details">
                ${song.songName.split('<br>')[0]}
                <div class="subtitle">${song.songName.split('<div class="subtitle">')[1].replace('</div>','')}</div>
            </div>
            <div class="action-icons">
                <i class="bi bi-plus-lg action-icon" data-action="add-to-playlist" title="Add to Playlist"></i>
                <i class="bi bi-music-note-list action-icon" data-action="add-to-queue" title="Add to Queue"></i>
            </div>
        </li>
    `;
}
function populateRecentlyPlayedListView() {
    const container = document.getElementById('library_view');
    const recentSongs = recentlyPlayed.map(id => allSongs.get(id)).filter(Boolean);
    let html = `<div class="song-list-header"><h1>Recently Played</h1><button id="play_all_recent"><i class="bi bi-play-fill"></i> Play All</button></div>`;
    if (recentSongs.length > 0) {
        html += '<ol class="playlist-view">' + recentSongs.map(song => renderSongListItem(song)).join('') + '</ol>';
    } else {
        html += '<p style="color: #a4a8b4;">No recently played songs yet.</p>';
    }
    container.innerHTML = html;
    const playAllBtn = container.querySelector('#play_all_recent');
    if(playAllBtn) {
        playAllBtn.addEventListener('click', () => { 
            currentPlaylist = recentSongs; 
            if (currentPlaylist.length > 0) playSong(currentPlaylist[0].id); 
        });
    }
}
function addToRecentlyPlayed(songId) {
    recentlyPlayed = recentlyPlayed.filter(id => id !== songId);
    recentlyPlayed.unshift(songId);
    if (recentlyPlayed.length > 20) recentlyPlayed = recentlyPlayed.slice(0, 20);
    saveState();
}
function populateRecentlyPlayedViews() {}
function setupScrollers() {
    setupScroller('pop_song_container', 'pop_song_left', 'pop_song_right');
    setupScroller('featured_albums_container', 'album_left', 'album_right');
    setupScroller('telugu_songs_container', 'telugu_song_left', 'telugu_song_right');
    setupScroller('hindi_songs_container', 'hindi_song_left', 'hindi_song_right');
    setupScroller('artists_container', 'pop_artist_left', 'pop_artist_right');
}
function setupScroller(containerId, leftBtnId, rightBtnId) {
    const container = document.getElementById(containerId);
    const leftBtn = document.getElementById(leftBtnId);
    const rightBtn = document.getElementById(rightBtnId);
    if (!container || !leftBtn || !rightBtn) return;
    leftBtn.addEventListener('click', () => container.scrollLeft -= 330);
    rightBtn.addEventListener('click', () => container.scrollLeft += 330);
}
function startBannerSlideshow(bannerPlaylist) {
    let bannerIndex = 0;
    const update = () => updateBanner(bannerPlaylist[bannerIndex]);
    update();
    clearInterval(bannerSlideshowInterval);
    bannerSlideshowInterval = setInterval(() => { bannerIndex = (bannerIndex + 1) % bannerPlaylist.length; const banner = document.querySelector('#discovery_carousels .content'); if(banner) { banner.classList.add('fade-out'); setTimeout(() => { update(); banner.classList.remove('fade-out'); }, 300); } }, 5000);
}
function updateBanner(song) {
    if (!song) return;
    const banner = document.querySelector('#discovery_carousels .content');
    if (!banner) return; 
    const bannerTitle = banner.querySelector('h1');
    const bannerSubtitle = banner.querySelector('p');
    if (bannerTitle && bannerSubtitle) { bannerTitle.textContent = song.songName.split('<br>')[0]; bannerSubtitle.textContent = song.songName.split('<div class="subtitle">')[1].replace('</div>', ''); banner.style.backgroundImage = `url(${song.poster})`; }
}
function setupBannerFunctionality(bannerPlaylist) {
    const banner = document.querySelector('#discovery_carousels .content');
    if (!banner) return;
    const playBtn = banner.querySelector('.buttons button:first-child');
    playBtn.addEventListener('click', () => { currentPlaylist = bannerPlaylist; const songToPlay = bannerPlaylist[0]; if (songToPlay) playSong(songToPlay.id); });
    banner.addEventListener('mouseenter', () => clearInterval(bannerSlideshowInterval));
    banner.addEventListener('mouseleave', () => startBannerSlideshow(bannerPlaylist));
}
function updateDynamicBackground(posterUrl) { if (posterUrl) songSide.style.setProperty('--bg-image', `url(${posterUrl})`); songSide.classList.toggle('has-bg', !!posterUrl); }
function updateNowPlayingIndicator() {
    document.querySelectorAll('.songitem.playing, .album_song_item.playing').forEach(item => item.classList.remove('playing'));
    if (index) { document.querySelectorAll(`.songitem[data-id="${index}"]`).forEach(item => item.classList.add('playing')); }
}
function showNowPlayingView() { if (window.innerWidth <= 930 && index) { const allMainViews = document.querySelectorAll('#discovery_carousels, #library_view, #album_view, #artist_view, #search_results_view'); allMainViews.forEach(view => { if (!view.classList.contains('hidden')) { lastActiveView = view.id; view.classList.add('hidden'); } }); document.getElementById('now_playing_view').classList.remove('hidden'); } }
function hideNowPlayingView() { document.getElementById('now_playing_view').classList.add('hidden'); document.getElementById(lastActiveView).classList.remove('hidden'); }
function syncPlayerUI() {
    const isPlaying = !music.paused && music.currentTime > 0;
    document.querySelectorAll('#masterPlay, #np_masterPlay').forEach(icon => { if (icon) { if (isPlaying) { icon.classList.remove('bi-play-circle-fill'); icon.classList.add('bi-pause-circle-fill'); icon.title = 'Pause'; } else { icon.classList.remove('bi-pause-circle-fill'); icon.classList.add('bi-play-circle-fill'); icon.title = 'Play'; } } });
    const { currentTime, duration } = music;
    const progressBar = duration ? (currentTime / duration) * 100 : 0;
    document.querySelectorAll('#seek, #np_seek').forEach(bar => { if(bar) bar.value = progressBar; });
    document.querySelectorAll('#bar2, #np_bar2').forEach(bar => { if(bar) bar.style.width = `${progressBar}%`; });
    const formatTime = (time) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
    document.querySelectorAll('#currentStart, #np_currentStart').forEach(el => { if(el) el.innerText = formatTime(currentTime || 0); });
    document.querySelectorAll('#currentEnd, #np_currentEnd').forEach(el => { if(el) el.innerText = duration ? formatTime(duration) : '0:00'; });
    document.querySelectorAll('#shuffle, #np_shuffle').forEach(btn => { if(btn) btn.classList.toggle('active', isShuffle); });
    document.querySelectorAll('#repeat, #np_repeat').forEach(btn => { if(btn) btn.classList.toggle('active', repeatMode !== 0); });
    const isLiked = likedSongs.has(index);
    document.querySelectorAll('#like_master, #np_like').forEach(icon => { if(icon) { icon.classList.toggle('liked', isLiked); icon.classList.toggle('bi-heart-fill', isLiked); icon.classList.toggle('bi-heart', !isLiked); } });
    updateNowPlayingIndicator();
}
function setupSearch() {
    const searchInput = document.querySelector('.search input');
    const backBtn = document.getElementById('back_to_main_view_btn');
    const searchResultsView = document.getElementById('search_results_view');
    
    searchInput.addEventListener('focus', showSearchPage);
    backBtn.addEventListener('click', hideSearchPage);

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const searchTerm = searchInput.value.trim();
            if (searchTerm) {
                executeSearchAndShowResults(searchTerm);
            }
        }
    });

    searchResultsView.addEventListener('click', (e) => {
        const recentSearchItem = e.target.closest('.recent-search-item');
        if (recentSearchItem) {
            e.preventDefault();
            const searchTerm = recentSearchItem.dataset.term;
            searchInput.value = searchTerm;
            executeSearchAndShowResults(searchTerm);
        }
    });
}
function showSearchPage() {
    if (isSearchActive) return;
    isSearchActive = true;
    songSide.classList.add('search-active');
    hideAllMainViews();
    
    const searchResultsView = document.getElementById('search_results_view');
    searchResultsView.classList.remove('hidden');
    
    populateRecentSearchesView();
}
function hideSearchPage() {
    if (!isSearchActive) return;
    isSearchActive = false;
    songSide.classList.remove('search-active');
    document.querySelector('.search input').value = '';
    
    hideAllMainViews();
    const lastView = document.getElementById(lastActiveView);
    if(lastView) lastView.classList.remove('hidden');
}
function populateRecentSearchesView() {
    const container = document.getElementById('search_results_view');
    let html = '<h1>Recent Searches</h1>';
    
    if (recentSearches.length > 0) {
        html += '<ul class="recent-searches-list">';
        html += recentSearches.map(term => `
            <li class="recent-search-item" data-term="${term}">
                <i class="bi bi-clock-history"></i>
                <span>${term}</span>
            </li>
        `).join('');
        html += '</ul>';
    } else {
        html += '<p style="color: #a4a8b4;">Search for your favorite songs or artists.</p>';
    }
    container.innerHTML = html;
}
async function executeSearchAndShowResults(searchTerm) {
    if (!searchTerm) return;

    recentSearches = recentSearches.filter(term => term.toLowerCase() !== searchTerm.toLowerCase());
    recentSearches.unshift(searchTerm);
    if (recentSearches.length > 10) recentSearches = recentSearches.slice(0, 10);
    saveState();

    const searchResultsView = document.getElementById('search_results_view');
    searchResultsView.innerHTML = `<h1 style="color: #a4a8b4;">Searching for "${searchTerm}"...</h1>`;

    const results = await fetchSongsByQuery(searchTerm, 50);
    populateSearchResultsView(results, searchTerm);
}
function populateSearchResultsView(songs, query) {
    const container = document.getElementById('search_results_view');
    let html = `<h1><span>Results for:</span> ${query}</h1>`;

    if (songs && songs.length > 0) {
        songs.forEach(song => { if (!allSongs.has(song.id)) allSongs.set(song.id, song); });
        
        html += `<ol class="playlist-view">` + songs.map(song => renderSongListItem(song)).join('') + `</ol>`;
    } else {
        html += `<p style="color: #a4a8b4;">No songs found for "${query}".</p>`;
    }
    container.innerHTML = html;
}

const menu_list_icon = document.getElementById('menu_list');
const menu_side = document.querySelector('.menu_side');
const menu_overlay = document.getElementById('menu_overlay');
const userProfileButton = document.getElementById('user_profile_button');
const profileModal = document.getElementById('profile_modal');
const closeModalButton = document.getElementById('close_modal');
function closeMenu() { menu_side.classList.remove('active'); menu_overlay.style.display = 'none'; }
if (menu_list_icon) menu_list_icon.addEventListener('click', () => { menu_side.classList.add('active'); menu_overlay.style.display = 'block'; });
if (menu_overlay) menu_overlay.addEventListener('click', closeMenu);
if (userProfileButton) userProfileButton.addEventListener('click', () => profileModal.style.display = 'block');
if (closeModalButton) closeModalButton.addEventListener('click', () => profileModal.style.display = 'none');
window.addEventListener('click', (event) => { 
    if (event.target == profileModal) { profileModal.style.display = 'none'; }
    if (event.target == lyricsModal) { lyricsModal.style.display = 'none'; }
    if (event.target == addToPlaylistModal) { addToPlaylistModal.style.display = 'none'; }
    if (event.target == document.getElementById('listen_together_modal')) { document.getElementById('listen_together_modal').style.display = 'none'; }
});