const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Y = require('yjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
let rooms = {};

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  console.log('A user connected');
  
  socket.on('create-room', ({ username }) => {
    const roomId = uuidv4().substring(0, 8);
    const userId = socket.id;
    
    rooms[roomId] = {
      ydoc: new Y.Doc(),
      users: new Map([[userId, username]]),
      texts: new Map([[userId, '']])
    };
    
    socket.join(roomId);
    socket.emit('room-created', { roomId, userId, username });
  });

  socket.on('join-room', ({ username, roomId }) => {
    const userId = socket.id;
    
    if (!rooms[roomId]) {
      socket.emit('error-message', { message: 'Room not found' });
      return;
    }
    
    rooms[roomId].users.set(userId, username);
    rooms[roomId].texts.set(userId, '');
    
    socket.join(roomId);
    socket.emit('room-joined', {
      roomId,
      userId,
      username,
      users: Array.from(rooms[roomId].users.entries())
    });
    
    socket.to(roomId).emit('user-joined', {
      users: Array.from(rooms[roomId].users.entries())
    });
  });

  socket.on('text-change', ({ text, userId }) => {
    const roomId = Array.from(socket.rooms)[1];
    if (roomId && rooms[roomId]) {
      rooms[roomId].texts.set(userId, text);
      io.to(roomId).emit('text-updated', { userId, text });
    }
  });

  socket.on('get-user-text', ({ userId }) => {
    const roomId = Array.from(socket.rooms)[1];
    if (roomId && rooms[roomId]) {
      const text = rooms[roomId].texts.get(userId) || '';
      socket.emit('text-updated', { userId, text });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        room.texts.delete(socket.id);
        
        if (room.users.size === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit('user-left', {
            users: Array.from(room.users.entries())
          });
        }
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log('Server is running on http://localhost:' + PORT);
});