---
name: reddit-readonly
description: >-
  Browse and search Reddit in read-only mode. Use when the user asks to browse
  subreddits, search for posts by topic, inspect comment threads, or build a
  shortlist of links to review and reply to manually.
metadata: {"clawdbot":{"emoji":"🔎","requires":{"bins":["node"]}}}
---

# Reddit Readonly

Read-only Reddit browsing. Works with no configuration at all; optional API keys
add capabilities.

## Backends (2026)

Reddit deprecated anonymous `.json` endpoints in May 2026 — datacenter IPs get
HTTP 403. Reads are **routed by capability** across the backends below, because
their strengths genuinely do not overlap. `data.source` reports who answered,
`data.backend_trail` the route taken, `data.freshness` how new the data is.

| Backend | Needs | Strengths | Limits |
|---|---|---|---|
| `rss` | nothing | Reddit's own Atom feeds: **real hot/new/top ranking** and **all-Reddit search** | 25 items; **no scores or comment counts**; tight rate limit |
| `arctic` | nothing | Arctic Shift archive: **2019 → today**, unlimited paging, bulk fan-out, has scores | no real ranking (approximated); **no all-Reddit search** |
| `tikhub` | `TIKHUB_API_KEY` (paid) | Only backend with **ranking + scores + nested reply trees** at once | billed per request; ~8 rows/page |
| `reddit` | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | Official API, full fidelity, no feed rate limit | needs a Reddit script app |
| `serpapi` | `SERPAPI_API_KEY` | Extra all-Reddit search via Google | no scores or timestamps |

**Zero-config is fully functional**: `rss` + `arctic` together cover every
command. Keys are additive, never required.

Force one backend with `REDDIT_RO_BACKEND=auto|reddit|rss|arctic|tikhub|serpapi`
(default `auto`).

### Routing

| Query | First choice | Then |
|---|---|---|
| hot / best / controversial listing | `tikhub` (if keyed) → `rss` | `arctic` (approximated) |
| new listing, in-subreddit search | `arctic` | `rss`, `tikhub` |
| all-Reddit search | `rss` | `tikhub`, `serpapi` |
| nested comment tree (`--nested`) | `tikhub` | `arctic` (flat, labelled) |
| comments / thread | `arctic` | `rss`, `tikhub` |
| history (>30d) or bulk (`find`) | `arctic` | — |

`reddit` leads every route when its credentials are set.

### Credentials

Read from **two places only**: the process environment, and a `.env` next to
this skill. Nothing else is touched — no personal secret manager, no reaching
into other skills. Export the vars yourself, or drop a `.env` beside the script:

```
TIKHUB_API_KEY=...
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
SERPAPI_API_KEY=...
```

### About TikHub

TikHub is a **third-party reverse-engineered service, billed per request**. It
is off unless `TIKHUB_API_KEY` is set, and official sources (`rss`, `reddit`)
are always preferred where they can do the same job. Compliance for using it —
including Reddit's Responsible Builder Policy and any applicable privacy law —
rests with whoever supplies the key. Every response reports
`cost.tikhub_requests`; paging is capped (`--tikhub-max-pages`, default 3).

### Freshness gate

A backend answering HTTP 200 with long-stale data used to pass silently. Results
are now also judged on recency: when a query asks for *the latest* and the rows
are older than `REDDIT_RO_MAX_STALE_DAYS` (default 7), the router moves on to the
next backend, and if none can do better the response carries a `warnings` entry.
Relevance searches and all-time top listings are exempt — old rows are correct
there, and `freshness.verdict` reports `not_time_sensitive`.

## What this skill is for

- Finding posts in one or more subreddits (hot/new/top/controversial/rising)
- Searching for posts by query (within a subreddit or across all)
- Pulling a comment thread for context
- Producing a *shortlist of permalinks* so the user can open Reddit and reply manually

## Hard rules

- **Read-only.** Never posts, replies, votes, or moderates.
- **Human-paced, on demand.** No daemons, no cron, no bulk harvesting pipelines.
- Be polite with requests: prefer small limits (5–10) first, expand only if needed.
- Always return **permalinks** so the user can act manually.

## Output format

JSON on stdout.

- Success: `{ "ok": true, "data": ... }`
- Failure: `{ "ok": false, "error": { "message": "...", "details": "..." } }`

Every successful payload includes:

