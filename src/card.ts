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
 * Parse YAML frontmatter from card content.
 * Frontmatter is delimited by `---` lines at the start of the file.
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of yaml.split("\n")) {
    // List item under current key
    const listItem = line.match(/^\s+-\s+(.+)/);
    if (listItem && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(listItem[1].trim());
      continue;
    }

    // Flush any pending list
    if (currentKey && currentList) {
      result[currentKey] = currentList;
      currentList = null;
      currentKey = null;
    }

    // Key: value pair
    const kvMatch = line.match(/^([\w-]+):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val) {
        result[key] = val;
        currentKey = null;
      } else {
        // Value will be a list on subsequent lines
        currentKey = key;
        currentList = [];
      }
    }
  }

  // Flush final pending list
  if (currentKey && currentList) {
    result[currentKey] = currentList;
  }

  return result;
}

/**
 * Parse card links (parent, root, children, blocked-by) from YAML frontmatter.
 */
export function parseReferences(content: string): CardReferences {
  const fm = parseFrontmatter(content);

  return {
    parent: typeof fm.parent === "string" ? fm.parent : null,
    root: typeof fm.root === "string" ? fm.root : null,
    children: Array.isArray(fm.children) ? fm.children : [],
    blockedBy: Array.isArray(fm["blocked-by"]) ? fm["blocked-by"] : [],
  };
}

/**
 * Strip frontmatter from content, returning just the markdown body.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
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

  // Strip frontmatter before heading search to avoid matching YAML comments
  const body = stripFrontmatter(raw);
  const headingMatch = body.match(/^(#\s+.+)$/m);
  if (!headingMatch) {
    throw new Error(`No heading found in ${filePath}`);
  }

  const { dotPath, title } = parseHeading(headingMatch[1]);
  const status = parseStatus(headingMatch[1]);
  const refs = parseReferences(raw);
  const fileManifest = parseFileManifest(raw);

  const fm = parseFrontmatter(raw);
  const lastIntegrityCheck =
    typeof fm["last-integrity-check"] === "string"
      ? fm["last-integrity-check"]
      : undefined;

  return {
    dotPath,
    title,
    status,
    refs,
    isNode: refs.children.length > 0,
    fileManifest,
    filePath,
    rawContent: raw,
    lastIntegrityCheck,
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
/** Normalize path separators to forward slashes for cross-platform comparison */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Upsert a scalar key-value pair in YAML frontmatter.
 * If frontmatter is absent, prepends a new block.
 * If the key already exists, updates it in-place; otherwise appends it.
 */
export function updateFrontmatterKey(
  content: string,
  key: string,
  value: string
): string {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return `---\n${key}: ${value}\n---\n${content}`;
  }

  const body = fmMatch[1];
  const keyRe = new RegExp(`^${key}:.*$`, "m");
  const newBody = keyRe.test(body)
    ? body.replace(keyRe, `${key}: ${value}`)
    : body.trimEnd() + `\n${key}: ${value}`;

  const newFm = `---\n${newBody}\n---`;
  return content.replace(/^---\s*\n[\s\S]*?\n---/, newFm);
}

/**
 * Prepend a dated entry to the ## Revision History section (newest-first).
 * Creates the section at the end of the document if absent.
 */
export function appendRevisionEntry(content: string, entry: string): string {
  const headingMatch = content.match(/^## Revision History[ \t]*$/m);
  if (headingMatch && headingMatch.index !== undefined) {
    const headingEnd = headingMatch.index + headingMatch[0].length;
    const after = content.slice(headingEnd);
    const insertAt = headingEnd + (after.startsWith("\n") ? 1 : 0);
    return content.slice(0, insertAt) + `- ${entry}\n` + content.slice(insertAt);
  }
  return content.trimEnd() + `\n\n## Revision History\n- ${entry}\n`;
}

export function checkReferenceIntegrity(
  card: Card,
  allCards: Card[]
): string[] {
  const errors: string[] = [];

  const matchesRef = (filePath: string, ref: string) =>
    normalizePath(filePath).endsWith(normalizePath(ref));

  if (card.refs.parent) {
    const resolved = allCards.find((c) => matchesRef(c.filePath, card.refs.parent!));
    if (!resolved) {
      errors.push(`Broken parent link: ${card.refs.parent}`);
    }
  }

  for (const child of card.refs.children) {
    const resolved = allCards.find((c) => matchesRef(c.filePath, child));
    if (!resolved) {
      errors.push(`Broken children link: ${child}`);
    }
  }

  for (const dep of card.refs.blockedBy) {
    const resolved = allCards.find((c) => matchesRef(c.filePath, dep));
    if (!resolved) {
      errors.push(`Broken blocked-by link: ${dep}`);
    }
  }

  return errors;
}
