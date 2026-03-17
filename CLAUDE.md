# PLANAR — Plan-Level Adaptive Narrowing And Refinement

## What Is This?

A task decomposer that uses the **Ralph Wiggum pattern** — a thin wrapper that repeatedly invokes Claude Code CLI, letting the LLM do all the heavy thinking while the wrapper just keeps feeding it the next card file.

## Quick Start

```bash
npm install
npm run build
npm start -- plan/root.md          # run the decomposition loop on a root plan
npm start -- plan/2.1-parser.md    # run on a specific card
```

## Key Concepts

- **Cards** are markdown files in `plan/` with YAML frontmatter — the atomic unit of work
- **Nodes** have `children:` in frontmatter, **Leaves** do not
- Leaves progress: `PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE`
- Nodes progress: `PLAN → DONE`
- One card = one file = one agent at a time
- Dot-paths (e.g. `2.3.1`) map deterministically to session GUIDs
- `@path/file` is Claude Code's file-reference syntax — card links live in YAML frontmatter

## Project Structure

```
plan/           ← card files (system of record)
docs/           ← generated architecture docs per domain
src/            ← TypeScript implementation
  card.ts       ← card parsing (YAML frontmatter + markdown)
  guid.ts       ← dot-path ↔ GUID conversion
  orchestrator.ts ← agent pool management
  wrapper.ts    ← the Ralph Wiggum loop (invoke claude-code)
  system-prompt.ts ← system prompt generation for each phase
  types.ts      ← shared type definitions
  cli.ts        ← CLI entry point
```

## Development

```bash
npm test              # run tests
npm run build         # compile TypeScript
npm run lint          # lint
```

## Architecture Rules

- The wrapper is intentionally dumb — all intelligence lives in the LLM invocation
- One operation per iteration, fresh context each time
- Cards own their file; agents must not modify cards outside their dot-path
- Broken card links are bugs — always verify link integrity
- Read the file manifest before writing anything
- Errors discovered during iteration become new cards, not silent fixes

## CLI

```bash
planar <card-file>              # run single card loop
planar orchestrate <root-file>  # run full orchestration with parallel agents
planar status <plan-dir>        # show status of all cards
planar watch [plan-dir]         # git watch mode
planar --cwd /path <command>    # run in a specific working directory
```
