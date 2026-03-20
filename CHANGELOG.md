# Changelog

All notable changes to this project will be documented in this file.

The format is intentionally simple and optimized for release notes and repository readers.

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
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target codex --ref v1.0.0
```
