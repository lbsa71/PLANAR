# Phase Lifecycle — Architecture

> Produced by card 7.4 (Design New Phase Lifecycle).
> Defines the complete phase lifecycle for leaf cards, ensuring every decision
> is captured before implementation begins and IMPLEMENT is purely mechanical.

## 1. Phase Sequence

```
PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE
```

The sequence is unchanged from the current system. The phases remain linear —
parallelism happens at the card level (multiple cards executing concurrently),
not at the phase level within a card.

What changes is the **rigor of entry/exit criteria** and **artifact
requirements** at each transition gate.

## 2. Phase Definitions

### 2.1 PLAN

| Property | Value |
|---|---|
| **Purpose** | Scope, decompose, and clarify the card |
| **Artifact sections produced** | None |
| **Card sections written** | Description, Acceptance Criteria, File Manifest (initial) |
| **Read permissions** | `plan/**`, `src/**` (read-only), `docs/**` (read-only) |
| **Write permissions** | `plan/<own-card>.md`, `plan/<new-child-cards>.md` |
| **Forbidden writes** | `src/**`, `docs/**` |

#### Entry Criteria
- Card file exists with a valid YAML frontmatter (parent, root links)
- Status is `[PLAN]`

#### Exit Criteria (gate to ARCHITECT)
1. Description is present and non-empty
2. At least one Acceptance Criterion exists
3. Each Acceptance Criterion is testable (contains a verifiable predicate, not vague language like "should be good")
4. If the card is too large for one implementation pass, it has been split (Hierarchize or sibling split)
5. `blocked-by` dependencies (if any) reference valid card paths

#### Allowed Operations
- Split into siblings
- Hierarchize into node with children
- Annotate with clearer acceptance criteria
- Reorder among siblings for dependency flow
- Add/refine Description

---

### 2.2 ARCHITECT

| Property | Value |
|---|---|
| **Purpose** | Capture every design decision and contract so IMPLEMENT is mechanical |
| **Artifact sections produced** | Decision, Contracts, Threshold Registry, Behavioral Spec (per "When Required" rules in artifact-taxonomy-ARCHITECTURE.md §2) |
| **Card sections written** | Decision, Contracts, Threshold Registry, inline Behavioral Spec in AC, File Manifest (finalized) |
| **Read permissions** | `plan/**`, `src/**` (read-only), `docs/**` |
| **Write permissions** | `docs/<own-domain>/**`, `plan/<own-card>.md` |
| **Forbidden writes** | `src/**`, `plan/<other-cards>.md` |

#### Entry Criteria
- All PLAN exit criteria are met
- Status is `[ARCHITECT]`

#### Exit Criteria (gate to IMPLEMENT)
1. **Decision completeness**: For every design choice implied by the Description (pattern, library, data structure, algorithm, technology), a Decision section exists with Options Considered, Choice, Rationale, and Consequences
2. **Contract completeness**: For every interface or API surface the card defines or modifies, a Contracts section exists with Preconditions, Postconditions, and Invariants
3. **Threshold completeness**: For every numeric constant the card introduces, a Threshold Registry row exists with Name, Value, Unit, Valid Range, Rationale, and Sensitivity
4. **Behavioral completeness**: For every multi-step flow or state transition, Behavioral Spec scenarios exist (inline or linked `.feature` file referenced in File Manifest)
5. **File Manifest is complete**: Every file to be created or modified during IMPLEMENT is listed
6. **Mechanical IMPLEMENT test** (informal self-check): Could a different agent, given only the card's Description + artifact sections + File Manifest, produce functionally identical code without asking questions? If not, more artifact sections are needed.

#### Structural Validation (automated gate)
The following are checkable without semantic understanding:
- If Description contains interface/API/type keywords → Contracts section must exist
- If Description contains choice/pattern/library/framework keywords → Decision section must exist
- If Description contains threshold/timeout/constant/default keywords → Threshold Registry must exist
- If Description contains flow/algorithm/sequence/state keywords → Behavioral Spec must exist (inline or linked)
- File Manifest has ≥1 entry

