# Output schema (informal)

All commands return JSON: `{ ok, data | error }`. Read data (v1.1.0+) comes
from PullPush.io; `data.source` is `"pullpush"`. Comments are a flat list
(no nested reply tree).

## Post object

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

## Comment object (flat list)

```json
{
  "id": "def456",
  "fullname": "t1_def456",
  "subreddit": "python",
  "author": "...",
  "score": 10,
  "created_utc": 1737060100,
  "created_iso": "2026-01-16T12:01:40.000Z",
  "depth": 0,
  "parent_id": "t1_...",
  "link_id": "t3_abc123",
  "permalink": "https://www.reddit.com/r/python/comments/abc123/.../def456/",
  "body_snippet": "..."
}
```
