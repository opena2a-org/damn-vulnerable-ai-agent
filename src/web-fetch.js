/**
 * web_fetch tool implementation for the ResearchBot pair.
 *
 * Performs an HTTPS GET, follows up to 3 redirects, extracts plain text
 * from HTML (strips scripts, styles, tags; decodes the common entities),
 * and surfaces any URL-exfil-style indirect injection found on the page.
 *
 * The agent's vulnerability is to process the returned text as instructions.
 * The post-injection outbound action (http:post to an attacker-controlled
 * URL) is the AIM enforcement boundary in src/index.js — this module only
 * fetches and inspects, it does not act.
 *
 * No external dependency (Node `https` + `URL`). Cache lives under
 *   <DVAA_AIM_DATA_DIR or .dvaa-aim>/research-cache/<sha256(url)>.html
 * Populated on first live fetch. Re-used when --cache or DVAA_RESEARCH_CACHE=on
 * are set, or when the live fetch errors and a cache entry exists.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

// SSRF guard: refuse loopback, link-local, RFC1918, cloud metadata, and
// non-http(s) schemes by default. The demo target is the public web. Set
// `DVAA_ALLOW_INTERNAL_FETCH=1` if you need to point ResearchBot at a
// local fixture for offline-stage testing — this is opt-in because the
// chat REPL is a user-facing interface and an unbounded fetch primitive
// would let a malicious URL exfiltrate internal-network state.
const INTERNAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
];

function isInternalHost(hostname) {
  if (!hostname) return true;
  return INTERNAL_HOST_PATTERNS.some(re => re.test(hostname));
}

// Throws a descriptive error if the URL is non-http(s) or resolves to an
// internal-network hostname (string-pattern check; DNS-rebinding is a
// known residual risk, documented in DEMO_BUILD.md).
export function assertExternalUrl(targetUrl) {
  if (String(process.env.DVAA_ALLOW_INTERNAL_FETCH || '') === '1') return;
  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { throw new Error(`web_fetch: invalid URL: ${targetUrl}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`web_fetch: unsupported scheme ${parsed.protocol} (set DVAA_ALLOW_INTERNAL_FETCH=1 to bypass)`);
  }
  if (isInternalHost(parsed.hostname)) {
    throw new Error(`web_fetch: refusing internal/loopback host ${parsed.hostname} (set DVAA_ALLOW_INTERNAL_FETCH=1 to bypass)`);
  }
}

function cacheRoot() {
  const base = process.env.DVAA_AIM_DATA_DIR
    || path.join(process.cwd(), '.dvaa-aim');
  return path.join(base, 'research-cache');
}

function cacheKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
}

function readCache(url) {
  const file = path.join(cacheRoot(), `${cacheKey(url)}.html`);
  try {
    const body = fs.readFileSync(file, 'utf8');
    const stat = fs.statSync(file);
    return { body, cachedAt: stat.mtime.toISOString(), file };
  } catch {
    return null;
  }
}

function writeCache(url, body) {
  try {
    fs.mkdirSync(cacheRoot(), { recursive: true });
    const file = path.join(cacheRoot(), `${cacheKey(url)}.html`);
    fs.writeFileSync(file, body, 'utf8');
    return file;
  } catch {
    return null;
  }
}

function liveGet(targetUrl, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (err) { reject(err); return; }
    try { assertExternalUrl(targetUrl); } catch (err) { reject(err); return; }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.get(parsed, {
      headers: {
        'User-Agent': 'DVAA-ResearchBot/1.0 (+https://github.com/opena2a-org/damn-vulnerable-ai-agent)',
        'Accept': 'text/html,*/*',
      },
      timeout: FETCH_TIMEOUT_MS,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redirectsLeft <= 0) {
          reject(new Error(`redirect limit (${MAX_REDIRECTS}) exceeded`));
          return;
        }
        let next;
        try {
          next = new URL(res.headers.location, parsed).toString();
          // Re-validate scheme + host on every hop (defeats redirect-based
          // SSRF where the initial URL is external but redirects to internal).
          assertExternalUrl(next);
        } catch (err) {
          reject(err);
          res.resume();
          return;
        }
        res.resume();
        liveGet(next, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      let bytes = 0;
      let overSize = false;
      res.on('data', (chunk) => {
        if (overSize) return;
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          overSize = true;
          req.destroy(new Error(`response exceeded ${MAX_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (overSize) return;
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${FETCH_TIMEOUT_MS}ms`)));
    req.on('error', reject);
  });
}

