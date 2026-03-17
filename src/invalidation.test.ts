import { describe, it, expect } from "vitest";
import { invalidateCards, InvalidationResult } from "./invalidation.js";
import { Card, CardStatus, FileSystem } from "./types.js";

/** Helper to build a minimal card for testing */
function makeCard(
  dotPath: string,
  status: CardStatus,
  rawContent: string,
  filePath = `plan/${dotPath}-test.md`
): Card {
  return {
    dotPath,
    title: "Test Card",
    status,
    refs: { parent: null, root: null, children: [], blockedBy: [] },
    isNode: false,
    fileManifest: ["src/foo.ts"],
    filePath,
    rawContent,
  };
}

function makeCardContent(dotPath: string, status: string): string {
  return [
    "---",
    "parent: plan/root.md",
    "root: plan/root.md",
    "---",
    `# ${dotPath} Test Card [${status}]`,
    "",
    "## Description",
    "Some description here.",
    "",
    "## File Manifest",
    "- src/foo.ts",
    "",
    "## Acceptance Criteria",
    "- Something works",
    "",
  ].join("\n");
}

/** Create a mock FileSystem that tracks writes */
function mockFs(files: Record<string, string>): FileSystem & { written: Record<string, string> } {
  const written: Record<string, string> = {};
  return {
    written,
    readFileSync(p: string) {
      if (!(p in files)) throw new Error(`File not found: ${p}`);
      return files[p];
    },
    writeFileSync(p: string, c: string) {
      written[p] = c;
    },
    existsSync(p: string) {
      return p in files;
    },
    readdirSync() {
      return [];
    },
  };
}

