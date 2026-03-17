import { Card, LeafPhase } from "./types.js";
import { isPhase } from "./card.js";

/**
 * Generate the system prompt for a given card based on its current phase.
 */
export function generateSystemPrompt(card: Card, rootPlanFile: string): string {
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

  if (isNode) {
    return `${preamble}

## Node Card Rules
This card is a NODE (it has children: in its frontmatter). Nodes are structural — about decomposition, not implementation.
Node lifecycle: PLAN → DONE
A node is DONE when it has the right children with the right boundaries, regardless of children's status.

## Your Task
${getNodeTaskPrompt(phase)}`;
  }

  return `${preamble}

## Leaf Card Rules
This card is a LEAF (no children: in frontmatter). Leaves go through the full phase lifecycle.
Leaf lifecycle: PLAN → ARCHITECT → IMPLEMENT → REVIEW → DONE

## Current Phase: [${phase ?? formatSpecialStatus(card.status)}]
${getLeafPhasePrompt(phase)}`;
}

function getNodeTaskPrompt(phase: string | null): string {
  if (phase === "DONE") {
    return `This node is [DONE]. Review its children for correctness and completeness. If everything looks good, make no changes. If something needs adjustment, Challenge this card back to [PLAN] with a content change explaining why.`;
  }
  return `Decompose this node into well-bounded children. Prefer splits that minimize cross-domain dependencies.
Available operations: Split, Hierarchize, Move, Aggregate, Collapse, Annotate, Reorder, Prune.
When decomposition is complete and children are well-defined, advance status to [DONE].`;
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

### Isolation
During [PLAN], you may only read source files and write plan cards. Do NOT write to src/ or docs/.`;

    case "ARCHITECT":
      return `## ARCHITECT Phase
Design the solution. You should:
1. Define interfaces and contracts
2. Update or create ARCHITECTURE.md in the relevant docs/ subdirectory for your domain
3. Populate the file manifest with all files you'll need to touch
4. Ensure acceptance criteria are testable

When architecture is complete, advance status to [IMPLEMENT].

### Isolation
During [ARCHITECT], you may write to docs/ within your domain and edit your card. Do NOT write to src/.`;

    case "IMPLEMENT":
      return `## IMPLEMENT Phase
Implementation discipline:
1. **Smallest valuable increment** — find the thinnest slice that delivers value. If there's more work, this card should have been decomposed further in [PLAN]. If it wasn't, regress to [PLAN] and split.
2. **Pre-refactor** — ask "Why isn't this an easy fix?" If existing code makes the change hard, refactor first to make it easy, then make the easy change. Two clean steps, not one messy one.
3. **Red/Green/Refactor** — write a failing test (Red), write minimum code to pass (Green), clean up while tests stay green (Refactor).

If the card is too large for one implementation pass, regress to [PLAN] and split.
When implementation is complete and tests pass, advance status to [REVIEW].

### Isolation
During [IMPLEMENT], you may write to src/ within your domain and edit your card. Do NOT write to docs/ or other plan cards.`;

    case "REVIEW":
      return `## REVIEW Phase
Verify the implementation:
1. Check each acceptance criterion
2. Verify tests exist and pass
3. Check for regressions in sibling domains
4. Verify file manifest is up to date

If all criteria are met, advance to [DONE].
If issues are found, regress to the appropriate phase with content changes explaining why.

### Isolation
During [REVIEW], you may only read source files and edit your card. Do NOT write to src/ or docs/.`;

    case "DONE":
      return `## DONE Phase
This card is complete. Review it one more time.
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
