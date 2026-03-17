---
root: plan/root.md
children:
  - plan/1-card-engine.md
  - plan/2-wrapper.md
  - plan/3-orchestrator.md
  - plan/4-cli.md
  - plan/5-git-watch.md
---
# 0 PLANAR [DONE]

## Description
Root plan for PLANAR — Plan-Level Adaptive Narrowing And Refinement.
A task decomposer that uses the Ralph Wiggum pattern to iteratively invoke
Claude Code CLI, letting the LLM do all the heavy thinking while the wrapper
just keeps feeding it the next card file.

## Acceptance Criteria
- @../README.md fully implemented.
- All child domains are well-bounded with minimal cross-domain dependencies
- The system can decompose a root plan into actionable cards and execute them
- Cards use YAML frontmatter for structural metadata and `@`-file references for Claude Code
- Full test coverage with dependency injection for all I/O boundaries
