import * as path from "node:path";
import { Card, FileSystem } from "./types.js";
import { discoverCards } from "./card.js";

/**
 * Normalize a path to forward slashes for cross-platform comparison.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Strip parenthetical annotations from a file manifest entry.
 * e.g. "src/card.ts (read — uses discoverCards)" → "src/card.ts"
 */
function stripAnnotation(entry: string): string {
  return entry.replace(/\s*\(.*\)\s*$/, "").trim();
}

/**
 * Find cards whose file manifest contains at least one of the changed files.
 */
export function findAffectedCards(
  changedFiles: string[],
  planDir: string,
  injectedFs?: FileSystem
): Card[] {
  const allCards = discoverCards(planDir, injectedFs);
  const normalizedChanged = changedFiles.map(normalizePath);

  return allCards.filter((card) => {
    const manifestPaths = card.fileManifest.map((entry) =>
      normalizePath(stripAnnotation(entry))
    );
    return manifestPaths.some((mp) =>
      normalizedChanged.some((cf) => cf === mp || cf.endsWith("/" + mp) || mp.endsWith("/" + cf))
    );
  });
}

/** Minimal info about an affected card, for createImpactCard */
export interface AffectedCardInfo {
  dotPath: string;
  title: string;
  filePath: string;
}

/**
 * Create an impact card documenting upstream changes.
 * Returns the file path of the created card.
 */
export function createImpactCard(
  commitRange: string,
  changedFiles: string[],
  affectedCards: AffectedCardInfo[],
  diffstat: string,
  planDir: string,
  injectedFs: FileSystem
): string {
  // Determine next N by scanning existing 0.* files
  const existingFiles = injectedFs.readdirSync(planDir);
  const zeroPattern = /^0\.(\d+)/;
  let maxN = 0;
  for (const f of existingFiles) {
    const m = f.match(zeroPattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    }
  }
  const nextN = maxN + 1;

  const fileName = `0.${nextN}-upstream-sync.md`;
  const filePath = path.join(planDir, fileName);

  const changedList = changedFiles.map((f) => `- ${f}`).join("\n");
  const affectedList = affectedCards
    .map((c) => `- ${c.dotPath} ${c.title} (${c.filePath})`)
    .join("\n");

  const content = [
    "---",
    "parent: plan/root.md",
    "root: plan/root.md",
    "---",
    `# 0.${nextN} Upstream Sync [PLAN]`,
    "",
    "## Description",
    `Impact analysis for upstream changes in commit range \`${commitRange}\`.`,
    "",
    "## Commit Range",
    `\`${commitRange}\``,
    "",
    "## Changed Files",
    changedList,
    "",
    "## Affected Cards",
    affectedList,
    "",
    "## Diffstat",
    "```",
    diffstat,
    "```",
    "",
  ].join("\n");

  injectedFs.writeFileSync(filePath, content);
  return filePath;
}
