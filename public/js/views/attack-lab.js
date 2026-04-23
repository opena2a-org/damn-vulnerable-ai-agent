/**
 * Attack Lab — Interactive agent hacking with AI tutor guidance
 */

import { el } from '../utils.js';
import { codeBlock } from '../components.js';
import { renderMarkdown } from '../markdown.js';

// Session state
let sessionId = 'session-' + Date.now();
let chatHistory = [];
let selectedAgent = null;
let tutorMessages = [];
let killChainProgress = [];

/**
 * Send a message to the selected agent
 */
async function sendMessage(agentId, port, message) {
  const resp = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'dvaa',
      messages: [{ role: 'user', content: message }],
    }),
  });
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || 'No response';
}

/**
 * Get tutor guidance after an interaction
 */
async function getTutorGuidance(agentId, agentName, securityLevel, userInput, agentResponse) {
  try {
    const resp = await fetch('/api/tutor/guidance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        agentId,
        agentName,
        securityLevel,
        userInput,
        agentResponse,
        detectionResults: { hasAttack: false, categories: [] },
        activeChallenge: null,
      }),
    });
    const data = await resp.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Ask the tutor a direct question
 */
async function askTutor(question) {
  try {
    const resp = await fetch('/api/tutor/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, question }),
    });
    const data = await resp.json();
    return data.answer || data;
  } catch {
    return null;
  }
}

/**
 * Build a chat message element
 */
function chatMessage(role, content, meta) {
  const msg = el('div', { className: `chat-msg chat-msg-${role}` });
  const header = el('div', { className: 'chat-msg-header' });
  header.appendChild(el('span', { className: 'chat-msg-role' }, role === 'user' ? 'You' : selectedAgent?.name || 'Agent'));
  if (meta) {
    header.appendChild(el('span', { className: 'chat-msg-meta' }, meta));
  }
  msg.appendChild(header);

  const body = el('div', { className: 'chat-msg-body md-body' });
  for (const node of renderMarkdown(content)) body.appendChild(node);
  msg.appendChild(body);
  return msg;
}

/**
 * Build tutor message element
 */
function tutorMessage(content, type = 'guidance') {
  const msg = el('div', { className: `tutor-msg tutor-msg-${type}` });
  const header = el('div', { className: 'tutor-msg-header' });
  header.appendChild(el('span', { className: 'tutor-msg-role' }, 'Tutor'));
  msg.appendChild(header);

  const body = el('div', { className: 'tutor-msg-body md-body' });
  for (const node of renderMarkdown(content)) body.appendChild(node);
  msg.appendChild(body);
  return msg;
}

/**
 * Build kill chain progress bar
 */
function killChainBar(progress) {
  const stages = ['recon', 'initial_access', 'cred_harvest', 'priv_esc', 'lateral', 'persistence', 'collection', 'exfiltration', 'impact'];
  const labels = ['Recon', 'Access', 'Creds', 'PrivEsc', 'Lateral', 'Persist', 'Collect', 'Exfil', 'Impact'];

  const bar = el('div', { className: 'killchain-bar' });
  stages.forEach((stage, i) => {
    const active = progress.includes(stage);
    const node = el('div', { className: `killchain-node ${active ? 'active' : ''}` });
    node.appendChild(el('div', { className: 'killchain-dot' }));
    node.appendChild(el('div', { className: 'killchain-label' }, labels[i]));
    bar.appendChild(node);
    if (i < stages.length - 1) {
      bar.appendChild(el('div', { className: `killchain-connector ${active ? 'active' : ''}` }));
    }
  });
  return bar;
}

/**
 * Render the Attack Lab view
 */
