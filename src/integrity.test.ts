import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkTreeIntegrity,
  applyIntegrityResults,
  formatIntegrityReport,
} from "./integrity.js";
import type { Card, FileSystem, IntegrityReport } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<Card> & { dotPath: string }): Card {
  return {
    title: "Test Card",
    status: "IMPLEMENT",
    refs: { parent: null, root: null, children: [], blockedBy: [] },
    isNode: false,
    fileManifest: [],
    filePath: `plan/${overrides.dotPath}-test.md`,
    rawContent: `---\nroot: plan/root.md\n---\n# ${overrides.dotPath} Test Card [IMPLEMENT]\n\n## Revision History\n`,
    lastIntegrityCheck: undefined,
    ...overrides,
  };
}

function mockFs(
  existing: Set<string>
): Pick<FileSystem, "existsSync"> {
  return {
    existsSync: (p: string) => existing.has(p),
  };
}

function captureFs(): { written: Map<string, string> } & FileSystem {
  const written = new Map<string, string>();
  return {
    written,
    readFileSync: (p: string) => written.get(p) ?? "",
    writeFileSync: (p: string, content: string) => { written.set(p, content); },
    existsSync: (p: string) => written.has(p),
    readdirSync: () => [],
  };
}

// ---------------------------------------------------------------------------
// checkTreeIntegrity — structural checks
// ---------------------------------------------------------------------------

describe("checkTreeIntegrity — parent/child link symmetry", () => {
  it("reports broken-parent-link when parent ref not found in card set", () => {
    const child = makeCard({
      dotPath: "1.1",
      refs: { parent: "plan/1-missing.md", root: null, children: [], blockedBy: [] },
    });
    const report = checkTreeIntegrity([child], "/cwd");
    const issue = report.cardIssues.find((i) => i.kind === "broken-parent-link");
    expect(issue).toBeDefined();
    expect(issue?.dotPath).toBe("1.1");
    expect(issue?.suggestedAction).toBe("flag-only");
  });

  it("reports parent-not-in-children when parent exists but does not list card", () => {
    const parent = makeCard({
      dotPath: "1",
      filePath: "plan/1-parent.md",
      isNode: true,
      refs: { parent: null, root: null, children: [], blockedBy: [] },
      // parent has NO children listed
    });
    const child = makeCard({
      dotPath: "1.1",
      filePath: "plan/1.1-child.md",
      refs: { parent: "plan/1-parent.md", root: null, children: [], blockedBy: [] },
    });
    const report = checkTreeIntegrity([parent, child], "/cwd");
    const issue = report.cardIssues.find((i) => i.kind === "parent-not-in-children");
    expect(issue).toBeDefined();
    expect(issue?.dotPath).toBe("1.1");
    expect(issue?.suggestedAction).toBe("flag-only");
  });

  it("reports broken-child-link when child ref not found", () => {
    const parent = makeCard({
      dotPath: "1",
      filePath: "plan/1-parent.md",
      isNode: true,
      refs: { parent: null, root: null, children: ["plan/1.1-missing.md"], blockedBy: [] },
    });
    const report = checkTreeIntegrity([parent], "/cwd");
    const issue = report.cardIssues.find((i) => i.kind === "broken-child-link");
    expect(issue).toBeDefined();
    expect(issue?.dotPath).toBe("1");
    expect(issue?.suggestedAction).toBe("regress-to-plan");
  });

  it("reports child-missing-parent-ref when child does not point back", () => {
    const parent = makeCard({
      dotPath: "1",
      filePath: "plan/1-parent.md",
      isNode: true,
      refs: { parent: null, root: null, children: ["plan/1.1-child.md"], blockedBy: [] },
    });
    const child = makeCard({
      dotPath: "1.1",
      filePath: "plan/1.1-child.md",
      refs: { parent: null, root: null, children: [], blockedBy: [] }, // no parent ref
    });
    const report = checkTreeIntegrity([parent, child], "/cwd");
    const issue = report.cardIssues.find((i) => i.kind === "child-missing-parent-ref");
    expect(issue).toBeDefined();
    expect(issue?.dotPath).toBe("1");
    expect(issue?.suggestedAction).toBe("flag-only");
  });

  it("emits no issues for a valid parent-child pair", () => {
    const parent = makeCard({
      dotPath: "1",
      filePath: "plan/1-parent.md",
      isNode: true,
      refs: { parent: null, root: null, children: ["plan/1.1-child.md"], blockedBy: [] },
    });
    const child = makeCard({
      dotPath: "1.1",
      filePath: "plan/1.1-child.md",
      refs: { parent: "plan/1-parent.md", root: null, children: [], blockedBy: [] },
    });
    const report = checkTreeIntegrity([parent, child], "/cwd");
    expect(report.cardIssues).toHaveLength(0);
  });
});

