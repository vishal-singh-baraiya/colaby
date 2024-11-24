const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Y = require('yjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
let rooms = {}; // Room management

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Handle room creation
  socket.on('create-room', ({ username }) => {
    const roomId = uuidv4().substring(0, 8);
    const userId = socket.id;

    // Create room with Yjs document and user list
    rooms[roomId] = {
      ydoc: new Y.Doc(),
      users: new Map([[userId, username]]),
      texts: new Map([[userId, '']]), // Track users' texts
    };

    socket.join(roomId);
    socket.emit('room-created', { roomId, userId, username });
    console.log(`Room ${roomId} created by ${username}`);
  });

  // Handle user joining an existing room
  socket.on('join-room', ({ username, roomId }) => {
    const userId = socket.id;

    if (!rooms[roomId]) {
      socket.emit('error-message', { message: 'Room not found' });
      return;
    }

    rooms[roomId].users.set(userId, username);
    rooms[roomId].texts.set(userId, ''); // Initialize text for new user

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

    console.log(`${username} joined room ${roomId}`);
  });

  // Sync text changes
  socket.on('text-change', ({ text, userId }) => {
    const roomId = Array.from(socket.rooms)[1]; // Get roomId from socket's rooms
    if (roomId && rooms[roomId]) {
      rooms[roomId].texts.set(userId, text);
      io.to(roomId).emit('text-updated', { userId, text });
    }
  });

  // Sync user text retrieval
  socket.on('get-user-text', ({ userId }) => {
    const roomId = Array.from(socket.rooms)[1];
    if (roomId && rooms[roomId]) {
      const text = rooms[roomId].texts.get(userId) || '';
      socket.emit('text-updated', { userId, text });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
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

  // Handle ICE candidates
  socket.on('ice-candidate', ({ candidate, target }) => {
    socket.to(target).emit('ice-candidate', { candidate, from: socket.id });
  });

  // Handle offer
  socket.on('offer', ({ offer, target }) => {
    socket.to(target).emit('offer', { offer, from: socket.id });
  });

  // Handle answer
  socket.on('answer', ({ answer, target }) => {
    socket.to(target).emit('answer', { answer, from: socket.id });
  });
});

server.listen(PORT, () => {
  console.log('Server is running on http://localhost:' + PORT);
});
