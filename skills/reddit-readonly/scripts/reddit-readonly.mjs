#!/usr/bin/env node

/**
 * reddit-readonly.mjs
 *
 * Read-only Reddit CLI.
 *
 * Backend (2026): Reddit deprecated anonymous .json endpoints (datacenter IPs
 * get HTTP 403). Reads go through a 5-backend AUTOMATIC FAILOVER chain:
 *
 *   1. reddit   — official OAuth API (only when REDDIT_CLIENT_ID/SECRET set;
 *                 optional REDDIT_USERNAME/PASSWORD for password grant).
 *                 Full fidelity: real hot/rising, live scores, nested-tree
 *                 comments (flattened with true depth).
 *   2. pullpush — PullPush.io, free no-auth Pushshift successor.
 *   3. arctic   — Arctic Shift, same family; no all-Reddit search
 *                 (subreddit required), score sort approximated client-side.
 *   4. serpapi  — Google `site:reddit.com` via SerpApi; ONLY fills the
 *                 all-Reddit keyword search gap (needs SERPAPI_API_KEY).
 *   5. jina     — r.jina.ai rendered-page parse; ONLY subreddit post
 *                 listings, last resort (scores unavailable).
 *
 * data.source reports which backend served. REDDIT_RO_BACKEND forces one:
 * auto (default) | reddit | pullpush | arctic | serpapi | jina.
 * Every result carries a permalink to the real Reddit thread.
 *
 * Commands output JSON to stdout:
 * - Success: { ok: true, data: ... }
 * - Failure: { ok: false, error: { message, details? } }
 */

const BASE_URL = 'https://www.reddit.com';
const PULLPUSH_BASE = 'https://api.pullpush.io/reddit/search';
const ARCTIC_BASE = 'https://arctic-shift.photon-reddit.com/api';
const BACKEND = String(process.env.REDDIT_RO_BACKEND || 'auto').toLowerCase();

const DEFAULTS = {
  minDelayMs: parseInt(process.env.REDDIT_RO_MIN_DELAY_MS || '500', 10),
  maxDelayMs: parseInt(process.env.REDDIT_RO_MAX_DELAY_MS || '1500', 10),
  timeoutMs: parseInt(process.env.REDDIT_RO_TIMEOUT_MS || '25000', 10),
  userAgent: process.env.REDDIT_RO_USER_AGENT || 'script:clawdbot-reddit-readonly:v2.0.0',
  maxChars: 1000,
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

async function fetchJson(url, { timeoutMs } = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('This script requires Node.js 18+ (global fetch not found).');
  }

  // polite pacing (jittered)
  await sleep(randInt(DEFAULTS.minDelayMs, DEFAULTS.maxDelayMs));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || DEFAULTS.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DEFAULTS.userAgent,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    if (text.trim().startsWith('<')) {
      throw new Error('Upstream returned HTML instead of JSON. Try again later or reduce request rate.');
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonWithRetry(url, { retries = 3 } = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      return await fetchJson(url);
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message ? e.message : e);
      const isRetryable = msg.includes('HTTP 429') || msg.includes('HTTP 5') || msg.includes('aborted') || msg.includes('HTML instead of JSON');
      if (!isRetryable || attempt === retries) break;
      const backoff = 600 * Math.pow(2, attempt) + randInt(0, 400);
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr || new Error('Request failed');
}

// -------------------- PullPush backend --------------------

// Map a Reddit-style time window to an epoch-seconds "after" bound.
function timeToAfterEpoch(time) {
  const map = { day: 86400, week: 604800, month: 2592000, year: 31536000 };
  const secs = map[String(time)];
  if (!secs) return null; // 'all' or unknown => no lower bound
  return Math.floor(nowMs() / 1000) - secs;
}

// ---- Multi-backend read layer with automatic failover ----
//
// Canonical params: { subreddit, q, size, sort, sort_type, after, link_id, ids }
// plus underscore-prefixed hints (_mode, _time) that only some backends use.
// Backends tried in order; a 5xx/timeout/HTML/unusable response falls through
// to the next. `lastServedBy` records which backend actually answered.
//
// Chain (auto): reddit-oauth (when creds set) -> pullpush -> arctic
//               -> serpapi (global search only, when key set)
//               -> jina (subreddit post listings only, last resort)

let lastServedBy = null;

const REDDIT_CREDS = {
  clientId: process.env.REDDIT_CLIENT_ID || '',
  clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  username: process.env.REDDIT_USERNAME || '',
  password: process.env.REDDIT_PASSWORD || '',
};
const HAS_REDDIT_CREDS = Boolean(REDDIT_CREDS.clientId && REDDIT_CREDS.clientSecret);
const SERPAPI_KEY = process.env.REDDIT_RO_SERPAPI_KEY || process.env.SERPAPI_API_KEY || '';
const JINA_BASE = 'https://r.jina.ai';

function qsFrom(obj) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue; // internal hints, never sent upstream
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  return qs.toString();
}