describe("checkTreeIntegrity — status-inconsistency", () => {
  it("reports status-inconsistency for DONE node with non-DONE child", () => {
    const parent = makeCard({
      dotPath: "1",
      filePath: "plan/1-parent.md",
      status: "DONE",
      isNode: true,
      refs: { parent: null, root: null, children: ["plan/1.1-child.md"], blockedBy: [] },
    });
    const child = makeCard({
      dotPath: "1.1",
      filePath: "plan/1.1-child.md",
      status: "IMPLEMENT",
      refs: { parent: "plan/1-parent.md", root: null, children: [], blockedBy: [] },
    });
    const report = checkTreeIntegrity([parent, child], "/cwd");
    const issue = report.cardIssues.find((i) => i.kind === "status-inconsistency");
    expect(issue).toBeDefined();
    expect(issue?.dotPath).toBe("1");
    expect(issue?.suggestedAction).toBe("regress-to-plan");
  });

  it("does not report status-inconsistency when all children are DONE", () => {
    const parent = makeCard({
      dotPath: "1",
      filePath: "plan/1-parent.md",
      status: "DONE",
      isNode: true,
      refs: { parent: null, root: null, children: ["plan/1.1-child.md"], blockedBy: [] },
    });
    const child = makeCard({
      dotPath: "1.1",
      filePath: "plan/1.1-child.md",
      status: "DONE",
      refs: { parent: "plan/1-parent.md", root: null, children: [], blockedBy: [] },
    });
    const report = checkTreeIntegrity([parent, child], "/cwd");
    expect(report.cardIssues.filter((i) => i.kind === "status-inconsistency")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkTreeIntegrity — codebase compliance
// ---------------------------------------------------------------------------

describe("checkTreeIntegrity — missing manifest file", () => {
  it("reports missing-manifest-file via injected fs when file does not exist", () => {
    const card = makeCard({
      dotPath: "2.1",
      fileManifest: ["src/missing.ts"],
    });
    const injectedFs = mockFs(new Set()); // nothing exists
    const report = checkTreeIntegrity([card], "/cwd", { fs: injectedFs });
    const issue = report.cardIssues.find((i) => i.kind === "missing-manifest-file");
    expect(issue).toBeDefined();
    expect(issue?.dotPath).toBe("2.1");
  });

  it("uses regress-to-review for DONE card with missing manifest", () => {
    const card = makeCard({
      dotPath: "2.1",
      status: "DONE",
      fileManifest: ["src/gone.ts"],
    });
    const injectedFs = mockFs(new Set());
    const report = checkTreeIntegrity([card], "/cwd", { fs: injectedFs });
    const issue = report.cardIssues.find((i) => i.kind === "missing-manifest-file");
    expect(issue?.suggestedAction).toBe("regress-to-review");
  });

  it("uses flag-only for non-DONE card with missing manifest", () => {
    const card = makeCard({
      dotPath: "2.1",
      status: "IMPLEMENT",
      fileManifest: ["src/pending.ts"],
    });
    const injectedFs = mockFs(new Set());
    const report = checkTreeIntegrity([card], "/cwd", { fs: injectedFs });
    const issue = report.cardIssues.find((i) => i.kind === "missing-manifest-file");
    expect(issue?.suggestedAction).toBe("flag-only");
  });

  it("emits no issue when manifest file exists", () => {
    const card = makeCard({
      dotPath: "2.1",
      fileManifest: ["src/exists.ts"],
    });
    const injectedFs = mockFs(new Set(["/cwd/src/exists.ts"]));
    const report = checkTreeIntegrity([card], "/cwd", { fs: injectedFs });
    expect(report.cardIssues.filter((i) => i.kind === "missing-manifest-file")).toHaveLength(0);
  });
});

describe("checkTreeIntegrity — duplicate file ownership", () => {
  it("reports duplicate-file-ownership when two cards claim same file", () => {
    const card1 = makeCard({ dotPath: "1.1", filePath: "plan/1.1.md", fileManifest: ["src/shared.ts"] });
    const card2 = makeCard({ dotPath: "1.2", filePath: "plan/1.2.md", fileManifest: ["src/shared.ts"] });
    const injectedFs = mockFs(new Set(["/cwd/src/shared.ts"]));
    const report = checkTreeIntegrity([card1, card2], "/cwd", { fs: injectedFs });
    const dupes = report.cardIssues.filter((i) => i.kind === "duplicate-file-ownership");
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    expect(dupes.every((i) => i.suggestedAction === "flag-only")).toBe(true);
  });
});

describe("checkTreeIntegrity — unowned source files (walkDir)", () => {
  it("flags source files under scanSourceDir not claimed by any card", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "planar-integrity-test-"));
    try {
      // Create a fake src structure with some files
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, "owned.ts"), "");
      fs.writeFileSync(path.join(srcDir, "unowned.ts"), "");

      // Also write nested dirs that should be skipped
      fs.mkdirSync(path.join(srcDir, "node_modules"), { recursive: true });
      fs.writeFileSync(path.join(srcDir, "node_modules", "pkg.ts"), "");
      fs.mkdirSync(path.join(srcDir, ".hidden"), { recursive: true });
      fs.writeFileSync(path.join(srcDir, ".hidden", "secret.ts"), "");

      const card = makeCard({
        dotPath: "3.1",
        fileManifest: ["src/owned.ts"],
      });
      const injectedFs = mockFs(new Set([path.join(tmpDir, "src/owned.ts")]));
      const report = checkTreeIntegrity([card], tmpDir, {
        scanSourceDir: "src",
        fs: injectedFs,
      });

      const unowned = report.complianceIssues.filter(
        (i) => i.kind === "unowned-source-file"
      );
      const files = unowned.map((i) => i.file);
      // unowned.ts should be flagged
      expect(files.some((f) => f.endsWith("unowned.ts"))).toBe(true);
      // owned.ts should NOT be flagged (check exact suffix to avoid matching "unowned.ts")
      expect(files.some((f) => /(?<![a-z])owned\.ts$/.test(f))).toBe(false);
      // node_modules contents should be skipped
      expect(files.some((f) => f.includes("node_modules"))).toBe(false);
      // hidden dir contents should be skipped
      expect(files.some((f) => f.includes(".hidden"))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips dist and .git directories", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "planar-integrity-test-"));
    try {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir);
      fs.mkdirSync(path.join(srcDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(srcDir, "dist", "output.js"), "");
      fs.mkdirSync(path.join(srcDir, ".git"), { recursive: true });
      fs.writeFileSync(path.join(srcDir, ".git", "HEAD"), "");

      const report = checkTreeIntegrity([], tmpDir, { scanSourceDir: "src" });
      const unowned = report.complianceIssues.map((i) => i.file);
      expect(unowned.some((f) => f.includes("dist"))).toBe(false);
      expect(unowned.some((f) => f.includes(".git"))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// applyIntegrityResults
// ---------------------------------------------------------------------------

describe("applyIntegrityResults", () => {
  it("stamps last-integrity-check and writes a revision entry for every card", () => {
    const card = makeCard({ dotPath: "1.1" });
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [],
      complianceIssues: [],
      scannedCards: 1,
      manifestFilesChecked: 0,
    };
    const injectedFs = captureFs();
    applyIntegrityResults(report, [card], { regressProblematic: false }, injectedFs);

    const written = injectedFs.written.get(card.filePath)!;
    expect(written).toContain("last-integrity-check: 2026-01-01T00:00:00.000Z");
    expect(written).toContain("integrity-check passed");
  });

  it("includes issue kinds in revision entry when issues exist", () => {
    const card = makeCard({ dotPath: "1.1" });
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [
        {
          dotPath: "1.1",
          filePath: card.filePath,
          kind: "missing-manifest-file",
          message: "file gone",
          suggestedAction: "flag-only",
        },
      ],
      complianceIssues: [],
      scannedCards: 1,
      manifestFilesChecked: 1,
    };
    const injectedFs = captureFs();
    applyIntegrityResults(report, [card], { regressProblematic: false }, injectedFs);

    const written = injectedFs.written.get(card.filePath)!;
    expect(written).toContain("1 issue(s): missing-manifest-file");
  });

  it("regresses DONE card to PLAN when regressProblematic:true and regress-to-plan issue", () => {
    const card = makeCard({
      dotPath: "1",
      status: "DONE",
      rawContent: `---\nroot: plan/root.md\n---\n# 1 Test Card [DONE]\n\n## Revision History\n`,
    });
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [
        {
          dotPath: "1",
          filePath: card.filePath,
          kind: "status-inconsistency",
          message: "child not DONE",
          suggestedAction: "regress-to-plan",
        },
      ],
      complianceIssues: [],
      scannedCards: 1,
      manifestFilesChecked: 0,
    };
    const injectedFs = captureFs();
    const result = applyIntegrityResults(report, [card], { regressProblematic: true }, injectedFs);

    expect(result.regressed).toContain("1 → PLAN");
    const written = injectedFs.written.get(card.filePath)!;
    expect(written).toContain("[PLAN]");
    expect(written).toContain("regressed to PLAN by integrity-check");
  });

  it("regresses DONE card to REVIEW when regressProblematic:true and regress-to-review issue", () => {
    const card = makeCard({
      dotPath: "2.1",
      status: "DONE",
      rawContent: `---\nroot: plan/root.md\n---\n# 2.1 Test Card [DONE]\n\n## Revision History\n`,
    });
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [
        {
          dotPath: "2.1",
          filePath: card.filePath,
          kind: "missing-manifest-file",
          message: "file gone",
          suggestedAction: "regress-to-review",
        },
      ],
      complianceIssues: [],
      scannedCards: 1,
      manifestFilesChecked: 1,
    };
    const injectedFs = captureFs();
    const result = applyIntegrityResults(report, [card], { regressProblematic: true }, injectedFs);

    expect(result.regressed).toContain("2.1 → REVIEW");
    const written = injectedFs.written.get(card.filePath)!;
    expect(written).toContain("[REVIEW]");
  });

  it("does NOT regress when regressProblematic:false even if issues exist", () => {
    const card = makeCard({
      dotPath: "1",
      status: "DONE",
      rawContent: `---\nroot: plan/root.md\n---\n# 1 Test Card [DONE]\n\n## Revision History\n`,
    });
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [
        {
          dotPath: "1",
          filePath: card.filePath,
          kind: "status-inconsistency",
          message: "child not DONE",
          suggestedAction: "regress-to-plan",
        },
      ],
      complianceIssues: [],
      scannedCards: 1,
      manifestFilesChecked: 0,
    };
    const injectedFs = captureFs();
    const result = applyIntegrityResults(report, [card], { regressProblematic: false }, injectedFs);

    expect(result.regressed).toHaveLength(0);
    const written = injectedFs.written.get(card.filePath)!;
    expect(written).toContain("[DONE]"); // status unchanged
  });

  it("returns updated count equal to number of cards", () => {
    const cards = [
      makeCard({ dotPath: "1.1" }),
      makeCard({ dotPath: "1.2" }),
      makeCard({ dotPath: "1.3" }),
    ];
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [],
      complianceIssues: [],
      scannedCards: 3,
      manifestFilesChecked: 0,
    };
    const injectedFs = captureFs();
    const result = applyIntegrityResults(report, cards, { regressProblematic: false }, injectedFs);
    expect(result.updated).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// formatIntegrityReport
// ---------------------------------------------------------------------------

describe("formatIntegrityReport", () => {
  it("returns clean report with no issues", () => {
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [],
      complianceIssues: [],
      scannedCards: 5,
      manifestFilesChecked: 3,
    };
    const output = formatIntegrityReport(report);
    expect(output).toContain("2026-01-01T00:00:00.000Z");
    expect(output).toContain("5 card(s)");
    expect(output).toContain("No structural issues");
    expect(output).toContain("All manifest files present");
  });

  it("returns report with structural issues formatted", () => {
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [
        {
          dotPath: "1.1",
          filePath: "plan/1.1.md",
          kind: "broken-child-link",
          message: "Child ref not found",
          suggestedAction: "regress-to-plan",
        },
      ],
      complianceIssues: [],
      scannedCards: 2,
      manifestFilesChecked: 0,
    };
    const output = formatIntegrityReport(report);
    expect(output).toContain("Structural Issues (1)");
    expect(output).toContain("1.1");
    expect(output).toContain("broken-child-link");
    expect(output).toContain("regress-to-plan");
  });

  it("returns report with compliance issues formatted", () => {
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [],
      complianceIssues: [
        {
          kind: "unowned-source-file",
          file: "src/orphan.ts",
          message: "not claimed by any card",
        },
      ],
      scannedCards: 2,
      manifestFilesChecked: 1,
    };
    const output = formatIntegrityReport(report);
    expect(output).toContain("Unowned source files (1)");
    expect(output).toContain("src/orphan.ts");
  });

  it("does not show suggestedAction line for flag-only issues", () => {
    const report: IntegrityReport = {
      timestamp: "2026-01-01T00:00:00.000Z",
      cardIssues: [
        {
          dotPath: "2.1",
          filePath: "plan/2.1.md",
          kind: "broken-parent-link",
          message: "Parent not found",
          suggestedAction: "flag-only",
        },
      ],
      complianceIssues: [],
      scannedCards: 1,
      manifestFilesChecked: 0,
    };
    const output = formatIntegrityReport(report);
    expect(output).not.toContain("=> flag-only");
    expect(output).toContain("broken-parent-link");
  });
});
