---
name: reddit-readonly
description: >-
  Browse and search Reddit in read-only mode using public JSON endpoints.
  Use when the user asks to browse subreddits, search for posts by topic,
  inspect comment threads, or build a shortlist of links to review and reply to manually.
metadata: {"clawdbot":{"emoji":"🔎","requires":{"bins":["node"]}}}
---

# Reddit Readonly

Read-only Reddit browsing for Clawdbot.

## Backend (2026)

Reddit deprecated anonymous `.json` endpoints in May 2026 — datacenter IPs get
HTTP 403. This skill now reads through **PullPush.io**, a free, no-auth
Pushshift-successor archive that mirrors Reddit's data model. **No API key,
OAuth, login, or bot account is required.** Every result still carries a
`permalink` to the real Reddit thread so the user opens it to reply manually.

Trade-offs vs the official API: PullPush is strong at *search/mining* (by
subreddit, keyword, author, time window) but has **no "hot"/"rising" ranking**
(posts are approximated by recency or score) and returns comments as a **flat
list** (no nested reply tree). This is the right tool for finding posts and
building shortlists; it is a near-real-time archive, so brand-new posts may lag
by minutes.

## What this skill is for

- Finding posts in one or more subreddits (hot/new/top/controversial/rising)
- Searching for posts by query (within a subreddit or across all)
- Pulling a comment thread for context
- Producing a *shortlist of permalinks* so the user can open Reddit and reply manually

## Hard rules

- **Read-only only.** This skill never posts, replies, votes, or moderates.
- Be polite with requests:
  - Prefer small limits (5–10) first.
  - Expand only if needed.
- When returning results to the user, always include **permalinks**.

## Output format

All commands print JSON to stdout.

- Success: `{ "ok": true, "data": ... }`
- Failure: `{ "ok": false, "error": { "message": "...", "details": "..." } }`

## Commands

### 1) List posts in a subreddit

```bash
node {baseDir}/scripts/reddit-readonly.mjs posts <subreddit> \
  --sort new|top|controversial \
  --time day|week|month|year|all \
  --limit 10
```
Note: `new` = newest first; `top`/`controversial` = by score (optionally within `--time`). `hot`/`rising` are not available from PullPush and fall back to recency.

### 2) Search posts

```bash
# Search within a subreddit
node {baseDir}/scripts/reddit-readonly.mjs search <subreddit> "<query>" --limit 10

# Search all of Reddit
node {baseDir}/scripts/reddit-readonly.mjs search all "<query>" --limit 10
```

### 3) Get comments for a post

```bash
# By post id or URL — returns a FLAT list of the post's comments (no nested tree)
node {baseDir}/scripts/reddit-readonly.mjs comments <post_id|url> --limit 50 --includeDeleted false --maxChars 1000
```

### 4) Recent comments across a subreddit

```bash
node {baseDir}/scripts/reddit-readonly.mjs recent-comments <subreddit> --limit 25
```

### 5) Thread bundle (post + comments)

```bash
node {baseDir}/scripts/reddit-readonly.mjs thread <post_id|url> --commentLimit 50
```

### 6) Find opportunities (multi-subreddit helper)

Use this when the user describes criteria like:
"Find posts about X in r/a, r/b, and r/c posted in the last 48 hours, excluding Y".

```bash
node {baseDir}/scripts/reddit-readonly.mjs find \
  --subreddits "python,learnpython" \
  --query "fastapi deployment" \
  --include "docker,uvicorn,nginx" \
  --exclude "homework,beginner" \
  --minScore 2 \
  --maxAgeHours 48 \
  --perSubredditLimit 25 \
  --maxResults 10 \
  --rank new
```

## Suggested agent workflow

1. **Clarify scope** if needed: subreddits + topic keywords + timeframe.
2. Start with `find` (or `posts`/`search`) using small limits.
3. For 1–3 promising items, fetch context via `thread`.
4. Present the user a shortlist:
   - title, subreddit, score, created time
   - permalink
   - a brief reason why it matched
5. If asked, propose *draft reply ideas* in natural language, but remind the user to post manually.

## Troubleshooting

- Reads go to `api.pullpush.io`. If it returns HTML or 5xx, the script retries with backoff; if it still fails, PullPush is likely rate-limiting or down — reduce `--limit` and slow the pace via env vars below, or retry later.
- If requests fail repeatedly, reduce `--limit` and/or set slower pacing:

```bash
export REDDIT_RO_MIN_DELAY_MS=800
export REDDIT_RO_MAX_DELAY_MS=1800
export REDDIT_RO_TIMEOUT_MS=25000
```

- To force the legacy official-Reddit-endpoint path (only works with OAuth or a residential/unblocked IP — otherwise 403), set `REDDIT_RO_BACKEND=reddit`. Default/unset uses PullPush.

## Compliance note

Low-volume, human-driven reading to build a shortlist is fine. Do **not** use
this for large-scale automated mining that feeds a commercial pipeline or trains
AI models — Reddit's Responsible Builder Policy prohibits that regardless of the
data source. Keep usage polite and permalink-back to the real thread.