async function viaPullpush(kind, p) {
  const url = `${PULLPUSH_BASE}/${kind}/?${qsFrom(p)}`;
  const json = await fetchJsonWithRetry(url, { retries: 1 });
  if (!json || !Array.isArray(json.data)) throw new Error('pullpush: unexpected response shape');
  return json.data;
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

// ---- Jina Reader — last-resort subreddit post listing via rendered markdown ----

async function viaJina(kind, p) {
  if (kind !== 'submission' || !p.subreddit || p.q || p.ids || p.link_id) {
    throw new Error('jina: only handles subreddit post listings');
  }
  const mode = ['hot', 'new', 'top', 'rising'].includes(p._mode) ? p._mode : 'new';
  const url = `${JINA_BASE}/https://www.reddit.com/r/${p.subreddit}/${mode}/`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULTS.timeoutMs);
  let text;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': DEFAULTS.userAgent }, signal: controller.signal });
    text = await res.text();
    if (!res.ok) throw new Error(`jina HTTP ${res.status}`);
  } finally {
    clearTimeout(t);
  }
  if (/blocked by network security|error 403/i.test(text)) {
    throw new Error('jina: upstream reddit returned 403 through Jina');
  }
  const seen = new Set();
  const rows = [];
  const re = /\[([^\]]{5,200})\]\(https:\/\/www\.reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)[^)]*\)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = m[3];
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      subreddit: m[2],
      title: m[1].trim(),
      author: null,
      score: null,
      num_comments: null,
      created_utc: 0,
      permalink: `https://www.reddit.com/r/${m[2]}/comments/${id}/`,
      url: `https://www.reddit.com/r/${m[2]}/comments/${id}/`,
      is_self: null,
      over_18: null,
      selftext: '',
    });
    if (rows.length >= (parseInt(p.size, 10) || 25)) break;
  }
  if (rows.length === 0) throw new Error('jina: no posts parsed from rendered page');
  return rows;
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
  pullpush: viaPullpush,
  arctic: viaArctic,
  serpapi: viaSerpapi,
  jina: viaJina,
};

function buildChain(kind, p) {
  const chain = [];
  if (HAS_REDDIT_CREDS) chain.push('reddit');
  chain.push('pullpush', 'arctic');
  const isGlobalSearch = kind === 'submission' && p.q && !p.subreddit;
  if (isGlobalSearch && SERPAPI_KEY) chain.push('serpapi');
  const isSubListing = kind === 'submission' && p.subreddit && !p.q && !p.ids && !p.link_id;
  if (isSubListing) chain.push('jina');
  return chain;
}

