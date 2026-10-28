#!/usr/bin/env node

/**
 * reddit-readonly.mjs
 *
 * Read-only Reddit CLI.
 *
 * Backend (2026): Reddit deprecated anonymous .json endpoints (datacenter IPs
 * get HTTP 403). Reads are ROUTED BY CAPABILITY across four live backends —
 * the strengths don't overlap, so there is no single "best" order:
 *
 *   rss     — Reddit's own Atom feeds. Real hot/new/top ranking plus
 *             all-Reddit search, zero config. Needs a feed-reader User-Agent
 *             (see RSS_UA). No score/comment counts; 25 items; rate limited.
 *   arctic  — Arctic Shift archive. 2019 → today, unlimited paging, has
 *             scores. No real ranking (approximated) and no all-Reddit search.
 *   tikhub  — TikHub (needs TIKHUB_API_KEY, paid per request). The only
 *             backend with full ranking AND scores AND nested reply trees.
 *             Third-party reverse-engineered service: opt-in only, and
 *             official sources win whenever they can do the same job.
 *   reddit  — official OAuth API (needs REDDIT_CLIENT_ID/SECRET). Full
 *             fidelity, no RSS rate limit. Preferred when configured.
 *   serpapi — Google `site:reddit.com` (needs SERPAPI_API_KEY). Last-resort
 *             all-Reddit search only; rss/tikhub already cover this.
 *   sorftime — Sorftime MCP (needs SORFTIME_KEY). Stable all-Reddit semantic
 *             search with per-post tags (type / sentiment / product / summary),
 *             full post text, and comments with likes + parent ids. Lags
 *             Reddit by weeks, has no subreddit listings or ranking.
 *
 * data.source reports which backend served, data.backend_trail the route
 * taken, data.freshness how new the data actually is. REDDIT_RO_BACKEND
 * forces one: auto (default) | reddit | rss | arctic | tikhub | serpapi | sorftime.
 * Every result carries a permalink to the real Reddit thread.
 *
 * Commands output JSON to stdout:
 * - Success: { ok: true, data: ... }
 * - Failure: { ok: false, error: { message, details? } }
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Credentials come from exactly two places: the process environment, and a .env
// sitting next to this skill. Nothing else — no reaching into other skills'
// files, no personal key-manager integration. Anyone can clone this and run it;
// wire your own secret store by exporting the vars before calling.
function loadDotEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.REDDIT_RO_ENV_FILE,
    path.join(here, '.env'),
    path.join(here, '..', '.env'),
  ].filter(Boolean);
  for (const file of candidates) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] !== undefined) continue; // real env always wins
      let value = m[2].trim().replace(/\s+#.*$/, '');
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}
loadDotEnv();

const BASE_URL = 'https://www.reddit.com';
const ARCTIC_BASE = 'https://arctic-shift.photon-reddit.com/api';
const TIKHUB_BASE = 'https://api.tikhub.io/api/v1/reddit/app';
const BACKEND = String(process.env.REDDIT_RO_BACKEND || 'auto').toLowerCase();

// Reddit serves .rss to feed readers but 403s browser-like agents. This UA is
// the switch that makes the whole RSS backend work — don't "modernise" it.
const RSS_UA = process.env.REDDIT_RO_RSS_USER_AGENT || 'feedparser/6.0';

const DEFAULTS = {
  minDelayMs: parseInt(process.env.REDDIT_RO_MIN_DELAY_MS || '500', 10),
  maxDelayMs: parseInt(process.env.REDDIT_RO_MAX_DELAY_MS || '1500', 10),
  timeoutMs: parseInt(process.env.REDDIT_RO_TIMEOUT_MS || '25000', 10),
  userAgent: process.env.REDDIT_RO_USER_AGENT || 'script:clawdbot-reddit-readonly:v2.0.0',
  maxChars: 1000,
  // A backend that answers with data older than this fails the freshness gate
  // on time-sensitive queries, and the router moves on to the next one.
  maxStaleDays: parseFloat(process.env.REDDIT_RO_MAX_STALE_DAYS || '7'),
  // Each TikHub page is a billed request; cap accidental fan-out.
  tikhubMaxPages: parseInt(process.env.REDDIT_RO_TIKHUB_MAX_PAGES || '3', 10),
  // Sorftime returns 20 rows a page and every page draws on the account quota.
  sorftimeMaxPages: parseInt(process.env.REDDIT_RO_SORFTIME_MAX_PAGES || '3', 10),
};

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function toIsoFromUtcSeconds(sec) {
  return new Date(sec * 1000).toISOString();
}

function clampInt(n, lo, hi, fallback) {
  const x = Number.isFinite(n) ? n : fallback;
  return Math.max(lo, Math.min(hi, x));
}

function parseCommaList(s) {
  if (!s) return [];
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// People paste whatever they have — a full URL, "/r/foo", or just "foo".
// Accept all three rather than 404-ing on the two that aren't bare names.
function normaliseSubredditName(input) {
  const s = String(input || '').trim();
  return s
    .replace(/^https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\//i, '')
    .replace(/^\/?r\//i, '')
    .replace(/\/+$/g, '');
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function ok(data) {
  process.stdout.write(JSON.stringify({ ok: true, data }, null, 2) + '\n');
}

function fail(message, details) {
  const error = { message };
  if (details) error.details = details;
  process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + '\n');
  process.exitCode = 1;
}

async function fetchJson(url, { timeoutMs, headers = {} } = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('This script requires Node.js 18+ (global fetch not found).');
  }

  // polite pacing (jittered)
  await sleep(randInt(DEFAULTS.minDelayMs, DEFAULTS.maxDelayMs));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || DEFAULTS.timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': headers['User-Agent'] || DEFAULTS.userAgent,
          'Accept': 'application/json',
          ...headers,
        },
        signal: controller.signal,
      });
    } catch (e) {
      // Node's fetch reports every transport failure as the opaque "fetch failed";
      // the real reason (ECONNRESET etc.) only lives on e.cause.code. Surface it so
      // isRetryable() can tell a transient blip from a permanent error.
      const code = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
      throw new Error(`${String(e && e.message ? e.message : e)}${code}`);
    }

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    if (text.trim().startsWith('<')) {
      throw new Error('Upstream returned HTML instead of JSON. Try again later or reduce request rate.');
    }

    // An empty body is a transport hiccup, not "zero results" — treat it as retryable.
    if (!text.trim()) {
      throw new Error('Upstream returned an empty body.');
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

// Transport blips are the norm on this kind of link (proxied / TUN-routed): a good
// backend fails ~1 request in 8. Without these patterns a healthy backend gets
// mistaken for a dead one, which is exactly how serpapi was written off as broken.
function isRetryableError(msg) {
  return msg.includes('HTTP 429')
    || msg.includes('HTTP 5')
    || msg.includes('HTTP 408')
    // Arctic Shift signals overload as 422 with "Timeout. Maybe slow down a bit"
    // — a back-off request wearing a client-error status code.
    || (msg.includes('HTTP 422') && /timeout|slow down/i.test(msg))
    || /\bslow down\b/i.test(msg)
    || msg.includes('aborted')
    || msg.includes('HTML instead of JSON')
    || msg.includes('empty body')
    || msg.includes('fetch failed')
    || /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|UND_ERR|socket hang up|terminated/i.test(msg);
}

async function fetchJsonWithRetry(url, { retries = 3, headers = {}, baseBackoffMs = 600 } = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      return await fetchJson(url, { headers });
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message ? e.message : e);
      if (!isRetryableError(msg) || attempt === retries) break;
      const backoff = baseBackoffMs * Math.pow(2, attempt) + randInt(0, 400);
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr || new Error('Request failed');
}

// Text sibling of fetchJson — the RSS backend needs the raw Atom body.
async function fetchTextWithRetry(url, { retries = 3, headers = {}, baseBackoffMs = 600 } = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      await sleep(randInt(DEFAULTS.minDelayMs, DEFAULTS.maxDelayMs));
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), DEFAULTS.timeoutMs);
      try {
        let res;
        try {
          res = await fetch(url, { headers, signal: controller.signal });
        } catch (e) {
          const code = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
          throw new Error(`${String(e && e.message ? e.message : e)}${code}`);
        }
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        if (!text.trim()) throw new Error('Upstream returned an empty body.');
        return text;
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message ? e.message : e);
      if (!isRetryableError(msg) || attempt === retries) break;
      const backoff = baseBackoffMs * Math.pow(2, attempt) + randInt(0, 400);
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr || new Error('Request failed');
}

// -------------------- Time-window helper --------------------

// Map a Reddit-style time window to an epoch-seconds "after" bound.
function timeToAfterEpoch(time) {
  const map = { day: 86400, week: 604800, month: 2592000, year: 31536000 };
  const secs = map[String(time)];
  if (!secs) return null; // 'all' or unknown => no lower bound
  return Math.floor(nowMs() / 1000) - secs;
}

// ---- Multi-backend read layer, routed by capability ----
//
// Canonical params: { subreddit, q, size, sort, sort_type, after, link_id, ids }
// plus underscore-prefixed hints (_mode, _time) that only some backends use.
//
// Backends are tried in an order chosen per query type (see buildChain): the
// four live backends have genuinely different strengths, so a fixed chain
// would always be wrong for some queries. A backend falls through to the next
// when it errors OR when its answer fails the freshness gate.
//
// `lastServedBy` records who answered; `backendTrail` records the whole route.

let lastServedBy = null;
let backendTrail = [];
let tikhubRequests = 0;
let sorftimeRequests = 0;
// Accumulated, not overwritten: a fan-out issues one call per subreddit, and a
// single warning slot would either hide the others or stick around after a
// later call succeeded. Each entry names the query it came from.
let staleWarnings = [];
// Whether the query that produced the current rows was asking for "the latest".
// Reporting freshness without this makes a relevance search look broken.
let lastQueryTimeSensitive = true;

const REDDIT_CREDS = {
  clientId: process.env.REDDIT_CLIENT_ID || '',
  clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  username: process.env.REDDIT_USERNAME || '',
  password: process.env.REDDIT_PASSWORD || '',
};
const HAS_REDDIT_CREDS = Boolean(REDDIT_CREDS.clientId && REDDIT_CREDS.clientSecret);
const SERPAPI_KEY = process.env.REDDIT_RO_SERPAPI_KEY || process.env.SERPAPI_API_KEY || '';
const TIKHUB_KEY = process.env.TIKHUB_API_KEY || '';
const HAS_TIKHUB = Boolean(TIKHUB_KEY);
const SORFTIME_KEY = process.env.SORFTIME_KEY || '';
const HAS_SORFTIME = Boolean(SORFTIME_KEY);

function qsFrom(obj) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue; // internal hints, never sent upstream
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  return qs.toString();
}

// ---- Official Reddit API via app-only / password OAuth ----

let redditToken = null;

async function redditGetToken() {
  if (redditToken) return redditToken;
  const body = REDDIT_CREDS.username && REDDIT_CREDS.password
    ? `grant_type=password&username=${encodeURIComponent(REDDIT_CREDS.username)}&password=${encodeURIComponent(REDDIT_CREDS.password)}`
    : 'grant_type=client_credentials';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULTS.timeoutMs);
  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${REDDIT_CREDS.clientId}:${REDDIT_CREDS.clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': DEFAULTS.userAgent,
      },
      body,
      signal: controller.signal,
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) {
      throw new Error(`reddit oauth token failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 160)}`);
    }
    redditToken = json.access_token;
    return redditToken;
  } finally {
    clearTimeout(t);
  }
}

async function redditApi(pathWithQuery) {
  const token = await redditGetToken();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULTS.timeoutMs);
  try {
    const res = await fetch(`https://oauth.reddit.com${pathWithQuery}`, {
      headers: { 'Authorization': `bearer ${token}`, 'User-Agent': DEFAULTS.userAgent },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`reddit api HTTP ${res.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

function listingChildren(listing, kindTag) {
  return (listing && listing.data && Array.isArray(listing.data.children) ? listing.data.children : [])
    .filter((c) => c && c.kind === kindTag)
    .map((c) => c.data);
}

// Flatten the official API's nested comment tree into a flat array.
function flattenRedditComments(children, depth = 0, out = []) {
  for (const node of children || []) {
    if (!node || node.kind !== 't1' || !node.data) continue;
    const d = node.data;
    out.push({ ...d, depth });
    const replies = d.replies && d.replies.data && d.replies.data.children;
    if (replies) flattenRedditComments(replies, depth + 1, out);
  }
  return out;
}

async function viaReddit(kind, p) {
  if (!HAS_REDDIT_CREDS) throw new Error('reddit: REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET not set');
  const size = parseInt(p.size, 10) || 25;
  if (kind === 'submission') {
    if (p.ids) {
      const json = await redditApi(`/api/info?id=t3_${String(p.ids).replace(/^t3_/, '')}`);
      return listingChildren(json, 't3');
    }
    if (p.q) {
      const qp = qsFrom({ q: p.q, limit: size, sort: p._mode === 'top' ? 'top' : 'relevance', t: p._time || 'all', ...(p.subreddit ? { restrict_sr: 'on' } : {}) });
      const path = p.subreddit ? `/r/${p.subreddit}/search?${qp}` : `/search?${qp}`;
      return listingChildren(await redditApi(path), 't3');
    }
    const mode = ['hot', 'new', 'top', 'controversial', 'rising'].includes(p._mode) ? p._mode : 'new';
    const qp = qsFrom({ limit: size, ...(mode === 'top' || mode === 'controversial' ? { t: p._time || 'all' } : {}) });
    return listingChildren(await redditApi(`/r/${p.subreddit}/${mode}?${qp}`), 't3');
  }
  // comments
  if (p.link_id) {
    const json = await redditApi(`/comments/${String(p.link_id).replace(/^t3_/, '')}?limit=${size}`);
    const commentListing = Array.isArray(json) ? json[1] : null;
    return flattenRedditComments(commentListing && commentListing.data && commentListing.data.children);
  }
  return listingChildren(await redditApi(`/r/${p.subreddit}/comments?limit=${size}`), 't1');
}

// ---- SerpApi (Google site:reddit.com) — fills the global-search gap ----

async function viaSerpapi(kind, p) {
  if (kind !== 'submission' || !p.q || p.subreddit) {
    throw new Error('serpapi: only handles all-Reddit keyword search');
  }
  if (!SERPAPI_KEY) throw new Error('serpapi: SERPAPI_API_KEY not set');
  const num = Math.min(20, parseInt(p.size, 10) || 10);
  const url = `https://serpapi.com/search.json?${qsFrom({ engine: 'google', q: `site:reddit.com ${p.q}`, num, api_key: SERPAPI_KEY })}`;
  const json = await fetchJsonWithRetry(url, { retries: 1 });
  if (json.error) throw new Error(`serpapi: ${String(json.error).slice(0, 120)}`);
  const rows = [];
  for (const r of json.organic_results || []) {
    const m = String(r.link || '').match(/reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
    if (!m) continue;
    rows.push({
      id: m[2],
      subreddit: m[1],
      title: String(r.title || '').replace(/\s*:\s*r\/\w+.*$/, ''),
      author: null,
      score: null,
      num_comments: null,
      created_utc: 0,
      permalink: r.link,
      url: r.link,
      is_self: null,
      over_18: null,
      selftext: r.snippet || '',
    });
  }
  return rows;
}

// ---- Reddit RSS — official Atom feeds, zero config ----
//
// Reddit still serves .rss to feed readers even though anonymous .json is dead;
// the only thing standing between 403 and 200 is the User-Agent (see RSS_UA).
// Gives real hot/new/top ranking AND all-Reddit search with no key at all.
// Costs: 25 items max, no score/comment counts (Atom carries neither), and a
// tight rate limit — roughly 1 in 3 requests gets a 429 under steady polling.

const rssCache = new Map(); // url -> { at, text }
const RSS_CACHE_TTL_MS = 60_000;

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x?([0-9a-f]+);/gi, (_, c) => {
      const code = /^x/i.test(_) || /[a-f]/i.test(c) ? parseInt(c, 16) : parseInt(c, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, '&');
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeXmlEntities(m[1].trim()) : '';
}

async function fetchRss(url) {
  const hit = rssCache.get(url);
  if (hit && nowMs() - hit.at < RSS_CACHE_TTL_MS) return hit.text;
  // Long first backoff: Reddit's feed limiter needs seconds, not milliseconds.
  const text = await fetchTextWithRetry(url, {
    retries: 3,
    baseBackoffMs: 8000,
    headers: { 'User-Agent': RSS_UA, 'Accept': 'application/atom+xml, application/xml, text/xml' },
  });
  if (/blocked by network security/i.test(text)) {
    throw new Error('rss: reddit returned its block page');
  }
  rssCache.set(url, { at: nowMs(), text });
  return text;
}

function parseAtomEntries(xml, limit) {
  const out = [];
  const re = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const linkMatch = b.match(/<link[^>]*href="([^"]+)"/i);
    const link = linkMatch ? decodeXmlEntities(linkMatch[1]) : '';
    const rawId = tagText(b, 'id');
    const updated = tagText(b, 'updated') || tagText(b, 'published');
    const authorBlock = b.match(/<author>([\s\S]*?)<\/author>/i);
    const author = authorBlock ? tagText(authorBlock[1], 'name').replace(/^\/u\//, '') : null;
    const catMatch = b.match(/<category[^>]*term="([^"]+)"/i);
    const subFromLink = link.match(/\/r\/([^/]+)\//);
    out.push({
      rawId,
      link,
      title: tagText(b, 'title'),
      author,
      subreddit: (catMatch && catMatch[1]) || (subFromLink && subFromLink[1]) || null,
      createdUtc: updated ? Math.floor(new Date(updated).getTime() / 1000) : 0,
      content: tagText(b, 'content'),
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}

// Reddit's search treats a bare multi-word query as OR, so "non slip bath mat"
// happily returns posts that only mention "mat". Quoting makes it a
// phrase match, which is what someone typing three words in a row actually meant.
// Applies to rss and tikhub (both hit Reddit's own search); arctic and serpapi
// already AND their terms, and quoting there would only narrow good results.
// Pass --loose (or quote/use operators yourself) to opt out.
function phraseQuery(q, loose) {
  const s = String(q || '').trim();
  if (!s || loose) return s;
  if (/["']/.test(s)) return s;                       // caller already quoted
  if (/\b(AND|OR|NOT)\b|[:()]/.test(s)) return s;     // caller used search syntax
  if (/\s/.test(s)) return `"${s}"`;
  return s;
}

async function viaRss(kind, p) {
  const size = clampInt(parseInt(p.size, 10) || 25, 1, 25, 25);

  // A post's own comment feed carries the post in its <feed> header
  // ("<title>Some title : SubName</title>"). Not rich — no score, no author —
  // but it keeps "fetch post by id" working with no key and no archive.
  if (p.ids) {
    const id = String(p.ids).replace(/^t3_/, '');
    const xml = await fetchRss(`${BASE_URL}/comments/${id}/.rss?limit=1`);
    const head = xml.split('<entry>')[0];
    const rawTitle = tagText(head, 'title');
    if (!rawTitle) throw new Error('rss: post feed had no title');
    // Split on the LAST " : " — post titles can contain colons themselves.
    const cut = rawTitle.lastIndexOf(' : ');
    const title = cut > 0 ? rawTitle.slice(0, cut) : rawTitle;
    const subFromTitle = cut > 0 ? rawTitle.slice(cut + 3) : '';
    const linkMatch = head.match(/<link[^>]*href="([^"]+)"/i);
    const permalink = linkMatch ? decodeXmlEntities(linkMatch[1]) : `${BASE_URL}/comments/${id}/`;
    const updated = tagText(head, 'updated');
    const subMatch = permalink.match(/\/r\/([^/]+)\//);
    return [{
      id,
      name: `t3_${id}`,
      subreddit: (subMatch && subMatch[1]) || (subFromTitle && subFromTitle !== 'reddit.com' ? subFromTitle : null),
      title,
      author: null,
      score: null,
      num_comments: null,
      // Feed-level <updated> is last activity, not creation — close enough to
      // order by, and the caller sees score/author are null anyway.
      created_utc: updated ? Math.floor(new Date(updated).getTime() / 1000) : 0,
      permalink,
      url: permalink,
      is_self: null,
      over_18: null,
      selftext: '',
    }];
  }
  const sortParam = ['relevance', 'hot', 'top', 'new', 'comments'].includes(p._mode) ? p._mode : 'new';

  if (kind === 'comment') {
    // A post's comment feed, or a subreddit's recent-comment firehose.
    const url = p.link_id
      ? `${BASE_URL}/comments/${String(p.link_id).replace(/^t3_/, '')}/.rss?limit=${size}`
      : `${BASE_URL}/r/${p.subreddit}/comments/.rss?limit=${size}`;
    const entries = parseAtomEntries(await fetchRss(url), size);
    return entries.map((e) => ({
      id: String(e.rawId || '').replace(/^t1_/, ''),
      name: e.rawId || null,
      subreddit: e.subreddit,
      author: e.author,
      score: null,               // Atom carries no score
      created_utc: e.createdUtc,
      parent_id: null,
      link_id: p.link_id ? `t3_${String(p.link_id).replace(/^t3_/, '')}` : null,
      permalink: e.link,
      body: e.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }));
  }

  let url;
  if (p.q && p.subreddit) {
    const q = phraseQuery(p.q, p._loose);
    url = `${BASE_URL}/r/${p.subreddit}/search.rss?${qsFrom({ q, restrict_sr: 1, sort: sortParam, t: p._time || 'all', limit: size })}`;
  } else if (p.q) {
    const q = phraseQuery(p.q, p._loose);
    url = `${BASE_URL}/search.rss?${qsFrom({ q, sort: sortParam, t: p._time || 'all', limit: size })}`;
  } else {
    const mode = ['hot', 'new', 'top', 'rising', 'controversial'].includes(p._mode) ? p._mode : 'new';
    const t = (mode === 'top' || mode === 'controversial') && p._time ? `?t=${p._time}&limit=${size}` : `?limit=${size}`;
    url = `${BASE_URL}/r/${p.subreddit}/${mode}/.rss${t}`;
  }

  const entries = parseAtomEntries(await fetchRss(url), size);
  return entries.map((e) => {
    const id = String(e.rawId || '').replace(/^t3_/, '');
    return {
      id,
      name: e.rawId || null,
      subreddit: e.subreddit,
      title: e.title,
      author: e.author,
      score: null,               // Atom carries no score
      num_comments: null,        // ...nor a comment count
      created_utc: e.createdUtc,
      permalink: e.link,
      url: e.link,
      is_self: null,
      over_18: null,
      selftext: e.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800),
    };
  });
}

// ---- TikHub — paid third-party, opt-in only ----
//
// The only backend that has ranking AND scores AND nested reply trees at once.
// It is a reverse-engineered third-party service billed per request, so it is
// never enabled by default: no TIKHUB_API_KEY, no TikHub in the route. Official
// sources are preferred wherever they can do the same job.
//
// Responses are raw Reddit GraphQL (need_format=true does NOT actually flatten
// them), and shapes differ per endpoint, so rather than hard-coding the deep
// paths we walk the tree and pick out anything that looks like a post/comment.
// That survives upstream shape changes; hard-coded paths would not.

const TIKHUB_SORTS = { best: 'BEST', hot: 'HOT', new: 'NEW', top: 'TOP', controversial: 'CONTROVERSIAL', rising: 'HOT' };

async function tikhubGet(pathname, params) {
  if (!HAS_TIKHUB) throw new Error('tikhub: TIKHUB_API_KEY not set');
  const url = `${TIKHUB_BASE}/${pathname}?${qsFrom(params)}`;
  tikhubRequests++;
  const json = await fetchJsonWithRetry(url, {
    retries: 2,
    headers: { 'Authorization': `Bearer ${TIKHUB_KEY}` },
  });
  if (json && json.code && json.code !== 200) {
    throw new Error(`tikhub: code ${json.code} ${String(json.message || '').slice(0, 120)}`);
  }
  return json;
}

// Walk the GraphQL blob and collect every object that carries the marker field.
function collectNodes(obj, marker, out = [], seen = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  if (seen.has(obj)) return out;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const v of obj) collectNodes(v, marker, out, seen);
    return out;
  }
  if (Object.prototype.hasOwnProperty.call(obj, marker)) out.push(obj);
  for (const v of Object.values(obj)) collectNodes(v, marker, out, seen);
  return out;
}

function tikhubEpoch(v) {
  if (!v) return 0;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return 0;
  return Math.floor((ms > 1e12 ? ms : ms * (ms < 1e11 ? 1000 : 1)) / 1000);
}

// The subreddit feed does NOT return post objects. It returns the client's UI
// tree: one CellGroup per post, with the fields scattered across typed cells
// (TitleCell/MetadataCell/ActionCell/...), the id base64-encoded, and no
// permalink at all. Search, by contrast, returns flat post objects. Both shapes
// have to be understood; this handles the cell-group one.
function tikhubCellGroupToPost(group, subreddit) {
  const cells = Array.isArray(group && group.cells) ? group.cells : [];
  if (!cells.length) return null;
  const byType = {};
  for (const c of cells) {
    if (c && c.__typename && !byType[c.__typename]) byType[c.__typename] = c;
  }
  const title = byType.TitleCell && byType.TitleCell.title;
  if (!title) return null;

  const meta = byType.MetadataCell || {};
  const action = byType.ActionCell || {};
  const preview = byType.PreviewTextCell || {};

  let id = String(group.id || '');
  try {
    const decoded = Buffer.from(id, 'base64').toString('utf8');
    if (/^t3_[a-z0-9]+$/i.test(decoded)) id = decoded;
  } catch { /* keep the raw id */ }
  id = id.replace(/^t3_/, '');

  const sub = subreddit || null;
  const permalink = sub && id ? `${BASE_URL}/r/${sub}/comments/${id}/` : null;

  return {
    id,
    name: id ? `t3_${id}` : null,
    subreddit: sub,
    title,
    author: String(meta.authorName || '').replace(/^u\//, '') || null,
    score: typeof action.score === 'number' ? action.score : null,
    num_comments: typeof action.commentCount === 'number' ? action.commentCount : null,
    created_utc: tikhubEpoch(meta.createdAt),
    permalink,
    url: permalink,
    is_self: null,
    over_18: null,
    selftext: String(preview.text || '').slice(0, 800),
  };
}