describe("invalidateCards", () => {
  it("leaves PLAN cards alone", () => {
    const content = makeCardContent("1.1", "PLAN");
    const card = makeCard("1.1", "PLAN", content);
    const fs = mockFs({ [card.filePath]: content });

    const results = invalidateCards([card], ["src/foo.ts"], fs);

    expect(results).toHaveLength(1);
    expect(results[0].modified).toBe(false);
    expect(results[0].skipReason).toBeDefined();
    expect(fs.written).toEqual({});
  });

  it("regresses ARCHITECT to PLAN with note", () => {
    const content = makeCardContent("1.1", "ARCHITECT");
    const card = makeCard("1.1", "ARCHITECT", content);
    const fs = mockFs({ [card.filePath]: content });

    const results = invalidateCards([card], ["src/foo.ts"], fs);

    expect(results).toHaveLength(1);
    expect(results[0].modified).toBe(true);
    expect(results[0].previousStatus).toBe("ARCHITECT");
    expect(results[0].newStatus).toBe("PLAN");

    const written = fs.written[card.filePath];
    expect(written).toContain("[PLAN]");
    expect(written).toContain("Upstream change detected");
    expect(written).toContain("src/foo.ts");
  });

  it("regresses IMPLEMENT to PLAN with note", () => {
    const content = makeCardContent("2.1", "IMPLEMENT");
    const card = makeCard("2.1", "IMPLEMENT", content);
    const fs = mockFs({ [card.filePath]: content });

    const results = invalidateCards([card], ["src/bar.ts"], fs);

    expect(results).toHaveLength(1);
    expect(results[0].modified).toBe(true);
    expect(results[0].newStatus).toBe("PLAN");

    const written = fs.written[card.filePath];
    expect(written).toContain("[PLAN]");
    expect(written).toContain("src/bar.ts");
  });

  it("regresses REVIEW to PLAN with note", () => {
    const content = makeCardContent("3.1", "REVIEW");
    const card = makeCard("3.1", "REVIEW", content);
    const fs = mockFs({ [card.filePath]: content });

    const results = invalidateCards([card], ["src/foo.ts"], fs);

    expect(results).toHaveLength(1);
    expect(results[0].modified).toBe(true);
    expect(results[0].newStatus).toBe("PLAN");
  });

  it("regresses DONE to REVIEW with note", () => {
    const content = makeCardContent("4.1", "DONE");
    const card = makeCard("4.1", "DONE", content);
    const fs = mockFs({ [card.filePath]: content });

    const results = invalidateCards([card], ["src/foo.ts"], fs);

    expect(results).toHaveLength(1);
    expect(results[0].modified).toBe(true);
    expect(results[0].previousStatus).toBe("DONE");
    expect(results[0].newStatus).toBe("REVIEW");

    const written = fs.written[card.filePath];
    expect(written).toContain("[REVIEW]");
    expect(written).toContain("Upstream change detected");
  });

  it("leaves special status cards alone (BLOCKED-BY)", () => {
    const content = [
      "---",
      "parent: plan/root.md",
      "root: plan/root.md",
      "---",
      "# 1.2 Test Card [BLOCKED-BY 1.1]",
      "",
      "## Description",
      "Blocked card.",
      "",
    ].join("\n");
    const card = makeCard("1.2", { kind: "BLOCKED-BY", dotPath: "1.1" }, content);
    const fs = mockFs({ [card.filePath]: content });

    const results = invalidateCards([card], ["src/foo.ts"], fs);

    expect(results).toHaveLength(1);
    expect(results[0].modified).toBe(false);
    expect(results[0].skipReason).toBeDefined();
    expect(fs.written).toEqual({});
  });

  it("leaves special status cards alone (INACTIONABLE)", () => {
    const content = [
      "---",
      "parent: plan/root.md",
      "root: plan/root.md",
      "---",
      "# 1.3 Test Card [INACTIONABLE]",
      "",
      "## Description",
      "Inactionable card.",
      "",
    ].join("\n");
    const card = makeCard("1.3", { kind: "INACTIONABLE" }, content);
    const fs = mockFs({ [card.filePath]: content });

    const results = invalidateCards([card], ["src/foo.ts"], fs);

    expect(results).toHaveLength(1);
    expect(results[0].modified).toBe(false);
    expect(fs.written).toEqual({});
  });

  it("handles multiple affected cards independently", () => {
    const content1 = makeCardContent("1.1", "IMPLEMENT");
    const content2 = makeCardContent("2.1", "DONE");
    const content3 = makeCardContent("3.1", "PLAN");
    const card1 = makeCard("1.1", "IMPLEMENT", content1);
    const card2 = makeCard("2.1", "DONE", content2);
    const card3 = makeCard("3.1", "PLAN", content3);
    const fs = mockFs({
      [card1.filePath]: content1,
      [card2.filePath]: content2,
      [card3.filePath]: content3,
    });

    const results = invalidateCards([card1, card2, card3], ["src/foo.ts"], fs);

    expect(results).toHaveLength(3);

    // IMPLEMENT → PLAN
    expect(results[0].modified).toBe(true);
    expect(results[0].newStatus).toBe("PLAN");

    // DONE → REVIEW
    expect(results[1].modified).toBe(true);
    expect(results[1].newStatus).toBe("REVIEW");

    // PLAN → no change
    expect(results[2].modified).toBe(false);
  });

  it("includes all changed file names in the note", () => {
    const content = makeCardContent("1.1", "ARCHITECT");
    const card = makeCard("1.1", "ARCHITECT", content);
    const fs = mockFs({ [card.filePath]: content });

    const changedFiles = ["src/foo.ts", "src/bar.ts", "src/baz.ts"];
    invalidateCards([card], changedFiles, fs);

    const written = fs.written[card.filePath];
    expect(written).toContain("src/foo.ts");
    expect(written).toContain("src/bar.ts");
    expect(written).toContain("src/baz.ts");
  });

  it("appends note in the Description section", () => {
    const content = makeCardContent("1.1", "IMPLEMENT");
    const card = makeCard("1.1", "IMPLEMENT", content);
    const fs = mockFs({ [card.filePath]: content });

    invalidateCards([card], ["src/foo.ts"], fs);

    const written = fs.written[card.filePath];
    // Note should appear after Description content, before next section
    const descIdx = written.indexOf("## Description");
    const noteIdx = written.indexOf("Upstream change detected");
    const nextSection = written.indexOf("## File Manifest");
    expect(noteIdx).toBeGreaterThan(descIdx);
    expect(noteIdx).toBeLessThan(nextSection);
  });
});
