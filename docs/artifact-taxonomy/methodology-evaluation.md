# Methodology Evaluation for PLANAR Artifact Taxonomy

> Produced by card 7.2 (Evaluate Standard Methodologies).
> Evaluates 5 methodologies against the 42-gap / 10-type taxonomy from 7.1.

## 1. Executive Summary

Three methodologies are recommended for selective adoption into PLANAR's card
model: **Design-by-Contract (DbC)** for interface contracts (9 IC gaps),
**ADRs** for design pattern rationale (7 DP gaps), and **BDD/Gherkin** for
behavioral specifications (6 BS gaps). Together these cover 22 of the 31
top-priority gaps (71%). **Arc42** and **C4 Model** are rejected — their
overhead exceeds their marginal coverage gain given what the other three
already provide. **Numeric Thresholds (NT, 9 gaps, 21%)** remain uncovered
by any standard methodology and require a custom artifact type in 7.3.

## 2. Coverage Matrix

### 5 Methodologies x 10 Gap Types

| Gap Type | Code | Count | ADRs | Arc42 | C4 | BDD/Gherkin | DbC |
|---|---|---|---|---|---|---|---|
| Interface Contract | IC | 9 | ○ | ○ | — | — | **●●** |
| Numeric Threshold | NT | 9 | — | — | — | — | — |
| Design Pattern | DP | 7 | **●●** | ● | ○ | — | — |
| Behavioral Spec | BS | 6 | — | — | — | **●●** | ● |
| API Contract | AC | 3 | ○ | ● | — | — | **●●** |
| Scope Extension | SE | 3 | ● | ● | — | — | — |
| Constraint | CN | 2 | ○ | ●● | — | — | **●●** |
| Technology Selection | TS | 2 | **●●** | ● | — | — | — |
| Configuration | CF | 1 | ○ | ● | — | — | — |
| Cross-Cutting | XC | 1 | ● | **●●** | ○ | — | — |

**Legend**: ●● Strong (directly addresses) | ● Partial (addresses with adaptation) | ○ Weak (tangential) | — None

### Column Totals (Strong + Partial coverage)

| Methodology | Strong (●●) types | Partial (●) types | Total coverage types |
|---|---|---|---|
| DbC | 3 (IC, AC, CN) | 1 (BS) | 4 |
| ADRs | 2 (DP, TS) | 2 (SE, XC) | 4 |
| BDD/Gherkin | 1 (BS) | 0 | 1 |
| Arc42 | 2 (CN, XC) | 4 (DP, AC, SE, CF) | 6 |
| C4 | 0 | 0 | 0 |

### Row Totals (Gap types with at least one Strong methodology)

| Gap Type | Covered by (Strong) | Gaps addressed |
|---|---|---|
| IC (9) | DbC | 9 |
| DP (7) | ADRs | 7 |
| BS (6) | BDD/Gherkin | 6 |
| CN (2) | DbC, Arc42 | 2 |
| AC (3) | DbC | 3 |
| TS (2) | ADRs | 2 |
| XC (1) | Arc42 | 1 |
| **NT (9)** | **None** | **0** |
| SE (3) | None (partial only) | 0 |
| CF (1) | None (partial only) | 0 |

**30 of 42 gaps** (71%) have at least one Strong-fit methodology.
**9 NT gaps** (21%) have no methodology coverage at all.

## 3. Per-Methodology Assessments

### 3.1 Architecture Decision Records (ADRs)

**What it provides**: Structured documents capturing the status, context,
decision, and consequences of significant architectural choices. Nygard's
format forces explicit trade-off documentation — why option A was chosen
over options B and C, and what the downstream effects are.

**Gap coverage**: Strong for **DP** (7 gaps — captures "why this pattern")
and **TS** (2 gaps — captures "why this technology"). Partial for **SE** (scope
decisions that expanded beyond plan), **XC** (cross-cutting strategy rationale).
Weak for IC, CN, CF — ADRs can mention these but don't specify them precisely.

