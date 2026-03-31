import * as path from "node:path";
import * as nodefs from "node:fs";
import {
  Card,
  FileSystem,
  IntegrityIssue,
  IntegrityReport,
  ComplianceIssue,
  SuggestedAction,
} from "./types.js";
import {
  isPhase,
  updateCardStatus,
  appendRevisionEntry,
  updateFrontmatterKey,
} from "./card.js";

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function cardMatchesRef(card: Card, ref: string): boolean {
  return normPath(card.filePath).endsWith(normPath(ref));
}

/**
 * Walk a directory recursively, returning paths relative to `base`.
 * Skips node_modules, dist, .git, and hidden entries.
 */
function walkDir(dir: string, base: string): string[] {
  const result: string[] = [];
  let entries: nodefs.Dirent[];
  try {
    entries = nodefs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (["node_modules", "dist", "__pycache__"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkDir(full, base));
    } else {
      result.push(path.relative(base, full));
    }
  }
  return result;
}

/**
 * Run a full integrity check on a card tree.
 *
 * Structural checks:
 *   - Parent-child link symmetry (broken refs, missing back-refs)
 *   - Status consistency (DONE node with non-DONE children)
 *
 * Codebase compliance (verifiable claims):
 *   - Every File Manifest entry exists on disk
 *   - No two cards claim the same file
 *   - If scanSourceDir is set: source files not claimed by any card are flagged
 */
export function checkTreeIntegrity(
  cards: Card[],
  cwd: string = process.cwd(),
  options: {
    /** Directory to scan for unowned source files, relative to cwd (e.g. "src") */
    scanSourceDir?: string;
    /** Injectable fs for testing manifest existence checks */
    fs?: { existsSync(p: string): boolean };
  } = {}
): IntegrityReport {
  const _fs = options.fs ?? nodefs;
  const timestamp = new Date().toISOString();
  const cardIssues: IntegrityIssue[] = [];
  const complianceIssues: ComplianceIssue[] = [];

  // normalized manifest path → cards claiming it
  const fileOwnership = new Map<string, Card[]>();

  for (const card of cards) {
    // ── Structural checks ─────────────────────────────────────────────────

    // 1. Parent link
    if (card.refs.parent) {
      const parentCard = cards.find((c) => cardMatchesRef(c, card.refs.parent!));
      if (!parentCard) {
        cardIssues.push({
          dotPath: card.dotPath,
          filePath: card.filePath,
          kind: "broken-parent-link",
          message: `Parent ref '${card.refs.parent}' not found among known cards`,
          suggestedAction: "flag-only",
        });
      } else {
        const listedByParent = parentCard.refs.children.some((c) =>
          cardMatchesRef(card, c)
        );
        if (!listedByParent) {
          cardIssues.push({
            dotPath: card.dotPath,
            filePath: card.filePath,
            kind: "parent-not-in-children",
            message: `Parent (${parentCard.dotPath}) does not list this card in its children`,
            suggestedAction: "flag-only",
          });
        }
      }
    }

    // 2. Children links
    for (const childRef of card.refs.children) {
      const childCard = cards.find((c) => cardMatchesRef(c, childRef));
      if (!childCard) {
        cardIssues.push({
          dotPath: card.dotPath,
          filePath: card.filePath,
          kind: "broken-child-link",
          message: `Child ref '${childRef}' not found`,
          suggestedAction: "regress-to-plan",
        });
      } else {
        const pointsBack =
          childCard.refs.parent && cardMatchesRef(card, childCard.refs.parent);
        if (!pointsBack) {
          cardIssues.push({
            dotPath: card.dotPath,
            filePath: card.filePath,
            kind: "child-missing-parent-ref",
            message: `Child ${childCard.dotPath} does not point back to this card as parent`,
            suggestedAction: "flag-only",
          });
        }
      }
    }

    // 3. Status consistency: DONE node with non-DONE children
    if (card.isNode && card.status === "DONE") {
      const children = card.refs.children
        .map((ref) => cards.find((c) => cardMatchesRef(c, ref)))
        .filter((c): c is Card => c !== undefined);
      const nonDone = children.filter((c) => c.status !== "DONE");
      if (nonDone.length > 0) {
        cardIssues.push({
          dotPath: card.dotPath,
          filePath: card.filePath,
          kind: "status-inconsistency",
          message: `Node marked DONE but ${nonDone.length} child/children not DONE: ${nonDone.map((c) => c.dotPath).join(", ")}`,
          suggestedAction: "regress-to-plan",
        });
      }
    }

    // ── Codebase compliance checks ─────────────────────────────────────────

    // 4. File Manifest existence
    for (const manifestFile of card.fileManifest) {
      const absPath = path.resolve(cwd, manifestFile);
      if (!_fs.existsSync(absPath)) {
        const action: SuggestedAction =
          card.status === "DONE" ? "regress-to-review" : "flag-only";
        cardIssues.push({
          dotPath: card.dotPath,
          filePath: card.filePath,
          kind: "missing-manifest-file",
          message: `Manifest file '${manifestFile}' does not exist on disk`,
          suggestedAction: action,
        });
      }
      const norm = normPath(manifestFile);
      if (!fileOwnership.has(norm)) fileOwnership.set(norm, []);
      fileOwnership.get(norm)!.push(card);
    }
  }

  // 5. Duplicate file ownership
  for (const [file, owners] of fileOwnership) {
    if (owners.length > 1) {
      const seen = new Set<string>();
      for (const card of owners) {
        if (!seen.has(card.filePath)) {
          seen.add(card.filePath);
          cardIssues.push({
            dotPath: card.dotPath,
            filePath: card.filePath,
            kind: "duplicate-file-ownership",
            message: `File '${file}' is claimed by multiple cards: ${owners.map((c) => c.dotPath).join(", ")}`,
            suggestedAction: "flag-only",
          });
        }
      }
    }
  }

  // 6. Unowned source files
  if (options.scanSourceDir) {
    const srcDir = path.resolve(cwd, options.scanSourceDir);
    const sourceFiles = walkDir(srcDir, cwd);
    const claimedFiles = new Set(Array.from(fileOwnership.keys()).map(normPath));
    for (const srcFile of sourceFiles) {
      if (!claimedFiles.has(normPath(srcFile))) {
        complianceIssues.push({
          kind: "unowned-source-file",
          file: srcFile,
          message: `Source file '${srcFile}' is not claimed by any card's File Manifest`,
        });
      }
    }
  }

  return {
    timestamp,
    cardIssues,
    complianceIssues,
    scannedCards: cards.length,
    manifestFilesChecked: fileOwnership.size,
  };
}