---

### 2.3 IMPLEMENT

| Property | Value |
|---|---|
| **Purpose** | Translate artifact sections into code — mechanically, with no design decisions |
| **Artifact sections produced** | None (consumed only) |
| **Card sections written** | File Manifest (additions if refactoring surfaces new files) |
| **Read permissions** | `plan/<own-card>.md`, `src/**`, `docs/<own-domain>/**` |
| **Write permissions** | `src/<own-domain>/**`, `plan/<own-card>.md` |
| **Forbidden writes** | `docs/**`, `plan/<other-cards>.md` |

#### Entry Criteria
- All ARCHITECT exit criteria are met
- Status is `[IMPLEMENT]`
- All `blocked-by` cards are `[DONE]`

#### Exit Criteria (gate to REVIEW)
1. Every file in the File Manifest has been created or modified
2. Every Contracts precondition has a corresponding guard (assertion, type check, or validation) in the implementation
3. Every Contracts postcondition has a corresponding test assertion
4. Every Contracts invariant holds across all test cases
5. Every Decision's chosen option is reflected in the implementation (no alternative pattern used)
6. Every Threshold Registry constant appears in code with the specified value and name
7. Every Behavioral Spec scenario (inline or linked) has a corresponding test that passes
8. No unregistered magic numbers exist in the implementation
9. All tests pass (`npm test` or equivalent)

#### The Mechanical IMPLEMENT Criterion
The IMPLEMENT phase is designed to be **purely mechanical**. The agent must not:
- Choose between design alternatives (→ regress to ARCHITECT, add Decision)
- Invent interface shapes (→ regress to ARCHITECT, add Contracts)
- Pick numeric constants (→ regress to ARCHITECT, add Threshold Registry)
- Decide behavior for unspecified edge cases (→ regress to ARCHITECT, add Behavioral Spec)

If the agent encounters ANY of these situations, it MUST regress the card to
`[ARCHITECT]` and update the card content to explain what was underspecified.
This is a **mandatory regression** — the agent cannot proceed by guessing.

#### Implementation Workflow
1. Read all artifact sections from the card
2. Read the File Manifest to identify target files
3. For each file: translate Contracts → type definitions + guards, Decision → pattern selection, Threshold Registry → constant definitions, Behavioral Spec → test cases
4. Run Red/Green/Refactor: failing test → minimal passing code → cleanup
5. Verify all exit criteria

---

### 2.4 REVIEW

| Property | Value |
|---|---|
| **Purpose** | Verify implementation against artifacts — not against intuition |
| **Artifact sections produced** | None |
| **Card sections written** | Only status line and regression notes (if regressing) |
| **Read permissions** | `plan/<own-card>.md`, `src/**`, `docs/<own-domain>/**` |
| **Write permissions** | `plan/<own-card>.md` (status + content changes for regression only) |
| **Forbidden writes** | `src/**`, `docs/**` |

#### Entry Criteria
- All IMPLEMENT exit criteria are met
- Status is `[REVIEW]`

#### Exit Criteria (gate to DONE)
1. Every Acceptance Criterion is verified as met
2. Every Contracts item is verified against implementation (precondition guards exist, postcondition tests pass, invariants hold)
3. Every Decision's chosen option is used in implementation (no drift)
4. Every Threshold Registry value matches the code constant
5. Every Behavioral Spec scenario has a passing test
6. File Manifest is accurate (no missing files, no extra unlisted files modified)
7. No regressions in sibling domain tests
8. Tests pass in clean run

#### Verification Method
REVIEW checks **artifacts against implementation**, not implementation against
the reviewer's opinion. The reviewer asks:
- "Does the code match the Contracts?" — not "Is this good code?"
- "Does the code follow the Decision?" — not "Would I have chosen differently?"
- "Do the constants match the Threshold Registry?" — not "Are these good values?"