**Card-model mapping**: **Card Section** — a lightweight "Decision" section
in ARCHITECT-phase cards. An ADR is typically 1-2 paragraphs; this fits
naturally as a card section rather than a separate document. When a card's
ARCHITECT phase selects a design pattern or technology, the Decision section
captures: (1) options considered, (2) choice made, (3) rationale,
(4) consequences.

*Mapping rationale*: Full standalone ADR documents would violate "one card =
one file = one agent" or create a parallel document tree. Inline sections
keep the decision co-located with the implementation specification.

**Overhead**: **Low** (≤5 min per card). Only cards that make significant
design/technology choices need the section. Most IMPLEMENT-phase cards inherit
decisions from parent cards. Estimated 20-30% of leaf cards need a Decision
section.

**Reproducibility gain**: **Medium**. Eliminates the gap where an agent must
re-derive design rationale from scratch. With explicit pattern documentation,
agents can implement the specified pattern rather than inventing their own.
Does not make IMPLEMENT fully mechanical — DP gaps are about "why," not "how."

**Recommendation**: **Adopt** — Decision section in ARCHITECT-phase cards.

**Rationale**: Covers 9 of 42 gaps (DP+TS) at low overhead. The format is
simple enough to be mandatory without burdening cards that don't need it
(the section is simply omitted when no significant decision exists).

### 3.2 Arc42

**What it provides**: A 12-section architecture documentation template
covering: introduction, constraints, context, solution strategy, building
blocks, runtime view, deployment view, cross-cutting concepts, design
decisions, quality requirements, risks, and glossary.

**Gap coverage**: Strong for **CN** (2 gaps — explicit constraints section)
and **XC** (1 gap — cross-cutting concepts section). Partial for **DP**
(design decisions section overlaps with ADRs), **AC** (building blocks can
document API shapes), **SE** (can capture scope rationale), **CF**
(deployment view covers config). No coverage of IC, NT, BS.

**Card-model mapping**: **Linked Artifact** — Arc42 is fundamentally a
per-system or per-domain template, not a per-card format. It would be a
reference document linked from domain-level cards, not inlined.

*Mapping tension*: Arc42's sections overlap significantly with PLANAR's
existing card structure (description = context, AC = quality requirements).
Adding Arc42 creates redundancy rather than filling gaps.

**Overhead**: **High** (>15 min per domain). Maintaining a full 12-section
template alongside the card tree creates parallel documentation burden.
Even selective adoption of 3-4 sections adds significant authoring cost.

**Reproducibility gain**: **Low-Medium**. The 3 gaps it uniquely covers
(CN=2, XC=1) total only 3 gaps. The constraint and cross-cutting information
can be captured more efficiently as card sections without Arc42's formalism.

**Recommendation**: **Reject**.

**Rationale**: Arc42's unique coverage is only 3 gaps (7% of 42), all of
which can be handled by simpler mechanisms. CN (2 gaps) maps well to DbC's
invariants. XC (1 gap) can be a simple note in a parent card's Description.
The overhead of maintaining a parallel 12-section template far exceeds the
marginal reproducibility gain. ADRs already cover the design-decision section,
making Arc42 largely redundant.

### 3.3 C4 Model

**What it provides**: Four hierarchical abstraction levels for system
visualization — Context (system boundary), Container (deployable units),
Component (internal modules), Code (class-level detail).

**Gap coverage**: No **Strong** coverage of any gap type. Weak relevance
to DP (zoom levels may clarify where a pattern applies) but does not
specify the pattern itself. No coverage of IC, NT, BS, AC, CN, TS, CF, SE.

**Card-model mapping**: **Card Section** — an optional `abstraction-level:`
tag in YAML frontmatter. PLANAR's dot-path hierarchy already provides
implicit zoom levels (root → domain → subsystem → leaf). An explicit tag
could formalize this but adds no information the agent can act on during
IMPLEMENT.

*Key finding*: PLANAR's dot-path decomposition already provides the
primary benefit of C4 (hierarchical zoom). The dot-path `7.2` implicitly
communicates "this is a component within domain 7." Adding explicit
abstraction-level metadata is redundant.

