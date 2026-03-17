---
parent: plan/root.md
root: plan/root.md
children:
  - plan/5.1-fetch-detect-pull.md
  - plan/5.2-impact-analysis.md
  - plan/5.3-card-invalidation.md
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
