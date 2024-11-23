const socket = io();
let pyodideInstance;

// Load Pyodide for Python execution
async function setupPyodide() {
  const pyodide = await loadPyodide();
  console.log('Pyodide loaded');
  return pyodide;
}

setupPyodide().then(pyodide => {
  pyodideInstance = pyodide;
});

const codeMirrorInstance = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
  mode: 'python',
  lineNumbers: true,
});

document.getElementById('runCode').addEventListener('click', async () => {
  const code = codeMirrorInstance.getValue();
  const outputElement = document.getElementById('output');
  outputElement.textContent = 'Running...';

  try {
    const result = await pyodideInstance.runPythonAsync(code);
    outputElement.textContent = result;
  } catch (err) {
    outputElement.textContent = `Error: ${err}`;
  }
});

codeMirrorInstance.on('change', () => {
  const text = codeMirrorInstance.getValue();
  socket.emit('text-change', { text });
});

socket.on('text-updated', ({ text }) => {
  codeMirrorInstance.setValue(text);
});

socket.on('user-joined', ({ users }) => {
  const userList = document.getElementById('userList');
  userList.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.textContent = user.username + (user.isSelf ? ' (You)' : '');
    li.className = user.isSelf ? 'active' : '';
    userList.appendChild(li);
  });
});
