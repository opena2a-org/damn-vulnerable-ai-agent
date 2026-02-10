// ===== Playground State =====
let currentLibrary = [];
let currentResults = null;

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
    const response = await fetch('/playground/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ systemPrompt: prompt, intensity: 'standard' }),
    });

    if (!response.ok) {
      throw new Error('Test failed');
    }

    const data = await response.json();
    currentResults = data.results;

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
function displayCategories(results) {
  categoriesList.innerHTML = '';

  // Group results by category
  const categoryMap = new Map();

  results.forEach(result => {
    if (!categoryMap.has(result.category)) {
      categoryMap.set(result.category, {
        name: result.category,
        attacks: [],
        maxSeverity: 'low',
      });
    }

    const category = categoryMap.get(result.category);
    category.attacks.push(result);

    // Track highest severity
    if (result.severity === 'high' || category.maxSeverity !== 'high') {
      if (result.severity === 'high') {
        category.maxSeverity = 'high';
      } else if (result.severity === 'medium' && category.maxSeverity === 'low') {
        category.maxSeverity = 'medium';
      }
    }
  });

  // Sort categories by severity (high > medium > low)
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const sortedCategories = Array.from(categoryMap.values()).sort(
    (a, b) => severityOrder[a.maxSeverity] - severityOrder[b.maxSeverity]
  );

  // Render categories
  sortedCategories.forEach(category => {
    const categoryItem = createCategoryItem(category);
    categoriesList.appendChild(categoryItem);
  });
}

// ===== Create Category Item =====
function createCategoryItem(category) {
  const item = document.createElement('div');
  item.className = 'category-item';

  // Count successful vs blocked attacks
  const successCount = category.attacks.filter(a => a.success).length;
  const totalCount = category.attacks.length;

  item.innerHTML = `
    <div class="category-header">
      <span class="category-name">${category.name}</span>
      <div class="category-stats">
        <span class="category-count">${successCount}/${totalCount} vulnerable</span>
        <span class="category-severity ${category.maxSeverity}">${category.maxSeverity}</span>
        <span class="category-expand">▶</span>
      </div>
    </div>
    <div class="category-details">
      <ul class="attack-list">
        ${category.attacks.map(attack => `
          <li class="attack-item">
            <span class="attack-status ${attack.success ? 'success' : 'blocked'}"></span>
            <span class="attack-name">${attack.attack}</span>
            <span class="attack-result ${attack.success ? 'success' : 'blocked'}">
              ${attack.success ? 'Vulnerable' : 'Blocked'}
            </span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;

  // Add click handler to toggle expansion
  const header = item.querySelector('.category-header');
  header.addEventListener('click', () => {
    item.classList.toggle('expanded');
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

    recItem.innerHTML = `
      <div class="recommendation-title">${rec.title}</div>
      <div class="recommendation-text">${rec.description}</div>
      ${rec.suggestedFix ? `<pre class="recommendation-code">${escapeHtml(rec.suggestedFix)}</pre>` : ''}
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
    .map(rec => rec.suggestedFix)
    .filter(fix => fix)
    .join('\n\n');

  if (fixes) {
    promptInput.value = fixes;
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
