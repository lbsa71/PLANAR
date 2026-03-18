---
parent: plan/root.md
root: plan/root.md
children:
  - plan/5.1-fetch-detect-pull.md
  - plan/5.2-impact-analysis.md
  - plan/5.3-card-invalidation.md
last-integrity-check: 2026-03-18T19:45:36.629Z
---
# 5 Git Watch Mode [DONE]

## Description
Background loop that monitors the upstream git branch for changes, creates
impact cards documenting what changed, and invalidates affected cards by
regressing them to the appropriate phase.

See @README.md — "Git Watch Mode" section for full spec.

## Acceptance Criteria
- Polls upstream at configurable interval (default 30s)
- Detects when local branch is behind remote
- Fast-forward only — logs warning and skips on diverged history
- Creates impact cards with commit range, changed files, affected cards
- Invalidates affected cards based on file manifest overlap
- Coordinates with orchestrator through filesystem (no in-process messaging)

## Revision History
- 2026-03-18T19:45:36.629Z: integrity-check passed
- 2026-03-18T19:39:43.686Z: integrity-check passed
- 2026-03-18T19:25:29.296Z: integrity-check passed
- 2026-03-18T19:24:28.141Z: integrity-check passed