function tikhubToPost(n) {
  const permalink = n.permalink || n.url || (n.id ? `/comments/${String(n.id).replace(/^t3_/, '')}/` : null);
  const sub = n.subreddit && typeof n.subreddit === 'object' ? (n.subreddit.name || n.subreddit.prefixedName) : n.subreddit;
  return {
    id: String(n.id || '').replace(/^t3_/, ''),
    name: n.id && String(n.id).startsWith('t3_') ? n.id : (n.id ? `t3_${n.id}` : null),
    subreddit: sub ? String(sub).replace(/^r\//, '') : null,
    title: n.postTitle || n.title || '',
    author: (n.authorInfo && n.authorInfo.name) || n.author || null,
    score: typeof n.score === 'number' ? n.score : null,
    num_comments: typeof n.commentCount === 'number' ? n.commentCount : null,
    created_utc: tikhubEpoch(n.createdAt || n.created_at),
    permalink,
    url: n.url || permalink,
    is_self: n.domain ? /^self\./.test(String(n.domain)) : null,
    over_18: typeof n.isNsfw === 'boolean' ? n.isNsfw : null,
    selftext: typeof n.content === 'string'
      ? n.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
      : (n.content && n.content.markdown ? String(n.content.markdown).slice(0, 800) : ''),
  };
}

// The reply tree lives in wrapper objects ({depth, parentId, childCount, node}),
// not on the comment itself — this is the one thing no other backend provides,
// so pull the structure from the wrapper rather than flattening it away.
function tikhubExtractCommentTrees(json) {
  const out = [];
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (typeof o.depth === 'number' && o.node && o.node.id && /^t1_/.test(String(o.node.id))) {
      out.push(o);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(json);
  return out;
}

function tikhubToComment(n, depth = 0, parentId = null, linkId = null) {
  const body = typeof n.content === 'string'
    ? n.content
    : (n.content && (n.content.markdown || n.content.html)) || n.body || '';
  return {
    id: String(n.id || '').replace(/^t1_/, ''),
    name: n.id || null,
    subreddit: null,
    author: (n.authorInfo && (n.authorInfo.name || n.authorInfo.displayName)) || n.author || null,
    score: typeof n.score === 'number' ? n.score : null,
    created_utc: tikhubEpoch(n.createdAt || n.created_at),
    depth,
    parent_id: parentId || n.parentId || null,
    link_id: linkId || n.postId || null,
    permalink: n.permalink || null,
    body: String(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

async function viaTikhub(kind, p) {
  if (!HAS_TIKHUB) throw new Error('tikhub: TIKHUB_API_KEY not set');
  const size = parseInt(p.size, 10) || 25;

  // TikHub wants the fullname form here: a bare id silently returns
  // {postInfoById: null} with HTTP 200 rather than an error.
  const fullname = (v) => `t3_${String(v).replace(/^t3_/, '')}`;

  if (kind === 'comment') {
    if (!p.link_id) throw new Error('tikhub: comment listing needs a post id');
    const json = await tikhubGet('fetch_post_comments', { post_id: fullname(p.link_id) });
    const trees = tikhubExtractCommentTrees(json);
    if (!trees.length) throw new Error('tikhub: no comments in response');
    return trees
      .slice(0, size)
      .map((t) => tikhubToComment(t.node, t.depth || 0, t.parentId, fullname(p.link_id)));
  }

  if (p.ids) {
    const json = await tikhubGet('fetch_post_details', { post_id: fullname(p.ids) });
    const found = [
      ...collectNodes(json, 'postTitle').map(tikhubToPost),
      ...collectNodes(json, 'cells').map((g) => tikhubCellGroupToPost(g, p.subreddit)),
    ].filter(Boolean);
    if (!found.length) throw new Error('tikhub: post not found in response');
    return found.slice(0, 1);
  }

  // Posts: search or subreddit feed, paging until we have `size` rows.
  // Every page is a billed request, so the page count is capped.
  const maxPages = clampInt(parseInt(p._tikhubMaxPages, 10) || DEFAULTS.tikhubMaxPages, 1, 20, DEFAULTS.tikhubMaxPages);
  const rows = [];
  const seenIds = new Set();
  let after = '';

  for (let page = 0; page < maxPages && rows.length < size; page++) {
    const json = p.q
      ? await tikhubGet('fetch_dynamic_search', {
          query: phraseQuery(p.q, p._loose),
          search_type: 'post',
          // Search defaults to relevance. TIKHUB_SORTS has no 'relevance' entry,
          // so falling back to NEW here would silently re-rank a relevance
          // search by date and bury the best matches. Send nothing instead and
          // let the API use its own default.
          sort: TIKHUB_SORTS[p._mode] || '',
          time_range: p._time && p._time !== 'all' ? p._time : '',
          after,
        })
      : await tikhubGet('fetch_subreddit_feed', {
          subreddit_name: p.subreddit,
          sort: TIKHUB_SORTS[p._mode] || 'NEW',
          after,
        });

    // Search gives flat post objects; the subreddit feed gives cell groups.
    const found = [
      ...collectNodes(json, 'postTitle').map(tikhubToPost),
      ...collectNodes(json, 'cells').map((g) => tikhubCellGroupToPost(g, p.subreddit)),
    ];

    let added = 0;
    for (const post of found) {
      if (!post || !post.id || seenIds.has(post.id)) continue;
      seenIds.add(post.id);
      rows.push(post);
      added++;
      if (rows.length >= size) break;
    }

    const cursors = collectNodes(json, 'endCursor');
    const next = cursors.length ? cursors[cursors.length - 1].endCursor : '';
    if (!next || next === after || added === 0) break;
    after = next;
  }

  if (rows.length === 0) throw new Error('tikhub: no posts parsed from response');
  return rows;
}

// ---- Sorftime — commercial MCP, opt-in (SORFTIME_KEY) ----
//
// Sorftime runs its own Reddit index behind an MCP server. What it adds that no
// other backend has: a stable all-Reddit search that is semantic rather than
// phrase-bound, and per-post tags already computed — post type, main-post
// sentiment, reply sentiment ratio, the product mentioned and an English
// summary. Post bodies come back in full and comments carry likes and parent
// ids, so a reply tree can be rebuilt from them.
//
// What it lacks: subreddit listings and Reddit's own ranking, search rows have
// no title (only the summary), dates are day-precision, and the index trails
// Reddit by weeks — the freshness gate moves "latest" queries elsewhere.
//
// The server is stateless JSON-RPC over HTTP: one tools/call per request, no
// session handshake needed. Every call draws on the account quota.

const SORFTIME_MCP = process.env.REDDIT_RO_SORFTIME_URL || 'https://mcp.sorftime.com';
// Codes 1-7 per the tool schema. Search results label the same buckets
// problem / inquiry / complaint / experience_share / ..., so accept those too.
const SORFTIME_POST_TYPES = {
  question: 1, help: 1, problem: 1, advice: 2, purchase: 2, inquiry: 2, complaint: 3,
  experience: 4, experience_share: 4, discussion: 5, innovation: 6, other: 7,
};
const SORFTIME_SENTIMENTS = { positive: 1, neutral: 2, negative: 3 };

// Accept names or the raw numeric codes; reject anything else loudly rather than
// silently dropping a filter the caller thinks is applied.
function sorftimePostTypeParam(v) {
  if (!v) return '';
  return parseCommaList(v).map((t) => {
    const k = String(t).toLowerCase();
    if (/^[1-7]$/.test(k)) return k;
    if (SORFTIME_POST_TYPES[k]) return String(SORFTIME_POST_TYPES[k]);
    throw new Error(`--postType "${t}" unknown; use ${Object.keys(SORFTIME_POST_TYPES).join('|')} or 1-7`);
  }).join(',');
}

function sorftimeSentimentParam(v) {
  if (!v) return 0;
  const k = String(v).toLowerCase();
  if (/^[1-3]$/.test(k)) return Number(k);
  if (SORFTIME_SENTIMENTS[k]) return SORFTIME_SENTIMENTS[k];
  throw new Error(`--sentiment "${v}" unknown; use positive|neutral|negative`);
}

async function sorftimeCall(name, args) {
  if (!HAS_SORFTIME) throw new Error('sorftime: SORFTIME_KEY not set');
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), DEFAULTS.timeoutMs);
    try {
      sorftimeRequests++;
      let res;
      try {
        res = await fetch(`${SORFTIME_MCP}?key=${encodeURIComponent(SORFTIME_KEY)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
          signal: controller.signal,
        });
      } catch (e) {
        const code = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
        throw new Error(`${String(e && e.message ? e.message : e)}${code}`);
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      // Streamable-HTTP servers may answer as SSE; the JSON-RPC reply is the last data line.
      const body = (res.headers.get('content-type') || '').includes('event-stream')
        ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean).pop()
        : text;
      if (!body || !body.trim()) throw new Error('Upstream returned an empty body.');
      const rpc = JSON.parse(body);
      if (rpc.error) throw new Error(`sorftime: ${String(rpc.error.message || rpc.error.code).slice(0, 160)}`);
      const out = (rpc.result && rpc.result.content && rpc.result.content[0] && rpc.result.content[0].text) || '';
      if (rpc.result && rpc.result.isError) throw new Error(`sorftime: ${out.slice(0, 160)}`);
      // "No data available." is a plain-text answer, not an error: zero rows.
      if (!out.trim().startsWith('{') && !out.trim().startsWith('[')) return null;
      return JSON.parse(out);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (attempt >= 2 || !isRetryableError(msg)) throw e;
      await sleep(600 * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }
}

// Sorftime gives "YYYY-MM-DD"; keep it as midnight UTC so freshness maths works.
function sorftimeEpoch(v) {
  const ms = Date.parse(String(v || '').length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

const stripPrefix = (v, prefix) => String(v || '').replace(prefix, '');
const stripSub = (v) => String(v || '').replace(/^\/?r\//i, '') || undefined;
const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

// Search rows (snake_case) and post detail (PascalCase) come back in different
// casings for the same fields; read either.
function sorftimeToPost(r, { full = false } = {}) {
  const id = stripPrefix(pick(r, 'reddit_id', 'RedditId'), /^t3_/);
  if (!id) return null;
  const summary = pick(r, 'summary', 'Summary');
  const content = pick(r, 'content', 'Content');
  return {
    id,
    name: `t3_${id}`,
    subreddit: stripSub(pick(r, 'subreddit', 'Subreddit')),
    title: pick(r, 'title', 'Title') || null,
    author: pick(r, 'author', 'Author'),
    score: pick(r, 'like_count', 'LikeCount') ?? null,
    num_comments: pick(r, 'reply_count', 'ReplyCount') ?? null,
    created_utc: sorftimeEpoch(pick(r, 'published_time', 'PublishedTime')),
    permalink: pick(r, 'url', 'Url') || null,
    url: pick(r, 'content_link', 'ContentLink') || null,
    is_self: (pick(r, 'content_type', 'ContentType') || 'text') === 'text',
    // Search rows only carry an AI summary; never pass that off as the post body.
    selftext: full ? content : undefined,
    voc_tags: summary || pick(r, 'post_type') ? {
      post_type: pick(r, 'post_type') || null,
      sentiment: pick(r, 'main_post_sentiment') || null,
      reply_sentiment_ratio: pick(r, 'reply_sentiment_ratio') || null,
      product: pick(r, 'product') || null,
      summary: summary || null,
      summary_source: 'sorftime (AI-written English summary, not the poster\'s words)',
    } : undefined,
  };
}

function sorftimeToComments(rows, postId) {
  const linkId = `t3_${postId}`;
  const list = rows.map((r) => ({
    id: stripPrefix(r.comment_id, /^t1_/),
    name: r.comment_id,
    author: r.author,
    body: r.content,
    score: r.like_count ?? null,
    created_utc: sorftimeEpoch(r.published_time),
    // Empty parent means a top-level reply; point it at the post like Reddit does.
    parent_id: r.parent_comment_id || linkId,
    link_id: linkId,
  }));
  // Rebuild depth from the parent chain — the one thing that makes this a tree
  // rather than a flat list.
  const byName = new Map(list.map((c) => [c.name, c]));
  for (const c of list) {
    let depth = 0;
    let cur = c;
    while (cur && cur.parent_id && cur.parent_id !== linkId && depth < 50) {
      cur = byName.get(cur.parent_id);
      depth++;
    }
    c.depth = depth;
  }
  return list;
}

async function viaSorftime(kind, p) {
  if (!HAS_SORFTIME) throw new Error('sorftime: SORFTIME_KEY not set');
  const size = parseInt(p.size, 10) || 25;
  const maxPages = clampInt(parseInt(p._sorftimeMaxPages, 10) || DEFAULTS.sorftimeMaxPages, 1, 20, DEFAULTS.sorftimeMaxPages);
  const fullname = (v) => `t3_${String(v).replace(/^t3_/, '')}`;

  if (kind === 'comment') {
    if (!p.link_id) throw new Error('sorftime: comment listing needs a post id (no subreddit firehose)');
    const rows = [];
    for (let page = 1; page <= maxPages && rows.length < size; page++) {
      const json = await sorftimeCall('reddit_comment_request', { reddit_id: fullname(p.link_id), page });
      const data = json && Array.isArray(json.data) ? json.data : [];
      rows.push(...data);
      const total = data.length ? Number(data[0].item_total) || 0 : 0;
      if (data.length < 20 || (total && rows.length >= total)) break;
    }
    if (!rows.length) throw new Error('sorftime: no comments indexed for this post');
    return sorftimeToComments(rows.slice(0, size), String(p.link_id).replace(/^t3_/, ''));
  }

  if (p.ids) {
    const json = await sorftimeCall('reddit_post_request', { reddit_id: fullname(p.ids) });
    const post = json && json.data ? sorftimeToPost(json.data, { full: true }) : null;
    if (!post) throw new Error('sorftime: post not indexed');
    return [post];
  }

  if (!p.q) throw new Error('sorftime: subreddit listings unsupported; needs a search query');

  const rows = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages && rows.length < size; page++) {
    // Send filters only when set: an explicit empty post_type / zero sentiment
    // makes Sorftime answer "No data available." instead of ignoring them.
    const json = await sorftimeCall('reddit_post_search', {
      search_name: String(p.q),
      ...(p._postType ? { post_type: p._postType } : {}),
      ...(p._sentiment ? { main_sentiment: p._sentiment } : {}),
      page,
    });
    const data = json && Array.isArray(json.data) ? json.data : [];
    for (const r of data) {
      const post = sorftimeToPost(r);
      if (!post || seen.has(post.id)) continue;
      // No server-side subreddit filter: narrow client-side when one was asked for.
      if (p.subreddit && String(post.subreddit || '').toLowerCase() !== String(p.subreddit).toLowerCase()) continue;
      seen.add(post.id);
      rows.push(post);
      if (rows.length >= size) break;
    }
    const total = data.length ? Number(data[0].item_total) || 0 : 0;
    if (data.length < 20 || (total && page * 20 >= total)) break;
  }
  return p.after ? rows.filter((r) => !r.created_utc || r.created_utc >= Number(p.after)) : rows;
}

async function viaArctic(kind, p) {
  // Arctic Shift cannot search across all of Reddit — it requires subreddit or author.
  if (p.q && !p.subreddit && !p.author && !p.link_id && !p.ids) {
    throw new Error('arctic: global (all-Reddit) keyword search unsupported; needs a subreddit');
  }
  let url;
  if (kind === 'submission' && p.ids) {
    url = `${ARCTIC_BASE}/posts/ids?${qsFrom({ ids: p.ids })}`;
  } else {
    const path = kind === 'submission' ? 'posts/search' : 'comments/search';
    const wantScoreSort = p.sort_type === 'score' || p.sort_type === 'num_comments';
    const mapped = {
      subreddit: p.subreddit,
      query: p.q,
      link_id: p.link_id,
      after: p.after,
      sort: p.sort || 'desc',
      // Arctic sorts by time only; when score-sort was requested, over-fetch
      // and re-rank client-side below (recency-biased approximation).
      limit: wantScoreSort ? Math.min(100, (parseInt(p.size, 10) || 25) * 4) : p.size,
    };
    url = `${ARCTIC_BASE}/${path}?${qsFrom(mapped)}`;
  }
  const json = await fetchJsonWithRetry(url, { retries: 1 });
  if (json && json.error) throw new Error(`arctic: ${json.error}`);
  let rows = Array.isArray(json && json.data) ? json.data : [];
  if (p.sort_type === 'score' || p.sort_type === 'num_comments') {
    const key = p.sort_type;
    rows = rows.slice().sort((a, b) => ((b && b[key]) || 0) - ((a && a[key]) || 0));
    if (p.size) rows = rows.slice(0, parseInt(p.size, 10) || 25);
  }
  return rows;
}

const BACKENDS = {
  reddit: viaReddit,
  rss: viaRss,
  arctic: viaArctic,
  tikhub: viaTikhub,
  serpapi: viaSerpapi,
  sorftime: viaSorftime,
};

const BACKEND_NAMES = ['auto', ...Object.keys(BACKENDS)];

// Route by capability, not by a fixed pecking order. The live backends have
// non-overlapping strengths (real ranking / deep archive / scores+nesting),
// so the right first choice depends on what is being asked for.
function buildChain(kind, p) {
  const chain = [];
  const push = (...names) => {
    for (const n of names) {
      if (!n || chain.includes(n)) continue;
      if (n === 'tikhub' && !HAS_TIKHUB) continue;
      if (n === 'serpapi' && !SERPAPI_KEY) continue;
      if (n === 'reddit' && !HAS_REDDIT_CREDS) continue;
      if (n === 'sorftime' && !HAS_SORFTIME) continue;
      chain.push(n);
    }
  };

  // Post-type / sentiment filters exist only on Sorftime; any other backend would
  // return unfiltered rows that look filtered.
  if (p._postType || p._sentiment) {
    if (!HAS_SORFTIME) throw new Error('--postType / --sentiment need SORFTIME_KEY (only Sorftime tags posts)');
    return ['sorftime'];
  }

  // The official API, when configured, is best at everything and has no feed
  // rate limit — it leads every route.
  push('reddit');

  if (kind === 'comment') {
    // tikhub has real trees; sorftime's are rebuilt from parent ids
    if (p._wantNested) push('tikhub', 'sorftime', 'arctic', 'rss');
    else push('arctic', 'sorftime', 'rss', 'tikhub');
    return chain;
  }

  if (p.ids) {                                             // fetch a post by id
    push('arctic', 'sorftime', 'rss', 'tikhub');
    return chain;
  }

  const isGlobalSearch = Boolean(p.q) && !p.subreddit;
  if (isGlobalSearch) {                                    // arctic cannot do this at all
    // Sorftime leads when keyed: it does not rate-limit like the feed, and its
    // weeks of lag are caught by the freshness gate on time-windowed searches.
    push('sorftime', 'rss', 'tikhub', 'serpapi');
    return chain;
  }

  // Historical windows and bulk fan-out are archive work; RSS only holds the
  // most recent 25 items and would silently under-serve them.
  const wantsHistory = Boolean(p.after) && (nowMs() / 1000 - Number(p.after)) > 30 * 86400;
  const wantsBulk = (parseInt(p.size, 10) || 25) > 25 || p._bulk;
  if (wantsHistory || wantsBulk) {
    push('arctic', 'tikhub', 'rss');
    return chain;
  }

  // Ranked listings: only rss/tikhub know Reddit's real ordering; arctic can
  // merely approximate it, so it goes last for these.
  const rankedMode = ['hot', 'best', 'controversial', 'rising', 'top'].includes(p._mode);
  if (rankedMode) {
    if (p._wantScore) push('tikhub', 'rss', 'arctic');     // rss has no scores
    else push('rss', 'tikhub', 'arctic');
    return chain;
  }

  // Plain new / in-subreddit search: archive first (no rate limit, more rows).
  // Sorftime can only filter its global search by subreddit, so it comes last.
  push('arctic', 'rss', 'tikhub');
  if (p.q) push('sorftime');
  return chain;
}

// ---- Freshness gate ----
//
// The failure that motivated this whole rewrite was a backend that answered
// HTTP 200 with data frozen 15 months earlier. "Did it throw?" cannot catch
// that, so results are also judged on whether they are plausibly current.
// The gate deliberately only fires on time-sensitive queries: asking for
// all-time top posts should legitimately return old rows.
// Deliberately narrow: only fire when the caller actually asked for "the
// latest". Relevance search, top/hot rankings and id lookups can all legitimately
// return old rows, and flagging those would train people to ignore the warning.
function isTimeSensitive(kind, p) {
  if (p._historical) return false;
  if (p.ids) return false;                                  // a specific post is as old as it is
  if (p.after && (nowMs() / 1000 - Number(p.after)) > 30 * 86400) return false;

  // An explicit recent window means recent data is expected.
  if (p._time && p._time !== 'all') return true;

  // Ranked/relevance results are ordered by interest, not by date.
  if (p._mode && ['top', 'controversial', 'relevance', 'best', 'hot', 'rising', 'comments'].includes(p._mode)) {
    return false;
  }

  // A keyword search with no time window is "find matches", not "show me today".
  if (p.q && (!p._time || p._time === 'all')) return false;

  if (kind === 'comment') return !p.link_id;                // a firehose should be current
  return true;                                              // plain "new" listings
}

function assessFreshness(rows, kind, p) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, reason: 'empty', newestUtc: 0 };
  }
  const newestUtc = rows.reduce((mx, r) => {
    const d = r && r.data ? r.data : r;
    return Math.max(mx, Number(d && d.created_utc) || 0);
  }, 0);
  if (!isTimeSensitive(kind, p)) return { ok: true, reason: 'ok', newestUtc };
  if (!newestUtc) return { ok: true, reason: 'no_timestamps', newestUtc };
  const ageDays = (nowMs() / 1000 - newestUtc) / 86400;
  if (ageDays > DEFAULTS.maxStaleDays) {
    return { ok: false, reason: `stale_${Math.round(ageDays)}d`, newestUtc };
  }
  return { ok: true, reason: 'ok', newestUtc };
}

// kind: 'submission' | 'comment'
async function fetchRows(kind, params) {
  const forced = BACKEND === 'auto' ? null : BACKEND;
  if (forced && !BACKENDS[forced]) {
    throw new Error(`Unknown backend "${forced}". Use ${BACKEND_NAMES.join(' | ')}.`);
  }
  const chain = forced ? [forced] : buildChain(kind, params);
  if (chain.length === 0) throw new Error('No usable backend for this query (check your API keys).');
  lastQueryTimeSensitive = isTimeSensitive(kind, params);

  const errors = [];
  let softFallback = null;   // best "worked but looked stale/empty" answer seen

  for (let i = 0; i < chain.length; i++) {
    const name = chain[i];
    try {
      const rows = await BACKENDS[name](kind, params);
      const verdict = assessFreshness(rows, kind, params);
      if (verdict.ok) {
        lastServedBy = name;
        backendTrail.push(`${name}:ok`);
        return rows;
      }
      backendTrail.push(`${name}:${verdict.reason}`);
      if (!softFallback || (rows.length && !softFallback.rows.length)) {
        softFallback = { name, rows, verdict };
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e).slice(0, 160);
      backendTrail.push(`${name}:error`);
      errors.push(`${name}: ${msg}`);
    }
  }

  // Everything either failed or looked stale. Returning the stale rows beats
  // returning nothing — but the caller surfaces the warning, never silently.
  if (softFallback) {
    lastServedBy = softFallback.name;
    const scope = params.subreddit ? `r/${params.subreddit}` : (params.q ? `search "${String(params.q).slice(0, 40)}"` : kind);
    staleWarnings.push(`${scope}: served by ${softFallback.name} but data looks ${softFallback.verdict.reason}; no fresher backend available`);
    return softFallback.rows;
  }
  throw new Error(`All backends failed — ${errors.join(' | ')}`);
}

// Every command reports who served it, the route taken, and how fresh the data
// actually is. The old output claimed success with no way to tell that the rows
// were 15 months old; freshness is now part of the contract, not an afterthought.
function resultMeta(rows) {
  const newestUtc = (Array.isArray(rows) ? rows : []).reduce(
    (mx, r) => Math.max(mx, Number(r && r.created_utc) || 0), 0,
  );
  const ageHours = newestUtc ? (nowMs() / 1000 - newestUtc) / 3600 : null;
  const meta = {
    source: lastServedBy,
    backend_trail: backendTrail.slice(),
    freshness: {
      newest_iso: newestUtc ? toIsoFromUtcSeconds(newestUtc) : null,
      age_hours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      // "stale" is only meaningful when recency was asked for. A relevance
      // search or an all-time top listing returning old rows is working
      // correctly, and calling that stale would just teach people to ignore it.
      verdict: !newestUtc
        ? (Array.isArray(rows) && rows.length ? 'no_timestamps' : 'empty')
        : (!lastQueryTimeSensitive
          ? 'not_time_sensitive'
          : (ageHours / 24 > DEFAULTS.maxStaleDays ? 'stale' : 'fresh')),
    },
  };
  if (staleWarnings.length) meta.warnings = staleWarnings.slice();
  if (tikhubRequests > 0 || sorftimeRequests > 0) {
    meta.cost = {
      ...(tikhubRequests ? { tikhub_requests: tikhubRequests } : {}),
      ...(sorftimeRequests ? { sorftime_requests: sorftimeRequests } : {}),
    };
  }
  return meta;
}

// The ranking a caller gets depends on who answered: rss/tikhub/reddit expose
// Reddit's own ordering, arctic can only approximate it. Say which happened
// instead of naming one fixed backend the way the old hard-coded strings did.
function rankingNote(sort, servedBy) {
  if (servedBy === 'arctic') {
    return sort === 'top' || sort === 'controversial'
      ? 'approximated by score client-side (arctic sorts by time only)'
      : 'sorted by recency (arctic has no hot/rising ranking)';
  }
  if (servedBy === 'serpapi') return 'Google relevance order (not Reddit ranking)';
  if (servedBy === 'rss') return `Reddit's own "${sort}" ordering (via Atom feed; no scores available)`;
  if (servedBy === 'tikhub') return `Reddit's own "${sort}" ordering (via TikHub; scores included)`;
  if (servedBy === 'reddit') return `Reddit's own "${sort}" ordering (official API)`;
  if (servedBy === 'sorftime') return 'Sorftime semantic relevance (no Reddit ranking; titles absent, see voc_tags.summary)';
  return `sorted by ${sort}`;
}

function buildUrl(pathWithQuery) {
  if (/^https?:\/\//i.test(pathWithQuery)) return pathWithQuery;
  const [path, qs] = String(pathWithQuery).split('?');
  const jsonPath = path.endsWith('.json') ? path : `${path}.json`;
  return qs ? `${BASE_URL}${jsonPath}?${qs}` : `${BASE_URL}${jsonPath}`;
}

function extractPostId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/comments\/([a-z0-9]{5,10})/i);
  if (m) return m[1];
  if (/^t3_/.test(s)) return s.slice(3);
  if (/^[a-z0-9]{5,10}$/i.test(s)) return s;
  return null;
}

function normalisePermalink(permalink) {
  if (!permalink) return null;
  if (permalink.startsWith('http')) return permalink;
  if (permalink.startsWith('/')) return `${BASE_URL}${permalink}`;
  return `${BASE_URL}/${permalink}`;
}

// Works on plain post objects and on Reddit's {data:{...}} wrappers alike.
function normalisePost(p) {
  const d = p && p.data ? p.data : p;
  const createdUtc = d.created_utc || 0;
  const permalink = d.permalink || (d.subreddit && d.id ? `/r/${d.subreddit}/comments/${d.id}/` : null);
  return {
    id: d.id,
    fullname: d.name || (d.id ? `t3_${d.id}` : null),
    subreddit: d.subreddit,
    title: d.title,
    author: d.author,
    score: d.score,
    num_comments: d.num_comments,
    created_utc: createdUtc,
    created_iso: createdUtc ? toIsoFromUtcSeconds(createdUtc) : null,
    permalink: normalisePermalink(permalink),
    url: d.url,
    is_self: d.is_self,
    over_18: d.over_18,
    flair: d.link_flair_text || null,
    selftext_snippet: d.selftext ? String(d.selftext).slice(0, 800) : null,
    ...(d.voc_tags ? { voc_tags: d.voc_tags } : {}),
  };
}

function normaliseComment(c, { depth = 0, maxChars = DEFAULTS.maxChars } = {}) {
  const d = c && c.data ? c.data : c;
  const createdUtc = d.created_utc || 0;
  const body = d.body || '';
  const permalink = d.permalink || (d.subreddit && d.link_id && d.id
    ? `/r/${d.subreddit}/comments/${String(d.link_id).replace(/^t3_/, '')}/_/${d.id}/`
    : null);
  return {
    id: d.id,
    fullname: d.name || (d.id ? `t1_${d.id}` : null),
    subreddit: d.subreddit,
    author: d.author,
    score: d.score,
    created_utc: createdUtc,
    created_iso: createdUtc ? toIsoFromUtcSeconds(createdUtc) : null,
    depth,
    parent_id: d.parent_id || null,
    link_id: d.link_id || null,
    permalink: normalisePermalink(permalink),
    body_snippet: body ? String(body).slice(0, maxChars) : null,
  };
}

function keywordHits(text, keywords) {
  const t = String(text || '').toLowerCase();
  const hits = [];
  for (const kw of keywords) {
    const k = String(kw).toLowerCase();
    if (k && t.includes(k)) hits.push(kw);
  }
  return hits;
}

function hoursAgo(createdUtc) {
  if (!createdUtc) return Number.POSITIVE_INFINITY;
  const deltaMs = nowMs() - createdUtc * 1000;
  return deltaMs / 3600000;
}

// Filter out deleted/removed comment bodies unless asked to keep them.
function isDeletedComment(d) {
  const body = d.body_snippet;
  const author = d.author;
  return author === '[deleted]' || body === '[deleted]' || body === '[removed]' || body == null;
}

// -------------------- Commands --------------------

async function cmdPosts(subreddit, args) {
  subreddit = normaliseSubredditName(subreddit);
  const sort = String(args.sort || 'new');
  const time = String(args.time || 'all');
  const limit = clampInt(parseInt(args.limit || '25', 10), 1, 100, 25);

  // Ranked modes are routed to backends that know Reddit's real ordering;
  // arctic still needs the score/recency hint in case it ends up serving.
  const byScore = sort === 'top' || sort === 'controversial';
  const after = byScore ? timeToAfterEpoch(time) : null;

  const rows = await fetchRows('submission', {
    subreddit,
    size: limit,
    sort: 'desc',
    sort_type: byScore ? 'score' : 'created_utc',
    after,
    _mode: sort,
    _time: time,
    _wantScore: Boolean(args.wantScore),
    _tikhubMaxPages: args['tikhub-max-pages'],
  });

  const posts = rows.map(normalisePost);

  // Asking for scores and silently getting a column of nulls is the same class
  // of failure this rewrite was about: say so rather than let it look like the
  // posts genuinely have no votes.
  if (args.wantScore && posts.length && posts.every((p) => p.score === null)) {
    staleWarnings.push(
      `--wantScore was requested but ${lastServedBy} cannot return scores; `
      + 'set TIKHUB_API_KEY (paid) or REDDIT_CLIENT_ID/SECRET to get them',
    );
  }

  ok({
    ...resultMeta(posts),
    subreddit,
    sort,
    ranking_note: rankingNote(sort, lastServedBy),
    time: byScore ? time : null,
    limit,
    posts,
  });
}

async function cmdSearch(scope, query, args) {
  scope = scope === 'all' ? scope : normaliseSubredditName(scope);
  const sort = String(args.sort || 'relevance');
  const time = String(args.time || 'all');
  const limit = clampInt(parseInt(args.limit || '25', 10), 1, 100, 25);

  const sortType = sort === 'top' ? 'score' : sort === 'comments' ? 'num_comments' : 'created_utc';
  const after = timeToAfterEpoch(time);

  const rows = await fetchRows('submission', {
    q: query,
    subreddit: scope === 'all' ? undefined : scope,
    size: limit,
    sort: 'desc',
    sort_type: sortType,
    after,
    _mode: sort,
    _time: time,
    _loose: Boolean(args.loose),
    _tikhubMaxPages: args['tikhub-max-pages'],
    _sorftimeMaxPages: args['sorftime-max-pages'],
    _postType: sorftimePostTypeParam(args.postType),
    _sentiment: sorftimeSentimentParam(args.sentiment),
  });

  const posts = rows.map(normalisePost);

  ok({
    ...resultMeta(posts),
    ...(args.postType || args.sentiment
      ? { filters: { post_type: args.postType || null, sentiment: args.sentiment || null } }
      : {}),
    scope,
    query,
    sort,
    ranking_note: rankingNote(sort, lastServedBy),
    time,
    limit,
    posts,
  });
}

async function cmdRecentComments(subreddit, args) {
  subreddit = normaliseSubredditName(subreddit);
  const limit = clampInt(parseInt(args.limit || '25', 10), 1, 100, 25);
  const maxChars = clampInt(parseInt(args.maxChars || String(DEFAULTS.maxChars), 10), 50, 20000, DEFAULTS.maxChars);

  const rows = await fetchRows('comment', {
    subreddit,
    size: limit,
    sort: 'desc',
    sort_type: 'created_utc',
  });

  const comments = rows.map((c) => normaliseComment(c, { maxChars }));

  ok({ ...resultMeta(comments), subreddit, limit, comments });
}

// Only TikHub and the official API expose real reply trees; everyone else
// returns a flat list. Say which one the caller actually got.
function treeNote(servedBy) {
  if (servedBy === 'tikhub' || servedBy === 'reddit') {
    return 'nested reply tree (depth is real); parent_id links replies to parents';
  }
  if (servedBy === 'sorftime') {
    return 'reply tree rebuilt from Sorftime parent ids (depth is real; replies Sorftime has not indexed are missing)';
  }
  return `flat list (${servedBy || 'this backend'} does not expose nested reply threads); use parent_id to reconstruct order`;
}

async function cmdComments(postIdOrUrl, args) {
  const postId = extractPostId(postIdOrUrl);
  if (!postId) throw new Error('Could not parse post id. Provide a post id like "abc123" or a full Reddit URL.');

  const limit = clampInt(parseInt(args.limit || '50', 10), 1, 100, 50);
  const includeDeleted = String(args.includeDeleted || 'false') === 'true';
  const maxChars = clampInt(parseInt(args.maxChars || String(DEFAULTS.maxChars), 10), 50, 20000, DEFAULTS.maxChars);

  const rows = await fetchRows('comment', {
    link_id: postId,
    size: limit,
    sort: 'asc',
    sort_type: 'created_utc',
    _wantNested: Boolean(args.nested),
  });

  let comments = rows.map((c) => normaliseComment(c, { depth: c && c.depth ? c.depth : 0, maxChars }));
  if (!includeDeleted) comments = comments.filter((c) => !isDeletedComment(c));

  ok({
    ...resultMeta(comments),
    post_id: postId,
    limit,
    include_deleted: includeDeleted,
    max_chars: maxChars,
    tree_note: treeNote(lastServedBy),
    comments,
  });
}

async function cmdThread(postIdOrUrl, args) {
  const postId = extractPostId(postIdOrUrl);
  if (!postId) throw new Error('Could not parse post id. Provide a post id like "abc123" or a full Reddit URL.');

  const commentLimit = clampInt(parseInt(args.commentLimit || args.limit || '50', 10), 1, 100, 50);
  const includeDeleted = String(args.includeDeleted || 'false') === 'true';
  const maxChars = clampInt(parseInt(args.maxChars || String(DEFAULTS.maxChars), 10), 50, 20000, DEFAULTS.maxChars);

  // The comments are the point of this command; losing the post header should
  // not cost the caller the whole thread.
  let post = null;
  let postError = null;
  try {
    const postRows = await fetchRows('submission', { ids: postId, size: 1 });
    post = postRows.length ? normalisePost(postRows[0]) : null;
  } catch (e) {
    postError = String(e && e.message ? e.message : e).slice(0, 160);
  }

  const commentRows = await fetchRows('comment', {
    link_id: postId,
    size: commentLimit,
    sort: 'asc',
    sort_type: 'created_utc',
    _wantNested: Boolean(args.nested),
  });
  let comments = commentRows.map((c) => normaliseComment(c, { depth: c && c.depth ? c.depth : 0, maxChars }));
  if (!includeDeleted) comments = comments.filter((c) => !isDeletedComment(c));

  ok({
    ...resultMeta(comments),
    post,
    ...(postError ? { post_error: postError } : {}),
    tree_note: treeNote(lastServedBy),
    comments,
  });
}

async function cmdFind(args) {
  const subreddits = parseCommaList(args.subreddits || args.subreddit).map(normaliseSubredditName);
  if (subreddits.length === 0) throw new Error('find requires --subreddits "a,b,c"');

  const query = args.query ? String(args.query) : '';
  const include = parseCommaList(args.include);
  const exclude = parseCommaList(args.exclude);

  const minScore = args.minScore != null ? parseInt(args.minScore, 10) : 0;
  const maxAgeHours = args.maxAgeHours != null ? parseFloat(args.maxAgeHours) : null;

  const perSubredditLimit = clampInt(parseInt(args.perSubredditLimit || '25', 10), 1, 100, 25);
  const maxResults = clampInt(parseInt(args.maxResults || '10', 10), 1, 100, 10);

  const rank = String(args.rank || 'new'); // new|score|comments|match

  // If maxAgeHours is set, push a matching lower bound to the backend too.
  const afterFromAge = maxAgeHours != null ? Math.floor(nowMs() / 1000) - Math.round(maxAgeHours * 3600) : null;

  const collected = [];
  const perSub = {};
  const perSubBackend = {};

  for (const sub of subreddits) {
    // Fan-out across subreddits is archive work: RSS would rate-limit long
    // before the last subreddit and only holds 25 items each anyway.
    const rows = await fetchRows('submission', {
      subreddit: sub,
      q: query || undefined,
      size: perSubredditLimit,
      sort: 'desc',
      sort_type: 'created_utc',
      after: afterFromAge,
      _bulk: true,
      _loose: Boolean(args.loose),
    });
    const posts = rows.map(normalisePost);
    perSub[sub] = posts.length;
    perSubBackend[sub] = lastServedBy;

    for (const p of posts) {
      const text = `${p.title || ''}\n\n${p.selftext_snippet || ''}`;
      const hits = keywordHits(text, include);
      const exHits = keywordHits(text, exclude);

      if (include.length > 0 && hits.length === 0) continue;
      if (exclude.length > 0 && exHits.length > 0) continue;
      if (typeof minScore === 'number' && (p.score || 0) < minScore) continue;
      if (maxAgeHours != null && hoursAgo(p.created_utc) > maxAgeHours) continue;

      const reason = [];
      if (query) reason.push(`query:${query}`);
      if (hits.length) reason.push(`include:${hits.join(',')}`);
      if (maxAgeHours != null) reason.push(`age_h:${hoursAgo(p.created_utc).toFixed(1)}`);
      if (minScore) reason.push(`minScore:${minScore}`);

      collected.push({ ...p, reason, match_score: hits.length });
    }
  }

  const ranked = collected.slice();
  ranked.sort((a, b) => {
    if (rank === 'score') return (b.score || 0) - (a.score || 0);
    if (rank === 'comments') return (b.num_comments || 0) - (a.num_comments || 0);
    if (rank === 'match') return (b.match_score || 0) - (a.match_score || 0);
    return (b.created_utc || 0) - (a.created_utc || 0);
  });

  const results = ranked.slice(0, maxResults);
  const usedBackends = [...new Set(Object.values(perSubBackend).filter(Boolean))];

  ok({
    ...resultMeta(results),
    // One fan-out can be served by different backends per subreddit, so a
    // single `source` would be misleading — report the set and the breakdown.
    source: usedBackends.length === 1 ? usedBackends[0] : usedBackends.join('+'),
    sources_by_subreddit: perSubBackend,
    criteria: { subreddits, query: query || null, include, exclude, minScore, maxAgeHours, perSubredditLimit, maxResults, rank },
    meta: { fetched_per_subreddit: perSub, candidates: collected.length, returned: results.length },
    results,
  });
}

// ---- doctor ----
//
// Probes every backend for real. A backend that cannot be probed is reported
// as not_configured / error — never quietly folded into a "looks fine" summary.
// Pull-based on purpose: no daemon, no cron. You run it when you want to know.
async function cmdDoctor() {
  const CAPS = {
    rss: ['subreddit listings (real hot/new/top)', 'in-subreddit search', 'all-Reddit search', 'post comments'],
    arctic: ['subreddit listings (recency; score approximated)', 'in-subreddit search', 'history back to 2019', 'bulk paging', 'comments (flat)'],
    tikhub: ['subreddit listings (full ranking + scores)', 'all-Reddit search', 'nested comment trees', 'post details'],
    reddit: ['everything, full fidelity, no feed rate limit'],
    serpapi: ['all-Reddit keyword search only (Google index)'],
    sorftime: ['all-Reddit semantic search', 'post type / sentiment filters + AI summary tags', 'full post text', 'comments with likes (tree rebuilt)'],
  };

  const probes = [
    { name: 'rss', configured: true, needs: null,
      run: () => viaRss('submission', { subreddit: 'test', size: 3, _mode: 'new' }) },
    { name: 'arctic', configured: true, needs: null,
      run: () => viaArctic('submission', { subreddit: 'test', size: 3, sort: 'desc', sort_type: 'created_utc' }) },
    { name: 'tikhub', configured: HAS_TIKHUB, needs: 'TIKHUB_API_KEY',
      run: () => viaTikhub('submission', { subreddit: 'test', size: 3, _mode: 'new', _tikhubMaxPages: 1 }) },
    { name: 'reddit', configured: HAS_REDDIT_CREDS, needs: 'REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET',
      run: () => viaReddit('submission', { subreddit: 'test', size: 3, _mode: 'new' }) },
    { name: 'serpapi', configured: Boolean(SERPAPI_KEY), needs: 'SERPAPI_API_KEY',
      // Needs a term whose Google hits are actual /r/*/comments/ threads —
      // a generic word returns Reddit landing pages and looks like a dead backend.
      run: () => viaSerpapi('submission', { q: 'python', size: 3 }) },
    { name: 'sorftime', configured: HAS_SORFTIME, needs: 'SORFTIME_KEY',
      run: () => viaSorftime('submission', { q: 'standing desk', size: 3, _sorftimeMaxPages: 1 }) },
  ];

  const backends = [];
  for (const probe of probes) {
    if (!probe.configured) {
      backends.push({
        name: probe.name,
        configured: false,
        status: 'not_configured',
        note: `set ${probe.needs} to enable`,
        capabilities: CAPS[probe.name],
      });
      continue;
    }
    const startedAt = nowMs();
    try {
      // A diagnostic that cries wolf is worse than no diagnostic: one transport
      // blip must not get a healthy backend reported as broken. Retry once
      // before calling it an error (the backends retry internally too, but a
      // rate-limited feed can still need a longer pause than they allow).
      let rows;
      let attempts = 0;
      for (;;) {
        try {
          rows = await probe.run();
          break;
        } catch (e) {
          attempts++;
          if (attempts >= 2 || !isRetryableError(String(e && e.message ? e.message : e))) throw e;
          await sleep(4000);
        }
      }
      const newestUtc = (rows || []).reduce((mx, r) => {
        const d = r && r.data ? r.data : r;
        return Math.max(mx, Number(d && d.created_utc) || 0);
      }, 0);
      const ageHours = newestUtc ? (nowMs() / 1000 - newestUtc) / 3600 : null;
      backends.push({
        name: probe.name,
        configured: true,
        status: rows && rows.length ? 'ok' : 'reachable_but_empty',
        rows: rows ? rows.length : 0,
        newest_iso: newestUtc ? toIsoFromUtcSeconds(newestUtc) : null,
        age_hours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
        freshness: !newestUtc ? 'unknown' : (ageHours / 24 > DEFAULTS.maxStaleDays ? 'STALE' : 'fresh'),
        latency_ms: nowMs() - startedAt,
        capabilities: CAPS[probe.name],
      });
    } catch (e) {
      backends.push({
        name: probe.name,
        configured: true,
        status: 'error',
        error: String(e && e.message ? e.message : e).slice(0, 200),
        latency_ms: nowMs() - startedAt,
        capabilities: CAPS[probe.name],
      });
    }
  }

  // TikHub bills per request, so surface the balance alongside its probe.
  if (HAS_TIKHUB) {
    const row = backends.find((b) => b.name === 'tikhub');
    try {
      const info = await fetchJsonWithRetry('https://api.tikhub.io/api/v1/tikhub/user/get_user_info', {
        retries: 1, headers: { 'Authorization': `Bearer ${TIKHUB_KEY}` },
      });
      const u = (info && info.user_data) || {};
      row.account = { balance: u.balance, email_verified: u.email_verified, active: u.is_active };
    } catch (e) {
      row.account = { error: String(e && e.message ? e.message : e).slice(0, 120) };
    }
  }

  const live = backends.filter((b) => b.status === 'ok');
  const usable = [...new Set(live.flatMap((b) => b.capabilities || []))];
  const zeroConfigLive = live.filter((b) => ['rss', 'arctic'].includes(b.name)).map((b) => b.name);

  const verdict = live.length === 0 ? 'down' : (live.length < 2 ? 'degraded' : 'healthy');
  ok({
    verdict,
    checked_at: new Date().toISOString(),
    live_backends: live.map((b) => b.name),
    zero_config_backends_live: zeroConfigLive,
    stale_backends: backends.filter((b) => b.freshness === 'STALE').map((b) => b.name),
    usable_capabilities: usable,
    backends,
    note: verdict === 'down'
      ? 'No backend answered. Check network/proxy first, then re-run.'
      : (zeroConfigLive.length === 0
        ? 'Only key-gated backends are live; the zero-config path (rss/arctic) is down.'
        : 'Zero-config path is live; optional keys add scores, nested comments and extra search.'),
  });

  if (verdict === 'down') process.exitCode = 1;
}

function usage() {
  return [
    'reddit-readonly — read-only Reddit, routed across official RSS + Arctic Shift (+ optional TikHub / OAuth).',
    '',
    'Commands:',
    '  posts <subreddit> [--sort hot|new|top|best|controversial] [--time day|week|month|year|all] [--limit N] [--wantScore]',
    '  search <subreddit|all> <query> [--sort relevance|top|new|comments] [--time all|day|week|month|year] [--limit N] [--loose]',
    '         [--postType question,advice,complaint,experience,discussion,innovation,other] [--sentiment positive|neutral|negative]  (Sorftime only)',
    '  comments <post_id|url> [--limit N] [--nested] [--includeDeleted true|false] [--maxChars N]',
    '  recent-comments <subreddit> [--limit N] [--maxChars N]',
    '  thread <post_id|url> [--commentLimit N] [--nested] [--includeDeleted true|false] [--maxChars N]',
    '  find --subreddits "a,b" [--query "..."] [--include "k1,k2"] [--exclude "k3"] [--minScore N] [--maxAgeHours H] [--perSubredditLimit N] [--maxResults N] [--rank new|score|comments|match]',
    '  doctor    — probe every backend for real and print a capability matrix',
    '',
    'Multi-word queries are phrase-matched by default — Reddit ORs bare words, so',
    '"non slip bath mat" would otherwise match posts that only mention "mat".',
    'Pass --loose for the original OR behaviour.',
    '',
    'Backends are chosen per query type (ranking -> rss/tikhub, history & bulk -> arctic,',
    'all-Reddit search -> sorftime/rss/tikhub/serpapi). data.source says who answered,',
    'data.backend_trail shows the route, data.freshness shows how new the data is.',
    '',
    'Zero config works: RSS + Arctic Shift need no keys. Optional, via env or a .env',
    'next to the script: REDDIT_CLIENT_ID/SECRET (official API), TIKHUB_API_KEY (paid,',
    'adds scores + nested comment trees), SERPAPI_API_KEY (extra all-Reddit search),',
    'SORFTIME_KEY (stable semantic search + post-type/sentiment tags + full text + comments).',
  ].join('\n');
}

async function main() {
  if (!BACKEND_NAMES.includes(BACKEND)) {
    fail(`Backend "${BACKEND}" is not implemented. Use ${BACKEND_NAMES.join(' | ')}.`);
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;

  try {
    switch (cmd) {
      case 'posts': {
        const [subreddit] = rest;
        if (!subreddit) throw new Error('Usage: posts <subreddit>');
        await cmdPosts(subreddit, args);
        break;
      }
      case 'search': {
        const [scope, ...qParts] = rest;
        const query = qParts.join(' ').trim();
        if (!scope || !query) throw new Error('Usage: search <subreddit|all> <query>');
        await cmdSearch(scope, query, args);
        break;
      }
      case 'comments': {
        const [postIdOrUrl] = rest;
        if (!postIdOrUrl) throw new Error('Usage: comments <post_id|url>');
        await cmdComments(postIdOrUrl, args);
        break;
      }
      case 'recent-comments': {
        const [subreddit] = rest;
        if (!subreddit) throw new Error('Usage: recent-comments <subreddit>');
        await cmdRecentComments(subreddit, args);
        break;
      }
      case 'thread': {
        const [postIdOrUrl] = rest;
        if (!postIdOrUrl) throw new Error('Usage: thread <post_id|url>');
        await cmdThread(postIdOrUrl, args);
        break;
      }
      case 'find': {
        await cmdFind(args);
        break;
      }
      case 'doctor': {
        await cmdDoctor();
        break;
      }
      default: {
        throw new Error(usage());
      }
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    fail(msg);
  }
}

main();
