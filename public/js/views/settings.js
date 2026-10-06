/**
 * Settings view - LLM API key configuration
 */

import { el } from '../utils.js';
import { configureLLM, disableLLM } from '../api.js';

// What the code does today: src/index.js (tele.init, --offline),
// src/telemetry/actions.js (dashboard actions), src/llm/provider.js (BYOK),
// src/web-fetch.js, src/aim-cloud-reporter.js, README "Telemetry".
const PRIVACY_FACTS = [
  'Anonymous usage telemetry is on by default. DVAA sends the OpenA2A Registry the tool name and version, '
    + 'the command or dashboard action name (for example lab-chat or lab-scan), success and duration for CLI commands, '
    + 'the platform, the Node.js major version, and a stable per-machine install ID. '
    + 'It never includes payloads, prompts, responses, file contents or API keys.',
  'To turn telemetry off, start the server with --offline (for example dvaa --api --offline), '
    + 'set OPENA2A_TELEMETRY=off in the server environment (Docker: docker run -e OPENA2A_TELEMETRY=off ...), '
    + 'or run dvaa telemetry off, which saves the choice in ~/.config/opena2a/telemetry.json. '
    + 'The server reads this setting when it starts. dvaa telemetry status shows the current state.',
  'LLM mode: your API key goes from this page to the local DVAA server, which keeps it in memory only and uses it '
    + 'to call the provider you chose (OpenAI or Anthropic). It is not written to disk and the API never returns it. '
    + 'Disable, or restarting the server, removes it.',
  'While LLM mode is on, agent conversations (your messages and the agent system prompts) and tutor requests '
    + 'are sent to that provider.',
  'ResearchBot, FlightBot and their AIM variants can fetch an http(s) URL from your message, directly from the DVAA server.',
  'The DVAA server sends AIM verification events to an AIM server only when AIM_SERVER_URL, AIM_API_KEY and '
    + 'DVAA_AIM_CLOUD_AGENT_ID are set.',
];

export function renderSettings(state) {
  const wrap = el('div', { className: 'settings-view' });

  wrap.appendChild(el('div', { className: 'section-header' }, 'Settings'));

  // LLM Configuration
  const llmSection = el('div', { className: 'settings-section' });
  llmSection.appendChild(el('h3', { className: 'settings-title' }, 'LLM Configuration'));
  llmSection.appendChild(el('p', { className: 'settings-desc' },
    'Provide your own API key to enable intelligent mode. Agents will use real LLM responses with vulnerable system prompts, and an AI tutor will guide your attacks in real-time. Your key is held in memory by the local DVAA server and sent only to your chosen LLM provider.'));

  // Provider select
  const providerRow = el('div', { className: 'settings-row' });
  providerRow.appendChild(el('label', {}, 'Provider'));
  const providerSelect = el('select', { className: 'settings-input', id: 'llm-provider' });
  providerSelect.appendChild(el('option', { value: 'openai' }, 'OpenAI'));
  providerSelect.appendChild(el('option', { value: 'anthropic' }, 'Anthropic'));
  providerRow.appendChild(providerSelect);
  llmSection.appendChild(providerRow);

  // API Key input
  const keyRow = el('div', { className: 'settings-row' });
  keyRow.appendChild(el('label', {}, 'API Key'));
  const keyInput = el('input', {
    className: 'settings-input',
    type: 'password',
    placeholder: 'sk-... or sk-ant-...',
    id: 'llm-key',
  });
  keyRow.appendChild(keyInput);
  llmSection.appendChild(keyRow);

  // Model select
  const modelRow = el('div', { className: 'settings-row' });
  modelRow.appendChild(el('label', {}, 'Model'));
  const modelInput = el('input', {
    className: 'settings-input',
    type: 'text',
    placeholder: 'gpt-4o-mini (default)',
    id: 'llm-model',
  });
  modelRow.appendChild(modelInput);
  llmSection.appendChild(modelRow);

  // Buttons
  const btnRow = el('div', { className: 'settings-btn-row' });
  const enableBtn = el('button', { className: 'btn btn-primary' }, 'Enable LLM Mode');
  const disableBtn = el('button', { className: 'btn btn-danger' }, 'Disable');
  const statusEl = el('span', { className: 'settings-status', id: 'llm-status-text' }, '');
  btnRow.appendChild(enableBtn);
  btnRow.appendChild(disableBtn);
  btnRow.appendChild(statusEl);
  llmSection.appendChild(btnRow);

  wrap.appendChild(llmSection);

  // Privacy notice
  const privacy = el('div', { className: 'settings-section settings-privacy' });
  privacy.appendChild(el('h3', { className: 'settings-title' }, 'Privacy'));
  const privacyList = el('ul', { className: 'settings-privacy-list' });
  PRIVACY_FACTS.forEach(text => privacyList.appendChild(el('li', {}, text)));
  privacy.appendChild(privacyList);
  const policy = el('p', { className: 'settings-desc' }, 'Full telemetry schema, retention and deletion: ');
  policy.appendChild(el('a', { href: 'https://opena2a.org/telemetry', target: '_blank', rel: 'noopener noreferrer' }, 'opena2a.org/telemetry'));
  privacy.appendChild(policy);
  wrap.appendChild(privacy);

  // Event handlers
  enableBtn.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const apiKey = keyInput.value.trim();
    const model = modelInput.value.trim() || undefined;

    if (!apiKey) {
      statusEl.textContent = 'API key is required';
      statusEl.className = 'settings-status error';
      return;
    }

    try {
      const data = await configureLLM(provider, apiKey, model);
      statusEl.textContent = `Active: ${data.provider} (${data.model})`;
      statusEl.className = 'settings-status active';
      keyInput.value = '';  // Clear from DOM for security
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'settings-status error';
    }
  });

  disableBtn.addEventListener('click', async () => {
    try {
      await disableLLM();
      statusEl.textContent = 'LLM mode disabled';
      statusEl.className = 'settings-status';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'settings-status error';
    }
  });

  // Load current status
  fetch('/api/llm/status').then(r => r.json()).then(data => {
    const statusText = document.getElementById('llm-status-text');
    if (statusText) {
      if (data.enabled) {
        statusText.textContent = `Active: ${data.provider} (${data.model})`;
        statusText.className = 'settings-status active';
      } else {
        statusText.textContent = 'LLM mode off (default)';
        statusText.className = 'settings-status';
      }
    }
  }).catch(() => {});

  return wrap;
}
