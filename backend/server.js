// =================================================================
//                      IMPORTS & INITIALIZATION
// =================================================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg'); // <-- Uses PostgreSQL driver

const app = express();
const server = http.createServer(app);

// =================================================================
//                         DATABASE SETUP
// =================================================================
// Configured for Render's free PostgreSQL tier
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // This line remains the same
    ssl: {
        rejectUnauthorized: false // This line ALSO remains the same
    }
});
console.log('PostgreSQL connection pool created. Forcing SSL via connection string and config.');


// =================================================================
//                           MIDDLEWARE
// =================================================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// --- Authentication Middleware (No changes needed) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// =================================================================
//                        HTTP API ROUTES
// =================================================================
console.log('Setting up API routes...');

// --- SERVE THE MAIN APP AS THE ROOT ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// --- AUTHENTICATION ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        console.log(`[REGISTER] Attempting to register user: ${username}`);
        const hashedPassword = await bcrypt.hash(password, 10);
        
        console.log('[REGISTER] Password hashed. Executing SQL query...');
        // Using PostgreSQL syntax with RETURNING id to get the new user's ID
        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
            [username, hashedPassword]
        );
        
        const newUserId = result.rows[0].id;
        console.log(`[REGISTER] User created successfully with ID: ${newUserId}`);
        const payload = { userId: newUserId, username: username };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
        
        res.status(201).json({ token, user: payload });

    } catch (err) {
        console.error("[REGISTER ERROR]", err);
        // PostgreSQL's error code for a unique constraint violation is '23505'
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Using PostgreSQL syntax and destructuring the 'rows' property from the result
        const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const payload = { userId: user.id, username: user.username };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({ token, user: payload });
    } catch (err) {
        console.error("[LOGIN ERROR]", err);
        res.status(500).json({ message: 'Server error during login.' });
    }
});


// --- PROTECTED USER DATA ROUTES ---

app.get('/api/data/all', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const { rows: likedRows } = await pool.query('SELECT song_id FROM liked_songs WHERE user_id = $1', [userId]);
        const likedSongs = likedRows.map(row => row.song_id);

        // PostgreSQL uses array_agg for aggregation, not GROUP_CONCAT
        const { rows: playlistRows } = await pool.query(`
            SELECT p.id, p.name, array_agg(ps.song_id) as songs
            FROM playlists p 
            LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
            WHERE p.user_id = $1 
            GROUP BY p.id, p.name`, [userId]);
        
        const userPlaylists = {};
        playlistRows.forEach(p => {
            // array_agg returns [null] for empty groups, so we handle that case
            userPlaylists[p.name] = p.songs[0] === null ? [] : p.songs;
        });
        res.json({ likedSongs, userPlaylists });
    } catch (err) {
        console.error("Error in /api/data/all:", err);
        res.status(500).json({ message: 'Error fetching user data.' });
    }
});