/**
 * Apply integrity results to card files:
 *   - Updates 'last-integrity-check' frontmatter key on every card
 *   - Prepends a revision history entry (newest-first) describing the outcome
 *   - Optionally regresses DONE cards with structural issues back to PLAN/REVIEW
 *
 * Returns counts of updated and regressed cards.
 */
export function applyIntegrityResults(
  report: IntegrityReport,
  cards: Card[],
  options: { regressProblematic: boolean },
  injectedFs: FileSystem
): { updated: number; regressed: string[] } {
  const issuesByFile = new Map<string, IntegrityIssue[]>();
  for (const issue of report.cardIssues) {
    if (!issuesByFile.has(issue.filePath))
      issuesByFile.set(issue.filePath, []);
    issuesByFile.get(issue.filePath)!.push(issue);
  }

  let updated = 0;
  const regressed: string[] = [];

  for (const card of cards) {
    let content = card.rawContent;

    // Always stamp last-integrity-check
    content = updateFrontmatterKey(
      content,
      "last-integrity-check",
      report.timestamp
    );

    const issues = issuesByFile.get(card.filePath) ?? [];
    if (issues.length > 0) {
      const kinds = [...new Set(issues.map((i) => i.kind))].join(", ");
      content = appendRevisionEntry(
        content,
        `${report.timestamp}: integrity-check — ${issues.length} issue(s): ${kinds}`
      );

      if (options.regressProblematic && isPhase(card.status) && card.status === "DONE") {
        const shouldPlan = issues.some(
          (i) => i.suggestedAction === "regress-to-plan"
        );
        const shouldReview =
          !shouldPlan &&
          issues.some((i) => i.suggestedAction === "regress-to-review");

        if (shouldPlan) {
          content = updateCardStatus(content, "PLAN");
          content = appendRevisionEntry(
            content,
            `${report.timestamp}: regressed to PLAN by integrity-check`
          );
          regressed.push(`${card.dotPath} → PLAN`);
        } else if (shouldReview) {
          content = updateCardStatus(content, "REVIEW");
          content = appendRevisionEntry(
            content,
            `${report.timestamp}: regressed to REVIEW by integrity-check`
          );
          regressed.push(`${card.dotPath} → REVIEW`);
        }
      }
    } else {
      content = appendRevisionEntry(
        content,
        `${report.timestamp}: integrity-check passed`
      );
    }

    injectedFs.writeFileSync(card.filePath, content);
    updated++;
  }

  return { updated, regressed };
}