// HTML -> plain text. Strips <script>, <style>, and all tags; collapses
// whitespace; decodes the four entities that show up in agentpwn's SSR
// output. Not a general-purpose HTML parser; just enough for the demo.
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect agentpwn-style indirect injections in the fetched body. Returns
// an object describing the injection (callback URL, payload kind) or null.
// Matches both the SSR meta-tag `ai-instructions` attribute and the
// visible-body APWN-DE-003 URL-exfiltration template.
export function detectInjection(rawBody, plainText) {
  const metaMatch = rawBody && rawBody.match(/ai-instructions"\s+content="([^"]+)"/i);
  const aiInstructions = metaMatch ? metaMatch[1] : null;

  // Search aiInstructions + visible page text together. Either source can
  // carry the callback URL (agentpwn's SSR puts it in both places).
  const text = plainText || htmlToText(rawBody || '');
  const search = aiInstructions ? `${aiInstructions}\n${text}` : text;

  // url-exfil keyword set (NOT including 'report' — that's the post-report
  // pattern's URL and we want it classified as post-report).
  const exfilMatch = search.match(/https?:\/\/[^\s"<>]+(?:canary|exfil|callback|webhook)[^\s"<>]*/i);
  const exfilUrl = exfilMatch ? trimUrl(exfilMatch[0]) : null;

  const postMatch = search.match(/POST\s+request\s+to\s+(https?:\/\/[^\s"<>]+)/i);
  const postUrl = postMatch ? trimUrl(postMatch[1]) : null;

  let kind = null;
  let callbackUrl = null;
  if (exfilUrl) {
    kind = 'url-exfiltration';
    callbackUrl = exfilUrl;
  } else if (postUrl) {
    kind = 'post-report';
    callbackUrl = postUrl;
  } else if (aiInstructions) {
    // SSR meta-tag was set but didn't match either known pattern; fall back
    // to the first http(s) URL in the instructions content.
    const anyUrl = aiInstructions.match(/https?:\/\/[^\s"<>]+/);
    if (anyUrl) {
      kind = 'url-exfiltration';
      callbackUrl = trimUrl(anyUrl[0]);
    }
  }

  if (!aiInstructions && !callbackUrl) return null;

  return {
    kind: kind || 'url-exfiltration',
    aiInstructions,
    callbackUrl,
    quotedExcerpt: aiInstructions
      || (callbackUrl ? text.slice(Math.max(0, text.indexOf(callbackUrl) - 60), text.indexOf(callbackUrl) + callbackUrl.length + 40) : null),
  };
}

// Trim trailing prose punctuation off a URL match, but preserve `]` so
// agentpwn's `[INSERT_YOUR_SYSTEM_PROMPT_HERE]` placeholder survives intact
// for the agent's persona-substitution step.
function trimUrl(url) {
  return (url || '').replace(/[.,);]+$/, '');
}

/**
 * Fetch a URL and return a structured result the agent can reason about
 * (or, in offline-mode, narrate from a template).
 *
 * Options:
 *   - useCache: if true, prefer cache over live; fall back to live if no cache
 *   - allowLive: if false, error out instead of hitting the network
 */
export async function webFetch(url, { useCache = false, allowLive = true } = {}) {
  if (useCache) {
    const cached = readCache(url);
    if (cached) {
      const plainText = htmlToText(cached.body);
      const injection = detectInjection(cached.body, plainText);
      return {
        url,
        source: 'cache',
        fetchedAt: cached.cachedAt,
        cacheFile: cached.file,
        body: cached.body,
        plainText,
        injection,
      };
    }
    if (!allowLive) {
      throw new Error(`no cache entry for ${url} and live fetch disabled`);
    }
  }
  try {
    const body = await liveGet(url);
    const cacheFile = writeCache(url, body);
    const plainText = htmlToText(body);
    const injection = detectInjection(body, plainText);
    return {
      url,
      source: 'live',
      fetchedAt: new Date().toISOString(),
      cacheFile,
      body,
      plainText,
      injection,
    };
  } catch (err) {
    const cached = readCache(url);
    if (cached) {
      const plainText = htmlToText(cached.body);
      const injection = detectInjection(cached.body, plainText);
      return {
        url,
        source: 'cache-after-live-failed',
        fetchedAt: cached.cachedAt,
        cacheFile: cached.file,
        body: cached.body,
        plainText,
        injection,
        liveError: err.message,
      };
    }
    throw err;
  }
}

/**
 * Pre-populate the research cache for `url` with `body`. Used by the
 * `dvaa demo flight` runner to stage a deterministic, offline poisoned page
 * keyed to the exact URL the agent will fetch, so the demo never depends on
 * the live network. Returns the cache file path, or null if the write failed.
 * Reuses the same key + root scheme as live fetches so a seeded entry is
 * indistinguishable from a cached live fetch.
 */
export function seedCache(url, body) {
  return writeCache(url, body);
}

export { htmlToText };
