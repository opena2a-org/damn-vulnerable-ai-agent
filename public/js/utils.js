/**
 * Utility functions — formatters, color mappings, helpers
 */

export const SECURITY_COLORS = {
  hardened: 'var(--hardened)',
  standard: 'var(--standard)',
  weak: 'var(--weak)',
  vulnerable: 'var(--vulnerable)',
  critical: 'var(--critical)',
};

export const SECURITY_LABELS = {
  hardened: 'HARDENED',
  standard: 'STANDARD',
  weak: 'WEAK',
  vulnerable: 'VULNERABLE',
  critical: 'CRITICAL',
};

export const PROTOCOL_LABELS = {
  api: 'API',
  mcp: 'MCP',
  a2a: 'A2A',
};

export const CATEGORY_LABELS = {
  promptInjection: 'Prompt Injection',
  jailbreak: 'Jailbreak',
  dataExfiltration: 'Data Exfiltration',
  capabilityAbuse: 'Capability Abuse',
  contextManipulation: 'Context Manipulation',
  mcpExploitation: 'MCP Exploitation',
  agentToAgent: 'Agent-to-Agent',
  supplyChain: 'Supply Chain',
  'prompt-injection': 'Prompt Injection',
  'jailbreak': 'Jailbreak',
  'data-exfiltration': 'Data Exfiltration',
  'capability-abuse': 'Capability Abuse',
  'context-manipulation': 'Context Manipulation',
  'mcp-exploitation': 'MCP Exploitation',
  'mcp-tool-exploitation': 'MCP Exploitation',
  'agent-to-agent': 'Agent-to-Agent',
  'supply-chain': 'Supply Chain',
  mixed: 'Mixed',
};

export const DIFFICULTY_LABELS = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

/**
 * Format relative time from timestamp
 */
export function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Format uptime seconds into human-readable string
 */
export function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Format number with locale separators
 */
export function formatNumber(n) {
  return (n || 0).toLocaleString();
}

/**
 * Calculate success rate percentage
 */
export function successRate(attacks, successful) {
  if (!attacks || attacks === 0) return '0.0';
  return ((successful / attacks) * 100).toFixed(1);
}

/**
 * Create a DOM element with properties
 */
export function el(tag, attrs = {}, ...children) {
  const elem = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') elem.className = val;
    else if (key === 'style' && typeof val === 'object') Object.assign(elem.style, val);
    else if (key.startsWith('on')) elem.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key === 'textContent') elem.textContent = val;
    else if (key === 'innerHTML') { /* skip — use textContent for safety */ }
    else elem.setAttribute(key, val);
  }
  for (const child of children) {
    if (typeof child === 'string') elem.appendChild(document.createTextNode(child));
    else if (child) elem.appendChild(child);
  }
  return elem;
}
