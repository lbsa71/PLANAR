# Artifact Taxonomy — Architecture

> Produced by card 7.3 (Design New Artifact Taxonomy).
> Defines the complete set of artifact section types that compose within PLANAR cards.

## 1. Core Design Principle

Artifact types are **section templates**, not card types. A single card in its
ARCHITECT phase composes whichever artifact sections it needs. There is no
separate artifact lifecycle — sections are authored during ARCHITECT and
consumed during IMPLEMENT.

**Key invariants**:
- Every gap type from the 7.1 catalogue maps to exactly one artifact section
- No two artifact sections answer the same question
- Removing any section loses coverage of at least one gap type
- Node cards use only Cross-Cutting Note; leaf cards use the other four

## 2. Artifact Section Catalogue

### 2.1 Contracts Section

| Field | Value |
|---|---|
| **Name** | Contracts |
| **Question it answers** | What are the interface guarantees? |
| **Gap types covered** | IC (9), AC (3), CN (2), CF (1) = 15 gaps (36%) |
| **Reproducibility role** | Without this, agents invent interface shapes ad hoc — two agents produce incompatible types. With contracts, interface implementation becomes mechanical. |
| **Card integration** | Leaf card section in ARCHITECT phase |
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

### 2.2 Decision Section

| Field | Value |
|---|---|
| **Name** | Decision |
| **Question it answers** | Why this choice over alternatives? |
| **Gap types covered** | DP (7), TS (2), SE (3) = 12 gaps (29%) |
| **Reproducibility role** | Without this, agents re-derive design rationale from scratch and may choose differently. With decisions, agents implement the specified pattern rather than inventing alternatives. |
| **Card integration** | Leaf card section in ARCHITECT phase |
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
- Any card that selects a design pattern, library, data structure, or algorithm from among alternatives
- Any card that selects a technology or framework
- Any card where scope expanded beyond the original plan
- Estimated ~25% of leaf cards

#### When Optional
- Cards where the implementation approach is fully determined by parent card decisions
- Cards with no meaningful design choices (e.g., pure wiring/glue cards)

---

### 2.3 Behavioral Spec Section

| Field | Value |
|---|---|
| **Name** | Behavioral Spec |
| **Question it answers** | What exactly happens step by step? |
| **Gap types covered** | BS (6) = 6 gaps (14%) |
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

### 2.4 Threshold Registry Section

| Field | Value |
|---|---|
| **Name** | Threshold Registry |
| **Question it answers** | What are the tuning constants and their rationale? |
| **Gap types covered** | NT (9) = 9 gaps (21%) |
| **Reproducibility role** | Without this, agents invent magic numbers — each run produces different constants with no documented rationale. With the registry, agents use the specified values and can later tune them with the documented sensitivity information. |
| **Card integration** | Leaf card section in ARCHITECT phase — structured table |
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

### 2.5 Cross-Cutting Note

| Field | Value |
|---|---|
| **Name** | Cross-Cutting Note |
| **Question it answers** | What concern spans multiple children? |
| **Gap types covered** | XC (1) = 1 gap (2%) |
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

## 3. Complete Coverage Map

Every gap type from 7.1 maps to exactly one artifact section:

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

### Overlap Check

| Section Pair | Overlap? | Resolution |
|---|---|---|
| Contracts ↔ Decision | No | Contracts = "what guarantees"; Decision = "why this choice" |
| Contracts ↔ Behavioral Spec | No | Contracts = static properties; Behavioral Spec = dynamic flows |
| Contracts ↔ Threshold Registry | No | Contracts = type shapes; Threshold Registry = numeric values |
| Decision ↔ Behavioral Spec | No | Decision = "why"; Behavioral Spec = "what happens" |
| Decision ↔ Threshold Registry | No | Decision = pattern/tech choices; Threshold Registry = numeric constants |
| Behavioral Spec ↔ Threshold Registry | No | Behavioral Spec = step-by-step flows; Threshold Registry = isolated values |
| Cross-Cutting Note ↔ any | No | Cross-Cutting Note lives in node cards; all others in leaf cards |

