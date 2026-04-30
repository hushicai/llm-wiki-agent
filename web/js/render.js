// render.js — DOM rendering functions
// Depends on: marked.js (global), app.js state variables (currentRawText, currentAssistantMsg, etc.)

function addMessage(text, type) {
  const el = document.createElement('div');
  el.className = `msg ${type}`;
  if (text) {
    if (type === 'assistant') {
      currentRawText = text;
      el.innerHTML = renderMarkdown(text);
    } else {
      el.textContent = text;
    }
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function addToolCall(name, args) {
  console.log('[addToolCall]', name, args, 'currentAssistantMsg:', !!currentAssistantMsg, 'currentToolBlock:', !!currentToolBlock);
  // Remove thinking area if it still exists
  const thinking = currentAssistantMsg?.querySelector('.thinking');
  if (thinking) thinking.remove();

  const argsStr = typeof args === 'object' ? JSON.stringify(args).slice(0, 120) : String(args).slice(0, 120);

  if (!currentToolBlock) {
    // First tool call: create grouped tool block, insert before assistant msg
    currentToolBlock = document.createElement('div');
    currentToolBlock.className = 'msg tool-block';
    currentToolBlock.innerHTML = `
      <div class="tool-header" onclick="toggleToolBlock(this)">
        <span class="tool-toggle">▼</span>
        <span class="tool-count">🔧 1 tool</span>
      </div>
      <div class="tool-body">
        <div class="tool-line">🔧 <strong>${escapeHtml(name)}</strong> ${escapeHtml(argsStr)}</div>
      </div>`;
    toolCallCount = 1;
    messagesEl.insertBefore(currentToolBlock, currentAssistantMsg);
    console.log('[addToolCall] created block, children:', messagesEl.children.length, 'inserted before:', currentAssistantMsg?.className);
  } else {
    // Subsequent tool calls: append to existing block
    toolCallCount++;
    const body = currentToolBlock.querySelector('.tool-body');
    const line = document.createElement('div');
    line.className = 'tool-line';
    line.innerHTML = `🔧 <strong>${escapeHtml(name)}</strong> ${escapeHtml(argsStr)}`;
    body.appendChild(line);
    // Update count
    currentToolBlock.querySelector('.tool-count').textContent = `🔧 ${toolCallCount} tools`;
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function toggleToolBlock(header) {
  const block = header.parentElement;
  const body = block.querySelector('.tool-body');
  const toggle = header.querySelector('.tool-toggle');
  body.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed');
}

function appendContent(el, text) {
  // Accumulate raw markdown, re-render from scratch each time
  currentRawText += text;
  el.innerHTML = renderMarkdown(currentRawText);
  console.log('[appendContent] el className:', el.className, 'toolBlock parent:', currentToolBlock?.parentElement?.id);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMarkdown(text) {
  // Use marked.js for full GFM support
  return marked.parse(text, { breaks: true, gfm: true });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
