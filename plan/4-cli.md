---
parent: plan/root.md
root: plan/root.md
last-integrity-check: 2026-03-18T19:45:36.629Z
---
# 4 CLI [DONE]

## Description
Command-line interface providing run, orchestrate, status, and watch commands.
Supports --cwd for targeting a specific project directory.

See @README.md — "Working Directory" section.

## File Manifest
- src/cli.ts

## Acceptance Criteria
- `planar <card-file>` runs the wrapper loop on a single card
- `planar orchestrate <root-file>` runs full parallel orchestration
- `planar status [plan-dir]` shows card tree with statuses, blocked/conflict info, link integrity
- `planar watch [plan-dir]` is recognized (stubbed pending implementation)
- `--cwd <dir>` changes working directory before any other operation
- `--max-iterations`, `--max-agents`, `--max-cost`, `--plan-dir`, `--root` all configurable
- `--interval`, `--branch` flags accepted for watch mode
- `--help` prints usage
- Dot-path sorting in status output

## Revision History
- 2026-03-18T19:45:36.629Z: integrity-check — 1 issue(s): duplicate-file-ownership
- 2026-03-18T19:39:43.686Z: integrity-check — 1 issue(s): duplicate-file-ownership
- 2026-03-18T19:25:29.296Z: integrity-check — 1 issue(s): duplicate-file-ownership
- 2026-03-18T19:24:28.141Z: integrity-check — 1 issue(s): duplicate-file-ownership
