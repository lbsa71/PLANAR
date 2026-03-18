# Domain 6 — Integrity: Revision History & Frontmatter Stamping

## Overview

Card 6.1 provides two low-level primitives that allow the integrity checker and
orchestrator to maintain audit trails directly inside card files.

---

## Contracts

### `updateFrontmatterKey(content, key, value): string`

Upserts a scalar YAML key inside the frontmatter block.

- **Input**: raw card content, YAML key name, string value
- **Output**: updated content with key upserted
- **Behaviour**:
  - If no frontmatter block (`---…---`) exists, prepends a minimal one
  - If the key already exists, replaces the value in-place
  - If the key is absent, appends it to the end of the existing frontmatter
- **Side effects**: none (pure string transformation)

### `appendRevisionEntry(content, entry): string`

Prepends a bullet to the `## Revision History` section (newest-first ordering).

- **Input**: raw card content, entry string (caller supplies full text including
  timestamp)
- **Output**: updated content with `- <entry>` inserted immediately after the
  `## Revision History` heading
- **Behaviour**:
  - If the section is absent, creates it at the end of the document
  - Preserves all existing entries unchanged
- **Side effects**: none (pure string transformation)

---

## Type Additions (`src/types.ts`)

| Symbol | Purpose |
|--------|---------|
| `IssueKind` | Discriminated string union for all integrity issue categories |
| `SuggestedAction` | Recommended remediation action for an issue |
| `IntegrityIssue` | Per-card issue record (dotPath, filePath, kind, message, suggestedAction) |
| `ComplianceIssue` | Cross-cutting issue (e.g. source file with no owning card) |
| `IntegrityReport` | Top-level report envelope (timestamp, arrays, counters) |
| `OrchestratorConfig.integrityIntervalSeconds` | Seconds between automated integrity checks (0 = disabled) |

### `Card.lastIntegrityCheck`

Populated from the `last-integrity-check` YAML frontmatter key by `parseCard`.
Type: `string | undefined` (ISO 8601 timestamp).

---

## Data Flow

```
integrity-checker
  ├─ reads card files
  ├─ calls updateFrontmatterKey(content, "last-integrity-check", now)
  ├─ calls appendRevisionEntry(content, "integrity-check — N issue(s): …")
  └─ writes updated content back to disk

orchestrator
  └─ calls appendRevisionEntry(content, "status PLAN → ARCHITECT")
```

---

## Testability

Both functions are pure string-in/string-out transformers with no I/O
dependencies. Unit tests need only pass raw markdown strings and assert on
the returned string.

Suggested test cases:
- `updateFrontmatterKey`: no frontmatter, key absent, key present, multi-key FM
- `appendRevisionEntry`: section absent, section empty, section with existing entries
- `Card.lastIntegrityCheck`: key present in FM, key absent, malformed value

---

## 6.2 Integrity Checker — `src/integrity.ts`

### Purpose

Runs two categories of checks against the full set of discovered cards:

1. **Structural checks** — tree consistency (links, back-references, status)
2. **Codebase compliance** — verifiable claims about the file system

### Public API

```typescript
checkTreeIntegrity(
  cards: Card[],
  cwd: string,
  options: {
    scanSourceDir?: string;                      // flag unowned src files
    fs?: { existsSync(p: string): boolean };    // injectable for tests
  }
): IntegrityReport

applyIntegrityResults(
  report: IntegrityReport,
  cards: Card[],
  options: { regressProblematic: boolean },
  injectedFs: FileSystem
): { updated: number; regressed: string[] }

formatIntegrityReport(report: IntegrityReport): string
```

### Structural Checks

| Check | Trigger | suggestedAction |
|---|---|---|
| `broken-parent-link` | `card.refs.parent` not found in card set | `flag-only` |
| `parent-not-in-children` | Parent exists but doesn't list this card | `flag-only` |
| `broken-child-link` | Child ref not found in card set | `regress-to-plan` |
| `child-missing-parent-ref` | Child doesn't point back to this card | `flag-only` |
| `status-inconsistency` | DONE node with non-DONE child | `regress-to-plan` |

### Codebase Compliance Checks

| Check | Trigger | suggestedAction |
|---|---|---|
| `missing-manifest-file` | `fs.existsSync` false for manifest entry | `regress-to-review` (if DONE), else `flag-only` |
| `duplicate-file-ownership` | Two or more cards claim the same file | `flag-only` |
| `unowned-source-file` | File under `scanSourceDir` not in any manifest | `complianceIssues` (no card to flag) |

