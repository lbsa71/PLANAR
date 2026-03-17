---
parent: plan/root.md
root: plan/root.md
children:
  - plan/2.1-ralph-wiggum-loop.md
  - plan/2.2-system-prompt.md
  - plan/2.3-termination.md
---
# 2 Wrapper [DONE]

## Description
The Ralph Wiggum loop — a thin wrapper that repeatedly invokes Claude Code CLI
with the system prompt and card file references until the card converges or a
termination condition is met. Intentionally dumb; all intelligence lives in the
LLM invocation.

See @README.md — "The Ralph Wiggum Pattern" section.

## Acceptance Criteria
- Iterates: read card → generate prompt → invoke claude → check diff → loop
- Four termination conditions: all DONE, convergence, max iterations, budget
- Rate limit (429) handling with retry
- Link integrity checked before and after each iteration
- Fresh context each invocation (no accumulated bias)