export function renderAttackLab(state) {
  const wrap = el('div', { className: 'attack-lab' });

  // Agent selector + kill chain bar
  const topBar = el('div', { className: 'attack-lab-top' });

  const agentSelect = el('select', { className: 'agent-select' });
  agentSelect.appendChild(el('option', { value: '' }, '-- Select an agent to attack --'));

  const agents = state.agents || [];
  const protocols = { api: 'API', mcp: 'MCP', a2a: 'A2A' };
  for (const [proto, label] of Object.entries(protocols)) {
    const group = el('optgroup', { label });
    const protoAgents = agents.filter(a => a.protocol === proto);
    for (const agent of protoAgents) {
      const opt = el('option', { value: agent.id });
      opt.textContent = `${agent.name} (:${agent.port}) [${agent.securityLevel}]`;
      opt.dataset.port = agent.port;
      opt.dataset.security = agent.securityLevel;
      opt.dataset.name = agent.name;
      opt.dataset.protocol = agent.protocol;
      group.appendChild(opt);
    }
    if (protoAgents.length) agentSelect.appendChild(group);
  }
  // Preserve selected agent across re-renders so the user can see what they picked.
  if (selectedAgent) agentSelect.value = selectedAgent.id;
  topBar.appendChild(agentSelect);
  topBar.appendChild(killChainBar(killChainProgress));
  wrap.appendChild(topBar);

  // Main content: chat + tutor split
  const splitView = el('div', { className: 'attack-lab-split' });

  // === LEFT: Chat Panel ===
  const chatPanel = el('div', { className: 'chat-panel' });
  const chatHeader = el('div', { className: 'panel-header' });
  chatHeader.appendChild(el('span', {}, 'Attack Console'));
  chatPanel.appendChild(chatHeader);

  const chatMessages = el('div', { className: 'chat-messages', id: 'chat-messages' });

  if (!selectedAgent) {
    chatMessages.appendChild(el('div', { className: 'chat-placeholder' },
      'Select an agent above to start attacking. The tutor will guide you through the kill chain.'));
  } else if (chatHistory.length === 0) {
    chatMessages.appendChild(el('div', { className: 'chat-placeholder' },
      `Target: ${selectedAgent.name} (:${selectedAgent.port}, ${selectedAgent.securityLevel}). Send a message below to begin. Try asking what it knows, or slip in a prompt injection.`));
  } else {
    for (const msg of chatHistory) {
      chatMessages.appendChild(chatMessage(msg.role, msg.content, msg.meta));
    }
  }
  chatPanel.appendChild(chatMessages);

  // Input area
  const inputArea = el('div', { className: 'chat-input-area' });
  const chatInput = el('textarea', {
    className: 'chat-input',
    placeholder: selectedAgent ? `Attack ${selectedAgent.name}...` : 'Select an agent first',
    disabled: !selectedAgent,
    rows: 2,
  });
  const sendBtn = el('button', {
    className: 'btn btn-primary chat-send',
    disabled: !selectedAgent,
  }, 'Send');
  inputArea.appendChild(chatInput);
  inputArea.appendChild(sendBtn);
  chatPanel.appendChild(inputArea);

  splitView.appendChild(chatPanel);

  // === RIGHT: Tutor Panel ===
  const tutorPanel = el('div', { className: 'tutor-panel' });
  const tutorHeader = el('div', { className: 'panel-header tutor-header' });
  tutorHeader.appendChild(el('span', {}, 'AI Security Tutor'));

  // LLM status indicator
  const llmDot = el('span', { className: 'llm-status-dot', id: 'llm-dot' });
  tutorHeader.appendChild(llmDot);
  tutorPanel.appendChild(tutorHeader);

  const tutorMessagesEl = el('div', { className: 'tutor-messages', id: 'tutor-messages' });

  if (tutorMessages.length === 0) {
    const placeholder = el('div', { className: 'tutor-placeholder' });
    placeholder.appendChild(el('p', {}, 'The tutor will analyze your attacks and guide you through the AI Agent Kill Chain.'));
    placeholder.appendChild(el('p', { className: 'tutor-note' }, 'Configure an LLM API key in Settings for intelligent guidance. Without it, you can still attack agents manually.'));
    tutorMessagesEl.appendChild(placeholder);
  } else {
    for (const msg of tutorMessages) {
      tutorMessagesEl.appendChild(tutorMessage(msg.content, msg.type));
    }
  }
  tutorPanel.appendChild(tutorMessagesEl);

  // Tutor input
  const tutorInputArea = el('div', { className: 'tutor-input-area' });
  const tutorInput = el('input', {
    className: 'tutor-input',
    type: 'text',
    placeholder: 'Ask the tutor anything...',
  });
  const askBtn = el('button', { className: 'btn btn-secondary tutor-ask' }, 'Ask');
  tutorInputArea.appendChild(tutorInput);
  tutorInputArea.appendChild(askBtn);
  tutorPanel.appendChild(tutorInputArea);

  splitView.appendChild(tutorPanel);
  wrap.appendChild(splitView);

  // === Event Handlers ===

  // Agent selection
  agentSelect.addEventListener('change', () => {
    const opt = agentSelect.selectedOptions[0];
    if (opt.value) {
      selectedAgent = {
        id: opt.value,
        name: opt.dataset.name,
        port: parseInt(opt.dataset.port),
        securityLevel: opt.dataset.security,
        protocol: opt.dataset.protocol,
      };
      chatHistory = [];
      tutorMessages.push({ content: `Target selected: ${selectedAgent.name} (port ${selectedAgent.port}, ${selectedAgent.securityLevel}). Start with reconnaissance -- try the /info endpoint or ask the agent about its capabilities.`, type: 'guidance' });
      // Re-render
      const app = document.getElementById('app');
      app.replaceChildren(renderAttackLab(state));
    }
  });

  // Send message
  async function handleSend() {
    if (!selectedAgent || !chatInput.value.trim()) return;
    const message = chatInput.value.trim();
    chatInput.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    // Add user message
    chatHistory.push({ role: 'user', content: message });
    chatMessages.appendChild(chatMessage('user', message));
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      // Send to agent
      const response = await sendMessage(selectedAgent.id, selectedAgent.port, message);
      chatHistory.push({ role: 'assistant', content: response });
      chatMessages.appendChild(chatMessage('assistant', response));
      chatMessages.scrollTop = chatMessages.scrollHeight;

      // Get tutor guidance
      const guidance = await getTutorGuidance(
        selectedAgent.id, selectedAgent.name, selectedAgent.securityLevel,
        message, response
      );

      if (guidance?.guidance) {
        tutorMessages.push({ content: guidance.guidance, type: 'guidance' });
        tutorMessagesEl.appendChild(tutorMessage(guidance.guidance, 'guidance'));
        tutorMessagesEl.scrollTop = tutorMessagesEl.scrollHeight;

        // Update kill chain progress
        if (guidance.killChainProgress) {
          killChainProgress = guidance.killChainProgress;
          const bar = wrap.querySelector('.killchain-bar');
          if (bar) bar.replaceWith(killChainBar(killChainProgress));
        }
      }
    } catch (err) {
      chatHistory.push({ role: 'assistant', content: `Error: ${err.message}. Is the agent running?` });
      chatMessages.appendChild(chatMessage('assistant', `Error: ${err.message}. Is the agent running?`, 'error'));
    }

    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  }

  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Ask tutor
  async function handleAsk() {
    if (!tutorInput.value.trim()) return;
    const question = tutorInput.value.trim();
    tutorInput.value = '';

    tutorMessages.push({ content: question, type: 'question' });
    tutorMessagesEl.appendChild(tutorMessage(question, 'question'));

    const answer = await askTutor(question);
    if (answer) {
      const text = typeof answer === 'string' ? answer : answer.answer || 'No guidance available. Configure an LLM API key in Settings.';
      tutorMessages.push({ content: text, type: 'answer' });
      tutorMessagesEl.appendChild(tutorMessage(text, 'answer'));
      tutorMessagesEl.scrollTop = tutorMessagesEl.scrollHeight;
    }
  }

  askBtn.addEventListener('click', handleAsk);
  tutorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAsk();
  });

  // Check LLM status
  fetch('/api/llm/status').then(r => r.json()).then(data => {
    const dot = document.getElementById('llm-dot');
    if (dot) {
      dot.className = `llm-status-dot ${data.enabled ? 'active' : 'inactive'}`;
      dot.title = data.enabled ? `LLM: ${data.provider} (${data.model})` : 'LLM: Not configured (Settings)';
    }
  }).catch(() => {});

  return wrap;
}
