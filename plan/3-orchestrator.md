---
parent: plan/root.md
root: plan/root.md
children:
  - plan/3.1-agent-spawning.md
  - plan/3.2-conflict-propagation.md
  - plan/3.3-top-down-enforcement.md
---
# 3 Orchestrator [DONE]

## Description
Manages the pool of parallel agents. Spawns agents for eligible cards, enforces
top-down resolution order, respects blocked-by dependencies, propagates conflict
markers, and reaps finished sessions.

See @README.md — "Orchestrator" and "Parallel Execution & Session Model" sections.

## Acceptance Criteria
- Spawns agents for resolved, unblocked, non-DONE cards
- Limits parallel agents to configurable maximum
- Top-down wavefront: no children spawned under nodes still in PLAN
- Conflict propagation: mirrors CONFLICTS-WITH, regresses common parent
- Stale cycle detection: exits after 3 cycles with no eligible cards
- ProcessSpawner injected for testability