app.post('/api/data/like', authenticateToken, async (req, res) => {
    const { songId, like } = req.body;
    const userId = req.user.userId;
    try {
        if (like) {
            // PostgreSQL's "INSERT IGNORE" equivalent is "ON CONFLICT DO NOTHING"
            await pool.query('INSERT INTO liked_songs (user_id, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, songId]);
            res.status(201).json({ message: 'Song liked.' });
        } else {
            await pool.query('DELETE FROM liked_songs WHERE user_id = $1 AND song_id = $2', [userId, songId]);
            res.status(200).json({ message: 'Song unliked.' });
        }
    } catch (err) {
        console.error("Error in /api/data/like:", err);
        res.status(500).json({ message: 'Could not update liked songs.' });
    }
});

// --- PLAYLIST MANAGEMENT ROUTES ---
app.post('/api/data/playlists', authenticateToken, async (req, res) => {
    const { playlistName } = req.body;
    const userId = req.user.userId;
    if (!playlistName) {
        return res.status(400).json({ message: 'Playlist name is required.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
            [userId, playlistName]
        );
        res.status(201).json({ id: result.rows[0].id, name: playlistName, songs: [] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A playlist with that name already exists.' });
        }
        console.error("Error creating playlist:", err);
        res.status(500).json({ message: 'Server error creating playlist.' });
    }
});

app.post('/api/data/playlists/songs', authenticateToken, async (req, res) => {
    const { playlistName, songId } = req.body;
    const userId = req.user.userId;

    if (!playlistName || !songId) {
        return res.status(400).json({ message: "Playlist name and song ID are required." });
    }

    try {
        const { rows: playlistRows } = await pool.query(
            'SELECT id FROM playlists WHERE name = $1 AND user_id = $2',
            [playlistName, userId]
        );
        if (playlistRows.length === 0) {
            return res.status(404).json({ message: 'Playlist not found.' });
        }
        const playlistId = playlistRows[0].id;

        await pool.query(
            'INSERT INTO playlist_songs (playlist_id, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [playlistId, songId]
        );
        res.status(201).json({ message: 'Song added to playlist.' });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(200).json({ message: 'Song is already in the playlist.' });
        }
        console.error("Error adding song to playlist:", err);
        res.status(500).json({ message: 'Server error adding song.' });
    }
});

console.log('API routes configured.');

// =================================================================
//                   WEBSOCKET SERVER ("Listen Together")
// =================================================================
// This section requires no changes for the database switch
const wss = new WebSocket.Server({ server });
const rooms = {};

function getParticipantNames(roomId) {
    if (!rooms[roomId] || !rooms[roomId].clients) return [];
    return rooms[roomId].clients.map((client, index) => {
        return index === 0 ? "Host" : `Guest ${index + 1}`;
    });
}

function broadcast(roomId, data, sender) {
    if (!rooms[roomId]) return;
    const message = JSON.stringify(data);
    rooms[roomId].clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    ws.id = Date.now();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { type, payload } = data;
            const { roomId } = payload;
            
            switch (type) {
                case 'CREATE_ROOM':
                    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
                    ws.roomId = newRoomId;
                    rooms[newRoomId] = { clients: [ws], queue: [] };
                    ws.send(JSON.stringify({ type: 'ROOM_CREATED', payload: { roomId: newRoomId } }));
                    broadcast(newRoomId, { type: 'USER_LIST_UPDATE', payload: { participants: getParticipantNames(newRoomId) } });
                    break;
                case 'JOIN_ROOM':
                    if (rooms[roomId]) {
                        ws.roomId = roomId;
                        rooms[roomId].clients.push(ws);
                        broadcast(roomId, { type: 'USER_LIST_UPDATE', payload: { participants: getParticipantNames(roomId) } });
                        const host = rooms[roomId].clients[0];
                        if (host) {
                            host.send(JSON.stringify({ type: 'GET_STATE_FOR_NEW_USER', payload: { newUserId: ws.id } }));
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Room not found' } }));
                    }
                    break;
                case 'ADD_TO_QUEUE':
                case 'PLAY':
                case 'PAUSE':
                case 'SEEK':
                case 'CHANGE_SONG':
                case 'SYNC_STATE':
                case 'QUEUE_UPDATE':
                    if(rooms[roomId]) broadcast(roomId, data, ws);
                    break;
            }
        } catch (error) {
            console.error("Failed to process WebSocket message:", message.toString(), error);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        const { roomId } = ws;
        if (roomId && rooms[roomId]) {
            rooms[roomId].clients = rooms[roomId].clients.filter(client => client !== ws);
            if (rooms[roomId].clients.length === 0) {
                console.log(`Room ${roomId} is empty, deleting.`);
                delete rooms[roomId];
            } else {
                broadcast(roomId, { type: 'USER_LIST_UPDATE', payload: { participants: getParticipantNames(roomId) } });
            }
        }
    });
});
console.log('WebSocket server configured.');

// =================================================================
//                          SERVER START
// =================================================================
const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
    console.log(`🚀 Server is live and listening on port ${PORT}`);
    console.log(`Access the application at http://localhost:${PORT}`);
});