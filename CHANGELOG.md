# Changelog

All notable changes to this project will be documented in this file.

The format is intentionally simple and optimized for release notes and repository readers.

## [Unreleased]

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