## 4. Necessity Check

Each section is necessary — removing it loses gap coverage:

| If Removed | Gaps Lost | Count | % |
|---|---|---|---|
| Contracts | IC, AC, CN, CF | 15 | 36% |
| Decision | DP, TS, SE | 12 | 29% |
| Behavioral Spec | BS | 6 | 14% |
| Threshold Registry | NT | 9 | 21% |
| Cross-Cutting Note | XC | 1 | 2% |

No section can be removed without losing coverage. No section can absorb another's gaps (the questions they answer are distinct).

## 5. Phase Lifecycle Integration

| Phase | Artifact Activity |
|---|---|
| **PLAN** | No artifact sections. Card has only Description and AC. |
| **ARCHITECT** | All artifact sections are **authored** in this phase. The agent reads the card's Description and determines which sections are needed, then writes them. |
| **IMPLEMENT** | All artifact sections are **consumed** in this phase. The agent reads Contracts to define types, Decision to select patterns, Behavioral Spec to write tests, and Threshold Registry to set constants. |
| **REVIEW** | Artifact sections are **verified**: Do contracts match implementation? Do tests cover behavioral specs? Do constants match the registry? |
| **DONE** | Artifact sections are frozen. Changes require card regression. |

### ARCHITECT Phase Workflow

When an agent enters ARCHITECT for a leaf card:

1. Read Description and Acceptance Criteria
2. Determine which artifact sections are needed (using the "When Required" rules above)
3. Write each required section using the content template
4. Populate the File Manifest with all files that will be created or modified
5. If Behavioral Spec requires linked `.feature` files, add them to the manifest (but do NOT create them yet — that happens in IMPLEMENT)

### Section Ordering in Cards

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

## 6. Composition Rules

### Rule 1: Multiple Sections Per Card
A single card may contain any combination of artifact sections. Example: a card defining an authentication interface might have Decision (why OAuth over API keys) + Contracts (IAuthProvider shape) + Threshold Registry (token expiry timeout).

### Rule 2: Section Optionality
No section is universally mandatory. Each section has "When Required" criteria. A card with no design choices, no interfaces, no behaviors, and no thresholds needs zero artifact sections (but this should be rare — if a leaf card has none, it may be too trivial to be a card).

### Rule 3: Node vs Leaf
- **Node cards**: Only Cross-Cutting Note (in Description). Nodes do not have Contracts, Decision, Behavioral Spec, or Threshold Registry sections.
- **Leaf cards**: Any of the four non-cross-cutting sections. Leaves do not have Cross-Cutting Notes (they have no children to inherit them).

### Rule 4: Cross-Card References
A Threshold Registry may reference a parent card's Cross-Cutting Note. A Decision may reference a sibling card's Contracts. References use the standard `plan/<card>.md` path format.

### Rule 5: Promotion from Inline to Linked
Behavioral Specs promote from inline (Given/When/Then in AC) to linked (`.feature` file) when:
- More than 3 scenarios
- Multi-step state transitions
- Scenario Outlines with parameterized examples

No other section type has a linked-artifact variant — Contracts, Decision, and Threshold Registry are always inline card sections.

## 7. Validation Checklist

For REVIEW-phase verification, each artifact section has specific validation criteria:

| Section | Validation |
|---|---|
| Contracts | Every precondition is checked in implementation (assertion or type guard). Every postcondition is tested. Every invariant holds across all tests. |
| Decision | The implementation uses the chosen option. No alternative pattern was used instead. Consequences are visible in the code. |
| Behavioral Spec | Every Given/When/Then scenario has a corresponding test. All scenarios pass. |
| Threshold Registry | Every registered constant appears in code with the specified value. No unregistered magic numbers appear. |
| Cross-Cutting Note | Every child card's implementation is consistent with the noted concern. |
