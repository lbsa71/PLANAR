# Taxonomy v2 Specification — Architecture

> Produced by card 7.6 (Taxonomy Specification).
> Defines the exact structure and content plan for `docs/taxonomy-v2-specification.md`.

## Purpose

The specification document consolidates outputs from cards 7.3, 7.4, and 7.5 into a
single self-contained document. A reader should not need to consult the source
architecture docs to understand it. The document must be precise enough that an
implementation team can build the v2 taxonomy without judgment calls.

## Document Structure

The specification has 7 sections matching the card's requirements:

### Section 1: Artifact Type Catalogue

**Source**: `artifact-taxonomy-ARCHITECTURE.md` §2 (complete catalogue)

Content for each of the 5 artifact section types:
- Name, question it answers, gap types covered
- Content template (markdown)
- Format rules
- When Required / When Optional criteria
- Reproducibility role
- Card integration (where it lives in a card)
- Relationships to other sections

Also includes:
- Coverage map (§3 from source) — every gap type maps to exactly one section
- Overlap check — no two sections answer the same question
- Necessity check — removing any section loses gap coverage
- Composition rules (§6 from source) — multiple sections per card, optionality, node vs leaf, cross-card references, promotion rules

### Section 2: Phase Lifecycle

**Source**: `phase-lifecycle-ARCHITECTURE.md` (complete lifecycle)

Content:
- Phase sequence: PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE
- For each phase: purpose, artifact activity, read/write permissions, entry criteria, exit criteria
- Artifact-phase mapping summary (authored in / consumed in / verified in)
- Transition gate definitions (structural, completeness, semantic)
- Gate check specifications (automatable regex patterns)
- Gate failure behavior
- Isolation matrix (full read/write permission table)
- Mechanical IMPLEMENT criterion (formal statement + corollary)

### Section 3: Card Schema Changes

**Source**: Derived from artifact-taxonomy-ARCHITECTURE.md §5 + §6, cross-referenced with current `types.ts`

Content:
- New card sections: Decision, Contracts, Threshold Registry (as markdown sections, not frontmatter fields)
- Section ordering rule: Decision → Contracts → Threshold Registry → File Manifest → AC
- No new YAML frontmatter fields required (artifact sections are markdown content, not structured data)
- Backward compatibility: existing cards with no artifact sections remain valid (sections are optional per composition rules)
- Migration path: existing cards in PLAN or ARCHITECT gain sections when they enter/re-enter ARCHITECT

### Section 4: System Prompt Changes

**Source**: Current `system-prompt.ts` + phase-lifecycle-ARCHITECTURE.md §2

Changes needed in `system-prompt.ts`:
- ARCHITECT phase prompt: add artifact section authoring instructions (section templates, "When Required" rules, ordering, workflow)
- IMPLEMENT phase prompt: add mechanical criterion, mandatory regression rules, artifact consumption workflow
- REVIEW phase prompt: add artifact-vs-implementation verification method, mandatory/optional regression triggers
- PLAN phase prompt: add exit criteria mentioning testable AC
- No changes to node card prompts (nodes use only Cross-Cutting Note in Description, which needs no prompt changes)

Exact prompt text changes will be specified inline in the specification document.

### Section 5: Type System Changes

**Source**: Current `types.ts` + artifact-taxonomy-ARCHITECTURE.md

Assessment: **No type changes required.**

Rationale:
- Artifact sections are unstructured markdown content within card files
- The `Card` interface already has `rawContent: string` which contains all sections
- No new phase values needed (`LeafPhase` already has all 5 phases)
- No new frontmatter fields needed (sections are markdown, not YAML)
- The system prompt (not types) drives agent behavior

If future implementation wants structured artifact parsing, new types would be:
- `ArtifactSection` union type (Decision | Contracts | ThresholdRegistry | BehavioralSpec | CrossCuttingNote)
- Per-section interfaces for structured data extraction
- But this is out of scope for the v2 specification (the spec defines the taxonomy, not a parser for it)

### Section 6: Validation Report

**Source**: `validation-report.md` (complete report)

Content (summarized from source):
- 3 validation cases: OAuth Authentication (PASS), Cognitive Budget (PASS), Memory Subsystem (PASS)
- Mechanical IMPLEMENT criterion assessment: all 3 cases PASS
- Taxonomy gap summary: no gaps found
- Cross-Cutting Note note: not exercised (leaf-card validations only), but definition is sufficient

### Section 7: Migration Guide

**Source**: Derived from all upstream docs

Content:
- Step 1: No immediate migration required — existing cards are backward compatible
- Step 2: When a card enters/re-enters ARCHITECT, the agent applies the new artifact section rules
- Step 3: Existing [DONE] cards are not retroactively modified (only on regression)
- Step 4: System prompt changes take effect for all future agent invocations
- Timeline: migration is gradual and automatic — the system prompt drives behavior, not card format changes

## Specification Document Format

The specification document uses:
- Numbered sections (1–7) with subsections
- Markdown tables for structured data (coverage maps, isolation matrix, threshold registries)
- Code blocks for templates and prompt text
- Self-contained — all templates and rules reproduced inline (not by reference)

## Implementation Note

Since this card's deliverable is a documentation file (not source code), the actual
specification document (`docs/taxonomy-v2-specification.md`) will be written during
IMPLEMENT. The file path is at docs root level since it's a cross-domain deliverable
consumed by future implementation subtrees, not scoped to the artifact-taxonomy domain.