```json
"source": "arctic",
"backend_trail": ["rss:429_backoff", "arctic:ok"],
"freshness": { "newest_iso": "...", "age_hours": 3.2, "verdict": "fresh" },
"warnings": ["..."],              // only when something degraded
"cost": { "tikhub_requests": 1 }  // only when TikHub was used
```

## Commands

### 0) Check what works

```bash
node {baseDir}/scripts/reddit-readonly.mjs doctor
```
Probes every backend for real and prints a capability matrix, freshness per
backend, and (for TikHub) the account balance. Backends that cannot be probed
are reported as `not_configured` / `error` — never counted as passing. Exits
non-zero only when nothing answered. Run this first after install.

### 1) List posts in a subreddit

```bash
node {baseDir}/scripts/reddit-readonly.mjs posts <subreddit> \
  --sort hot|new|top|best|controversial \
  --time day|week|month|year|all \
  --limit 10 \
  [--wantScore] [--tikhub-max-pages 3]
```
`--wantScore` prefers a backend that returns real scores (TikHub) over one that
only has ranking (RSS). `ranking_note` in the response states which ordering you
actually got.

### 2) Search posts

```bash
# Within a subreddit
node {baseDir}/scripts/reddit-readonly.mjs search <subreddit> "<query>" --limit 10

# Across all of Reddit
node {baseDir}/scripts/reddit-readonly.mjs search all "<query>" --limit 10

# Opt out of phrase matching (original OR behaviour)
node {baseDir}/scripts/reddit-readonly.mjs search all "<query>" --loose
```

**Multi-word queries are phrase-matched by default.** Reddit ORs bare words, so
`non slip bath mat` unquoted also returns posts that only mention "mat".
Quoting fixes it. Pass `--loose` for the old behaviour, or use your own quotes /
search operators (`AND`, `OR`, `title:`) and they are passed through untouched.

### 3) Get comments for a post

```bash
node {baseDir}/scripts/reddit-readonly.mjs comments <post_id|url> \
  --limit 50 [--nested] [--includeDeleted false] [--maxChars 1000]
```
`--nested` asks for a real reply tree (TikHub only); otherwise a flat list comes
back with `parent_id` for reconstruction. `tree_note` says which you got.

### 4) Recent comments across a subreddit

```bash
node {baseDir}/scripts/reddit-readonly.mjs recent-comments <subreddit> --limit 25
```

### 5) Thread bundle (post + comments)

```bash
node {baseDir}/scripts/reddit-readonly.mjs thread <post_id|url> --commentLimit 50 [--nested]
```

### 6) Find opportunities (multi-subreddit)

```bash
node {baseDir}/scripts/reddit-readonly.mjs find \
  --subreddits "python,learnpython" \
  --query "fastapi deployment" \
  --include "docker,uvicorn,nginx" \
  --exclude "homework,beginner" \
  --minScore 2 --maxAgeHours 48 \
  --perSubredditLimit 25 --maxResults 10 --rank new
```
Fan-out is archive work and routes to `arctic`. The response reports
`sources_by_subreddit`, since different subreddits can be served by different
backends.

## Suggested agent workflow

1. **Clarify scope** if needed: subreddits + topic keywords + timeframe.
2. Start with `find` (or `posts`/`search`) using small limits.
3. For 1–3 promising items, fetch context via `thread`.
4. Present a shortlist: title, subreddit, score, created time, permalink, and why it matched.
5. If asked, draft reply ideas in natural language — but remind the user to post manually.

Check `freshness.verdict` before treating results as current signal, and mention
`warnings` to the user rather than swallowing them.

## Troubleshooting

Run `doctor` first — it tells you which backend is actually failing.

- **Everything fails**: check network/proxy. Transport blips are retried
  automatically (`fetch failed` / `ECONNRESET` are treated as transient).
- **RSS 429s**: expected under repeated polling; requests back off and results
  are cached for 60s. Slow down, or set `REDDIT_CLIENT_ID/SECRET` to bypass the
  feed limiter entirely.
- **RSS returns 403**: the feed User-Agent was overridden. Reddit serves feeds to
  feed readers only — leave `REDDIT_RO_RSS_USER_AGENT` alone unless you know why.
- **No scores in results**: RSS served the request; Atom carries no scores. Pass
  `--wantScore` (needs `TIKHUB_API_KEY`) or accept the approximation from arctic.
- **Pacing**: `REDDIT_RO_MIN_DELAY_MS`, `REDDIT_RO_MAX_DELAY_MS`, `REDDIT_RO_TIMEOUT_MS`.
