# Methodology Evaluation — Architecture

> Produced by card 7.2 (Evaluate Standard Methodologies).
> Defines the structure of the evaluation document and the assessment framework.

## Purpose

Evaluate five software engineering methodologies against the 42-gap / 10-type
taxonomy from 7.1, determining which elements to adopt into PLANAR's card model
and how they map structurally.

## Input: Gap Catalogue Summary (from 7.1)

| Type | Code | Count | % of 42 |
|---|---|---|---|
| Interface Contract | IC | 9 | 21% |
| Numeric Threshold | NT | 9 | 21% |
| Design Pattern | DP | 7 | 17% |
| Behavioral Spec | BS | 6 | 14% |
| API Contract | AC | 3 | 7% |
| Scope Extension | SE | 3 | 7% |
| Constraint | CN | 2 | 5% |
| Technology Selection | TS | 2 | 5% |
| Configuration | CF | 1 | 2% |
| Cross-Cutting | XC | 1 | 2% |

**Top-4 gap types** (IC, NT, DP, BS) account for 31 of 42 gaps (74%).
The evaluation should prioritize methodologies that address these four.

## Candidates

| # | Methodology | Core Idea |
|---|---|---|
| 1 | Architecture Decision Records (ADRs) | Structured decision capture: status, context, decision, consequences |
| 2 | Arc42 | 12-section architecture template covering constraints, quality, deployment, runtime |
| 3 | C4 Model | 4 zoom levels: Context → Container → Component → Code |
| 4 | BDD/Gherkin | Given/When/Then behavioral specifications |
| 5 | Design-by-Contract (DbC) | Preconditions, postconditions, invariants on interfaces |

## Assessment Framework

Each candidate is evaluated on three axes:

### Axis 1: Gap-Type Coverage (5×10 matrix)

For each (methodology, gap-type) cell, assign a fit rating:

| Rating | Symbol | Meaning |
|---|---|---|
| **Strong** | ●● | Methodology directly and naturally addresses this gap type |
| **Partial** | ● | Methodology can address this gap type with adaptation |
| **Weak** | ○ | Methodology tangentially relates but is not designed for this |
| **None** | — | No meaningful coverage |

A methodology must have **Strong** coverage on at least one of the top-4
gap types (IC, NT, DP, BS) to be worth adopting.

### Axis 2: PLANAR Card-Model Mapping

For each methodology, assess the most natural integration point:

| Mapping | Description |
|---|---|
| **Card Type** | The methodology artifact becomes a new kind of card (e.g., an ADR card) with its own lifecycle |
| **Card Section** | The methodology's structure becomes a required or optional section within existing cards (e.g., a "Contracts" section in ARCHITECT-phase cards) |
| **Linked Artifact** | The methodology artifact is a separate document linked from cards via file manifest (e.g., a Gherkin `.feature` file) |
| **Hybrid** | Combination — e.g., lightweight inline section for simple cases, promoted to linked artifact when complex |

Assessment criteria:
- Does the mapping preserve PLANAR's "one card = one file = one agent" principle?
- Does it add mandatory overhead to cards that don't need it?
- Can an LLM agent in IMPLEMENT phase consume this format mechanically?

### Axis 3: Overhead vs Reproducibility

For each methodology, estimate:

- **Authoring overhead**: How much extra work during ARCHITECT phase?
  - Low: ≤5 min per card | Medium: 5–15 min | High: >15 min
- **Reproducibility gain**: How much does this reduce implementation variance between agents?
  - Low: marginal | Medium: eliminates some ambiguity | High: makes IMPLEMENT nearly mechanical

The ratio of gain-to-overhead determines adoption priority.

## Evaluation Document Structure

The output document (`docs/artifact-taxonomy/methodology-evaluation.md`) will have:

```
# Methodology Evaluation for PLANAR Artifact Taxonomy

## 1. Executive Summary
- Which elements adopted, which rejected, one-paragraph rationale

## 2. Coverage Matrix
- 5×10 table with fit ratings
- Row and column totals
- Heat map narrative: which gap types remain uncovered

## 3. Per-Methodology Assessments

### 3.N <Methodology Name>
- **What it provides**: 2-3 sentence summary
- **Gap coverage**: which types it addresses (Strong/Partial)
- **Card-model mapping**: Card Type / Card Section / Linked Artifact / Hybrid
- **Overhead**: Low / Medium / High with justification
- **Reproducibility gain**: Low / Medium / High with justification
- **Recommendation**: Adopt (which elements) / Reject
- **Rationale**: Tied to specific gap types and overhead tradeoff

## 4. Adoption Recommendations
- Ordered list of elements to adopt
- For each: what gap types it covers, how it maps to cards, expected overhead

## 5. Rejection Rationale
- For each rejected element: why overhead exceeds reproducibility gain,
  or why another adopted element already covers its gap types

## 6. Remaining Gaps
- Any gap types not addressed by any adopted methodology
- Recommendations for 7.3 (design artifact taxonomy) on how to handle these
```

## Preliminary Assessment (ARCHITECT-phase analysis)

These are directional hypotheses to be validated/refined in IMPLEMENT:

| Methodology | Expected Strength | Expected Mapping |
|---|---|---|
| **ADRs** | DP (7), TS (2), XC (1) — captures "why" behind patterns and technology choices | Card Section (lightweight "Decision" section in ARCHITECT-phase cards) |
| **Arc42** | CF (1), XC (1), AC (3) — cross-cutting and deployment concerns | Linked Artifact (too heavyweight for inline; useful as a per-domain reference doc) |
| **C4 Model** | Partial overlap with dot-path hierarchy; may add explicit zoom-level metadata | Card Section (optional `abstraction-level:` tag in frontmatter) |
| **BDD/Gherkin** | BS (6) — directly formalizes behavioral specifications | Hybrid (simple Given/When/Then inline in AC section; complex flows as linked `.feature` files) |
| **DbC** | IC (9), CN (2) — directly specifies interface shapes and constraints | Card Section (Preconditions/Postconditions/Invariants section in ARCHITECT cards) |

The top-4 gap types map to specific methodologies:
- **IC (9)**: DbC (Strong)
- **NT (9)**: None directly — may need a custom "Threshold Registry" artifact type
- **DP (7)**: ADRs (Strong)
- **BS (6)**: BDD/Gherkin (Strong)

**NT is the critical gap** — no standard methodology directly addresses numeric
thresholds/tuning constants. The evaluation document must explicitly flag this for 7.3.

## File Dependencies

- **Input**: `docs/audit-traceability/gap-catalogue.md` (7.1 output) — classification taxonomy and 42 gap entries
- **Input**: `docs/audit-traceability/ARCHITECTURE.md` (7.1 architecture) — gap type definitions
- **Output**: `docs/artifact-taxonomy/methodology-evaluation.md` — the evaluation document

## Acceptance Criteria Traceability

| Card AC | How the evaluation addresses it |
|---|---|
| "5 candidates evaluated against 10-type gap taxonomy" | Section 3: one subsection per methodology, all 10 types assessed |
| "Coverage matrix: 5×10 with fit rating" | Section 2: explicit matrix table |
| "Card-model mapping assessment" | Section 3.N: Card Type/Section/Linked Artifact/Hybrid per methodology |
| "Recommendation with rationale tied to gap coverage" | Section 4: adoption list with gap-type justification |
| "Rejection rationale for elements not adopted" | Section 5: explicit rejection entries |
| "Output in docs/artifact-taxonomy/" | Document path: `docs/artifact-taxonomy/methodology-evaluation.md` |