**Overhead**: **Low** (just a frontmatter tag). But even low overhead
is unjustified when the gain is zero.

**Reproducibility gain**: **None**. No gap type benefits from explicit
abstraction-level labeling. The LLM agent doesn't change its IMPLEMENT
behavior based on whether a card is labeled "Component" vs "Container."

**Recommendation**: **Reject**.

**Rationale**: PLANAR's dot-path hierarchy already provides C4's primary
value proposition (hierarchical zoom levels). C4 covers zero of the top-4
gap types. Adding abstraction-level metadata would be cosmetic — it cannot
reduce implementation variance because it doesn't specify what to build,
only where in the hierarchy you are.

### 3.4 BDD/Gherkin

**What it provides**: A structured syntax for behavioral specifications
using Given/When/Then scenarios. Forces precise specification of
preconditions, actions, and expected outcomes.

**Gap coverage**: Strong for **BS** (6 gaps — directly formalizes behavioral
flows like "setup-token flow," "consolidation algorithm," "escalation logic").
Partial for nothing else — Gherkin is narrowly focused on behavior.

**Card coverage specifics** (from 7.1 BS gaps):
- OAuth setup-token flow → `Given a user without credentials, When they run setup, Then they are prompted for a setup token and credentials are persisted`
- Verdict determination algorithm → `Given an action with severity > 0.95, When ethical evaluation runs, Then verdict is "blocked"`
- Consolidation algorithm → `Given memories exceeding capacity, When consolidation runs, Then episodes are merged by modality`
- Snapshot integrity verification → `Given a corrupted snapshot hash, When verification runs, Then an error is thrown`
- Wait state / deadline checking → `Given a plan step with a deadline, When the deadline passes, Then the step is escalated`
- Escalation and abandonment → `Given escalation count > threshold, When escalation triggers, Then the plan is abandoned`

**Card-model mapping**: **Hybrid** — simple Given/When/Then inline in the
Acceptance Criteria section of ARCHITECT-phase cards; complex multi-scenario
flows as linked `.feature` files in the file manifest.

*Threshold for promotion*: If a behavioral spec requires >3 scenarios or
involves multi-step state transitions, it should be a linked artifact.
Single-scenario behaviors belong inline.

*Key advantage*: Gherkin scenarios are directly consumable by LLM agents
in IMPLEMENT phase. The format is unambiguous enough to make test writing
nearly mechanical — the agent translates Given/When/Then directly into
test setup/action/assertion.

**Overhead**: **Low-Medium** (5-10 min for inline scenarios; 10-15 min for
complex `.feature` files). Only the ~15% of cards with behavioral
specifications need this format. The overhead is justified because BS gaps
are the 4th largest category.

**Reproducibility gain**: **High**. Gherkin specifications make IMPLEMENT
nearly mechanical for behavioral logic. Given/When/Then maps directly to
test cases, and the implementation must satisfy those exact scenarios.
This is the highest reproducibility gain of any evaluated methodology.

**Recommendation**: **Adopt** — Hybrid: inline Given/When/Then in AC
section for simple behaviors; linked `.feature` files for complex flows.

**Rationale**: Covers 6 of 42 gaps (BS) with the highest reproducibility
gain of any methodology. The Gherkin format is uniquely suited to LLM
consumption — it's precise enough to eliminate ambiguity yet human-readable
enough for ARCHITECT-phase authoring. The hybrid mapping avoids bloating
simple cards while supporting complex specifications.

### 3.5 Design-by-Contract (DbC)

**What it provides**: Formal specification of interface behavior through
three elements: preconditions (what must be true before a method call),
postconditions (what must be true after), and invariants (what must always
be true about a type/module).

**Gap coverage**: Strong for **IC** (9 gaps — directly specifies interface
shapes like IAuthProvider, EthicalPattern, ContinuityToken), **AC** (3 gaps
— API contracts are a special case of interface contracts), and **CN**
(2 gaps — invariants capture constraints like "token must match prefix
`sk-ant-oat01-`"). Partial for **BS** (postconditions can specify behavioral
outcomes, but Gherkin is better for multi-step flows).

