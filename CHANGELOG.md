# Changelog

All notable changes to this project will be documented in this file.

The format is intentionally simple and optimized for release notes and repository readers.

## [Unreleased]

### Added

- `reddit-readonly`: **Reddit RSS backend** — Reddit still serves its own Atom feeds to
  feed-reader user agents, giving real hot/new/top ranking plus all-Reddit search with
  zero configuration. (The earlier "RSS is blocked" finding was a user-agent problem,
  not a blocked endpoint.)
- `reddit-readonly`: **TikHub backend** (opt-in, needs `TIKHUB_API_KEY`, billed per
  request) — the only source providing ranking, scores and nested reply trees at once
- `reddit-readonly`: `doctor` subcommand — probes every backend for real and prints a
  capability/freshness matrix; unprobed backends are reported as `not_configured`,
  never counted as passing
- `reddit-readonly`: **freshness gate** — a backend answering HTTP 200 with long-stale
  data no longer passes silently; the router moves on, and degraded results carry a
  `warnings` entry
- `reddit-readonly`: response envelope now reports `backend_trail`, `freshness`,
  `warnings` and `cost.tikhub_requests`
- `reddit-readonly`: `--nested`, `--wantScore`, `--loose` and `--tikhub-max-pages` flags

### Changed

- `reddit-readonly`: backends are now **routed by capability** instead of a fixed
  failover chain — the live backends have non-overlapping strengths (real ranking /
  deep archive / scores + nesting), so the best first choice depends on the query
- `reddit-readonly`: multi-word searches are **phrase-matched by default**. Reddit ORs
  bare words, so an unquoted query such as `non slip bath mat` can also match posts
  that only mention "mat". Pass `--loose` for the old behaviour
- `reddit-readonly`: credentials are read only from the process environment and a `.env`
  next to the skill — no other files are touched

### Removed

- `reddit-readonly`: **PullPush backend** — its archive froze on 2025-05-19 and it now
  answers agents with `429 This website does not provide free scraping resources`.
  Arctic Shift covers the same range (2019 → today), so nothing was lost
- `reddit-readonly`: **Jina backend** — returns HTTP 200 wrapping Reddit's own block
  page, i.e. a false positive rather than a working fallback

### Fixed

- `reddit-readonly`: results are no longer silently served from a stale backend. The
  failover test was "did it throw?", so a backend returning 200 with 15-month-old rows
  counted as success — `search all` answered with 2025 posts and `thread` returned an
  empty comment list, both reported as `ok: true`
- `reddit-readonly`: transient transport failures (`fetch failed` / `ECONNRESET`, and
  Arctic Shift's `HTTP 422 "slow down"`) are now retried instead of marking a healthy
  backend dead. Measured availability went from ~65% to 100% over 10 consecutive runs
- `reddit-readonly`: TikHub searches are no longer re-ranked by date when the caller
  asked for relevance
- `reddit-readonly`: subreddit arguments accept a full URL, `r/name` or a bare name

## [v1.3.0] - 2026-07-29

### Added

- **5-backend failover chain for `reddit-readonly`** (was 2). New backends:
  - `reddit` — official Reddit OAuth API (app-only `client_credentials`, or password grant). Activates automatically when `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` are set and takes first priority: real `hot`/`rising`, live scores, nested comment tree (flattened with true depth).
  - `serpapi` — Google `site:reddit.com` search via SerpApi (`SERPAPI_API_KEY`). Only serves all-Reddit keyword search, filling the gap when PullPush is down (Arctic cannot search globally).
  - `jina` — r.jina.ai rendered-page parsing. Only serves subreddit post listings as an opportunistic last resort; fails cleanly when Reddit blocks Jina's IPs.
- `REDDIT_RO_BACKEND` now accepts `auto|reddit|pullpush|arctic|serpapi|jina`.

### Notes

- Probed and rejected as backends: Reddit RSS (403, same-domain block), redlib public instances (anti-bot JS walls), headless-Chrome rendering (reCAPTCHA interaction gate — not automatable).

## [v1.2.1] - 2026-07-29

### Added

- **Dual-source automatic failover for `reddit-readonly`.** PullPush.io remains the primary backend; when it is down or overloaded (e.g. Cloudflare 502) requests automatically fall back to **Arctic Shift** (`arctic-shift.photon-reddit.com`), another free, no-auth Pushshift successor. `data.source` in every response now reports which backend actually served.
- `REDDIT_RO_BACKEND=auto|pullpush|arctic` to force a backend (default `auto`).

### Notes

- Arctic Shift cannot search across all of Reddit (a subreddit is required), so `search all` only works while PullPush is up; score sorting on Arctic is approximated client-side over a recent window.

## [v1.2.0] - 2026-07-01

### Added

- **Optional HTML report output.** Daily/weekly reports can now be produced as `md` or `md+html`. On first use the skill asks the user which they want and writes the choice back to the task config (`reporting.report_output_formats`).
- Zero-dependency Markdown→HTML renderer at `skills/reddit-readonly/scripts/md_to_html.mjs`: self-contained single-file HTML, GFM tables, auto-linked bare Reddit permalinks, `P1/P2/P3` priority coloring, Chinese-friendly styling.
- `reporting.report_output_formats`, `reporting.ask_output_format_on_first_use`, and `reporting.html_renderer` config fields (plus the same in the task template); skills.md section 5B documents the behavior.

## [v1.1.0] - 2026-07-01

### Changed

- **`reddit-readonly` subskill now reads through PullPush.io instead of Reddit's anonymous `.json` endpoints.** Reddit deprecated those endpoints in May 2026 and datacenter IPs get HTTP 403; PullPush is a free, no-auth Pushshift successor, so the skill needs **no API key, OAuth, login, or bot account**. Every result still carries a real Reddit `permalink`.
- `posts` sort options are now `new` / `top` / `controversial`; `hot` and `rising` are not available from PullPush and fall back to recency.
- `comments` / `thread` now return a **flat comment list** (PullPush exposes no nested reply tree); `--depth` is removed.
- Repo owner references and install/raw URLs updated from `restart2000` to `WaytoAIC`.
- Bundled `reddit-readonly.zip` regenerated to match the updated subskill.

### Added

- `REDDIT_RO_BACKEND=reddit` escape hatch to force the legacy official-endpoint path (requires OAuth or a residential IP).
- Reusable `templates/README_PREFIX_WAYTOAIC.md` block for future Way to AIC GitHub repositories
- README "Data Backend" section documenting the PullPush switch, trade-offs, and compliance notes.

### Changed (prior, unreleased)

- Added the fixed `Way to AIC` brand and community prefix to the top of `README.md`

## [v1.0.0] - 2026-03-20

First public release.

### Added

- Bundled `reddit-readonly` as a nested subskill under `skills/reddit-readonly`
- One-task-one-config guidance in the main skill docs
- Starter config template at `templates/monitor_task_config.template.yaml`
- Table-first report templates for daily, weekly, and master summary outputs
- Bilingual `README.md`
- `install.sh` for one-command installation into Codex or OpenClaw skill directories
- Public repository metadata and source-available licensing docs

### Changed

- Main skill docs now explicitly guide users into config setup when they do not yet know how to define monitoring tasks
- Reporting guidance now prefers Markdown tables for signals, actions, archives, shortlist, and decision boards
- Installation guidance now supports both `main` and version-pinned installation flows

### Notes

- This repository is public and source-available, but not OSI-defined Open Source, because commercial use is restricted
- Recommended stable install path for this release:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target codex --ref v1.0.0
```
