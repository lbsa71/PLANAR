import { Card, CardStatus, FileSystem, LeafPhase } from "./types.js";
import { parseCard, updateCardStatus, isPhase } from "./card.js";

/** Result of invalidating a single card */
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
 * Determine the regression target for a given leaf phase.
 * Returns null if no regression is needed.
 */
function regressionTarget(status: CardStatus): LeafPhase | null {
  if (!isPhase(status)) return null; // special statuses: leave alone

  switch (status) {
    case "PLAN":
      return null; // planning hasn't committed to anything
    case "ARCHITECT":
    case "IMPLEMENT":
    case "REVIEW":
      return "PLAN";
    case "DONE":
      return "REVIEW";
  }
}

/**
 * Build the upstream change note as a blockquote.
 */
function buildUpstreamNote(changedFiles: string[]): string {
  const fileList = changedFiles.map((f) => `\`${f}\``).join(", ");
  return [
    "",
    `> **Upstream change detected:** Files ${fileList} were modified`,
    "> in upstream commits. Re-evaluate this card's assumptions.",
    "",
  ].join("\n");
}

/**
 * Insert a note at the end of the Description section,
 * before the next ## heading.
 */
function insertNoteInDescription(content: string, note: string): string {
  // Find the Description section and insert note before the next ## heading
  const descPattern = /(## Description[^\n]*\n)([\s\S]*?)(\n## )/;
  const match = content.match(descPattern);

  if (match) {
    const [fullMatch, heading, body, nextSection] = match;
    const trimmedBody = body.replace(/\n+$/, "");
    return content.replace(
      fullMatch,
      heading + trimmedBody + note + nextSection
    );
  }

  // Fallback: if no next section, append after Description content
  const descOnly = /(## Description[^\n]*\n)([\s\S]*)$/;
  const descMatch = content.match(descOnly);
  if (descMatch) {
    const [fullMatch, heading, body] = descMatch;
    const trimmedBody = body.replace(/\n+$/, "");
    return content.replace(fullMatch, heading + trimmedBody + note + "\n");
  }

  // Last resort: append at end
  return content + note;
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
): InvalidationResult[] {
  const results: InvalidationResult[] = [];

  for (const card of affectedCards) {
    const target = regressionTarget(card.status);

    if (target === null) {
      // No regression needed
      const skipReason = isPhase(card.status)
        ? `Card in ${card.status}: no regression needed`
        : `Card has special status: left alone`;

      results.push({
        filePath: card.filePath,
        dotPath: card.dotPath,
        previousStatus: card.status,
        newStatus: card.status,
        modified: false,
        skipReason,
      });
      continue;
    }

    // Read current content from disk (may differ from card.rawContent)
    let content = card.rawContent;
    if (injectedFs) {
      content = injectedFs.readFileSync(card.filePath, "utf-8");
    }

    // Update the status in the heading
    content = updateCardStatus(content, target);

    // Append upstream change note in Description section
    const note = buildUpstreamNote(changedFiles);
    content = insertNoteInDescription(content, note);

    // Write back
    if (injectedFs) {
      injectedFs.writeFileSync(card.filePath, content);
    }

    results.push({
      filePath: card.filePath,
      dotPath: card.dotPath,
      previousStatus: card.status,
      newStatus: target,
      modified: true,
    });
  }

  return results;
}
