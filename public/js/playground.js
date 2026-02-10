// ===== Playground State =====
let currentLibrary = [];
let currentResults = null;
let llmSettings = {
  provider: 'simulated',
  apiKey: '',
  model: ''
};

// ===== DOM Elements =====
const librarySelect = document.getElementById('library-select');
const loadLibraryBtn = document.getElementById('load-library-btn');
const promptInput = document.getElementById('prompt-input');
const testBtn = document.getElementById('test-btn');
const clearBtn = document.getElementById('clear-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

// Results panel elements
const emptySection = document.getElementById('empty-section');
const loadingSection = document.getElementById('loading-section');
const resultsSection = document.getElementById('results-section');
const scoreValue = document.getElementById('score-value');
const scoreFill = document.getElementById('score-fill');
const categoriesList = document.getElementById('categories-list');
const recommendationsList = document.getElementById('recommendations-list');
const applyRecommendationsBtn = document.getElementById('apply-recommendations-btn');
const exportBtn = document.getElementById('export-btn');

// Settings elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const llmProvider = document.getElementById('llm-provider');
const apiKeySection = document.getElementById('api-key-section');
const apiKeyInput = document.getElementById('api-key');
const modelSection = document.getElementById('model-section');
const llmModel = document.getElementById('llm-model');
const testConnectionSection = document.getElementById('test-connection-section');
const testConnectionBtn = document.getElementById('test-connection-btn');
const connectionStatus = document.getElementById('connection-status');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');

// ===== Initialization =====
async function init() {
  try {
    // Check server status
    const response = await fetch('/health');
    if (response.ok) {
      statusDot.classList.add('online');
      statusText.textContent = 'Online';
    } else {
      throw new Error('Server not responding');
    }

    // Load best practices library
    await loadLibrary();
  } catch (error) {
    console.error('Initialization error:', error);
    statusDot.classList.add('offline');
    statusText.textContent = 'Offline';
    librarySelect.innerHTML = '<option value="">Error loading library</option>';
  }
}

// ===== Load Best Practices Library =====
async function loadLibrary() {
  try {
    const response = await fetch('/playground/library');
    if (!response.ok) {
      throw new Error('Failed to load library');
    }

    const data = await response.json();
    currentLibrary = data.examples || [];

    // Populate select dropdown
    librarySelect.innerHTML = '<option value="">Select a best practice...</option>';
    currentLibrary.forEach((item, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = item.name;
      librarySelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading library:', error);
    librarySelect.innerHTML = '<option value="">Error loading library</option>';
  }
}

// ===== Load Template into Prompt Textarea =====
function loadTemplate() {
  const selectedIndex = librarySelect.value;
  if (selectedIndex === '') {
    return;
  }

  const template = currentLibrary[selectedIndex];
  if (template && template.prompt !== undefined) {
    promptInput.value = template.prompt;
  }
}

// ===== Test Prompt =====
async function testPrompt() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert('Please enter a prompt to test');
    return;
  }

  // Show loading state
  emptySection.style.display = 'none';
  resultsSection.style.display = 'none';
  loadingSection.style.display = 'block';

  try {
    const requestBody = {
      systemPrompt: prompt,
      intensity: 'standard'
    };

    // Include LLM settings if using real LLM
    if (llmSettings.provider !== 'simulated') {
      requestBody.llmProvider = llmSettings.provider;
      requestBody.llmModel = llmSettings.model;
      requestBody.llmApiKey = llmSettings.apiKey;
    }

    const response = await fetch('/playground/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error('Test failed');
    }

    const data = await response.json();
    currentResults = data.results;

    // Debug: Log the response
    console.log('API Response:', data);
    console.log('Overall Score:', data.results.overallScore);
    console.log('Categories:', data.results.categories);

    // Display results
    displayResults(data.results);
  } catch (error) {
    console.error('Error testing prompt:', error);
    console.error('Error details:', error.message, error.stack);
    alert(`Error testing prompt: ${error.message}\n\nCheck browser console for details.`);
    loadingSection.style.display = 'none';
    emptySection.style.display = 'block';
  }
}

// ===== Display Results =====
function displayResults(results) {
  loadingSection.style.display = 'none';
  resultsSection.style.display = 'block';

  // Update score meter
  updateScoreMeter(results.overallScore);

  // Display vulnerability categories
  displayCategories(results.categories);

  // Display AI recommendations
  displayRecommendations(results.recommendations);
}

// ===== Update Score Meter =====
function updateScoreMeter(score) {
  // Update score text
  scoreValue.textContent = score;

  // Calculate arc fill (semi-circle = 180 degrees = π * radius)
  // Arc length ≈ 251.2 (calculated from SVG path)
  const arcLength = 251.2;
  const fillPercentage = score / 100;
  const dashOffset = arcLength * (1 - fillPercentage);

  // Animate the arc fill
  scoreFill.style.strokeDashoffset = dashOffset;

  // Update score color based on security level
  let color;
  if (score >= 81) {
    color = '#22c55e'; // Hardened
  } else if (score >= 61) {
    color = '#eab308'; // Standard
  } else if (score >= 41) {
    color = '#f59e0b'; // Weak
  } else if (score >= 21) {
    color = '#f97316'; // Vulnerable
  } else {
    color = '#ef4444'; // Critical
  }

  scoreValue.style.fill = color;
}

// ===== Display Vulnerability Categories =====
function displayCategories(categories) {
  categoriesList.innerHTML = '';

  // Convert categories object to array
  const categoryArray = Object.entries(categories).map(([name, data]) => ({
    name: name,
    attacks: data.attacks || [],
    total: data.total || 0,
    blocked: data.blocked || 0,
    succeeded: data.succeeded || 0
  }));

  // Render categories
  categoryArray.forEach(category => {
    const categoryItem = createCategoryItem(category);
    categoriesList.appendChild(categoryItem);
  });
}

// ===== Create Category Item =====
function createCategoryItem(category) {
  const item = document.createElement('div');
  item.className = 'category-item';

  // Count successful vs blocked attacks
  const successCount = category.attacks.filter(a => a.succeeded).length;
  const totalCount = category.attacks.length;

  const severityClass = successCount > totalCount * 0.5 ? 'high' : successCount > 0 ? 'medium' : 'low';

  item.innerHTML = `
    <div class="category-header">
      <span class="category-name">${category.name}</span>
      <div class="category-stats">
        <span class="category-count">${successCount}/${totalCount} vulnerable</span>
        <span class="category-severity ${severityClass}">${severityClass}</span>
        <span class="category-expand">▶</span>
      </div>
    </div>
    <div class="category-details">
      <ul class="attack-list">
        ${category.attacks.map((attack, idx) => `
          <li class="attack-item" data-attack-id="${idx}">
            <div class="attack-item-header">
              <span class="attack-status ${attack.succeeded ? 'success' : 'blocked'}"></span>
              <span class="attack-name">${attack.name}</span>
              <span class="attack-result ${attack.succeeded ? 'success' : 'blocked'}">
                ${attack.succeeded ? 'Vulnerable' : 'Blocked'}
              </span>
              <span class="attack-item-expand">▼</span>
            </div>
            <div class="attack-item-details">
              <div class="attack-detail-section">
                <div class="attack-detail-label">Attack Payload:</div>
                <div class="attack-detail-content">${escapeHtml(attack.payload)}</div>
              </div>
              <div class="attack-detail-section">
                <div class="attack-detail-label">LLM Response:</div>
                <div class="attack-detail-content">${escapeHtml(attack.response || 'No response')}</div>
              </div>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
  `;

  // Add click handler to toggle category expansion
  const header = item.querySelector('.category-header');
  header.addEventListener('click', () => {
    item.classList.toggle('expanded');
  });

  // Add click handlers to toggle attack item expansion
  const attackItems = item.querySelectorAll('.attack-item');
  attackItems.forEach(attackItem => {
    const attackHeader = attackItem.querySelector('.attack-item-header');
    attackHeader.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent category toggle
      attackItem.classList.toggle('attack-expanded');
    });
  });

  return item;
}

// ===== Display Recommendations =====
function displayRecommendations(recommendations) {
  if (!recommendations || recommendations.length === 0) {
    recommendationsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No recommendations available.</p>';
    applyRecommendationsBtn.style.display = 'none';
    return;
  }

  recommendationsList.innerHTML = '';

  recommendations.forEach(rec => {
    const recItem = document.createElement('div');
    recItem.className = 'recommendation-item';

    const priorityColor = rec.priority === 'critical' ? '#ef4444' : rec.priority === 'high' ? '#f97316' : rec.priority === 'medium' ? '#eab308' : '#64748b';

    recItem.innerHTML = `
      <div class="recommendation-title">
        <span style="color: ${priorityColor}; font-weight: 700; text-transform: uppercase; font-size: 0.75rem; margin-right: 0.5rem;">[${rec.priority}]</span>
        ${rec.issue}
      </div>
      <div class="recommendation-text">${rec.category}</div>
      ${rec.fix ? `<pre class="recommendation-code">${escapeHtml(rec.fix)}</pre>` : ''}
    `;

    recommendationsList.appendChild(recItem);
  });

  // Show apply button
  applyRecommendationsBtn.style.display = 'block';
}

// ===== Apply Recommendations =====
function applyRecommendations() {
  if (!currentResults || !currentResults.recommendations) {
    return;
  }

  // Combine all suggested fixes into the prompt
  const fixes = currentResults.recommendations
    .map(rec => rec.fix)
    .filter(fix => fix)
    .join('\n\n');

  if (fixes) {
    promptInput.value = promptInput.value + '\n\n' + fixes;
    alert('Recommendations applied to prompt. Review and test again.');
  } else {
    alert('No actionable recommendations to apply.');
  }
}

// ===== Clear Prompt =====
function clearPrompt() {
  promptInput.value = '';
  currentResults = null;

  // Reset to empty state
  resultsSection.style.display = 'none';
  loadingSection.style.display = 'none';
  emptySection.style.display = 'block';

  // Reset score meter
  scoreFill.style.strokeDashoffset = '251.2';
  scoreValue.textContent = '0';
  scoreValue.style.fill = 'var(--text)';
}

// ===== Export Results =====
function exportResults() {
  if (!currentResults) {
    alert('No results to export');
    return;
  }

  const dataStr = JSON.stringify(currentResults, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `playground-results-${Date.now()}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

// ===== Utility Functions =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Event Listeners =====
loadLibraryBtn.addEventListener('click', loadTemplate);
testBtn.addEventListener('click', testPrompt);
clearBtn.addEventListener('click', clearPrompt);
applyRecommendationsBtn.addEventListener('click', applyRecommendations);
exportBtn.addEventListener('click', exportResults);

// Allow Enter key to load template (when select is focused)
librarySelect.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && librarySelect.value !== '') {
    loadTemplate();
  }
});

