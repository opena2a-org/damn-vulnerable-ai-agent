/**
 * Settings view — LLM API key configuration
 */

import { el } from '../utils.js';

export function renderSettings(state) {
  const wrap = el('div', { className: 'settings-view' });

  wrap.appendChild(el('div', { className: 'section-header' }, 'Settings'));

  // LLM Configuration
  const llmSection = el('div', { className: 'settings-section' });
  llmSection.appendChild(el('h3', { className: 'settings-title' }, 'LLM Configuration'));
  llmSection.appendChild(el('p', { className: 'settings-desc' },
    'Provide your own API key to enable intelligent mode. Agents will use real LLM responses with vulnerable system prompts, and an AI tutor will guide your attacks in real-time. Your key is stored in memory only and never sent anywhere except your chosen LLM provider.'));

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
  [
    'DVAA is offline by default. No network calls are made without your explicit API key.',
    'Your API key is stored in memory only. It is never written to disk, never logged, and never sent to any server except your chosen LLM provider.',
    'No telemetry, analytics, or usage data is collected.',
    'All agent interactions happen locally between your browser and the DVAA server.',
    'Disabling LLM mode immediately removes your key from memory.',
  ].forEach(text => privacyList.appendChild(el('li', {}, text)));
  privacy.appendChild(privacyList);
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
      const resp = await fetch('/api/llm/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, model }),
      });
      const data = await resp.json();
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
      await fetch('/api/llm/disable', { method: 'POST' });
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
        statusText.textContent = 'Offline mode (default)';
        statusText.className = 'settings-status';
      }
    }
  }).catch(() => {});

  return wrap;
}
