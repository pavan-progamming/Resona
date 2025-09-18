const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '..')));

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
    
    if (data.type === 'SYNC_STATE' && data.payload.targetUserId) {
        const targetUser = rooms[roomId].clients.find(client => client.id === data.payload.targetUserId);
        if(targetUser) {
            targetUser.send(message);
            console.log(`Syncing state to new user ${targetUser.id}`);
        }
        return;
    }

    rooms[roomId].clients.forEach(client => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.id = Date.now(); 

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { type, payload } = data;
            const { roomId, songId } = payload;
            
            switch (type) {
                case 'CREATE_ROOM':
                    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
                    ws.roomId = newRoomId;
                    rooms[newRoomId] = {
                        clients: [ws],
                        queue: []
                    };
                    ws.send(JSON.stringify({ type: 'ROOM_CREATED', payload: { roomId: newRoomId } }));
                    console.log(`Room ${newRoomId} created by ${ws.id}`);
                    broadcast(newRoomId, { type: 'USER_LIST_UPDATE', payload: { participants: getParticipantNames(newRoomId) } });
                    break;

                case 'JOIN_ROOM':
                    if (rooms[roomId]) {
                        ws.roomId = roomId;
                        rooms[roomId].clients.push(ws);
                        console.log(`Client ${ws.id} joined room ${roomId}`);
                        
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
                    if (rooms[roomId]) {
                        rooms[roomId].queue.push(songId);
                        broadcast(roomId, { type: 'QUEUE_UPDATE', payload: { queue: rooms[roomId].queue } });
                    }
                    break;

                case 'PLAY':
                case 'PAUSE':
                case 'SEEK':
                case 'CHANGE_SONG':
                case 'SYNC_STATE':
                case 'QUEUE_UPDATE': // Allow host to broadcast queue changes
                    broadcast(roomId, data, ws);
                    break;
            }
        } catch (error) {
            console.error("Failed to process message:", message.toString(), error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        const { roomId } = ws;
        if (roomId && rooms[roomId]) {
            rooms[roomId].clients = rooms[roomId].clients.filter(client => client !== ws);
            
            if (rooms[roomId].clients.length === 0) {
                delete rooms[roomId];
                console.log(`Room ${roomId} is empty and has been deleted.`);
            } else {
                broadcast(roomId, { type: 'USER_LIST_UPDATE', payload: { participants: getParticipantNames(roomId) } });
            }
        }
    });
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});