If the reviewer finds a deficiency, they must identify which artifact it
violates. If no artifact is violated but the reviewer believes the approach is
wrong, the correct action is to regress to ARCHITECT and add/modify the
relevant artifact — not to edit the code directly.

---

### 2.5 DONE

| Property | Value |
|---|---|
| **Purpose** | Card is complete and frozen |
| **Artifact sections produced** | None |
| **Card sections written** | None (except regression) |
| **Read permissions** | All |
| **Write permissions** | `plan/<own-card>.md` (only for regression challenge) |
| **Forbidden writes** | Everything (except card regression) |

#### Entry Criteria
- All REVIEW exit criteria are met
- Status is `[DONE]`

#### Regression
A `[DONE]` card can be regressed to any earlier phase via the Challenge
mechanism (see §4). The challenge must satisfy BOTH conditions:
1. Regress the phase
2. Change card content to explain why

---

## 3. Artifact-Phase Mapping Summary

| Artifact Section | Authored in | Consumed in | Verified in |
|---|---|---|---|
| Decision | ARCHITECT | IMPLEMENT | REVIEW |
| Contracts | ARCHITECT | IMPLEMENT | REVIEW |
| Threshold Registry | ARCHITECT | IMPLEMENT | REVIEW |
| Behavioral Spec | ARCHITECT | IMPLEMENT | REVIEW |
| Cross-Cutting Note | PLAN (node cards only) | All child phases | REVIEW (of children) |

**Invariant**: No artifact section is authored during IMPLEMENT or REVIEW.
If an artifact is missing or incomplete, the card must regress to ARCHITECT.

## 4. Regression Rules

### 4.1 Mandatory Regressions

These regressions are **required** — the agent has no discretion:

| Trigger | From Phase | To Phase | Reason |
|---|---|---|---|
| IMPLEMENT agent encounters a design choice | IMPLEMENT | ARCHITECT | Decision section missing or incomplete |
| IMPLEMENT agent encounters an undefined interface | IMPLEMENT | ARCHITECT | Contracts section missing or incomplete |
| IMPLEMENT agent encounters an undocumented constant | IMPLEMENT | ARCHITECT | Threshold Registry row missing |
| IMPLEMENT agent encounters unspecified behavior | IMPLEMENT | ARCHITECT | Behavioral Spec scenario missing |
| IMPLEMENT agent finds the card too large for one pass | IMPLEMENT | PLAN | Card needs splitting |
| REVIEW finds missing test coverage for a spec scenario | REVIEW | IMPLEMENT | Test gap (not artifact gap) |
| Structural gate check fails at any transition | Current | Previous | Exit criteria not met |

### 4.2 Optional Regressions

These regressions are **permitted but not required**:

| Trigger | From Phase | To Phase | Reason |
|---|---|---|---|
| REVIEW finds a better approach | REVIEW | ARCHITECT | Quality improvement (functionally equivalent alternative) |
| External spec change invalidates design | DONE | PLAN | Requirements changed |
| Sibling card change invalidates assumptions | Any | ARCHITECT | Dependency drift |
| REVIEW finds code quality issues (not correctness) | REVIEW | IMPLEMENT | Cleanup needed |

### 4.3 Challenge Protocol

Any status — including `[DONE]` — can be regressed. A challenge MUST:
1. **Regress the phase** in the card heading (e.g., `[DONE]` → `[ARCHITECT]`)
2. **Change card content** (Description, Acceptance Criteria, or artifact sections) to explain WHY

Both conditions are mandatory. A bare status change without content modification
will be treated as a no-op by the next iteration (nothing looks different, so
the agent re-advances).

## 5. Transition Gate Implementation

### 5.1 Gate Types

| Gate | Check Type | Description |
|---|---|---|
| **Structural** | Automated | Section headers present, template structure followed, File Manifest non-empty |
| **Completeness** | Semi-automated | Keyword scan of Description to verify required artifact sections exist |
| **Semantic** | Agent-verified | "Could a different agent produce identical code from these artifacts alone?" |

