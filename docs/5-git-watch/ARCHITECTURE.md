# 5-git-watch Architecture

## 5.1 Fetch, Detect & Pull — `src/git-ops.ts`

### Dependency Injection

All git subprocess calls are injected via a `GitRunner` interface:

```typescript
/** Runs a git command and returns stdout. Throws on non-zero exit. */
export interface GitRunner {
  run(args: string[]): Promise<string>;
}
```

This makes the module fully testable — tests inject a mock `GitRunner` that returns
canned output without touching a real repo.

### Return Type — Discriminated Union

The `fetchDetectPull` function returns one of three outcomes:

```typescript
export type FetchResult =
  | { status: "up-to-date" }
  | { status: "pulled"; diff: string; changedFiles: string[] }
  | { status: "diverged"; warning: string };
```

- **`up-to-date`** — HEAD matches the tracking branch; nothing to do.
- **`pulled`** — upstream had new commits; diff and changed file list captured
  *before* the pull, then `git pull --ff-only` succeeded.
- **`diverged`** — `git pull --ff-only` failed (non-fast-forward); warning
  message logged, cycle skipped.

### Core Function

```typescript
export async function fetchDetectPull(
  git: GitRunner,
  branch?: string
): Promise<FetchResult>;
```

#### Algorithm

1. **Resolve branch** — If `branch` is not provided, detect the current branch
   via `git rev-parse --abbrev-ref HEAD` and derive the tracking remote branch
   as `origin/<branch>`.

2. **Fetch** — `git fetch origin` to update remote refs.

3. **Compare** — `git rev-parse HEAD` vs `git rev-parse origin/<branch>`.
   If identical, return `{ status: "up-to-date" }`.

4. **Check fast-forward** — `git merge-base --is-ancestor HEAD origin/<branch>`.
   If HEAD is not an ancestor of the remote (exit code non-zero), return
   `{ status: "diverged", warning: "..." }`.

5. **Capture diff** — `git diff HEAD..origin/<branch>` for the full diff text.

6. **Capture changed files** — `git diff --name-only HEAD..origin/<branch>`
   split by newlines for the file list.

7. **Pull** — `git pull --ff-only`. On failure (unexpected, since we checked
   ancestry), return `{ status: "diverged", warning: "..." }`.

8. **Return** — `{ status: "pulled", diff, changedFiles }`.

### Error Handling

- `GitRunner.run()` throws on non-zero exit codes, *except* `merge-base --is-ancestor`
  where non-zero means "not an ancestor" (handled as diverged).
- The `fetchDetectPull` function catches `git pull --ff-only` failures and
  returns `diverged` rather than throwing.

### Test Strategy

Tests inject a `GitRunner` that records calls and returns scripted responses:

| Scenario | Mock behavior |
|---|---|
| Up-to-date | `rev-parse HEAD` and `rev-parse origin/main` return same SHA |
| Pulled successfully | Different SHAs, merge-base succeeds, diff returns content, pull succeeds |
| Diverged | Different SHAs, merge-base fails (not ancestor) |
| Pull failure | merge-base succeeds but pull throws (race condition) |
| Branch detection | No explicit branch, `rev-parse --abbrev-ref HEAD` returns "feature-x" |

### File Manifest

- `src/git-ops.ts` — the module itself
- `src/git-ops.test.ts` — unit tests
- `src/types.ts` — `GitRunner`, `FetchResult` type exports (added to shared types)
- `src/cli.ts` — watch command wiring (consumer)

## 5.3 Card Invalidation — `src/invalidation.ts`

### Overview

Card invalidation is the final step of the git watch cycle. After `findAffectedCards` (5.2) identifies which cards have file manifest overlap with upstream changes, this module performs the actual card file modifications — regressing affected cards and appending explanatory notes.

### Interface

