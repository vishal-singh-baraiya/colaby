let pyodide;
let editor;
let peerConnections = new Map(); // Store peer connections for each user
let dataChannels = new Map(); // Store RTCDataChannels for each user




async function initPyodide() {
  pyodide = await loadPyodide();
  console.log('Pyodide loaded');
}

initPyodide();

// Initialize CodeMirror editor
editor = CodeMirror(document.getElementById('editor'), {
  mode: 'python',        // Syntax highlighting for Python
  theme: 'night',      // Dark theme (can be changed as needed)
  lineNumbers: true,     // Display line numbers
  indentUnit: 4,         // Indentation width
  tabSize: 4,            // Tab size
  indentWithTabs: true,  // Use tabs for indentation (if true)
  autofocus: true,       // Focus editor when page loads
  lineWrapping: false,    // Allow lines to wrap within the editor's width
  matchBrackets: true,   // Highlight matching brackets
  showCursorWhenSelecting: true, // Show cursor when selecting text
  extraKeys: {
    'Ctrl-Space': 'autocomplete', 
  }
});

const socket = io();
let currentUserId = '';
let currentRoomId = '';
let currentUserName = '';
let selectedUserId = '';
let users = new Map();

// DOM Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const roomScreen = document.getElementById('roomScreen');
const createUsernameInput = document.getElementById('createUsername');
const joinUsernameInput = document.getElementById('joinUsername');
const roomIdInput = document.getElementById('roomIdInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const userList = document.getElementById('userList');
const currentRoomIdSpan = document.getElementById('currentRoomId');
const selectedUserNameSpan = document.getElementById('selectedUserName');
const output = document.getElementById('output');
const runCodeBtn = document.getElementById('runCode');

// Helper: Show messages in the output area
const showOutput = (message, isError = false) => {
  output.textContent = message;
  output.style.color = isError ? 'red' : 'white';
};

// Run Python code
runCodeBtn.addEventListener('click', async () => {
  try {
    showOutput('Running...', false);

    // Redirect stdout and stderr
    await pyodide.runPython(`
      import sys
      from io import StringIO
      sys.stdout = StringIO()
      sys.stderr = StringIO()
    `);

    const userCode = editor.getValue();
    await pyodide.runPython(userCode);

    const capturedOutput = await pyodide.runPython(`
      stdout = sys.stdout.getvalue()
      stderr = sys.stderr.getvalue()
      sys.stdout = sys.__stdout__
      sys.stderr = sys.__stderr__
      stdout + stderr
    `);

    showOutput(capturedOutput.trim() || 'Code executed successfully, but no output was produced.');
  } catch (error) {
    showOutput(`Error: ${error.message || error}`, true);
    console.error('Python execution error:', error);
  }
});

// Create Room
createRoomBtn.addEventListener('click', () => {
  const username = createUsernameInput.value.trim();
  if (!username) return alert('Please enter your name');
  socket.emit('create-room', { username });
});

// Join Room
joinRoomBtn.addEventListener('click', () => {
  const username = joinUsernameInput.value.trim();
  const roomId = roomIdInput.value.trim();
  if (!username || !roomId) return alert('Please enter both your name and room ID');
  socket.emit('join-room', { username, roomId });
});

// Handle editor changes with debounce
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const handleEditorChange = debounce((cm) => {
  const text = cm.getValue();
  if (selectedUserId) {
    sendEditorContentToPeer(text, selectedUserId); // Send editor content to selected peer
  }
  socket.emit('text-change', { text, userId: selectedUserId || currentUserId });
}, 500);

editor.on('change', (cm, change) => {
  if (change.origin !== 'setValue') {
    handleEditorChange(cm);
  }
});

// Socket event handlers
socket.on('room-created', ({ roomId, userId, username }) => {
  setupRoom(roomId, userId, username);
});

socket.on('room-joined', ({ roomId, userId, username, users: roomUsers }) => {
  setupRoom(roomId, userId, username);
  updateUsersList(roomUsers);
});

socket.on('user-joined', ({ users: roomUsers }) => {
  updateUsersList(roomUsers);
});

socket.on('user-left', ({ users: roomUsers }) => {
  updateUsersList(roomUsers);
});

socket.on('text-updated', ({ userId, text }) => {
  if (userId === (selectedUserId || currentUserId)) {
    const cursor = editor.getCursor();
    const scrollInfo = editor.getScrollInfo();
    editor.setValue(text);
    editor.setCursor(cursor);
    editor.scrollTo(scrollInfo.left, scrollInfo.top);
  }
});

socket.on('error-message', ({ message }) => {
  alert(message);
});

// Setup room UI
function setupRoom(roomId, userId, username) {
  currentRoomId = roomId;
  currentUserId = userId;
  currentUserName = username;
  selectedUserId = currentUserId;
  currentRoomIdSpan.textContent = roomId;
  welcomeScreen.style.display = 'none';
  roomScreen.style.display = 'block';
  editor.refresh();
}

// Update user list
function updateUsersList(roomUsers) {
  users = new Map(roomUsers);
  userList.innerHTML = '';
  users.forEach((username, userId) => {
    const li = document.createElement('li');
    li.textContent = username + (userId === currentUserId ? ' (You)' : '');
    li.classList.toggle('active', userId === selectedUserId);
    li.addEventListener('click', () => selectUser(userId, username));
    userList.appendChild(li);
  });
}

// Select user to view or edit their code
function selectUser(userId, username) {
  selectedUserId = userId;
  selectedUserNameSpan.textContent = userId === currentUserId ? 'You' : username;
  document.querySelectorAll('.user-list li').forEach(li => {
    li.classList.toggle('active', li.textContent.includes(username));
  });
  socket.emit('get-user-text', { userId });
}

// P2P: Setup WebRTC connection and DataChannel
function setupPeerConnection(userId) {
  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: "stun:stun2.l.google.com:19302" } ] // Example STUN server
  });

  // Create DataChannel
  const dataChannel = peerConnection.createDataChannel('editor', { ordered: true});

  // On DataChannel message, update editor
  dataChannel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'editor') {
      editor.setValue(data.content);
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { candidate: event.candidate, target: userId });
    }
  };

  peerConnections.set(userId, peerConnection);
  dataChannels.set(userId, dataChannel);
}

