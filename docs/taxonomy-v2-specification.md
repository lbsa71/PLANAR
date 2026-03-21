# PLANAR Artifact Taxonomy v2 — Specification

> **Version**: 2.0
> **Date**: 2026-03-21
> **Status**: Final
> **Produced by**: Card 7.6 (Taxonomy Specification)
> **Inputs**: artifact-taxonomy-ARCHITECTURE.md (7.3), phase-lifecycle-ARCHITECTURE.md (7.4), validation-report.md (7.5)

This document is the complete specification for PLANAR's artifact taxonomy v2. It is
self-contained — a reader needs no other document to understand and implement it.

---

## Table of Contents

1. [Artifact Type Catalogue](#1-artifact-type-catalogue)
2. [Phase Lifecycle](#2-phase-lifecycle)
3. [Card Schema Changes](#3-card-schema-changes)
4. [System Prompt Changes](#4-system-prompt-changes)
5. [Type System Changes](#5-type-system-changes)
6. [Validation Report](#6-validation-report)
7. [Migration Guide](#7-migration-guide)

---

## 1. Artifact Type Catalogue

### 1.1 Core Design Principle

Artifact types are **section templates**, not card types. A single card in its ARCHITECT
phase composes whichever artifact sections it needs. There is no separate artifact
lifecycle — sections are authored during ARCHITECT and consumed during IMPLEMENT.

**Key invariants**:
- Every gap type maps to exactly one artifact section (100% coverage, no gaps)
- No two artifact sections answer the same question (no overlap)
- Removing any section loses coverage of at least one gap type (all necessary)
- Node cards use only Cross-Cutting Note; leaf cards use the other four

### 1.2 Decision Section

| Field | Value |
|---|---|
| **Name** | Decision |
| **Question it answers** | Why this choice over alternatives? |
| **Gap types covered** | Design Pattern (DP: 7), Technology Selection (TS: 2), Scope Extension (SE: 3) = 12 gaps (29%) |
| **Reproducibility role** | Without this, agents re-derive design rationale from scratch and may choose differently. With decisions, agents implement the specified pattern rather than inventing alternatives. |
| **Card integration** | Leaf card section, authored in ARCHITECT phase |
| **Relationships** | May reference Contracts (a decision may constrain interface shape). May reference Threshold Registry (a decision may set threshold values). |

#### Content Template

```markdown
## Decision

### Context
<1-2 sentences: what problem or choice prompted this decision>

### Options Considered
1. **<Option A>** — <1-sentence description>
2. **<Option B>** — <1-sentence description>
3. **<Option C>** — <1-sentence description> (if applicable)

### Choice
**<Option N>** — <1-sentence restatement>

### Rationale
<2-4 sentences: why this option was chosen, what trade-offs were accepted>

### Consequences
- <positive consequence>
- <negative consequence or trade-off accepted>
- <constraint imposed on downstream cards>
```

#### Format Rules
- Context is brief — the card Description already provides full background
- Options Considered lists at minimum 2 alternatives (if only one option exists, no Decision section is needed — there is no decision)
- Choice must reference one of the listed options by name
- Rationale must reference specific properties of the chosen option, not just "it's the best"
- Consequences must include at least one trade-off or constraint (all decisions have costs)
- Scope extensions (SE gaps) are captured as Decisions: "We decided to extend scope to include X because Y"

#### When Required
- Any card that selects a design pattern, library, data structure, algorithm, or technology from among alternatives
- Any card that selects a technology or framework
- Any card where scope expanded beyond the original plan
- Estimated ~25% of leaf cards

#### When Optional
- Cards where the implementation approach is fully determined by parent card decisions
- Cards with no meaningful design choices (e.g., pure wiring/glue cards)

---

### 1.3 Contracts Section

| Field | Value |
|---|---|
| **Name** | Contracts |
| **Question it answers** | What are the interface guarantees? |
| **Gap types covered** | Interface Contract (IC: 9), API Contract (AC: 3), Constraint (CN: 2), Configuration (CF: 1) = 15 gaps (36%) |
| **Reproducibility role** | Without this, agents invent interface shapes ad hoc — two agents produce incompatible types. With contracts, interface implementation becomes mechanical. |
| **Card integration** | Leaf card section, authored in ARCHITECT phase |
| **Relationships** | Consumed by Behavioral Spec (scenarios test contract compliance). Consumed by Threshold Registry (thresholds may appear as invariant bounds). |

#### Content Template

```markdown
## Contracts

### Preconditions
- `paramName` must satisfy <constraint>
- <input validation rule>

### Postconditions
- Returns <type> satisfying <property>
- Side effect: <what changes and how>

### Invariants
- <property that must always hold>
- <type constraint or value range>
```

#### Format Rules
- Each item is a single bulleted statement
- Use backtick-quoted identifiers for code references
- Preconditions describe caller obligations (what must be true before invocation)
- Postconditions describe callee guarantees (what is true after successful return)
- Invariants describe type/module properties that hold across all states
- Configuration constants (CF gaps) appear as invariants (e.g., "credentials path is always `~/.config/app/credentials.json`")

#### When Required
- Any card that **defines or modifies** an interface, API surface, or exported type
- Any card whose Description mentions a type contract, shape, or schema
- Estimated ~30% of leaf cards

#### When Optional
- Cards that only consume (not define) interfaces
- Cards focused purely on internal algorithms with no public surface

---

### 1.4 Threshold Registry Section

| Field | Value |
|---|---|
| **Name** | Threshold Registry |
| **Question it answers** | What are the tuning constants and their rationale? |
| **Gap types covered** | Numeric Threshold (NT: 9) = 9 gaps (21%) |
| **Reproducibility role** | Without this, agents invent magic numbers — each run produces different constants with no documented rationale. With the registry, agents use the specified values and can later tune them with the documented sensitivity information. |
| **Card integration** | Leaf card section, authored in ARCHITECT phase — structured table |
| **Relationships** | Referenced by Contracts (threshold values may appear as invariant bounds). Referenced by Behavioral Spec (scenarios may use threshold values in test data). |

#### Content Template

```markdown
## Threshold Registry

| Name | Value | Unit | Valid Range | Rationale | Sensitivity |
|---|---|---|---|---|---|
| `CONSTANT_NAME` | 0.95 | — | [0.0, 1.0] | <why this value> | <what happens if ±10%> |
| `TIMEOUT_MS` | 7000 | ms | [1000, 30000] | <why this value> | <what happens if ±10%> |
```

#### Column Definitions

| Column | Description | Required |
|---|---|---|
| **Name** | The constant identifier as it appears in code (UPPER_SNAKE_CASE) | Yes |
| **Value** | The specified numeric value or expression | Yes |
| **Unit** | Unit of measurement (ms, bytes, ratio, count, —) | Yes |
| **Valid Range** | Acceptable bounds expressed as interval notation `[min, max]` or `(min, max)` | Yes |
| **Rationale** | 1-sentence explanation of why this specific value was chosen | Yes |
| **Sensitivity** | Brief description of behavioral impact if value changes by ±10%; one of: `low` (cosmetic), `medium` (noticeable quality change), `high` (correctness affected) | Yes |

#### Format Rules
- One row per constant — no grouping or nesting
- Name must match the identifier used in implementation code
- Value must be a literal (no expressions like `7 * 24 * 60 * 60 * 1000` — write `604800000`)
- Valid Range must be an interval; use `[x, ∞)` for unbounded upper, `(-∞, x]` for unbounded lower
- Rationale must cite evidence (measurement, paper, heuristic) not just "seemed reasonable"
- String constants (e.g., axiom texts) are NOT thresholds — they belong in Contracts as invariants

#### When Required
- Any card that introduces numeric constants affecting system behavior
- Any card where the Description mentions tuning, thresholds, defaults, timeouts, or capacities
- Estimated ~20% of leaf cards

#### When Optional
- Cards with no numeric parameters
- Cards where all numeric values are derived from other cards' thresholds (reference the source card instead)

---

### 1.5 Behavioral Spec Section

| Field | Value |
|---|---|
| **Name** | Behavioral Spec |
| **Question it answers** | What exactly happens step by step? |
| **Gap types covered** | Behavioral Spec (BS: 6) = 6 gaps (14%) |
| **Reproducibility role** | Without this, agents interpret behavioral flows differently — especially multi-step state transitions, edge cases, and error paths. With specs, test writing becomes direct translation from Given/When/Then to setup/action/assertion. |
| **Card integration** | Hybrid: inline Given/When/Then in AC for simple cases; linked `.feature` file for complex cases |
| **Relationships** | Tests contract compliance (references Contracts section). May reference Threshold Registry values in scenario data. |

#### Content Template — Inline (≤3 scenarios, no multi-step state)

```markdown
## Acceptance Criteria
- Given <precondition>, when <action>, then <expected outcome>
- Given <precondition>, when <action>, then <expected outcome>
```

#### Content Template — Linked (>3 scenarios or multi-step state transitions)

Card references the `.feature` file in its File Manifest:

```markdown
## File Manifest
- path/to/feature.feature
```

The `.feature` file uses standard Gherkin:

```gherkin
Feature: <feature name>
  <1-sentence description>

  Scenario: <scenario name>
    Given <precondition>
    And <additional precondition>
    When <action>
    Then <expected outcome>
    And <additional assertion>

  Scenario: <error case name>
    Given <precondition>
    When <invalid action>
    Then <error outcome>
```

#### Format Rules
- Inline scenarios use natural-language Given/When/Then in the Acceptance Criteria section
- Linked `.feature` files use standard Gherkin syntax (parseable by Cucumber/jest-cucumber)
- **Promotion threshold**: promote to linked file when >3 scenarios OR multi-step state transitions OR scenario outlines with parameterized examples
- `.feature` files live alongside their card's implementation source, not in `plan/`
- Each scenario must be independently executable (no shared mutable state between scenarios)

#### When Required
- Any card specifying algorithmic flows, state machines, or multi-step processes
- Any card where the Description contains words like "flow," "algorithm," "sequence," "state transition," "escalation"
- Estimated ~15% of leaf cards

#### When Optional
- Cards defining static interfaces (use Contracts instead)
- Cards making design choices (use Decision instead)
- Cards with trivially verifiable behavior (single input → single output, no state)

---

### 1.6 Cross-Cutting Note

| Field | Value |
|---|---|
| **Name** | Cross-Cutting Note |
| **Question it answers** | What concern spans multiple children? |
| **Gap types covered** | Cross-Cutting (XC: 1) = 1 gap (2%) |
| **Reproducibility role** | Without this, cross-cutting concerns are invisible to child-card agents, leading to inconsistent treatment across sibling cards. With the note, all children inherit the same constraint. |
| **Card integration** | **Node card** Description section — NOT a separate section |
| **Relationships** | Inherited by all child cards. May reference Contracts (cross-cutting type constraints) or Threshold Registry (shared constants). |

#### Content Template

Cross-cutting notes are embedded in the node card's existing Description section:

```markdown
## Description
<normal description text>

### Cross-Cutting Concerns
- **<concern name>**: <1-2 sentence description of the concern and how children must handle it>
- **<concern name>**: <1-2 sentence description>
```

#### Format Rules
- Lives in node (non-leaf) cards only — subsection of Description
- Each concern is a named bullet with bold label
- Description must be actionable: not "error handling is important" but "all children must throw typed errors extending `BaseError` with a `code` field"
- Agents processing child cards must read the parent card's Cross-Cutting Concerns as input

#### When Required
- Any node card where a design constraint applies uniformly to all children
- Estimated ~30% of node cards

#### When Optional
- Node cards where children are independent (no shared constraints)

---

### 1.7 Complete Coverage Map

Every gap type maps to exactly one artifact section:

| Gap Type | Code | Count | Artifact Section | Coverage Mechanism |
|---|---|---|---|---|
| Interface Contract | IC | 9 | Contracts | Pre/Post/Invariants on interface shapes |
| Numeric Threshold | NT | 9 | Threshold Registry | Structured constant table |
| Design Pattern | DP | 7 | Decision | Options/Choice/Rationale for pattern selection |
| Behavioral Spec | BS | 6 | Behavioral Spec | Given/When/Then scenarios |
| API Contract | AC | 3 | Contracts | Pre/Post on API endpoints (special case of IC) |
| Scope Extension | SE | 3 | Decision | Scope-extension captured as a decision |
| Constraint | CN | 2 | Contracts | Invariants on type/module properties |
| Technology Selection | TS | 2 | Decision | Options/Choice/Rationale for technology |
| Configuration | CF | 1 | Contracts | Configuration paths/defaults as invariants |
| Cross-Cutting | XC | 1 | Cross-Cutting Note | Named concerns in node card Description |
| **Total** | | **42** | **5 sections** | **100% coverage** |

### 1.8 Overlap Check

No two sections answer the same question:

| Section Pair | Overlap? | Resolution |
|---|---|---|
| Contracts ↔ Decision | No | Contracts = "what guarantees"; Decision = "why this choice" |
| Contracts ↔ Behavioral Spec | No | Contracts = static properties; Behavioral Spec = dynamic flows |
| Contracts ↔ Threshold Registry | No | Contracts = type shapes; Threshold Registry = numeric values |
| Decision ↔ Behavioral Spec | No | Decision = "why"; Behavioral Spec = "what happens" |
| Decision ↔ Threshold Registry | No | Decision = pattern/tech choices; Threshold Registry = numeric constants |
| Behavioral Spec ↔ Threshold Registry | No | Behavioral Spec = step-by-step flows; Threshold Registry = isolated values |
| Cross-Cutting Note ↔ any | No | Cross-Cutting Note lives in node cards; all others in leaf cards |

### 1.9 Necessity Check

Each section is necessary — removing it loses gap coverage:

| If Removed | Gaps Lost | Count | % |
|---|---|---|---|
| Contracts | IC, AC, CN, CF | 15 | 36% |
| Decision | DP, TS, SE | 12 | 29% |
| Behavioral Spec | BS | 6 | 14% |
| Threshold Registry | NT | 9 | 21% |
| Cross-Cutting Note | XC | 1 | 2% |

### 1.10 Composition Rules

**Rule 1: Multiple Sections Per Card**
A single card may contain any combination of artifact sections. Example: a card defining an authentication interface might have Decision (why OAuth over API keys) + Contracts (IAuthProvider shape) + Threshold Registry (token expiry timeout).

**Rule 2: Section Optionality**
No section is universally mandatory. Each section has "When Required" criteria. A card with no design choices, no interfaces, no behaviors, and no thresholds needs zero artifact sections (but this should be rare — if a leaf card has none, it may be too trivial to be a card).

**Rule 3: Node vs Leaf**
- **Node cards**: Only Cross-Cutting Note (in Description). Nodes do not have Contracts, Decision, Behavioral Spec, or Threshold Registry sections.
- **Leaf cards**: Any of the four non-cross-cutting sections. Leaves do not have Cross-Cutting Notes (they have no children to inherit them).

**Rule 4: Cross-Card References**
A Threshold Registry may reference a parent card's Cross-Cutting Note. A Decision may reference a sibling card's Contracts. References use the standard `plan/<card>.md` path format.

**Rule 5: Promotion from Inline to Linked**
Behavioral Specs promote from inline (Given/When/Then in AC) to linked (`.feature` file) when:
- More than 3 scenarios
- Multi-step state transitions
- Scenario Outlines with parameterized examples

No other section type has a linked-artifact variant — Contracts, Decision, and Threshold Registry are always inline card sections.

### 1.11 Section Ordering in Cards

When multiple artifact sections appear in a single card, they follow this order:

```
# <dot-path> <Title> [STATUS]

## Description
...

## Decision                    ← "why" comes first (informs the rest)
...

## Contracts                   ← "what guarantees" comes second
...

## Threshold Registry          ← "what values" comes third
...

## File Manifest
...

## Acceptance Criteria         ← includes inline Given/When/Then if applicable
...
```

Rationale: Decision informs Contracts (the chosen pattern determines the interface shape). Contracts inform Threshold Registry (invariant bounds constrain threshold ranges). Behavioral Specs are inline in AC or linked from the manifest.

---

## 2. Phase Lifecycle

### 2.1 Phase Sequence

```
PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE
```

The sequence is linear. Parallelism happens at the card level (multiple cards executing concurrently), not at the phase level within a card.

### 2.2 PLAN Phase

| Property | Value |
|---|---|
| **Purpose** | Scope, decompose, and clarify the card |
| **Artifact sections produced** | None |
| **Card sections written** | Description, Acceptance Criteria, File Manifest (initial) |
| **Read permissions** | `plan/**`, `src/**` (read-only), `docs/**` (read-only) |
| **Write permissions** | `plan/<own-card>.md`, `plan/<new-child-cards>.md` |
| **Forbidden writes** | `src/**`, `docs/**` |

#### Entry Criteria
- Card file exists with valid YAML frontmatter (parent, root links)
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

### 2.3 ARCHITECT Phase

| Property | Value |
|---|---|
| **Purpose** | Capture every design decision and contract so IMPLEMENT is mechanical |
| **Artifact sections produced** | Decision, Contracts, Threshold Registry, Behavioral Spec (per "When Required" rules in §1) |
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
The following checks are automatable without semantic understanding:
- If Description contains interface/API/type keywords → Contracts section must exist
- If Description contains choice/pattern/library/framework keywords → Decision section must exist
- If Description contains threshold/timeout/constant/default keywords → Threshold Registry must exist
- If Description contains flow/algorithm/sequence/state keywords → Behavioral Spec must exist (inline or linked)
- File Manifest has ≥1 entry

#### ARCHITECT Phase Workflow
When an agent enters ARCHITECT for a leaf card:
1. Read Description and Acceptance Criteria
2. Determine which artifact sections are needed (using the "When Required" rules from §1)
3. Write each required section using the content template
4. Populate the File Manifest with all files that will be created or modified during IMPLEMENT
5. If Behavioral Spec requires linked `.feature` files, add them to the manifest (but do NOT create them yet — that happens in IMPLEMENT)

---

### 2.4 IMPLEMENT Phase

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

If the agent encounters ANY of these situations, it MUST regress the card to `[ARCHITECT]` and update the card content to explain what was underspecified. This is a **mandatory regression** — the agent cannot proceed by guessing.

#### Formal Statement

> Take the card file (with all artifact sections produced by PLAN and ARCHITECT) and hand
> it to a **different agent with no memory** of prior phases or conversations. Give it only:
> 1. The card file (Description, Decision, Contracts, Threshold Registry, AC with inline Behavioral Spec)
> 2. The File Manifest
> 3. Read access to the existing codebase
>
> If this agent produces **functionally identical code** (same interfaces, same behavior,
> same constants — modulo stylistic differences), then the artifact sections are
> sufficiently specified.

**Corollary**: If the amnesiac agent would need to ask a question, the artifact sections
are incomplete and the card must regress to ARCHITECT.

**Practically**, ARCHITECT must specify:
- Every type signature and interface shape (Contracts)
- Every design pattern and technology choice (Decision)
- Every numeric constant and its rationale (Threshold Registry)
- Every non-obvious behavioral flow (Behavioral Spec)

The only latitude left to the IMPLEMENT agent is:
- Variable naming (stylistic)
- Internal function decomposition within a module (structural)
- Test assertion ordering (mechanical)
- Import organization (mechanical)

#### Implementation Workflow
1. Read all artifact sections from the card
2. Read the File Manifest to identify target files
3. For each file: translate Contracts → type definitions + guards, Decision → pattern selection, Threshold Registry → constant definitions, Behavioral Spec → test cases
4. Run Red/Green/Refactor: failing test → minimal passing code → cleanup
5. Verify all exit criteria

---

### 2.5 REVIEW Phase

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
REVIEW checks **artifacts against implementation**, not implementation against the
reviewer's opinion. The reviewer asks:
- "Does the code match the Contracts?" — not "Is this good code?"
- "Does the code follow the Decision?" — not "Would I have chosen differently?"
- "Do the constants match the Threshold Registry?" — not "Are these good values?"

If the reviewer finds a deficiency, they must identify which artifact it violates. If no
artifact is violated but the reviewer believes the approach is wrong, the correct action
is to regress to ARCHITECT and add/modify the relevant artifact — not to edit the code
directly.

---

### 2.6 DONE Phase

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
A `[DONE]` card can be regressed to any earlier phase via the Challenge mechanism (see §2.10).

---

### 2.7 Artifact-Phase Mapping Summary

| Artifact Section | Authored in | Consumed in | Verified in |
|---|---|---|---|
| Decision | ARCHITECT | IMPLEMENT | REVIEW |
| Contracts | ARCHITECT | IMPLEMENT | REVIEW |
| Threshold Registry | ARCHITECT | IMPLEMENT | REVIEW |
| Behavioral Spec | ARCHITECT | IMPLEMENT | REVIEW |
| Cross-Cutting Note | PLAN (node cards only) | All child phases | REVIEW (of children) |

**Invariant**: No artifact section is authored during IMPLEMENT or REVIEW. If an artifact
is missing or incomplete, the card must regress to ARCHITECT.

---

### 2.8 Regression Rules

#### Mandatory Regressions

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

#### Optional Regressions

These regressions are **permitted but not required**:

| Trigger | From Phase | To Phase | Reason |
|---|---|---|---|
| REVIEW finds a better approach | REVIEW | ARCHITECT | Quality improvement (functionally equivalent alternative) |
| External spec change invalidates design | DONE | PLAN | Requirements changed |
| Sibling card change invalidates assumptions | Any | ARCHITECT | Dependency drift |
| REVIEW finds code quality issues (not correctness) | REVIEW | IMPLEMENT | Cleanup needed |

---

### 2.9 Transition Gate Implementation

#### Gate Types

| Gate | Check Type | Description |
|---|---|---|
| **Structural** | Automated | Section headers present, template structure followed, File Manifest non-empty |
| **Completeness** | Semi-automated | Keyword scan of Description to verify required artifact sections exist |
| **Semantic** | Agent-verified | "Could a different agent produce identical code from these artifacts alone?" |

#### Structural Gate Checks (automatable)

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

#### Gate Failure Behavior
When a gate check fails:
1. The transition is **blocked** — the card remains in its current phase
2. The failing checks are reported to the agent
3. The agent must either fix the deficiency or regress to an earlier phase

Gates are **advisory in the current implementation** (the system prompt instructs the
agent, but enforcement is trust-based). Future implementation may add programmatic gate
enforcement in the card engine.

---

### 2.10 Challenge Protocol

Any status — including `[DONE]` — can be regressed. A challenge MUST:
1. **Regress the phase** in the card heading (e.g., `[DONE]` → `[ARCHITECT]`)
2. **Change card content** (Description, Acceptance Criteria, or artifact sections) to explain WHY

Both conditions are mandatory. A bare status change without content modification will be
treated as a no-op by the next iteration (nothing looks different, so the agent
re-advances).

---

### 2.11 Isolation Matrix

| Phase | Read `plan/` | Write own card | Write other cards | Read `src/` | Write `src/` | Read `docs/` | Write `docs/` |
|---|---|---|---|---|---|---|---|
| PLAN | ✓ | ✓ | ✓ (new children only) | ✓ | ✗ | ✓ | ✗ |
| ARCHITECT | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ (own domain) |
| IMPLEMENT | own card | ✓ | ✗ | ✓ | ✓ (own domain) | own domain | ✗ |
| REVIEW | own card | ✓ (status only) | ✗ | ✓ | ✗ | own domain | ✗ |
| DONE | all | regression only | ✗ | ✓ | ✗ | ✓ | ✗ |

**Key invariant**: No phase has both `src/` write and `docs/` write permissions. This
prevents contamination between design artifacts and implementation.

---

## 3. Card Schema Changes

### 3.1 New Card Sections

Three new markdown sections may appear in leaf cards:

| Section | Type | Location in Card |
|---|---|---|
| **Decision** | Markdown section (`## Decision`) | After Description, before Contracts |
| **Contracts** | Markdown section (`## Contracts`) | After Decision, before Threshold Registry |
| **Threshold Registry** | Markdown section (`## Threshold Registry`) | After Contracts, before File Manifest |

Behavioral Spec does not have its own section — it is either inline in Acceptance Criteria (Given/When/Then) or a linked `.feature` file referenced in File Manifest.

### 3.2 Section Ordering Rule

```
## Description
## Decision                    (if applicable)
## Contracts                   (if applicable)
## Threshold Registry          (if applicable)
## File Manifest
## Acceptance Criteria         (with inline Behavioral Spec if applicable)
```

### 3.3 No New YAML Frontmatter Fields

Artifact sections are markdown content, not structured YAML data. The existing frontmatter
schema (`parent`, `root`, `children`, `blocked-by`) is unchanged. No new frontmatter
fields are required.

### 3.4 Backward Compatibility

Existing cards with no artifact sections remain valid. Sections are optional per the
composition rules (§1.10). A card with only Description and Acceptance Criteria is a valid
card — it simply has no artifact sections.

### 3.5 Migration Path

- Existing cards in PLAN or ARCHITECT gain sections when they enter/re-enter ARCHITECT
- Existing `[DONE]` cards are not retroactively modified (only on regression)
- The new section ordering is applied only when sections are written — existing card section order is not forcibly rearranged

---

## 4. System Prompt Changes

The following changes are required in `src/system-prompt.ts` to implement the v2 taxonomy.

### 4.1 PLAN Phase Prompt Changes

**Current**: Generic planning instructions.

**Add** to exit criteria:
```
3. Each Acceptance Criterion is testable (contains a verifiable predicate, not vague language)
```

This is already present in the current `system-prompt.ts`. No change needed.

### 4.2 ARCHITECT Phase Prompt Changes

**Current**: Generic architecture instructions.

**Required**: The ARCHITECT prompt must include:
1. The artifact section authoring instructions (which sections exist, "When Required" rules)
2. The content templates for each section
3. The section ordering rule
4. The ARCHITECT workflow (read Description → determine sections → write sections → populate manifest)
5. The structural validation gate checks
6. The mechanical IMPLEMENT test as exit criterion

This is already implemented in the current `system-prompt.ts` (see the `case "ARCHITECT"` block). The existing prompt includes all six items above. No additional changes needed.

### 4.3 IMPLEMENT Phase Prompt Changes

**Current**: Generic implementation instructions.

**Required**: The IMPLEMENT prompt must include:
1. The mechanical criterion (must NOT choose alternatives, invent interfaces, pick constants, decide behavior)
2. The mandatory regression rules (regress to ARCHITECT if underspecified)
3. The artifact consumption workflow (read artifacts → translate to code)
4. The implementation exit criteria (every contract has a guard, every threshold appears in code, etc.)

This is already implemented in the current `system-prompt.ts` (see the `case "IMPLEMENT"` block). The existing prompt includes all four items above. No additional changes needed.

### 4.4 REVIEW Phase Prompt Changes

**Current**: Generic review instructions.

**Required**: The REVIEW prompt must include:
1. The artifact-vs-implementation verification method ("Does code match Contracts?" not "Is this good code?")
2. The mandatory regression triggers (missing test coverage → IMPLEMENT)
3. The optional regression triggers (better approach → ARCHITECT)

This is already implemented in the current `system-prompt.ts` (see the `case "REVIEW"` block). The existing prompt includes all three items above. No additional changes needed.

### 4.5 Node Card Prompt — No Changes Needed

Node cards use only Cross-Cutting Note in their Description section. The Cross-Cutting Note requires no prompt changes — it is authored as part of the Description, which the agent already writes during PLAN.

### 4.6 Summary

All system prompt changes required by the v2 taxonomy are **already implemented** in the
current `system-prompt.ts`. The ARCHITECT prompt includes artifact section instructions
with templates, ordering, and gate checks. The IMPLEMENT prompt includes the mechanical
criterion and mandatory regression rules. The REVIEW prompt includes artifact-based
verification. No further changes to `system-prompt.ts` are required.

---

## 5. Type System Changes

### 5.1 Assessment: No Type Changes Required

The existing type system in `src/types.ts` is sufficient for the v2 taxonomy.

**Rationale**:
- Artifact sections are unstructured markdown content within card files
- The `Card` interface already has `rawContent: string` which contains all sections
- No new phase values are needed — `LeafPhase` already defines all 5 phases: `"PLAN" | "ARCHITECT" | "IMPLEMENT" | "REVIEW" | "DONE"`
- No new frontmatter fields are needed — sections are markdown, not YAML
- The system prompt (not types) drives agent behavior

### 5.2 Future Consideration

If a future implementation wants structured artifact parsing (e.g., programmatic gate
enforcement), new types would be needed:

```typescript
type ArtifactSectionKind =
  | "Decision"
  | "Contracts"
  | "ThresholdRegistry"
  | "BehavioralSpec"
  | "CrossCuttingNote";

interface ThresholdRow {
  name: string;
  value: number | string;
  unit: string;
  validRange: string;
  rationale: string;
  sensitivity: "low" | "medium" | "high";
}

interface ParsedArtifacts {
  decision?: { context: string; options: string[]; choice: string; rationale: string; consequences: string[] };
  contracts?: { preconditions: string[]; postconditions: string[]; invariants: string[] };
  thresholdRegistry?: ThresholdRow[];
  behavioralSpec?: { scenarios: string[]; featureFile?: string };
}
```

These are **out of scope** for v2. The v2 specification defines the taxonomy and its
integration into the phase lifecycle and system prompts. Structured parsing is an
implementation optimization, not a taxonomy concern.

---

## 6. Validation Report

### 6.1 Validation Cases

Three real codebases were used to validate that the five artifact section types are
sufficient to capture all design knowledge needed for mechanical implementation.

#### Case 1: OAuth Authentication — **PASS**

**Source files**: `auth-providers.ts`, `setup-token.ts`, `anthropic-llm-client.ts`

Artifacts produced:
- **Decision**: Strategy pattern (IAuthProvider) chosen over conditional header injection and middleware chain
- **Contracts**: Full pre/post/invariants for `IAuthProvider`, `createAuthProvider`, `validateSetupToken`, `ensureSetupToken`, `AnthropicLlmClient.infer()`
- **Threshold Registry**: `SETUP_TOKEN_MIN_LENGTH = 80`
- **Behavioral Spec**: 7 inline scenarios covering token acquisition, re-prompt, header format, and system prompt formatting

**Verdict**: A fresh agent given these artifacts could produce functionally identical code. All auth strategies, token validation, and system prompt formatting are fully specified.

#### Case 2: Cognitive Budget Enforcement — **PASS**

**Source files**: `cognitive-budget.ts`, `types.ts` (agent-runtime)

Artifacts produced:
- **Decision**: Runtime monitoring with soft yield chosen over pre-allocation and post-hoc reporting
- **Contracts**: Full pre/post/invariants for `startPhase`, `endPhase`, `shouldYieldPhase`, `isPhaseOverBudget`, `resetTick`, `getBudgetReport`, `checkSoftCaps`
- **Threshold Registry**: `MONITOR_FLOOR = 0.40`, `DELIBERATE_FLOOR = 0.25`, `STABILITY_SOFT_CAP = 0.15`, `ETHICAL_SOFT_CAP = 0.10`
- **Behavioral Spec**: 4 inline scenarios covering reset, auto-end, yield logic, and MONITOR exemption

**Verdict**: A fresh agent given these artifacts could produce functionally identical code. All budget constants, floor/cap semantics, and yield logic are fully specified.

#### Case 3: Memory Subsystem — **PASS**

**Source files**: `episodic-memory.ts`, `semantic-memory.ts`, `memory-system.ts`, `interfaces.ts`, `retrieval.ts`, `types.ts` (memory)

Artifacts produced:
- **Decision**: Three-tier architecture (working + episodic + semantic) with MemorySystem facade chosen over unified store and two-tier
- **Contracts**: Full pre/post/invariants for `EpisodicMemory`, `SemanticMemory`, `MemorySystem` including all ranking formulas and snapshot integrity
- **Threshold Registry**: 7 constants including `DEFAULT_RECENCY_HALF_LIFE_MS`, `NO_EMBEDDING_SIMILARITY`, `MAX_SALIENCE_BOOST`, `DECAY_SCORE_THRESHOLD`, `CONFIDENCE_STEP`, `DEFAULT_WORKING_MEMORY_CAPACITY`, `DEFAULT_HALF_LIFE_MS`
- **Behavioral Spec**: 8 inline scenarios covering record/retrieve/decay/reinforce/consolidate/snapshot flows

**Verdict**: A fresh agent given these artifacts could produce functionally identical code. All three tiers, ranking formulas, consolidation algorithm, and snapshot integrity are fully specified.

### 6.2 Mechanical IMPLEMENT Criterion Assessment

For each case, the mechanical IMPLEMENT thought experiment was applied:

> Could a different agent with no memory, given only the artifact sections + File Manifest +
> read access to the existing codebase, produce functionally identical code?

| Case | Verdict | Notes |
|---|---|---|
| OAuth Authentication | **PASS** | All auth strategies, token validation, and system prompt formatting fully specified |
| Cognitive Budget Enforcement | **PASS** | All budget constants, floor/cap semantics, and yield logic fully specified |
| Memory Subsystem | **PASS** | All three tiers, ranking formulas, consolidation algorithm, and snapshot integrity fully specified |

### 6.3 Taxonomy Gap Summary

**No gaps found.** Every design decision, interface contract, numeric constant, and
behavioral flow discovered in all three validation cases maps cleanly to exactly one
artifact section type.

Cross-Cutting Note was not exercised (leaf-card-level validations only), but the
definition is sufficient for node card usage (confirmed by the "node cards only"
constraint).

---

## 7. Migration Guide

### 7.1 Overview

Migration from v1 (no artifact sections) to v2 (with artifact sections) is **gradual and
automatic**. No bulk migration is required. The system prompt drives agent behavior —
when the prompt changes, all future agent invocations follow the new rules.

### 7.2 Migration Steps

**Step 1: No immediate migration required**
Existing cards are backward compatible. Cards with no artifact sections remain valid per
the composition rules (§1.10, Rule 2: Section Optionality).

**Step 2: ARCHITECT applies new rules on entry/re-entry**
When a card enters or re-enters the ARCHITECT phase, the agent reads the updated system
prompt and applies the new artifact section rules. It determines which sections are needed
based on the "When Required" criteria and writes them using the content templates.

**Step 3: Existing [DONE] cards are not retroactively modified**
Cards already at `[DONE]` are not changed. They only gain artifact sections if they are
regressed (via Challenge) to ARCHITECT. This means the codebase will contain a mix of
v1 cards (no artifact sections) and v2 cards (with artifact sections) during the
transition period. This is acceptable — v1 cards are still valid.

**Step 4: System prompt changes take effect immediately**
All system prompt changes described in §4 take effect for all future agent invocations.
No deployment steps are needed beyond updating `system-prompt.ts`.

### 7.3 Timeline

Migration is gradual and automatic:
- **Day 1**: System prompt updated. All new cards and all cards entering ARCHITECT get v2 sections.
- **Ongoing**: As existing cards are revisited (regression, new work), they gain v2 sections.
- **Steady state**: Eventually all active cards have v2 sections. Old `[DONE]` cards without sections remain valid but frozen.

### 7.4 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agent ignores new section templates | Low | Medium | System prompt is the primary driver; templates are explicit and detailed |
| Existing cards fail structural gate | None | None | Gates are additive — they only apply to ARCHITECT→IMPLEMENT transitions, and only when sections are expected per keyword scan |
| Mixed v1/v2 cards cause confusion | Low | Low | v1 cards are valid v2 cards with zero artifact sections; the composition rules explicitly allow this |
| Agent over-applies sections | Low | Low | "When Optional" criteria prevent unnecessary sections; the cost of an extra section is minimal |

---

## Appendix A: Validation Checklist for REVIEW Phase

For REVIEW-phase verification, each artifact section has specific validation criteria:

| Section | Validation |
|---|---|
| Contracts | Every precondition is checked in implementation (assertion or type guard). Every postcondition is tested. Every invariant holds across all tests. |
| Decision | The implementation uses the chosen option. No alternative pattern was used instead. Consequences are visible in the code. |
| Behavioral Spec | Every Given/When/Then scenario has a corresponding test. All scenarios pass. |
| Threshold Registry | Every registered constant appears in code with the specified value. No unregistered magic numbers appear. |
| Cross-Cutting Note | Every child card's implementation is consistent with the noted concern. |