**Card coverage specifics** (from 7.1 IC gaps):
- IAuthProvider interface shape → Precondition: takes config object; Postcondition: returns valid auth headers; Invariant: header format `anthropic-version: 2023-06-01`
- EthicalPattern learned heuristic → Invariant: must contain pattern string + confidence score; Precondition: confidence ∈ [0,1]
- 60+ ethical-governance type shapes → Invariant: each type's required fields
- ISemanticMemory / IWorkingMemory contracts → Pre/postconditions on each method
- ContinuityToken, PhenomenalField, IntentionalField → Invariant: required field sets and valid value ranges
- ExperientialState (7 fields), ConsciousnessMetrics (4 fields) → Invariant: complete field specification

**Card-model mapping**: **Card Section** — a "Contracts" section in
ARCHITECT-phase cards with three subsections: Preconditions, Postconditions,
Invariants. Each is a bulleted list of formal constraints.

*Format example*:
```markdown
## Contracts
### Preconditions
- `config.type` must be one of: 'oauth' | 'setup-token' | 'api-key'
- `config.credentials` must be a non-empty string

### Postconditions
- Returns `Record<string, string>` with at minimum `anthropic-version` key
- Returned headers pass Anthropic API validation

### Invariants
- `anthropic-version` header is always `'2023-06-01'`
- `user-agent` header matches pattern `claude-cli/<semver>`
```

*Key advantage*: Contracts are directly testable. An LLM agent in IMPLEMENT
can generate runtime assertions or type guards directly from the contract
specification. This makes interface implementation nearly mechanical.

**Overhead**: **Medium** (5-15 min per card). Only cards that define or
consume interfaces need the section (~30% of leaf cards based on the 7.1
audit). The authoring cost is moderate because contract specification
requires precise thinking about edge cases.

**Reproducibility gain**: **High**. DbC specifications are the most
directly translatable to code of any methodology evaluated. Pre/postconditions
become runtime assertions or type guards. Invariants become property-based
tests. Two agents given the same DbC spec will produce structurally
identical implementations.

**Recommendation**: **Adopt** — Contracts section (Preconditions /
Postconditions / Invariants) in ARCHITECT-phase cards.

**Rationale**: Covers 14 of 42 gaps (IC+AC+CN) — the largest single
coverage of any methodology. IC is tied for the largest gap type (9 gaps,
21%). DbC's formal structure produces the highest implementation
reproducibility alongside BDD/Gherkin. The medium overhead is justified
by the high gap count and high reproducibility gain.

## 4. Adoption Recommendations

Ordered by gap coverage (largest first):

### 4.1 Design-by-Contract — Contracts Section
- **Covers**: IC (9), AC (3), CN (2) = **14 gaps** (33% of 42)
- **Mapping**: Card Section — "Contracts" with Pre/Post/Invariant subsections
- **When required**: Any card that defines or modifies an interface, API, or type contract
- **Overhead**: Medium (5-15 min per applicable card; ~30% of leaf cards)
- **Integration point**: ARCHITECT phase — contracts are specified before IMPLEMENT

### 4.2 Architecture Decision Records — Decision Section
- **Covers**: DP (7), TS (2) = **9 gaps** (21% of 42)
- **Mapping**: Card Section — "Decision" with options/choice/rationale/consequences
- **When required**: Any card that selects a design pattern or technology
- **Overhead**: Low (≤5 min per applicable card; ~20-30% of leaf cards)
- **Integration point**: ARCHITECT phase — decisions are recorded when made

### 4.3 BDD/Gherkin — Behavioral Specifications
- **Covers**: BS (6) = **6 gaps** (14% of 42)
- **Mapping**: Hybrid — inline Given/When/Then in AC section; linked `.feature` files for complex flows (>3 scenarios or multi-step state transitions)
- **When required**: Any card specifying behavioral flows, algorithms, or state transitions
- **Overhead**: Low-Medium (5-10 min inline; 10-15 min for `.feature` files; ~15% of leaf cards)
- **Integration point**: ARCHITECT phase for spec; IMPLEMENT phase consumes and translates to tests

