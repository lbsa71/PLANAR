---
parent: plan/root.md
root: plan/root.md
children:
  - plan/6.1-revision-history.md
  - plan/6.2-integrity-checker.md
  - plan/6.3-integrity-cli.md
last-integrity-check: 2026-03-18T19:45:36.629Z
---
# 6 Integrity & Revision History [DONE]
## Description
Reverse-review mechanism: tree integrity checks, codebase compliance scanning,
and per-card revision history. Ensures the plan tree stays structurally sound
and that what cards claim to implement actually exists in the codebase.

## Acceptance Criteria
- Every card has a `last-integrity-check` frontmatter timestamp after running `planar integrity`
- Every card has a `## Revision History` section updated whenever its status changes
- `planar integrity` reports structural issues (broken links, status inconsistencies)
- `planar integrity` reports codebase compliance issues (missing manifest files, unowned source files)
- `--regress` flag on `planar integrity` regresses DONE cards with issues to PLAN/REVIEW
- `planar orchestrate --integrity-interval <secs>` runs periodic integrity checks during orchestration
- Orchestrator adds revision entries when it programmatically changes card status

## Revision History
- 2026-03-18T19:47:09.152Z: status PLAN → DONE
- 2026-03-18T19:47:00.000Z: advanced to DONE — decomposition complete; 6.1 (primitives), 6.2 (checker engine), 6.3 (CLI+orchestrator) fully cover all acceptance criteria
- 2026-03-18T19:45:36.629Z: regressed to PLAN by integrity-check
- 2026-03-18T19:45:36.629Z: integrity-check — 1 issue(s): status-inconsistency
- 2026-03-18T19:40:15.347Z: status PLAN → DONE
- 2026-03-18T19:39:43.686Z: advanced to DONE — decomposition complete; 6.1 (primitives), 6.2 (engine), 6.3 (CLI+orchestrator) cover all acceptance criteria
- 2026-03-18T19:39:43.686Z: integrity-check passed
- 2026-03-18T19:25:29.296Z: integrity-check passed
- 2026-03-18T19:24:28.141Z: integrity-check passed
