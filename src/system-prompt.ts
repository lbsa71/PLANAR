import { Card, LeafPhase } from "./types.js";
import { isPhase } from "./card.js";
import { parseCardSections } from "./section-parser.js";
import {
  IFACE_KEYWORDS,
  CHOICE_KEYWORDS,
  THRESHOLD_KEYWORDS,
  FLOW_KEYWORDS,
} from "./gate-checks.js";

/**
 * Build a human-readable artifact inventory from the card's current content.
 * Shows which sections are present, missing, or incomplete so the agent
 * knows exactly what needs work without re-reading the card.
 */
export function buildArtifactInventory(card: Card): string {
  const sections = parseCardSections(card.rawContent);
  const lines: string[] = [
    "## Artifact Inventory (auto-detected from current card content)",
    "| Section | Status |",
    "|---|---|",
  ];

  // Description
  if (sections.description.present) {
    lines.push(`| Description | Present (${sections.description.wordCount} words) |`);
  } else {
    lines.push("| Description | **Missing** |");
  }

  // Decision
  if (sections.decision.present) {
    const subs = sections.decision.subsections;
    const subStatus = [
      `Context: ${subs.context ? "yes" : "**no**"}`,
      `Options: ${subs.optionsConsidered ? `yes (${sections.decision.optionCount})` : "**no**"}`,
      `Choice: ${subs.choice ? "yes" : "**no**"}`,
      `Rationale: ${subs.rationale ? "yes" : "**no**"}`,
      `Consequences: ${subs.consequences ? "yes" : "**no**"}`,
    ].join(", ");
    lines.push(`| Decision | Present (${subStatus}) |`);
  } else {
    lines.push("| Decision | Not present |");
  }

  // Contracts
  if (sections.contracts.present) {
    const subs = sections.contracts.subsections;
    const bullets = sections.contracts.subsectionBullets;
    const subStatus = [
      `Preconditions: ${subs.preconditions ? `yes (${bullets.preconditions} bullets)` : "**no**"}`,
      `Postconditions: ${subs.postconditions ? `yes (${bullets.postconditions} bullets)` : "**no**"}`,
      `Invariants: ${subs.invariants ? `yes (${bullets.invariants} bullets)` : "**no**"}`,
    ].join(", ");
    lines.push(`| Contracts | Present (${subStatus}) |`);
  } else {
    lines.push("| Contracts | Not present |");
  }

  // Threshold Registry
  if (sections.thresholdRegistry.present) {
    const rowCount = sections.thresholdRegistry.rows.length;
    const cellStatus = sections.thresholdRegistry.hasEmptyCells ? ", **has empty cells**" : ", complete";
    lines.push(`| Threshold Registry | Present (${rowCount} rows${cellStatus}) |`);
  } else {
    lines.push("| Threshold Registry | Not present |");
  }

  // Behavioral Spec
  const bsParts: string[] = [];
  if (sections.behavioralSpec.inlineDetected) bsParts.push("inline GWT detected");
  if (sections.behavioralSpec.linkedFeatureFiles.length > 0) {
    bsParts.push(`${sections.behavioralSpec.linkedFeatureFiles.length} linked .feature file(s)`);
  }
  lines.push(`| Behavioral Spec | ${bsParts.length > 0 ? bsParts.join(", ") : "Not present"} |`);

  // File Manifest & AC
  lines.push(`| File Manifest | ${card.fileManifest.length} entries |`);
  const acBullets = (card.rawContent.match(/^## Acceptance Criteria\s*\n([\s\S]*?)(?=\n## |\n*$)/m)?.[1] ?? "")
    .split("\n").filter((l) => /^\s*- /.test(l)).length;
  lines.push(`| Acceptance Criteria | ${acBullets} bullets |`);

  // Action needed — pre-compute what the gate would flag
  const descText = sections.description.present
    ? (card.rawContent.match(/^## Description\s*\n([\s\S]*?)(?=\n## |\n*$)/m)?.[1] ?? "")
    : "";
  const actions: string[] = [];
  if (IFACE_KEYWORDS.test(descText) && !sections.contracts.present) {
    actions.push("Add **Contracts** section (Description mentions interface/API/type keywords)");
  }
  if (CHOICE_KEYWORDS.test(descText) && !sections.decision.present) {
    actions.push("Add **Decision** section (Description mentions choice/pattern keywords)");
  }
  if (THRESHOLD_KEYWORDS.test(descText) && !sections.thresholdRegistry.present) {
    actions.push("Add **Threshold Registry** section (Description mentions threshold/constant keywords)");
  }
  if (FLOW_KEYWORDS.test(descText) && !sections.behavioralSpec.inlineDetected && sections.behavioralSpec.linkedFeatureFiles.length === 0) {
    actions.push("Add **Behavioral Spec** (Description mentions flow/algorithm keywords)");
  }
  if (sections.description.present && sections.description.wordCount < 10) {
    actions.push("Expand **Description** (minimum 10 words)");
  }
  if (sections.decision.present && sections.decision.optionCount < 2) {
    actions.push("Add more options to **Decision → Options Considered** (minimum 2)");
  }

  if (actions.length > 0) {
    lines.push("");
    lines.push("**Action needed to pass gate:**");
    for (const a of actions) {
      lines.push(`- ${a}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate the system prompt for a given card based on its current phase.
 * @param gateContext - Optional gate violation context from the previous iteration.
 * @param artifactInventory - Optional pre-computed artifact inventory string.
 */
export function generateSystemPrompt(card: Card, rootPlanFile: string, gateContext?: string, artifactInventory?: string): string {
  const phase = isPhase(card.status) ? card.status : null;
  const isNode = card.isNode;

  const manifestInstructions = card.fileManifest.length > 0
    ? `\n\n## File Manifest — Read These First\nBefore doing ANYTHING, read every file in this manifest:\n${card.fileManifest.map((f) => `- ${f}`).join("\n")}\nIf you discover a relevant file not listed here, add it to the manifest.`
    : "";

  const preamble = `You are a PLANAR agent working on card "${card.dotPath} ${card.title}".
Your card file is: ${card.filePath}
Root plan file is: ${rootPlanFile}

## Rules
- You work on EXACTLY ONE card: ${card.filePath}
- You must NEVER modify cards outside your dot-path (${card.dotPath})
- Perform exactly ONE operation per iteration
- Every iteration MUST begin by reading the card's file manifest and ALL referenced files
- If you discover an error, create a new card for it and exit — don't fix silently
- All card links in YAML frontmatter must remain valid — broken links are bugs
- Discover sibling cards by scanning plan/ for files sharing your dot-path prefix (e.g. plan/${card.dotPath.split(".")[0]}.*)
- When working on a regressed card (status moved backward), re-evaluate ALL existing content from scratch. Do not re-advance without verifying that every section is still correct and complete.

## Challenging a Status
Any status — including [DONE] — can be regressed to an earlier phase. But a challenge MUST satisfy BOTH conditions:
1. Regress the phase (e.g. [DONE] → [PLAN])
2. Change the card content (description, acceptance criteria, or constraints) to explain WHY
Both are mandatory. If you regress without changing content, the next iteration will simply re-advance because nothing looks different.

## Card File Format
When creating or modifying card files, use this structure:
\`\`\`
---
parent: plan/<parent-card>.md
root: plan/root.md
children:              # only if this card has sub-cards
  - plan/<child>.md
blocked-by:            # only if this card depends on others
  - plan/<dep>.md
---
# <dot-path> <Title> [<STATUS>]

## Description
...

## File Manifest
- path/to/relevant/file.ts

## Acceptance Criteria
- ...
\`\`\`
Card links (parent, root, children, blocked-by) go in YAML frontmatter. The heading contains the dot-path, title, and status in brackets.${manifestInstructions}`;

  const gateSection = gateContext
    ? `\n\n## Gate Violations from Previous Iteration\n${gateContext}`
    : "";

  const inventorySection = artifactInventory
    ? `\n\n${artifactInventory}`
    : "";

  if (isNode) {
    return `${preamble}

## Node Card Rules
This card is a NODE (it has children: in its frontmatter). Nodes are structural — about decomposition, not implementation.
Node lifecycle: PLAN → DONE
A node is DONE when it has the right children with the right boundaries, regardless of children's status.

## Your Task
${getNodeTaskPrompt(phase)}${gateSection}`;
  }

  return `${preamble}

## Leaf Card Rules
This card is a LEAF (no children: in frontmatter). Leaves go through the full phase lifecycle.
Leaf lifecycle: PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE

## Current Phase: [${phase ?? formatSpecialStatus(card.status)}]
${getLeafPhasePrompt(phase)}${inventorySection}${gateSection}`;
}

function getNodeTaskPrompt(phase: string | null): string {
  if (phase === "DONE") {
    return `This node is [DONE]. Review its children for correctness and completeness. If everything looks good, make no changes. If something needs adjustment, Challenge this card back to [PLAN] with a content change explaining why.`;
  }
  return `Re-evaluate this node and its ENTIRE subtree against the current spec.

### Procedure
1. Read this node's description and acceptance criteria
2. Scan ALL descendant cards (not just direct children — walk the full tree)
3. For each descendant, compare its description/acceptance criteria against the current spec
4. If a descendant is [DONE] but its work no longer satisfies the spec, regress it to the appropriate phase (e.g. [PLAN]) and update its content to explain WHY (both are required per Challenge rules)
5. If new children are needed, create them. If children are obsolete, prune them.
6. Once all descendant statuses accurately reflect reality, advance this node to [DONE]

Available structural operations: Split, Hierarchize, Move, Aggregate, Collapse, Annotate, Reorder, Prune.
Prefer splits that minimize cross-domain dependencies.`;
}

function getLeafPhasePrompt(phase: LeafPhase | null): string {
  switch (phase) {
    case "PLAN":
      return `## PLAN Phase
Decompose this leaf into actionable work. You may:
- Split it into siblings if it covers too much
- Hierarchize it into a node with children if it needs sub-tasks
- Annotate with clearer acceptance criteria
- Reorder among siblings for better dependency flow

When planning is complete, advance status to [ARCHITECT].
If this card needs children, use Hierarchize — it will become a node.

### Exit Criteria (gate to ARCHITECT)
1. Description is present, non-empty, and has at least 10 words
2. At least one Acceptance Criterion exists
3. Each Acceptance Criterion is testable (contains a verifiable predicate, not vague language)
4. If the card is too large for one implementation pass, it has been split
5. \`blocked-by\` dependencies (if any) reference valid card paths

### Artifact Anticipation
Before advancing to [ARCHITECT], consider which artifact sections will be needed:
- Will this card require a design choice among alternatives? → Decision section
- Will this card define or modify interfaces, types, or APIs? → Contracts section
- Will this card introduce numeric constants? → Threshold Registry
- Will this card specify multi-step processes or state machines? → Behavioral Spec
Write a Description that accurately names what this card does — the automated gates use Description keywords to determine required sections.

### Isolation
During [PLAN], you may read \`plan/**\`, \`src/**\`, \`docs/**\`. You may write \`plan/<own-card>.md\` and \`plan/<new-child-cards>.md\`. Do NOT write to src/ or docs/.`;

    case "ARCHITECT":
      return `## ARCHITECT Phase
Capture every design decision and contract so IMPLEMENT is purely mechanical.

### Artifact Sections to Author
Author all applicable sections below. The automated gate will **block** your transition to IMPLEMENT if required sections are missing or incomplete. Check the Artifact Inventory below to see what exists and what the gate expects.
1. **Decision** — if card selects a design pattern, library, data structure, algorithm, or technology from among alternatives. Must include: Context, Options Considered (≥2), Choice, Rationale, Consequences.
2. **Contracts** — if card defines or modifies an interface, API surface, or exported type. Must include: Preconditions, Postconditions, Invariants.
3. **Threshold Registry** — if card introduces numeric constants affecting system behavior. Must include table with: Name, Value, Unit, Valid Range, Rationale, Sensitivity.
4. **Behavioral Spec** — if card specifies algorithmic flows, state machines, or multi-step processes. Use inline Given/When/Then in AC for ≤3 scenarios; linked \`.feature\` file for more.

### Section Ordering
Decision → Contracts → Threshold Registry → File Manifest → Acceptance Criteria (with inline Behavioral Spec if applicable).

### Workflow
1. Read Description and Acceptance Criteria
2. Determine which artifact sections are needed
3. Write each required section using the content template
4. Populate the File Manifest with all files to be created or modified during IMPLEMENT
5. Update or create ARCHITECTURE.md in the relevant docs/ subdirectory for your domain

### Exit Criteria (gate to IMPLEMENT)
1. **Decision completeness**: For every design choice implied by Description, a Decision section exists
2. **Contract completeness**: For every interface/API surface defined or modified, a Contracts section exists
3. **Threshold completeness**: For every numeric constant introduced, a Threshold Registry row exists
4. **Behavioral completeness**: For every multi-step flow or state transition, Behavioral Spec scenarios exist
5. **File Manifest** has ≥1 entry listing every file to create or modify
6. **Mechanical IMPLEMENT test** (self-check): Could a different agent, given only this card's Description + artifact sections + File Manifest, produce functionally identical code without asking questions?

### Structural Validation (automated gate)
- If Description contains interface/API/type keywords → Contracts section must exist
- If Description contains choice/pattern/library/framework keywords → Decision section must exist
- If Description contains threshold/timeout/constant/default keywords → Threshold Registry must exist
- If Description contains flow/algorithm/sequence/state keywords → Behavioral Spec must exist

When architecture is complete, advance status to [IMPLEMENT].

### Isolation
During [ARCHITECT], you may read \`plan/**\`, \`src/**\`, \`docs/**\`. You may write \`docs/<own-domain>/**\` and \`plan/<own-card>.md\`. Do NOT write to src/.`;

    case "IMPLEMENT":
      return `## IMPLEMENT Phase
Implementation discipline:
1. **Smallest valuable increment** — find the thinnest slice that delivers value. If there's more work, this card should have been decomposed further in [PLAN]. If it wasn't, regress to [PLAN] and split.
2. **Pre-refactor** — ask "Why isn't this an easy fix?" If existing code makes the change hard, refactor first to make it easy, then make the easy change. Two clean steps, not one messy one.
3. **Red/Green/Refactor** — write a failing test (Red), write minimum code to pass (Green), clean up while tests stay green (Refactor).

If the card is too large for one implementation pass, regress to [PLAN] and split.
When implementation is complete and tests pass, advance status to [REVIEW].

### The Mechanical IMPLEMENT Criterion
This phase is **purely mechanical**. You must NOT:
- Choose between design alternatives (→ regress to ARCHITECT, add Decision)
- Invent interface shapes (→ regress to ARCHITECT, add Contracts)
- Pick numeric constants (→ regress to ARCHITECT, add Threshold Registry)
- Decide behavior for unspecified edge cases (→ regress to ARCHITECT, add Behavioral Spec)

If you encounter ANY of these situations, you MUST regress the card to [ARCHITECT] and update the card content to explain what was underspecified. This is a **mandatory regression** — you cannot proceed by guessing.

### Implementation Workflow
1. Read all artifact sections from the card (Decision, Contracts, Threshold Registry, Behavioral Spec)
2. Read the File Manifest to identify target files
3. For each file: translate Contracts → type definitions + guards, Decision → pattern selection, Threshold Registry → constant definitions, Behavioral Spec → test cases
4. Run Red/Green/Refactor: failing test → minimal passing code → cleanup
5. Verify all exit criteria

### Exit Criteria (gate to REVIEW)
1. Every file in the File Manifest has been created or modified
2. Every Contracts precondition has a corresponding guard in the implementation
3. Every Contracts postcondition has a corresponding test assertion
4. Every Contracts invariant holds across all test cases
5. Every Decision's chosen option is reflected in the implementation
6. Every Threshold Registry constant appears in code with the specified value and name
7. Every Behavioral Spec scenario has a corresponding test that passes
8. No unregistered magic numbers exist in the implementation
9. All tests pass

### Isolation
During [IMPLEMENT], you may read \`plan/<own-card>.md\`, \`src/**\`, \`docs/<own-domain>/**\`. You may write \`src/<own-domain>/**\` and \`plan/<own-card>.md\`. Do NOT write to docs/ or other plan cards.`;

    case "REVIEW":
      return `## REVIEW Phase
Verify implementation **against artifacts**, not against intuition.

### Verification Method
Check artifacts against implementation — ask:
- "Does the code match the Contracts?" — not "Is this good code?"
- "Does the code follow the Decision?" — not "Would I have chosen differently?"
- "Do the constants match the Threshold Registry?" — not "Are these good values?"

If you find a deficiency, identify which artifact it violates. If no artifact is violated but you believe the approach is wrong, regress to ARCHITECT and add/modify the relevant artifact — do NOT edit code directly.

### Exit Criteria (gate to DONE)
1. Every acceptance criterion is verified as met
2. Every Contracts item is verified against implementation (precondition guards exist, postcondition tests pass, invariants hold)
3. Every Decision's chosen option is used in implementation (no drift)
4. Every Threshold Registry value matches the code constant
5. Every Behavioral Spec scenario has a passing test
6. File Manifest is accurate (no missing files, no extra unlisted files modified)
7. No regressions in sibling domain tests
8. Tests pass in clean run

### Mandatory Regressions
- Missing test coverage for a spec scenario → regress to IMPLEMENT
- Artifact violation found → regress to IMPLEMENT (code fix) or ARCHITECT (artifact fix)

### Optional Regressions
- Better approach found → regress to ARCHITECT with content changes
- Code quality issues (not correctness) → regress to IMPLEMENT

If all criteria are met, advance to [DONE].

### Isolation
During [REVIEW], you may read \`plan/<own-card>.md\`, \`src/**\`, \`docs/<own-domain>/**\`. You may write \`plan/<own-card>.md\` (status + regression notes only). Do NOT write to src/ or docs/.`;

    case "DONE":
      return `## DONE Phase
This card is complete and frozen. Review it one more time.
If everything still looks correct, make no changes (this signals convergence).
If something needs to be revisited, Challenge it back to an earlier phase — remember, you MUST change card content when regressing.`;

    default:
      return `## Special Status
This card has a special status and cannot be advanced normally.
Review the status and determine if it can be unblocked or resolved.`;
  }
}

function formatSpecialStatus(status: import("./types.js").CardStatus): string {
  if (typeof status === "string") return status;
  switch (status.kind) {
    case "BLOCKED-BY":
      return `BLOCKED-BY ${status.dotPath}`;
    case "CONFLICTS-WITH":
      return `CONFLICTS-WITH ${status.dotPath}`;
    case "INACTIONABLE":
      return "INACTIONABLE";
  }
}