/**
 * Smoke-test a node's entire descendant tree when the node is in PLAN.
 *
 * Recursively walks all descendants via children refs and checks:
 *   - File manifest entries exist on disk
 *   - Node children marked DONE actually have all their children DONE
 *
 * Returns a list of cards that were regressed, with their new phase.
 * Cards past PLAN with missing manifest files → regress to PLAN.
 * DONE nodes with non-DONE children → regress to PLAN.
 */
export function smokeTestDescendants(
  rootCard: Card,
  allCards: Card[],
  cwd: string,
  injectedFs: FileSystem
): string[] {
  const regressed: string[] = [];
  const descendants = collectDescendants(rootCard, allCards);

  for (const card of descendants) {
    // Only check cards that have progressed past PLAN
    if (!isPhase(card.status) || card.status === "PLAN") continue;

    const issues: string[] = [];

    // Check file manifest entries exist on disk
    for (const manifestFile of card.fileManifest) {
      const absPath = path.resolve(cwd, manifestFile);
      if (!injectedFs.existsSync(absPath)) {
        issues.push(`manifest file '${manifestFile}' missing from disk`);
      }
    }

    // Check DONE nodes have all children DONE
    if (card.isNode && card.status === "DONE") {
      const children = card.refs.children
        .map((ref) => allCards.find((c) => normPath(c.filePath).endsWith(normPath(ref))))
        .filter((c): c is Card => c !== undefined);
      const nonDone = children.filter((c) => c.status !== "DONE");
      if (nonDone.length > 0) {
        issues.push(
          `node marked DONE but ${nonDone.length} child(ren) not DONE: ${nonDone.map((c) => c.dotPath).join(", ")}`
        );
      }
    }

    if (issues.length === 0) continue;

    // Regress this card to PLAN
    const ts = new Date().toISOString();
    let content = card.rawContent;
    content = updateCardStatus(content, "PLAN");
    content = appendRevisionEntry(
      content,
      `${ts}: regressed to PLAN by smoke-test — ${issues.join("; ")}`
    );
    injectedFs.writeFileSync(card.filePath, content);
    regressed.push(`${card.dotPath} → PLAN (${issues.join("; ")})`);
  }

  return regressed;
}

/**
 * Collect all descendant cards of a given card, recursively following children refs.
 */
function collectDescendants(rootCard: Card, allCards: Card[]): Card[] {
  const result: Card[] = [];
  const queue: Card[] = [rootCard];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childRef of current.refs.children) {
      const child = allCards.find((c) =>
        normPath(c.filePath).endsWith(normPath(childRef))
      );
      if (child && !seen.has(child.dotPath)) {
        seen.add(child.dotPath);
        result.push(child);
        queue.push(child);
      }
    }
  }

  return result;
}

/**
 * Format an IntegrityReport for human-readable CLI output.
 */
export function formatIntegrityReport(report: IntegrityReport): string {
  const lines: string[] = [];
  lines.push(`\nPLANAR Integrity Check — ${report.timestamp}`);
  lines.push(
    `Scanned: ${report.scannedCards} card(s), ${report.manifestFilesChecked} manifest file(s) checked`
  );
  lines.push("");

  if (report.cardIssues.length === 0) {
    lines.push("  No structural issues found.");
  } else {
    lines.push(`Structural Issues (${report.cardIssues.length}):`);
    for (const issue of report.cardIssues) {
      lines.push(`  ${issue.dotPath}  [${issue.kind}]`);
      lines.push(`    ${issue.message}`);
      if (issue.suggestedAction !== "flag-only") {
        lines.push(`    => ${issue.suggestedAction}`);
      }
    }
  }

  if (report.complianceIssues.length > 0) {
    lines.push("");
    lines.push(
      `Codebase Compliance — Unowned source files (${report.complianceIssues.length}):`
    );
    for (const issue of report.complianceIssues) {
      lines.push(`  ${issue.file}`);
    }
  } else if (report.manifestFilesChecked > 0) {
    lines.push("  All manifest files present on disk.");
  }

  return lines.join("\n");
}