### 5.2 Structural Gate Checks (automatable)

```
PLAN → ARCHITECT gate:
  ✓ ## Description exists and is non-empty
  ✓ ## Acceptance Criteria exists with ≥1 bullet
  ✓ Each AC bullet contains a verifiable predicate

ARCHITECT → IMPLEMENT gate:
  ✓ ## File Manifest exists with ≥1 entry
  ✓ If Description matches /interface|API|type|contract|shape|schema/i
      → ## Contracts section exists with ### Preconditions, ### Postconditions, ### Invariants
  ✓ If Description matches /choice|pattern|library|framework|select|decide|approach/i
      → ## Decision section exists with ### Options Considered, ### Choice, ### Rationale
  ✓ If Description matches /threshold|timeout|constant|default|capacity|limit|magic/i
      → ## Threshold Registry section exists with table header row
  ✓ If Description matches /flow|algorithm|sequence|state|transition|step|escalat/i
      → ## Behavioral Spec or AC contains Given/When/Then patterns

IMPLEMENT → REVIEW gate:
  ✓ All files in File Manifest exist on disk
  ✓ Test suite passes (exit code 0)

REVIEW → DONE gate:
  ✓ No open regression notes in card
  ✓ All AC bullets addressed (agent-verified)
```

### 5.3 Gate Failure Behavior

When a gate check fails:
1. The transition is **blocked** — the card remains in its current phase
2. The failing checks are reported to the agent
3. The agent must either fix the deficiency or regress to an earlier phase

Gates are **advisory in the current implementation** (the system prompt instructs
the agent, but enforcement is trust-based). Future implementation may add
programmatic gate enforcement in the card engine.

## 6. Isolation Matrix

| Phase | Read `plan/` | Write own card | Write other cards | Read `src/` | Write `src/` | Read `docs/` | Write `docs/` |
|---|---|---|---|---|---|---|---|
| PLAN | ✓ | ✓ | ✓ (new children only) | ✓ | ✗ | ✓ | ✗ |
| ARCHITECT | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ (own domain) |
| IMPLEMENT | own card | ✓ | ✗ | ✓ | ✓ (own domain) | own domain | ✗ |
| REVIEW | own card | ✓ (status only) | ✗ | ✓ | ✗ | own domain | ✗ |
| DONE | all | regression only | ✗ | ✓ | ✗ | ✓ | ✗ |

**Key invariant**: No phase has both `src/` write and `docs/` write permissions.
This prevents contamination between design artifacts and implementation.

## 7. Mechanical IMPLEMENT — Formal Statement

**Definition**: The IMPLEMENT phase satisfies the "mechanical" criterion if and
only if the following thought experiment succeeds:

> Take the card file (with all artifact sections produced by PLAN and ARCHITECT)
> and hand it to a **different agent with no memory** of prior phases or
> conversations. Give it only:
> 1. The card file (Description, Decision, Contracts, Threshold Registry, AC with inline Behavioral Spec)
> 2. The File Manifest
> 3. Read access to the existing codebase
>
> If this agent produces **functionally identical code** (same interfaces, same
> behavior, same constants — modulo stylistic differences), then the artifact
> sections are sufficiently specified.

**Corollary**: If the amnesiac agent would need to ask a question, the
artifact sections are incomplete and the card must regress to ARCHITECT.

**Practically**, this means ARCHITECT must specify:
- Every type signature and interface shape (Contracts)
- Every design pattern and technology choice (Decision)
- Every numeric constant and its rationale (Threshold Registry)
- Every non-obvious behavioral flow (Behavioral Spec)

The only latitude left to the IMPLEMENT agent is:
- Variable naming (stylistic)
- Internal function decomposition within a module (structural)
- Test assertion ordering (mechanical)
- Import organization (mechanical)
