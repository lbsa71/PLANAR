---
parent: plan/root.md
root: plan/root.md
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
