import * as fs from "node:fs";
import * as path from "node:path";
import {
  Card,
  CardReferences,
  CardStatus,
  FileSystem,
  LeafPhase,
  LEAF_PHASES,
} from "./types.js";

/** Default fs implementation using node:fs */
const nodeFs: FileSystem = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, c) => fs.writeFileSync(p, c),
  existsSync: (p) => fs.existsSync(p),
  readdirSync: (p) => fs.readdirSync(p) as string[],
};

/**
 * Parse the status from a heading like "# 2.1 Plan Parser [PLAN]"
 */
export function parseStatus(heading: string): CardStatus {
  const blockedMatch = heading.match(/\[BLOCKED-BY\s+([\d.]+)\]/);
  if (blockedMatch) {
    return { kind: "BLOCKED-BY", dotPath: blockedMatch[1] };
  }

  const conflictsMatch = heading.match(/\[CONFLICTS-WITH\s+([\d.]+)\]/);
  if (conflictsMatch) {
    return { kind: "CONFLICTS-WITH", dotPath: conflictsMatch[1] };
  }

  if (heading.includes("[INACTIONABLE]")) {
    return { kind: "INACTIONABLE" };
  }

  for (const phase of LEAF_PHASES) {
    if (heading.includes(`[${phase}]`)) {
      return phase;
    }
  }

  return "PLAN";
}

/**
 * Parse dot-path and title from heading.
 */
export function parseHeading(heading: string): {
  dotPath: string;
  title: string;
} {
  const match = heading.match(/^#\s+([\d.]+)\s+(.*?)(?:\s*\[.*\])?\s*$/);
  if (!match) {
    const rootMatch = heading.match(/^#\s+(.*?)(?:\s*\[.*\])?\s*$/);
    if (rootMatch) {
      return { dotPath: "0", title: rootMatch[1].trim() };
    }
    throw new Error(`Cannot parse heading: "${heading}"`);
  }
  return { dotPath: match[1], title: match[2].trim() };
}

/**
 * Parse @-references from card content.
 */
export function parseReferences(content: string): CardReferences {
  const refs: CardReferences = {
    parent: null,
    root: null,
    children: [],
    blockedBy: [],
  };

  const parentMatch = content.match(/@-parent:\s*(.+)/);
  if (parentMatch) refs.parent = parentMatch[1].trim();

  const rootMatch = content.match(/@-root:\s*(.+)/);
  if (rootMatch) refs.root = rootMatch[1].trim();

  const childrenMatch = content.match(/@-children:\s*\n((?:\s*-\s*.+\n?)*)/);
  if (childrenMatch) {
    refs.children = childrenMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }

  const blockedMatch = content.match(/@-blocked-by:\s*\n((?:\s*-\s*.+\n?)*)/);
  if (blockedMatch) {
    refs.blockedBy = blockedMatch[1]
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }

  return refs;
}

/**
 * Parse file manifest from card content.
 */
export function parseFileManifest(content: string): string[] {
  const sectionMatch = content.match(
    /## File Manifest[^\n]*\n([\s\S]*?)(?=\n##|\n*$)/
  );
  if (!sectionMatch) return [];

  return sectionMatch[1]
    .split("\n")
    .filter((line) => /^\s*-\s/.test(line))
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Parse a card file into a Card object.
 * If `content` is provided, skips reading from disk.
 */
export function parseCard(
  filePath: string,
  content?: string,
  injectedFs?: FileSystem
): Card {
  const raw = content ?? (injectedFs ?? nodeFs).readFileSync(filePath, "utf-8");

  const headingMatch = raw.match(/^(#\s+.+)$/m);
  if (!headingMatch) {
    throw new Error(`No heading found in ${filePath}`);
  }

  const { dotPath, title } = parseHeading(headingMatch[1]);
  const status = parseStatus(headingMatch[1]);
  const refs = parseReferences(raw);
  const fileManifest = parseFileManifest(raw);

  return {
    dotPath,
    title,
    status,
    refs,
    isNode: refs.children.length > 0,
    fileManifest,
    filePath,
    rawContent: raw,
  };
}

/**
 * Update a card's status in its file content.
 * Handles both dot-path headings and root-format headings.
 */
export function updateCardStatus(
  content: string,
  newStatus: CardStatus
): string {
  const statusStr = formatStatus(newStatus);

  const dotPathPattern = /^(#\s+[\d.]+\s+.+?)\s*\[.*?\]\s*$/m;
  if (dotPathPattern.test(content)) {
    return content.replace(dotPathPattern, `$1 [${statusStr}]`);
  }

  return content.replace(/^(#\s+.+?)\s*\[.*?\]\s*$/m, `$1 [${statusStr}]`);
}

/**
 * Format a CardStatus to its string representation.
 */
export function formatStatus(status: CardStatus): string {
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

/**
 * Get the next phase for a leaf card.
 */
export function nextLeafPhase(current: LeafPhase): LeafPhase | null {
  const idx = LEAF_PHASES.indexOf(current);
  if (idx === -1 || idx >= LEAF_PHASES.length - 1) return null;
  return LEAF_PHASES[idx + 1];
}

/**
 * Check if a status is a simple phase string.
 */
export function isPhase(status: CardStatus): status is LeafPhase {
  return typeof status === "string";
}

/**
 * Discover all card files in a plan directory.
 */
export function discoverCards(
  planDir: string,
  injectedFs?: FileSystem
): Card[] {
  const _fs = injectedFs ?? nodeFs;
  if (!_fs.existsSync(planDir)) return [];
  const files = _fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  return files.map((f) => parseCard(path.join(planDir, f), undefined, _fs));
}

/**
 * Find sibling cards (same parent prefix) for a given dot-path.
 */
export function findSiblings(
  dotPath: string,
  planDir: string,
  injectedFs?: FileSystem
): Card[] {
  const parts = dotPath.split(".");
  if (parts.length <= 1) {
    return discoverCards(planDir, injectedFs).filter(
      (c) => !c.dotPath.includes(".") && c.dotPath !== dotPath
    );
  }
  const parentPrefix = parts.slice(0, -1).join(".");
  return discoverCards(planDir, injectedFs).filter(
    (c) => c.dotPath.startsWith(parentPrefix + ".") && c.dotPath !== dotPath
  );
}

/**
 * Check reference integrity for a card against all known cards.
 */
export function checkReferenceIntegrity(
  card: Card,
  allCards: Card[]
): string[] {
  const errors: string[] = [];

  if (card.refs.parent) {
    const resolved = allCards.find((c) => c.filePath.endsWith(card.refs.parent!));
    if (!resolved) {
      errors.push(`Broken @-parent reference: ${card.refs.parent}`);
    }
  }

  for (const child of card.refs.children) {
    const resolved = allCards.find((c) => c.filePath.endsWith(child));
    if (!resolved) {
      errors.push(`Broken @-children reference: ${child}`);
    }
  }

  for (const dep of card.refs.blockedBy) {
    const resolved = allCards.find((c) => c.filePath.endsWith(dep));
    if (!resolved) {
      errors.push(`Broken @-blocked-by reference: ${dep}`);
    }
  }

  return errors;
}