```typescript
// src/invalidation.ts

export interface InvalidationResult {
  /** Card file path */
  filePath: string;
  /** Card dot-path */
  dotPath: string;
  /** Status before invalidation */
  previousStatus: CardStatus;
  /** Status after invalidation */
  newStatus: CardStatus;
  /** Whether the card was actually modified */
  modified: boolean;
  /** Reason for skip (if not modified) */
  skipReason?: string;
}

/**
 * Regress affected cards to the appropriate phase based on their current status.
 *
 * Rules:
 * - PLAN: left alone (planning hasn't committed to anything)
 * - ARCHITECT, IMPLEMENT, REVIEW: regressed to PLAN
 * - DONE: regressed to REVIEW (implementation may still be valid)
 * - Special statuses (BLOCKED-BY, CONFLICTS-WITH, INACTIONABLE): left alone
 *
 * Every regression appends a content note satisfying Challenge rules.
 */
export function invalidateCards(
  affectedCards: Card[],
  changedFiles: string[],
  injectedFs?: FileSystem
): InvalidationResult[];
```

### Regression Table

| Current Status | Target Status | Rationale |
|---|---|---|
| `PLAN` | _(no change)_ | Planning hasn't committed to file-level assumptions |
| `ARCHITECT` | `PLAN` | Architecture decisions may be based on stale code |
| `IMPLEMENT` | `PLAN` | Implementation in progress may conflict with upstream |
| `REVIEW` | `PLAN` | Review criteria may no longer apply |
| `DONE` | `REVIEW` | Implementation exists but needs re-verification |
| Special statuses | _(no change)_ | Already blocked/conflicted; leave for orchestrator |

### Content Change (Challenge Rule Compliance)

Every regression appends a blockquote note to the card's Description section:

```markdown
> **Upstream change detected:** Files `src/foo.ts`, `src/bar.ts` were modified
> in upstream commits. Re-evaluate this card's assumptions.
```

This satisfies the Challenge rules (regression + content change), preventing the next iteration from blindly re-advancing.

### Algorithm

```
for each affected card:
  1. Read card content from disk via injectedFs
  2. Parse card to get current status
  3. Determine target status per regression table
  4. If no regression needed → skip, record skipReason
  5. Update heading status via updateCardStatus()
  6. Append upstream change note after Description heading
  7. Write modified content back via injectedFs
  8. Record result
```

### Note Insertion

The note is inserted immediately after the `## Description` line's existing content,
before any subsequent `##` section. This uses a regex to find the Description section
and append the blockquote at its end.

### Integration Point

Called from the git watch loop after `findAffectedCards` (5.2):

```typescript
// In the watch loop:
const affected = findAffectedCards(changedFiles, planDir, fs);
const impactCard = createImpactCard(commitRange, changedFiles, affected, diffstat, planDir, fs);
const results = invalidateCards(affected, changedFiles, fs);
```

### Dependencies

- **card.ts**: `parseCard`, `updateCardStatus`, `isPhase` — read/parse/modify cards
- **types.ts**: `Card`, `CardStatus`, `LeafPhase`, `FileSystem`

### Test Strategy

Unit tests in `src/invalidation.test.ts` using injected `FileSystem`:

| Scenario | Expected |
|---|---|
| Card in PLAN | Not modified, skipReason recorded |
| Card in ARCHITECT | Regressed to PLAN, note appended |
| Card in IMPLEMENT | Regressed to PLAN, note appended |
| Card in REVIEW | Regressed to PLAN, note appended |
| Card in DONE | Regressed to REVIEW, note appended |
| Card with special status (BLOCKED-BY) | Not modified, skipReason recorded |
| Multiple affected cards | Each processed independently |
| Note content | Contains changed file names |

### File Manifest

- `src/invalidation.ts` — the module itself
- `src/invalidation.test.ts` — unit tests
- `src/card.ts` — uses `parseCard`, `updateCardStatus`, `isPhase`
- `src/types.ts` — uses `Card`, `CardStatus`, `LeafPhase`, `FileSystem`
