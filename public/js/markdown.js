/**
 * Minimal markdown → DOM nodes renderer (XSS-safe).
 *
 * Built for LLM-generated content (tutor panels, agent chat, AI
 * recommendations). Returns an array of DOM nodes you can append. Does NOT
 * touch innerHTML — every piece of text goes through createTextNode via the
 * el() helper, so inline HTML / script tags in LLM output render as literal
 * text rather than executing.
 *
 * Supported:
 *   #  ##  ###        headings (h1–h6)
 *   **bold**          <strong>
 *   *italic*          <em>
 *   `inline code`     <code>
 *   ```lang\n...\n``` fenced code block
 *   - list item       unordered list
 *   1. list item      ordered list
 *   ---               horizontal rule
 *   [text](url)       external link
 *
 * NOT supported (yet): tables, blockquotes, nested lists, images, footnotes.
 * If the LLM emits these, they render as literal text — acceptable until
 * someone ships a use case that needs them.
 */

import { el } from './utils.js';

export function renderMarkdown(input) {
  const nodes = [];
  const src = String(input || '');

  // Split into top-level blocks: code fences are opaque, everything else
  // is line-addressable.
  const blocks = splitBlocks(src);
  for (const block of blocks) {
    if (block.type === 'code') {
      nodes.push(renderCodeBlock(block.code, block.lang));
    } else {
      nodes.push(...renderTextBlock(block.text));
    }
  }
  return nodes;
}

function splitBlocks(src) {
  const out = [];
  const parts = src.split(/(```[\s\S]*?```)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('```')) {
      const m = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (m) out.push({ type: 'code', lang: m[1] || '', code: m[2] });
      else out.push({ type: 'text', text: part });
    } else {
      out.push({ type: 'text', text: part });
    }
  }
  return out;
}

function renderCodeBlock(code, lang) {
  const wrap = el('pre', { className: `md-code${lang ? ' md-code-' + lang : ''}` });
  const c = el('code', {}, code.replace(/\n$/, ''));
  wrap.appendChild(c);
  return wrap;
}

function renderTextBlock(text) {
  const nodes = [];
  const lines = text.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // HR
    if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*+\s*$/.test(line)) {
      nodes.push(el('hr', { className: 'md-hr' }));
      i++;
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      nodes.push(el('h' + level, { className: 'md-h' + level }, ...renderInline(hMatch[2])));
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*+]\s+/, '');
        items.push(el('li', {}, ...renderInline(content)));
        i++;
      }
      nodes.push(el('ul', { className: 'md-ul' }, ...items));
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(el('li', {}, ...renderInline(content)));
        i++;
      }
      nodes.push(el('ol', { className: 'md-ol' }, ...items));
      continue;
    }

    // Paragraph: consume consecutive non-empty lines into one <p>.
    if (line.trim()) {
      const paraLines = [line];
      i++;
      while (i < lines.length && lines[i].trim() &&
             !/^\s*[-*+]\s+/.test(lines[i]) &&
             !/^\s*\d+\.\s+/.test(lines[i]) &&
             !/^#{1,6}\s+/.test(lines[i]) &&
             !/^\s*---+\s*$/.test(lines[i])) {
        paraLines.push(lines[i]);
        i++;
      }
      nodes.push(el('p', { className: 'md-p' }, ...renderInline(paraLines.join(' '))));
      continue;
    }

    i++;
  }
  return nodes;
}

/**
 * Inline renderer. Text with **bold**, *italic*, `code`, [text](url).
 * Returns an array of text nodes and elements — safe for appendChild via el().
 * All text hits createTextNode via the el() machinery, so no HTML injection.
 */
function renderInline(text) {
  const nodes = [];
  // Tokenize by the earliest-match of any inline pattern.
  const patterns = [
    { re: /\*\*([^*]+)\*\*/,           wrap: m => el('strong', {}, m[1]) },
    { re: /\*([^*]+)\*/,               wrap: m => el('em', {}, m[1]) },
    { re: /`([^`]+)`/,                 wrap: m => el('code', { className: 'md-inline-code' }, m[1]) },
    { re: /\[([^\]]+)\]\(([^)]+)\)/,   wrap: m => el('a', { href: m[2], target: '_blank', rel: 'noopener noreferrer', className: 'md-link' }, m[1]) },
  ];

  let remaining = text;
  while (remaining.length > 0) {
    let earliest = null;
    for (const p of patterns) {
      const m = remaining.match(p.re);
      if (m && (earliest === null || m.index < earliest.m.index)) {
        earliest = { p, m };
      }
    }
    if (!earliest) {
      nodes.push(document.createTextNode(remaining));
      break;
    }
    if (earliest.m.index > 0) {
      nodes.push(document.createTextNode(remaining.slice(0, earliest.m.index)));
    }
    nodes.push(earliest.p.wrap(earliest.m));
    remaining = remaining.slice(earliest.m.index + earliest.m[0].length);
  }
  return nodes;
}
