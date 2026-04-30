// app.js — application logic and state management
// Depends on: render.js (loaded first)

// --- State ---
let sessionId = null;
let currentAssistantMsg = null;
let currentRawText = '';
let currentToolBlock = null;
let toolCallCount = 0;
let loading = false;

// --- DOM refs ---
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');

// --- Auto-resize textarea ---
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

// --- Send message ---
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || loading) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  loading = true;
  sendBtn.disabled = true;

  // Add user message
  addMessage(text, 'user');

  // Show thinking placeholder for tool calls
  currentAssistantMsg = addMessage('', 'assistant');
  currentRawText = '';
  currentToolBlock = null;
  toolCallCount = 0;
  const thinkingDiv = document.createElement('div');
  thinkingDiv.className = 'thinking visible';
  const header = document.createElement('div');
  header.className = 'thinking-header';
  header.innerHTML = '<span class="spinner"></span>思考中<span class="dots"></span>';
  thinkingDiv.appendChild(header);
  currentAssistantMsg.appendChild(thinkingDiv);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, session_id: sessionId }),
    });

    if (!res.ok) {
      const err = await res.json();
      currentAssistantMsg.innerHTML = `<strong>Error:</strong> ${err.error}`;
      loading = false;
      sendBtn.disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          console.log('[SSE]', data.type, data.type === 'tool' ? data.name : '');
          handleSSEEvent(data);
        } catch (e) {
          console.warn('[SSE] parse error:', e.message, line.slice(0, 80));
        }
      }
    }
  } catch (err) {
    currentAssistantMsg.innerHTML = `<strong>Error:</strong> ${err.message}`;
  }

  loading = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

// --- SSE event handler ---
function handleSSEEvent(data) {
  switch (data.type) {
    case 'session_id':
      sessionId = data.id;
      break;
    case 'delta':
      if (currentAssistantMsg) {
        const thinking = currentAssistantMsg.querySelector('.thinking');
        if (thinking) thinking.remove();
        appendContent(currentAssistantMsg, data.content);
      }
      break;
    case 'tool':
      addToolCall(data.name, data.args);
      break;
    case 'tool_result':
      // Could update tool call status
      break;
    case 'end':
      sessionId = data.session_id || sessionId;
      break;
    case 'error':
      if (currentAssistantMsg) {
        currentAssistantMsg.innerHTML += `<br><strong>Error:</strong> ${data.message}`;
      }
      break;
  }
}

// --- Event listeners ---
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// Enable send after load
sendBtn.disabled = false;
inputEl.focus();
