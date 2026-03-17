# PLANAR

**Plan-Level Adaptive Narrowing And Refinement**

A best-in-class task decomposer that uses a Ralph Wiggum pattern — a thin, cheerfully persistent wrapper that repeatedly invokes Claude Code CLI (`--dangerously-skip-permissions`) in iterative loops, letting the LLM do all the heavy thinking while the wrapper just keeps feeding it the next plan file.

## Core Concept

PLANAR takes a high-level task description (the **root plan**) and decomposes it into actionable sub-plans through successive iterations. Each iteration is a standalone Claude Code CLI invocation that receives:

1. A **system prompt** with the decomposition rules
2. The **current card file** and the **root plan** as `@`-file references (Claude Code's native file-reading syntax, e.g. `@plan/2.1-parser.md @plan/root.md`)
3. Instructions for what to do next

> **Note on `@` syntax:** Throughout this document, `@path/to/file` refers to **Claude Code file references** — the mechanism by which Claude Code reads a file into the conversation context. These are prompt-level constructs, not card metadata. Card metadata (parent, children, dependencies) lives in **YAML frontmatter**.

The wrapper doesn't reason. It doesn't decide. It just keeps calling Claude Code with the card file until the work is done. That's the Ralph Wiggum pattern — "I'm helping!"

## Cards

Every plan item is its own file — a **card**. An agent works on exactly one card at a time. Cards are the atomic unit of work, ownership, and concurrency.

A card is either a **node** or a **leaf**, determined solely by whether it has children:

- **Nodes** (have `children:` in frontmatter) — structural. A node is about *decomposition*, not implementation. It is `[DONE]` when it has the right children with the right boundaries, regardless of the children's own status.
- **Leaves** (no `children:`) — work items. Leaves go through the full phase lifecycle (`PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE`). These are where actual architecture and implementation happen.

This distinction is **fluid**. A leaf becomes a node the moment you **Hierarchize** it (add children). A node becomes a leaf when you **Collapse** it (remove children). The card file itself doesn't declare "I am a node" — it simply has or doesn't have `children:` in its frontmatter, and the rules follow from that.

### Card Structure

A card file uses **YAML frontmatter** for structural metadata and standard markdown for content:

```markdown
---
parent: plan/2-core-engine.md
root: plan/root.md
children:
  - plan/2.1.1-tokenizer.md
  - plan/2.1.2-ast-builder.md
blocked-by:
  - plan/1.2-build-system.md
---
# 2.1 Plan Parser [PLAN]

## Description
Parse plan files into an in-memory tree structure.

## File Manifest
Files of interest (not ownership — multiple cards may reference the same file):
- src/parser/index.ts
- src/parser/types.ts
- src/parser/tokenizer.ts

## Acceptance Criteria
- Parses nested dot-path items
- Validates card links
- Returns structured tree
```

The frontmatter fields are:

| Field | Description |
|---|---|
| `parent` | Path to the parent card |
| `root` | Path to the root plan card |
| `children` | List of child card paths (presence makes the card a **node**) |
| `blocked-by` | List of card paths that must reach `[DONE]` before this card can proceed |

These are **card links** — structural metadata parsed by PLANAR. They are distinct from `@`-file references, which are Claude Code's syntax for reading files into conversation context. When the wrapper invokes Claude Code, it passes `@plan/2.1-parser.md @plan/root.md` as prompt-level file references so Claude can read the card contents.

### Link Integrity

All parent/child relationships and dependencies are documented in each card's frontmatter. Every iteration must verify that all card links are correct and complete. Broken links are bugs.

### File Manifest

Each card maintains a **file manifest** listing all source files of interest to that item. The manifest grows as iterations discover new relevant files. It serves as the institutional memory for "read before you write" — each fresh-context invocation reads the manifest instead of guessing what's relevant.

**The manifest is not an ownership claim.** Multiple cards may list the same file. Overlap in manifests is expected and is not by itself a problem — it becomes a signal for the agent to check whether its changes are compatible with sibling cards that share interest in the same files.

## Phase Progression

Each **leaf** card progresses through a fixed sequence of phases. The phase determines what an iteration is allowed to do with that card. Each phase does the work *and* advances the status in a single iteration.

```
PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE
```

| Phase | What happens | Allowed output |
|---|---|---|
| `[PLAN]` | Decompose: split, hierarchize, annotate, move, reorder, prune | Edit card, create child cards |
| `[ARCHITECT]` | Design: define interfaces, update ARCHITECTURE.md, populate file manifest | Edit card, edit docs |
| `[IMPLEMENT]` | Implement per the architecture, following the implementation discipline (see below) | Edit card, write source |
| `[REVIEW]` | Verify: check implementation against acceptance criteria | Edit card |
| `[DONE]` | Complete and verified | — |

The system prompt tells the agent: *"If status is `[PLAN]`, do the planning work and advance to `[ARCHITECT]`. If `[ARCHITECT]`, do the architecture work and advance to `[IMPLEMENT]`."* And so on. One iteration, one phase of real work, one transition.

For **node** cards (cards with `children:` in frontmatter), the lifecycle is simpler:

```
PLAN → DONE
```

A structural card is `[DONE]` when its children are correctly defined and properly bounded. It does not wait for children to complete.

### Implementation Discipline

When a leaf card enters `[IMPLEMENT]`, the agent follows a strict process:

1. **Identify the smallest valuable increment.** Don't implement the whole card in one pass. Find the thinnest slice that delivers value or proves a concept, implement that, and advance. If there's more work, the card should have been decomposed further during `[PLAN]` — if it wasn't, regress to `[PLAN]` and split.

2. **Pre-refactor.** Before making the change, ask: *"Why isn't this an easy fix?"* If the existing code makes the change hard, refactor first to make it easy, then make the easy change. Two clean steps, not one messy one.

3. **Red/Green/Refactor.** Work in a TDD cycle (or the analogous concept for non-code deliverables):
   - **Red** — write a failing test that defines the expected behavior
   - **Green** — write the minimum code to make the test pass
   - **Refactor** — clean up while all tests stay green

This discipline applies whether the deliverable is code, configuration, documentation, or any other artifact. The principle is the same: define "done" first (the test), achieve it minimally (green), then clean up (refactor).

### Additional Statuses

- `[BLOCKED-BY <dot-path>]` — Cannot proceed until the referenced card reaches a required phase. The orchestrator will not spawn an agent for a blocked card.
- `[CONFLICTS-WITH <dot-path>]` — Set programmatically by the orchestrator (see Conflict Detection below). Signals that this card's work is in tension with another card and needs resolution from a higher-level card.
- `[INACTIONABLE]` — Cannot be acted on in the current context (deferred or permanently out of scope).

### Challenging a Status

Any status — including `[DONE]` — can be **regressed** to an earlier phase. But a challenge must satisfy two conditions:

1. **Regress the phase** — set the card back to the appropriate earlier phase (e.g., `[DONE]` → `[PLAN]` or `[DONE]` → `[REVIEW]`)
2. **Change the card content** — modify the description, acceptance criteria, or constraints to reflect *why* the regression is needed

Both conditions are mandatory. If you regress without changing content, the next iteration will simply re-advance to `[DONE]` because nothing looks different. The content change is what forces genuine re-assessment.

### Conflict Detection

When an agent writes a `[CONFLICTS-WITH <dot-path>]` marker into its own card, the **orchestrator** (not the agent) handles the cross-card coordination:

1. The orchestrator scans the card after the agent exits
2. If it finds `[CONFLICTS-WITH 2.3]`, it programmatically sets card `2.3` to `[CONFLICTS-WITH 2.1]`
3. Both cards are now frozen — the orchestrator will not spawn agents for either
4. The **parent card** (e.g., `2`) is regressed to `[PLAN]` with a note about the conflict, opening it up for re-decomposition
5. A higher-level iteration can then restructure the domain boundaries, update children, and resolve the tension

This keeps agents dumb (they only flag conflicts on their own card) while letting the orchestrator enforce the cross-card protocol mechanically.

## Iterative Decomposition

Start from the root plan and refine it through successive iterations. Each iteration performs **exactly one** of the following plan operations:

| Operation | Description |
|---|---|
| **Split** | Divide a card into two sibling cards at the same level |
| **Hierarchize** | Convert a flat card into a parent node and create child cards beneath it |
| **Move** | Relocate a card from one parent to another |
| **Aggregate** | Merge two related cards into one |
| **Collapse** | Flatten a parent card back into a single card when children are resolved |
| **Annotate** | Add clarifying detail, acceptance criteria, or context to a card |
| **Reorder** | Change the sequence of sibling cards to reflect dependency or priority |
| **Prune** | Remove a card that is redundant or out of scope |
| **Advance** | Do the work for the current phase and transition to the next |
| **Challenge** | Regress a card to an earlier phase (must include content change) |
| **Flag Conflict** | Mark own card as `[CONFLICTS-WITH]` to trigger orchestrator resolution |

### Read Before You Write

Every iteration must begin by reading the card's **file manifest** and all referenced files. Understand the codebase before proposing changes. If you discover a relevant file not in the manifest, add it.

Agents are expected to discover sibling cards by scanning `plan/` for files sharing their dot-path prefix (e.g., an agent working on `plan/2.1-plan-parser.md` should scan for `plan/2.*` to understand its siblings). The consistent naming convention in `plan/` makes sibling discovery mechanical.

### Error and Critique Handling

If an iteration discovers an error, omission, or questionable choice — don't fix it silently. Instead, **add a new card** that outlines the error and the critique, then **exit the iteration**. This ensures nothing gets swept under the rug and every concern is tracked as a first-class card.

## Parallel Execution & Session Model

PLANAR can launch **unlimited parallel agents**, each working on its own card without stepping on each other's feet.

### One Card, One File, One Agent

- Every plan item is a separate file in `plan/`
- An agent works on **exactly one card file** per iteration
- An agent must **never** work on a card that is beneath another card with an active session
- This eliminates write contention: no two agents ever touch the same plan file

### Dot-Path as Session GUID

Every card has a natural dot-path address (e.g., `2.3.1` means root item 2, child 3, grandchild 1). The dot-path is encoded into a deterministic **GUID** that serves as the session ID — each path segment maps to a two-byte hex pair, zero-padded into the standard GUID layout:

```
Dot-path → GUID mapping:

1       → 01000000-0000-0000-0000-000000000000
1.1     → 01010000-0000-0000-0000-000000000000
1.2     → 01020000-0000-0000-0000-000000000000
2.1     → 02010000-0000-0000-0000-000000000000
2.3.1   → 02030100-0000-0000-0000-000000000000
3.1.4.1 → 03010401-0000-0000-0000-000000000000
```

This gives you human-readable GUIDs (you can eyeball `02030100...` and know it's card `2.3.1`) while still being valid session identifiers that work with `claude-code --session-id`.

### Top-Down Resolution

Agents can only be spawned on **resolved nodes** — a node is resolved when its own decomposition is complete and its children are well-defined. You cannot launch parallel agents under a node that is still being split or reorganized. This enforces a top-down wavefront: the plan granularizes from the root downward, and parallelism only opens up once a level has stabilized.

### Domain Isolation

Hierarchical nodes should represent **domains** — bounded areas of concern that are optimally isolated from each other. When decomposing, prefer splits that minimize cross-domain dependencies. A good hierarchy is one where sibling nodes can be worked on in parallel with little or no file overlap. If two nodes keep touching the same files, that's a signal the domain boundaries are wrong and the plan should be restructured. Think Conway's Law in reverse — the plan structure should *drive* the code architecture toward clean domain boundaries.

### Orchestrator

The orchestrator manages the pool of active agents. It can:

- **List sessions** — see which dot-paths currently have an active agent
- **Spawn agents** — launch a new Claude Code invocation for any resolved, unblocked, non-`[DONE]` leaf card
- **Enforce top-down order** — refuse to spawn agents under nodes still being decomposed
- **Respect blocks** — do not spawn an agent for a `[BLOCKED-BY]` card until the dependency is satisfied
- **Propagate conflicts** — after an agent exits, scan for `[CONFLICTS-WITH]` and mirror the status to the referenced card, then regress the common parent
- **Reap finished sessions** — when an agent advances its card, reclaim the slot and look for the next available card

### Isolation Rules

- An agent **owns** its card file and only its card file
- Agents must not modify cards outside their own dot-path
- During `[ARCHITECT]` phase, agents write to `docs/` within their domain
- During `[IMPLEMENT]` phase, agents write to `src/` within their domain
- During `[PLAN]` and `[REVIEW]` phases, agents only read source and write plan cards

## The Ralph Wiggum Pattern

```
┌─────────────────────────────┐
│        Wrapper Loop         │
│  "I'm helping!"             │
│                             │
│  while not done:            │
│    claude-code \            │
│      --dangerously-skip \   │
│      --print \              │
│      --system-prompt "..." \│
│      @card-file.md          │
│      @root-plan.md          │
│      "do the next thing"    │
│                             │
└─────────────────────────────┘
```

The wrapper is intentionally minimal. It:
- Picks up the current card file
- Invokes Claude Code with the system prompt and references
- Writes back whatever Claude Code returns
- Loops

All intelligence lives in the LLM invocation. The wrapper is just a delivery mechanism.

### Why Burn Tokens?

The one-operation-per-iteration constraint is deliberate. Each invocation gets a **fresh context** — no accumulated bias, no sunk-cost attachment to earlier decisions, no context window slowly filling with stale reasoning. Every iteration is a new pair of eyes on the plan. This is the core value proposition of the Ralph Wiggum pattern: you trade token cost for independence of perspective. A single long session drifts. A hundred short sessions converge.

### Termination

The wrapper needs to know when to stop. An iteration exits the loop when **any** of the following conditions are met:

- **All cards are `[DONE]`** — the plan is fully resolved
- **No operation was performed** — the LLM reviewed the card and found nothing to change (stable state)
- **Max iterations reached** — a configurable safety cap to prevent runaway loops
- **Budget exhausted** — token or cost limit hit

The LLM signals "no operation" by returning the card file unchanged. The wrapper diffs the before/after — if identical, the card has converged and the loop ends.

### Debug Logging

All process errors, invocation failures, and operational events are captured in `debug.log` at the working directory root. The log file is capped at **200 lines** (most recent kept) to prevent unbounded growth.

The debug log captures:
- **Process spawn/exit events** — which agent was spawned, exit codes
- **Full error context on failure** — command, args, error message, error code (e.g. `ENOENT`), error path, last 500 chars of stdout/stderr
- **Rate limit events** — 429 responses and retry timing
- **Cost tracking** — per-iteration cost from Claude Code JSON output

Console output stays terse (one-line summaries). The debug log gets the full story. When something goes wrong, `debug.log` is the first place to look.

## Project Structure

PLANAR expects `plan/` and `src/` at the **repository root**:

```
repo/
├── plan/           ← card files live here (the system of record)
│   ├── root.md
│   ├── 1-project-structure.md
│   ├── 1.1-directory-layout.md
│   ├── 2-core-engine.md
│   ├── 2.1-plan-parser.md
│   └── ...
├── docs/           ← generated and maintained documentation
│   ├── 1-project-structure/
│   │   ├── README.md
│   │   └── ARCHITECTURE.md
│   ├── 2-core-engine/
│   │   ├── README.md
│   │   └── ARCHITECTURE.md
│   └── ...
├── src/            ← implementation code
├── README.md
└── CLAUDE.md
```

Card file naming follows the dot-path convention (`{dot-path}-{slug}.md`), making sibling discovery trivial — an agent can glob `plan/2.*` to find all cards in its domain.

Phases are **per-card**, not global. Card `1.1` can be in `[IMPLEMENT]` while card `3.2` is still in `[PLAN]`. There is no waterfall — the plan decomposes top-down and each leaf progresses through its own lifecycle independently.

### Standard Artifacts

Every hierarchical node that represents a domain must establish and maintain standard artifacts in its `docs/` subdirectory:

- **`README.md`** — what this domain is, its boundaries, and how it relates to sibling domains
- **`ARCHITECTURE.md`** — key design decisions, component relationships, and interface contracts

These artifacts are created during the `[ARCHITECT]` phase and are **living documents** — updated by any iteration that touches the domain. They serve as the institutional memory that survives across the fresh-context invocations of the Ralph Wiggum pattern.

## Working Directory

PLANAR operates on a **target project directory** — the repo where the actual work happens. This is distinct from PLANAR's own installation directory. The target directory is where `plan/`, `docs/`, and `src/` live.

```bash
planar --cwd /path/to/my-project plan/root.md       # explicit target
planar plan/root.md                                   # defaults to cwd
```

The `--cwd` flag sets the working directory for the entire PLANAR session. All card paths, file manifests, and Claude Code invocations resolve relative to this directory. If omitted, PLANAR uses the current working directory.

This means PLANAR can be installed globally (or in its own repo) and pointed at any project:

```bash
# PLANAR lives in ~/tools/planar, but operates on ~/work/my-app
cd ~/work/my-app
planar orchestrate plan/root.md

# Or equivalently:
planar --cwd ~/work/my-app orchestrate plan/root.md
```

The target directory must contain at least a `plan/` directory with a root card. PLANAR will create `docs/` subdirectories as needed during `[ARCHITECT]` phases.

## Git Watch Mode

When PLANAR operates on a git repository with collaborators, external changes can land at any time — merges, force-pushes, CI-driven commits. If the plan doesn't react to these changes, cards drift out of sync with the codebase and agents make decisions based on stale assumptions.

**Git watch mode** solves this by running a background loop that monitors the upstream branch and feeds external changes back into the plan as first-class cards.

```bash
planar watch [plan-dir]                # watch the current branch
planar watch --interval 60 [plan-dir]  # poll every 60 seconds (default: 30s)
planar watch --branch main [plan-dir]  # watch a specific branch
```

### How It Works

```
┌──────────────────────────────────────┐
│          Git Watch Loop              │
│                                      │
│  every <interval>:                   │
│    git fetch origin                  │
│    if behind:                        │
│      diff = git diff HEAD..origin/X  │
│      git pull --ff-only              │
│      analyze diff                    │
│      create impact card              │
│      invalidate affected cards       │
│                                      │
└──────────────────────────────────────┘
```

1. **Fetch** — `git fetch origin` to check for upstream changes without modifying the working tree.

2. **Detect** — Compare `HEAD` against the tracking branch. If not behind, do nothing.

3. **Diff** — Capture the full diff (`git diff HEAD..origin/<branch>`) and the list of changed files before pulling.

4. **Pull** — `git pull --ff-only` to integrate. If fast-forward fails (diverged history), the watch logs a warning and skips — the human needs to resolve the merge.

5. **Analyze** — Cross-reference the changed files against every card's **file manifest**. Any card whose manifest overlaps with the diff is a candidate for invalidation.

6. **Create impact card** — Generate a new card (e.g., `plan/0.N-upstream-sync.md`) that documents:
   - The commit range that was pulled
   - The files that changed
   - Which existing cards are affected (by manifest overlap)
   - A summary of what changed (generated by diffstat, not by LLM — keep the watcher dumb)

7. **Invalidate** — For each affected card that is past `[PLAN]` phase:
   - If in `[ARCHITECT]` or later, regress to `[PLAN]` with a content note: *"Upstream changes in [files] may affect this card's assumptions. Re-evaluate."*
   - If `[DONE]`, regress to `[REVIEW]` — the implementation may still be valid, but it needs verification against the new code.
   - If in `[PLAN]`, leave it alone — planning hasn't committed to anything yet.

### Design Principles

- **The watcher is dumb.** It does not reason about whether changes are breaking. It mechanically matches changed files to manifests and creates cards. The LLM decides what to do about it during the next iteration.

- **Impact cards are first-class.** They enter the plan like any other card and go through the normal lifecycle. An agent will pick up the impact card, assess the damage, and either resolve it or decompose it further.

- **No silent invalidation.** Every regression includes a content change (the upstream diff summary), satisfying the Challenge rules. The agent seeing the regressed card knows *why* it was regressed and can make an informed decision.

- **Fast-forward only.** The watcher never resolves merge conflicts. If the local branch has diverged, it logs a warning and waits for human intervention. PLANAR agents should not be making merge decisions.

### Interaction with the Orchestrator

Git watch mode can run alongside the orchestrator. The orchestrator's normal cycle will pick up:
- Newly created impact cards (they start in `[PLAN]`)
- Regressed cards (they re-enter the eligible pool)

The watcher and orchestrator coordinate through the filesystem — the watcher writes cards, the orchestrator reads them. No direct communication needed. This is the same "dumb wrapper" philosophy: coordination happens through the card files, not through in-process messaging.

## Project Status

Early development. The plan is to eat our own dog food — PLANAR's own implementation will be decomposed and tracked using PLANAR.