// ===== Initialize on Load =====
init();

// ===== Settings Management =====
const MODEL_OPTIONS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (Recommended, ~$0.05/test)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Faster, ~$0.01/test)' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo (~$0.08/test)' }
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (Recommended, ~$0.03/test)' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (Most Capable, ~$0.10/test)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fastest, ~$0.01/test)' }
  ],
  ollama: [
    { value: 'llama2', label: 'Llama 2 (General Purpose)' },
    { value: 'llama3', label: 'Llama 3 (Latest)' },
    { value: 'mistral', label: 'Mistral (Fast)' },
    { value: 'mixtral', label: 'Mixtral (Most Capable)' },
    { value: 'phi', label: 'Phi (Small & Fast)' }
  ]
};

function loadSettings() {
  const saved = localStorage.getItem('dvaa-llm-settings');
  if (saved) {
    try {
      llmSettings = JSON.parse(saved);
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  }
  updateStatusText();
}

function saveSettings() {
  localStorage.setItem('dvaa-llm-settings', JSON.stringify(llmSettings));
  updateStatusText();
}

function updateStatusText() {
  if (llmSettings.provider === 'simulated') {
    statusText.textContent = 'Learning Mode';
    statusText.style.color = 'var(--green)';
  } else if (llmSettings.provider === 'ollama') {
    statusText.textContent = 'Local: Ollama';
    statusText.style.color = 'var(--teal)';
  } else {
    const providerText = llmSettings.provider === 'openai' ? 'OpenAI' : 'Claude';
    statusText.textContent = `Production: ${providerText}`;
    statusText.style.color = 'var(--amber)';
  }
}

function openSettings() {
  llmProvider.value = llmSettings.provider;
  apiKeyInput.value = llmSettings.apiKey;
  updateProviderFields();
  settingsModal.style.display = 'flex';
}

function closeSettings() {
  settingsModal.style.display = 'none';
  connectionStatus.textContent = '';
}

function updateProviderFields() {
  const provider = llmProvider.value;

  if (provider === 'simulated') {
    apiKeySection.style.display = 'none';
    modelSection.style.display = 'none';
    testConnectionSection.style.display = 'none';
  } else if (provider === 'ollama') {
    // Ollama doesn't need API key, only model selection
    apiKeySection.style.display = 'none';
    modelSection.style.display = 'block';
    testConnectionSection.style.display = 'block';

    const models = MODEL_OPTIONS[provider] || [];
    llmModel.innerHTML = models.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');

    if (llmSettings.model && models.find(m => m.value === llmSettings.model)) {
      llmModel.value = llmSettings.model;
    }
  } else {
    // OpenAI and Anthropic need API key
    apiKeySection.style.display = 'block';
    modelSection.style.display = 'block';
    testConnectionSection.style.display = 'block';

    const models = MODEL_OPTIONS[provider] || [];
    llmModel.innerHTML = models.map(m =>
      `<option value="${m.value}">${m.label}</option>`
    ).join('');

    if (llmSettings.model && models.find(m => m.value === llmSettings.model)) {
      llmModel.value = llmSettings.model;
    }
  }
}

function saveSettingsFromForm() {
  llmSettings = {
    provider: llmProvider.value,
    apiKey: apiKeyInput.value.trim(),
    model: llmModel.value
  };
  saveSettings();
  closeSettings();
  alert('Settings saved. You can now test prompts with ' + llmSettings.provider);
}

// Settings event listeners
settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
llmProvider.addEventListener('change', updateProviderFields);
saveSettingsBtn.addEventListener('click', saveSettingsFromForm);
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Load settings on startup
loadSettings();

// Test connection function
async function testConnection() {
  const provider = llmProvider.value;
  const apiKey = apiKeyInput.value.trim();
  const model = llmModel.value;

  // Ollama doesn't need API key
  if (provider !== 'ollama' && !apiKey) {
    connectionStatus.textContent = 'Please enter an API key';
    connectionStatus.className = 'connection-status error';
    return;
  }

  connectionStatus.textContent = 'Testing...';
  connectionStatus.className = 'connection-status';
  testConnectionBtn.disabled = true;

  try {
    const response = await fetch('/playground/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llmProvider: provider,
        llmModel: model,
        llmApiKey: apiKey
      })
    });

    const data = await response.json();

    if (data.success) {
      connectionStatus.textContent = '✓ Connection successful';
      connectionStatus.className = 'connection-status success';
    } else {
      connectionStatus.textContent = `✗ ${data.error || 'Connection failed'}`;
      connectionStatus.className = 'connection-status error';
    }
  } catch (error) {
    console.error('Connection test error:', error);
    connectionStatus.textContent = '✗ Network error - check connection';
    connectionStatus.className = 'connection-status error';
  } finally {
    testConnectionBtn.disabled = false;
  }
}

// Add event listener for test connection button
testConnectionBtn.addEventListener('click', testConnection);