// Send editor content to peer
function sendEditorContentToPeer(text, userId) {
  const data = JSON.stringify({ type: 'editor', content: text });
  if (dataChannels.has(userId)) {
    dataChannels.get(userId).send(data);
  }
}

// WebRTC Signaling: Handle offers and answers
socket.on('offer', async (data) => {
  const { offer, from } = data;
  const peerConnection = new RTCPeerConnection();
  peerConnections.set(from, peerConnection);
  
  console.log(`Offer received from ${from}, creating peer connection`);

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  console.log(`Sending answer back to ${from}`);
  
  socket.emit('answer', { answer, target: from });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('ICE candidate received:', event.candidate);
      socket.emit('ice-candidate', { candidate: event.candidate, target: from });
    }
  };

  const dataChannel = peerConnection.createDataChannel('editor');
  dataChannel.onmessage = (event) => {
    console.log(`Received data: ${event.data}`);
    const data = JSON.parse(event.data);
    if (data.type === 'editor') {
      editor.setValue(data.content);
    }
  };
  dataChannels.set(from, dataChannel);
  console.log(`DataChannel created with ${from}`);
});

// When an answer is received
socket.on('answer', async (data) => {
  const { answer, from } = data;
  const peerConnection = peerConnections.get(from);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  
  console.log(`Answer received from ${from}, setting remote description`);
});

// When ICE candidate is received
socket.on('ice-candidate', (data) => {
  const { candidate, from } = data;
  const peerConnection = peerConnections.get(from);
  if (candidate) {
    console.log(`Adding ICE candidate from ${from}`);
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
});
