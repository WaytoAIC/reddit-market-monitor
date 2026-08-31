# Output schema (informal)

All commands return JSON: `{ ok, data | error }`.

Reads (v1.4.0+) are routed across Reddit RSS, Arctic Shift, and optionally
TikHub / the official API / SerpApi. `data.source` names whoever answered.

## Envelope fields (every successful response)

```json
{
  "source": "arctic",
  "backend_trail": ["rss:429_backoff", "arctic:ok"],
  "freshness": {
    "newest_iso": "2026-08-27T09:01:55.000Z",
    "age_hours": 3.2,
    "verdict": "fresh"
  },
  "warnings": ["r/foo: served by arctic but data looks stale_141d; no fresher backend available"],
  "cost": { "tikhub_requests": 1 }
}
```

- `backend_trail` — every backend tried and why it was passed over
  (`ok`, `empty`, `stale_<n>d`, `error`).
- `freshness.verdict` — `fresh` | `stale` | `empty` | `no_timestamps` |
  `not_time_sensitive`. The last one means recency was never asked for
  (relevance search, all-time top), so age carries no signal.
- `warnings` — present only when results were degraded. Surface these; do not
  swallow them.
- `cost` — present only when TikHub was called (billed per request).

`find` additionally returns `sources_by_subreddit`, since a fan-out can be
served by different backends per subreddit.

## Post object

`score` and `num_comments` are `null` when RSS served the request — Atom carries
neither. Use `--wantScore` (needs `TIKHUB_API_KEY`) when they are required.

```json
{
  "id": "abc123",
  "fullname": "t3_abc123",
  "subreddit": "python",
  "title": "...",
  "author": "...",
  "score": 123,
  "num_comments": 45,
  "created_utc": 1737060000,
  "created_iso": "2026-01-16T12:00:00.000Z",
  "permalink": "https://www.reddit.com/r/python/comments/abc123/.../",
  "url": "https://...",
  "selftext_snippet": "...",
  "flair": "..."
}
```

## Comment object

`depth` is a real reply level only when `tree_note` says so (TikHub or the
official API). Otherwise comments are a flat list with `depth: 0`; use
`parent_id` to reconstruct the ordering.

```json
{
  "id": "def456",
  "fullname": "t1_def456",
  "subreddit": "python",
  "author": "...",
  "score": 10,
  "created_utc": 1737060100,
  "created_iso": "2026-01-16T12:01:40.000Z",
  "depth": 1,
  "parent_id": "t1_...",
  "link_id": "t3_abc123",
  "permalink": "https://www.reddit.com/r/python/comments/abc123/.../def456/",
  "body_snippet": "..."
}
```

## doctor

```json
{
  "verdict": "healthy | degraded | down",
  "live_backends": ["rss", "arctic"],
  "zero_config_backends_live": ["rss", "arctic"],
  "stale_backends": [],
  "usable_capabilities": ["..."],
  "backends": [
    { "name": "rss", "configured": true, "status": "ok", "rows": 3,
      "newest_iso": "...", "age_hours": 1.1, "freshness": "fresh", "latency_ms": 1571 },
    { "name": "reddit", "configured": false, "status": "not_configured",
      "note": "set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET to enable" }
  ]
}
```

`status` is one of `ok`, `reachable_but_empty`, `error`, `not_configured`. A
backend that was not probed is never reported as passing. Exit code is non-zero
only when nothing answered at all.
