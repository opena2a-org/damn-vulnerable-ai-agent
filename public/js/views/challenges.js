/**
 * Challenge Board view
 */

import { el, CATEGORY_LABELS } from '../utils.js';
import { categoryBadge, difficultyBadge, challengeStatusIcon, openModal } from '../components.js';
import { verifyChallenge } from '../api.js';

/**
 * Build the challenge detail modal content
 */
function challengeDetailModal(challenge) {
  const body = el('div');

  // Meta row
  const meta = el('div', { className: 'challenge-meta', style: { marginBottom: '0.75rem' } });
  meta.appendChild(categoryBadge(challenge.category));
  meta.appendChild(difficultyBadge(challenge.difficulty));
  meta.appendChild(el('span', { className: 'challenge-points' }, `${challenge.points} pts`));
  meta.appendChild(el('span', { className: 'port' }, `Target: ${challenge.targetAgent}`));
  body.appendChild(meta);

  // Description
  body.appendChild(el('p', { className: 'challenge-detail-desc' }, challenge.description));

  // Objectives
  const objHeader = el('p', { style: { fontWeight: '600', fontSize: '0.85rem', marginBottom: '0.25rem' } }, 'Objectives:');
  body.appendChild(objHeader);
  const objList = el('ul', { className: 'challenge-objectives' });
  for (const obj of (challenge.objectives || [])) {
    objList.appendChild(el('li', {}, obj));
  }
  body.appendChild(objList);

  // Progressive hints
  const hintContainer = el('div', { className: 'hint-container' });
  const hints = challenge.hints || [];
  hints.forEach((hint, i) => {
    const btn = el('button', { className: 'hint-btn' }, `> Hint ${i + 1}`);
    const text = el('div', { className: 'hint-text' }, hint);
    btn.addEventListener('click', () => text.classList.toggle('visible'));
    hintContainer.appendChild(btn);
    hintContainer.appendChild(text);
  });
  body.appendChild(hintContainer);

  // Verification section
  if (!challenge.manual) {
    const verifySection = el('div', { className: 'verify-section' });
    const input = el('input', {
      className: 'verify-input',
      type: 'text',
      placeholder: 'Paste agent response here to verify...',
    });
    const verifyBtn = el('button', { className: 'btn btn-primary' }, 'Verify');
    verifySection.appendChild(input);
    verifySection.appendChild(verifyBtn);
    body.appendChild(verifySection);

    const resultDiv = el('div');
    body.appendChild(resultDiv);

    verifyBtn.addEventListener('click', async () => {
      const response = input.value.trim();
      if (!response) return;
      verifyBtn.textContent = '...';
      verifyBtn.disabled = true;
      try {
        const result = await verifyChallenge(challenge.id, response);
        const resultEl = el('div', {
          className: `verify-result ${result.success ? 'success' : 'failure'}`,
        }, result.success
          ? `Completed! +${result.points} points (${result.attempts} attempt${result.attempts !== 1 ? 's' : ''})`
          : `${result.message} (attempt ${result.attempts})`
        );
        resultDiv.replaceChildren(resultEl);
      } catch {
        resultDiv.replaceChildren(el('div', { className: 'verify-result failure' }, 'Verification failed'));
      }
      verifyBtn.textContent = 'Verify';
      verifyBtn.disabled = false;
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verifyBtn.click();
    });
  } else {
    body.appendChild(el('p', { style: { color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' } },
      'This challenge requires manual verification.'));
  }

  return body;
}

/**
 * Build a single challenge tile
 */
function challengeTile(challenge) {
  const isCompleted = challenge.completed && challenge.completed.completedAt;
  const tile = el('div', { className: `challenge-tile${isCompleted ? ' completed' : ''}` });

  // Header row
  const header = el('div', { className: 'challenge-tile-header' });
  header.appendChild(el('span', { className: 'challenge-id' }, challenge.id));
  header.appendChild(el('span', { className: 'challenge-name' }, challenge.name));
  header.appendChild(challengeStatusIcon(challenge.completed));
  tile.appendChild(header);

  // Meta
  const meta = el('div', { className: 'challenge-meta' });
  meta.appendChild(categoryBadge(challenge.category));
  meta.appendChild(difficultyBadge(challenge.difficulty));
  meta.appendChild(el('span', { className: 'challenge-points' }, `${challenge.points} pts`));
  tile.appendChild(meta);

  // Target
  tile.appendChild(el('div', { className: 'challenge-target' }, `Target: ${challenge.targetAgent}`));

  // Click to open detail
  tile.addEventListener('click', () => {
    openModal(`${challenge.id}: ${challenge.name}`, challengeDetailModal(challenge));
  });

  return tile;
}

/**
 * Render challenge board
 */
export function renderChallenges(state) {
  const wrap = el('div');
  const challenges = state.challenges || [];

  // Scoreboard
  const totalPoints = challenges.reduce((s, c) => s + c.points, 0);
  const earnedPoints = challenges.reduce((s, c) => s + (c.completed?.completedAt ? c.points : 0), 0);
  const completedCount = challenges.filter(c => c.completed?.completedAt).length;
  const pct = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;

  const scoreboard = el('div', { className: 'challenge-scoreboard' });
  scoreboard.appendChild(el('div', { className: 'scoreboard-points' },
    `${earnedPoints}`,
    el('span', {}, ` / ${totalPoints}`)
  ));
  const bar = el('div', { className: 'progress-bar' });
  const fill = el('div', { className: 'progress-fill' });
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  scoreboard.appendChild(bar);
  scoreboard.appendChild(el('div', { className: 'scoreboard-count' }, `${completedCount} / ${challenges.length} completed`));
  wrap.appendChild(scoreboard);

  // Group by level
  const levels = [1, 2, 3, 4];
  const levelNames = { 1: 'Level 1 -- Beginner', 2: 'Level 2 -- Intermediate', 3: 'Level 3 -- Advanced', 4: 'Level 4 -- Expert' };

  for (const level of levels) {
    const levelChallenges = challenges.filter(c => c.level === level);
    if (levelChallenges.length === 0) continue;

    wrap.appendChild(el('div', { className: 'section-header' }, levelNames[level]));
    const grid = el('div', { className: 'challenge-grid' });
    for (const c of levelChallenges) {
      grid.appendChild(challengeTile(c));
    }
    wrap.appendChild(grid);
  }

  return wrap;
}