### walkDir

Recursive directory scan returning paths relative to `base`.
Skips: entries starting with `.`, `node_modules`, `dist`, `__pycache__`.

### applyIntegrityResults Write-back Protocol

For every card:
1. Stamp `last-integrity-check` frontmatter key with ISO timestamp
2. Prepend revision entry: `integrity-check — N issue(s): kind1, kind2` (or `passed`)
3. If `regressProblematic: true` and card is DONE:
   - `regress-to-plan` if any issue recommends it (wins over regress-to-review)
   - `regress-to-review` otherwise if any issue recommends it

### Dependency Injection

File-existence checks use injected `options.fs?.existsSync ?? nodefs.existsSync`.
Write-back uses the `FileSystem` interface (`readFileSync`, `writeFileSync`, `existsSync`).

### Test Coverage — `src/integrity.test.ts`

- Parent/child link symmetry (broken refs, missing back-refs)
- Status-inconsistency (DONE node, non-DONE child)
- Missing manifest file via injected `fs` returning `false`
- Duplicate file ownership across two cards
- Unowned source files via `scanSourceDir`
- `applyIntegrityResults`: timestamps stamped, revision entry written, DONE cards regressed
- `applyIntegrityResults`: no regression when `regressProblematic: false`
- `formatIntegrityReport`: clean report, report with issues, report with compliance issues

---

## 6.3 CLI & Orchestrator Integration

### CLI — `planar integrity [plan-dir]`

**Entry Point**: `src/cli.ts` — `case "integrity":` branch.

**Flow**:
```
planar integrity [plan-dir] [--regress] [--no-scan-src] [--src-dir <dir>]
    │
    ▼
discoverCards(dir)
    │
    ▼
checkTreeIntegrity(cards, cwd, { scanSourceDir?: srcDir })
    │
    ▼
formatIntegrityReport(report)  →  stdout
    │
    ▼
applyIntegrityResults(report, cards, { regressProblematic }, nodeFs)
    — stamps last-integrity-check frontmatter key
    — prepends revision history entry on every card
    — optionally regresses DONE cards with issues to PLAN/REVIEW
```

**CLI Flags**:
| Flag | Wired as |
|------|----------|
| `--regress` | `regressProblematic: true` |
| `--no-scan-src` | `scanSourceDir: undefined` |
| `--src-dir <dir>` | `scanSourceDir: dir` (default `src`) |

All flags are declared in `parseArgs` and documented in `printUsage`.

---

### Orchestrator — Periodic Automated Checks

**Configuration**: `OrchestratorConfig.integrityIntervalSeconds` (default `0`).
Set via `planar orchestrate --integrity-interval <secs>`.

**Trigger**: `maybeRunIntegrityCheck(cards)` is called every orchestration cycle.
- Skips if `intervalMs <= 0` or if `elapsed < intervalMs` since last check.
- Always passes `regressProblematic: true` — no user flag needed.
- Logs summary to dashboard after each run.

**Revision History on Status Changes** — three write sites:

| Method | Trigger | Entry content |
|--------|---------|---------------|
| `reapAgent` | Agent finishes and card status changed | `status A → B` |
| `propagateConflicts` | CONFLICTS-WITH marker propagated to target | `CONFLICTS-WITH X propagated by orchestrator` |
| `regressCommonParent` | Common parent of two conflicting cards regressed | `regressed to PLAN — conflict between X and Y` |

All sites use `appendRevisionEntry` from `src/card.ts`.

---

### Dependencies

```
src/cli.ts
  └─ src/integrity.ts  (checkTreeIntegrity, applyIntegrityResults, formatIntegrityReport)
  └─ src/card.ts       (discoverCards)

src/orchestrator.ts
  └─ src/integrity.ts  (checkTreeIntegrity, applyIntegrityResults, formatIntegrityReport)
  └─ src/card.ts       (appendRevisionEntry)
```

### Testing Strategy

- Unit-test `maybeRunIntegrityCheck` with a mock `FileSystem` and injected config
- Verify `reapAgent` writes revision entry only when status changes
- Verify `propagateConflicts` and `regressCommonParent` write correct entries
- Integration-test the CLI `integrity` command with a temporary plan directory