### Combined Coverage

| Adoption | Gap Types Covered | Gap Count | % of 42 |
|---|---|---|---|
| DbC (Contracts) | IC, AC, CN | 14 | 33% |
| ADRs (Decision) | DP, TS | 9 | 21% |
| BDD/Gherkin (Behavioral) | BS | 6 | 14% |
| **Total adopted** | **6 of 10 types** | **29** | **69%** |
| Uncovered | NT, SE, CF, XC | 13 | 31% |

## 5. Rejection Rationale

### 5.1 Arc42 — Rejected

**Primary reason**: Overhead far exceeds marginal coverage gain. Arc42's
unique coverage is only 3 gaps (XC=1, and CN=2 which DbC already covers
better). The 12-section template creates a parallel documentation tree
that conflicts with PLANAR's "one card = one file" principle.

**Secondary reason**: Significant redundancy with adopted methodologies.
Arc42's design-decisions section overlaps with ADRs. Its quality-requirements
section overlaps with card Acceptance Criteria. Its building-blocks section
overlaps with dot-path decomposition.

**What to do instead**: XC (1 gap) can be documented as a note in the
parent domain card's Description section. CN (2 gaps) is fully covered by
DbC's invariants.

### 5.2 C4 Model — Rejected

**Primary reason**: Zero gap coverage. PLANAR's dot-path hierarchy already
provides the hierarchical zoom levels that C4 offers. Adding explicit
`abstraction-level:` metadata provides no actionable information to
IMPLEMENT-phase agents.

**Secondary reason**: No methodology-specific content to adopt. C4 is
a visualization/communication framework, not a specification methodology.
PLANAR's challenge is specification precision, not visualization.

## 6. Remaining Gaps

### 6.1 Numeric Thresholds (NT) — 9 gaps, 21% of total

**Status**: Completely uncovered by any standard methodology.

**Nature of gaps**: Hardcoded constants, tuning parameters, and magic numbers
that materially affect system behavior but appear nowhere in plan artifacts:
- PHI_DELIBERATION_BOOST=0.15, MIN_CONSCIOUS_PHI=0.3
- BLOCK_SEVERITY_THRESHOLD=0.95, UNCERTAINTY_CERTAINTY_THRESHOLD=0.5
- DEFAULT_WORKING_MEMORY_CAPACITY=7, DEFAULT_HALF_LIFE_MS=7 days
- Richness heuristic (0.7 vs 0.3), default valence/arousal/unity values
- Six core axiom texts as constants

**Recommendation for 7.3**: Design a custom **Threshold Registry** artifact
type. This should be a structured format (likely a table or YAML block)
within ARCHITECT-phase cards that enumerates: constant name, value, unit,
valid range, rationale for chosen value, and sensitivity (how much does
system behavior change if this value changes by 10%?).

### 6.2 Scope Extension (SE) — 3 gaps, 7%

**Status**: Partially covered by ADRs (a scope extension is a type of
decision). Not severe enough to warrant a dedicated artifact type.

**Recommendation for 7.3**: Handle through ADR Decision sections — when
scope extends beyond the original plan, the decision to extend and its
rationale should be captured in the Decision section of the relevant card.

### 6.3 Configuration (CF) — 1 gap, 2%

**Status**: Partially covered by DbC invariants (configuration paths and
defaults can be specified as invariants). Too small a category to warrant
dedicated treatment.

**Recommendation for 7.3**: Handle through DbC Contracts sections —
configuration choices are specified as invariants (e.g., "credentials
path is always `~/.master-plan/credentials.json`").

### 6.4 Cross-Cutting (XC) — 1 gap, 2%

**Status**: Would be covered by Arc42, but Arc42 was rejected due to
overhead. Only 1 gap in this category.

**Recommendation for 7.3**: Handle through parent card Description
sections — cross-cutting concerns are documented in domain-level (node)
cards and inherited by children. No new artifact type needed.