// kind: 'submission' | 'comment'
async function pullpush(kind, params) {
  const forced = BACKEND === 'auto' ? null : BACKEND;
  const chain = forced ? [forced] : buildChain(kind, params);
  if (forced && !BACKENDS[forced]) {
    throw new Error(`Unknown backend "${forced}". Use auto | reddit | pullpush | arctic | serpapi | jina.`);
  }
  const errors = [];
  for (const name of chain) {
    try {
      const rows = await BACKENDS[name](kind, params);
      lastServedBy = name;
      return rows;
    } catch (e) {
      errors.push(`${name}: ${String(e && e.message ? e.message : e).slice(0, 160)}`);
    }
  }
  throw new Error(`All backends failed — ${errors.join(' | ')}`);
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

// Works on both raw PullPush objects and Reddit {data} wrappers.
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

// -------------------- Commands (PullPush-backed) --------------------

async function cmdPosts(subreddit, args) {
  const sort = String(args.sort || 'new');
  const time = String(args.time || 'all');
  const limit = clampInt(parseInt(args.limit || '25', 10), 1, 100, 25);

  // PullPush has no hot/rising ranking. Map:
  //  top/controversial -> by score;  otherwise -> by recency.
  const byScore = sort === 'top' || sort === 'controversial';
  const after = byScore ? timeToAfterEpoch(time) : null;

  const rows = await pullpush('submission', {
    subreddit,
    size: limit,
    sort: 'desc',
    sort_type: byScore ? 'score' : 'created_utc',
    after,
    _mode: sort,
    _time: time,
  });

  const posts = rows.map(normalisePost);

  ok({
    source: lastServedBy,
    subreddit,
    sort,
    ranking_note: byScore
      ? `approximated by score${after ? ` within last ${time}` : ''}`
      : 'approximated by recency (PullPush has no hot/rising)',
    time: byScore ? time : null,
    limit,
    posts,
  });
}

async function cmdSearch(scope, query, args) {
  const sort = String(args.sort || 'relevance');
  const time = String(args.time || 'all');
  const limit = clampInt(parseInt(args.limit || '25', 10), 1, 100, 25);

  const sortType = sort === 'top' ? 'score' : sort === 'comments' ? 'num_comments' : 'created_utc';
  const after = timeToAfterEpoch(time);

  const rows = await pullpush('submission', {
    q: query,
    subreddit: scope === 'all' ? undefined : scope,
    size: limit,
    sort: 'desc',
    sort_type: sortType,
    after,
    _mode: sort,
    _time: time,
  });

  const posts = rows.map(normalisePost);

  ok({
    source: lastServedBy,
    scope,
    query,
    sort,
    ranking_note: sort === 'relevance' ? 'PullPush has no relevance sort; returned newest-first' : `sorted by ${sortType}`,
    time,
    limit,
    posts,
  });
}

async function cmdRecentComments(subreddit, args) {
  const limit = clampInt(parseInt(args.limit || '25', 10), 1, 100, 25);
  const maxChars = clampInt(parseInt(args.maxChars || String(DEFAULTS.maxChars), 10), 50, 20000, DEFAULTS.maxChars);

  const rows = await pullpush('comment', {
    subreddit,
    size: limit,
    sort: 'desc',
    sort_type: 'created_utc',
  });

  const comments = rows.map((c) => normaliseComment(c, { maxChars }));

  ok({ source: lastServedBy, subreddit, limit, comments });
}

async function cmdComments(postIdOrUrl, args) {
  const postId = extractPostId(postIdOrUrl);
  if (!postId) throw new Error('Could not parse post id. Provide a post id like "abc123" or a full Reddit URL.');

  const limit = clampInt(parseInt(args.limit || '50', 10), 1, 100, 50);
  const includeDeleted = String(args.includeDeleted || 'false') === 'true';
  const maxChars = clampInt(parseInt(args.maxChars || String(DEFAULTS.maxChars), 10), 50, 20000, DEFAULTS.maxChars);

  // PullPush returns a FLAT list of comments for a link (no nested tree).
  const rows = await pullpush('comment', {
    link_id: postId,
    size: limit,
    sort: 'asc',
    sort_type: 'created_utc',
  });

  let comments = rows.map((c) => normaliseComment(c, { maxChars }));
  if (!includeDeleted) comments = comments.filter((c) => !isDeletedComment(c));

  ok({
    source: lastServedBy,
    post_id: postId,
    limit,
    include_deleted: includeDeleted,
    max_chars: maxChars,
    tree_note: 'flat list (PullPush does not expose nested reply threads); use parent_id to reconstruct order',
    comments,
  });
}

async function cmdThread(postIdOrUrl, args) {
  const postId = extractPostId(postIdOrUrl);
  if (!postId) throw new Error('Could not parse post id. Provide a post id like "abc123" or a full Reddit URL.');

  const commentLimit = clampInt(parseInt(args.commentLimit || args.limit || '50', 10), 1, 100, 50);
  const includeDeleted = String(args.includeDeleted || 'false') === 'true';
  const maxChars = clampInt(parseInt(args.maxChars || String(DEFAULTS.maxChars), 10), 50, 20000, DEFAULTS.maxChars);

  const postRows = await pullpush('submission', { ids: postId, size: 1 });
  const post = postRows.length ? normalisePost(postRows[0]) : null;

  const commentRows = await pullpush('comment', {
    link_id: postId,
    size: commentLimit,
    sort: 'asc',
    sort_type: 'created_utc',
  });
  let comments = commentRows.map((c) => normaliseComment(c, { maxChars }));
  if (!includeDeleted) comments = comments.filter((c) => !isDeletedComment(c));

  ok({
    source: lastServedBy,
    post,
    tree_note: 'flat comment list (PullPush)',
    comments,
  });
}

async function cmdFind(args) {
  const subreddits = parseCommaList(args.subreddits || args.subreddit);
  if (subreddits.length === 0) throw new Error('find requires --subreddits "a,b,c"');

  const query = args.query ? String(args.query) : '';
  const include = parseCommaList(args.include);
  const exclude = parseCommaList(args.exclude);

  const minScore = args.minScore != null ? parseInt(args.minScore, 10) : 0;
  const maxAgeHours = args.maxAgeHours != null ? parseFloat(args.maxAgeHours) : null;

  const perSubredditLimit = clampInt(parseInt(args.perSubredditLimit || '25', 10), 1, 100, 25);
  const maxResults = clampInt(parseInt(args.maxResults || '10', 10), 1, 100, 10);

  const rank = String(args.rank || 'new'); // new|score|comments|match

  // If maxAgeHours is set, push a matching lower bound to PullPush too.
  const afterFromAge = maxAgeHours != null ? Math.floor(nowMs() / 1000) - Math.round(maxAgeHours * 3600) : null;

  const collected = [];
  const perSub = {};

  for (const sub of subreddits) {
    const rows = await pullpush('submission', {
      subreddit: sub,
      q: query || undefined,
      size: perSubredditLimit,
      sort: 'desc',
      sort_type: 'created_utc',
      after: afterFromAge,
    });
    const posts = rows.map(normalisePost);
    perSub[sub] = posts.length;

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

  ok({
    source: lastServedBy,
    criteria: { subreddits, query: query || null, include, exclude, minScore, maxAgeHours, perSubredditLimit, maxResults, rank },
    meta: { fetched_per_subreddit: perSub, candidates: collected.length, returned: Math.min(maxResults, ranked.length) },
    results: ranked.slice(0, maxResults),
  });
}

function usage() {
  return [
    'reddit-readonly (PullPush backend). Commands:',
    '  posts <subreddit> [--sort new|top|controversial] [--time day|week|month|year|all] [--limit N]',
    '  search <subreddit|all> <query> [--sort relevance|top|new|comments] [--time all|day|week|month|year] [--limit N]',
    '  comments <post_id|url> [--limit N] [--includeDeleted true|false] [--maxChars N]',
    '  recent-comments <subreddit> [--limit N] [--maxChars N]',
    '  thread <post_id|url> [--commentLimit N] [--includeDeleted true|false] [--maxChars N]',
    '  find --subreddits "a,b" [--query "..."] [--include "k1,k2"] [--exclude "k3"] [--minScore N] [--maxAgeHours H] [--perSubredditLimit N] [--maxResults N] [--rank new|score|comments|match]',
    '',
    'Backends (auto failover): reddit-oauth (if REDDIT_CLIENT_ID/SECRET set) -> pullpush -> arctic -> serpapi (global search, if SERPAPI_API_KEY) -> jina (post listings). data.source reports which served.',
  ].join('\n');
}

async function main() {
  if (!['auto', 'reddit', 'pullpush', 'arctic', 'serpapi', 'jina'].includes(BACKEND)) {
    fail(`Backend "${BACKEND}" is not implemented. Use auto (default failover chain), reddit (needs REDDIT_CLIENT_ID/SECRET), pullpush, arctic, serpapi (global search, needs SERPAPI_API_KEY), or jina (post listings).`);
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
