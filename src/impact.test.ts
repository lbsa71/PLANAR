import { describe, it, expect } from "vitest";
import { findAffectedCards, createImpactCard } from "./impact.js";
import { FileSystem } from "./types.js";

/** Helper to build a minimal card file with a file manifest */
function makeCard(
  dotPath: string,
  title: string,
  manifestEntries: string[]
): string {
  const manifest = manifestEntries.map((e) => `- ${e}`).join("\n");
  return [
    "---",
    "parent: plan/root.md",
    "root: plan/root.md",
    "---",
    `# ${dotPath} ${title} [PLAN]`,
    "",
    "## Description",
    "Test card.",
    "",
    "## File Manifest",
    manifest,
    "",
    "## Acceptance Criteria",
    "- Done",
    "",
  ].join("\n");
}

function makeFs(files: Record<string, string>): FileSystem {
  return {
    readFileSync: (p: string) => {
      const norm = p.replace(/\\/g, "/");
      for (const [key, val] of Object.entries(files)) {
        if (norm.endsWith(key) || key === norm) return val;
      }
      throw new Error(`File not found: ${p}`);
    },
    writeFileSync: (p: string, content: string) => {
      const norm = p.replace(/\\/g, "/");
      files[norm] = content;
    },
    existsSync: (p: string) => {
      const norm = p.replace(/\\/g, "/").replace(/\/$/, "");
      return Object.keys(files).some(
        (k) =>
          norm.endsWith(k) ||
          k === norm ||
          k.startsWith(norm + "/")
      );
    },
    readdirSync: (p: string) => {
      const norm = p.replace(/\\/g, "/").replace(/\/$/, "");
      return Object.keys(files)
        .filter((k) => {
          const dir = k.substring(0, k.lastIndexOf("/"));
          return dir === norm;
        })
        .map((k) => k.substring(k.lastIndexOf("/") + 1));
    },
  };
}

const rootCard = [
  "---",
  "root: plan/root.md",
  "children:",
  "  - plan/1-foo.md",
  "  - plan/2-bar.md",
  "---",
  "# 0 Root [DONE]",
  "",
  "## Description",
  "Root.",
  "",
].join("\n");

describe("findAffectedCards", () => {
  it("returns cards whose manifest contains a changed file", () => {
    const fs = makeFs({
      "plan/root.md": rootCard,
      "plan/1-foo.md": makeCard("1", "Foo", ["src/foo.ts", "src/shared.ts"]),
      "plan/2-bar.md": makeCard("2", "Bar", ["src/bar.ts"]),
    });

    const result = findAffectedCards(["src/foo.ts"], "plan", fs);
    expect(result).toHaveLength(1);
    expect(result[0].dotPath).toBe("1");
  });

  it("returns multiple cards when a file appears in several manifests", () => {
    const fs = makeFs({
      "plan/root.md": rootCard,
      "plan/1-foo.md": makeCard("1", "Foo", ["src/shared.ts"]),
      "plan/2-bar.md": makeCard("2", "Bar", ["src/shared.ts"]),
    });

    const result = findAffectedCards(["src/shared.ts"], "plan", fs);
    expect(result).toHaveLength(2);
  });

  it("returns empty when no manifests match", () => {
    const fs = makeFs({
      "plan/root.md": rootCard,
      "plan/1-foo.md": makeCard("1", "Foo", ["src/foo.ts"]),
    });

    const result = findAffectedCards(["src/unrelated.ts"], "plan", fs);
    expect(result).toHaveLength(0);
  });

  it("strips manifest annotations (parenthetical notes) before matching", () => {
    const fs = makeFs({
      "plan/root.md": rootCard,
      "plan/1-foo.md": makeCard("1", "Foo", [
        "src/card.ts (read — uses discoverCards)",
      ]),
    });

    const result = findAffectedCards(["src/card.ts"], "plan", fs);
    expect(result).toHaveLength(1);
    expect(result[0].dotPath).toBe("1");
  });

  it("normalizes backslashes in changed files to forward slashes", () => {
    const fs = makeFs({
      "plan/root.md": rootCard,
      "plan/1-foo.md": makeCard("1", "Foo", ["src/foo.ts"]),
    });

    const result = findAffectedCards(["src\\foo.ts"], "plan", fs);
    expect(result).toHaveLength(1);
  });
});

describe("createImpactCard", () => {
  it("creates 0.1-upstream-sync.md when no 0.* cards exist", () => {
    const files: Record<string, string> = {
      "plan/root.md": rootCard,
      "plan/1-foo.md": makeCard("1", "Foo", ["src/foo.ts"]),
    };
    const fs = makeFs(files);

    const cardPath = createImpactCard(
      "abc123..def456",
      ["src/foo.ts", "src/bar.ts"],
      [{ dotPath: "1", title: "Foo", filePath: "plan/1-foo.md" }],
      " 2 files changed, 10 insertions(+), 3 deletions(-)",
      "plan",
      fs
    );

    expect(cardPath).toContain("0.1-upstream-sync.md");
    const content = files[cardPath.replace(/\\/g, "/")];
    expect(content).toBeDefined();
    expect(content).toContain("# 0.1 Upstream Sync [PLAN]");
    expect(content).toContain("parent: plan/root.md");
    expect(content).toContain("root: plan/root.md");
    expect(content).toContain("abc123..def456");
    expect(content).toContain("src/foo.ts");
    expect(content).toContain("src/bar.ts");
    expect(content).toContain("1 Foo");
    expect(content).toContain("10 insertions");
  });

  it("increments dot-path when existing 0.* cards are present", () => {
    const files: Record<string, string> = {
      "plan/root.md": rootCard,
      "plan/0.1-upstream-sync.md": makeCard("0.1", "Upstream Sync", []),
      "plan/1-foo.md": makeCard("1", "Foo", ["src/foo.ts"]),
    };
    const fs = makeFs(files);

    const cardPath = createImpactCard(
      "aaa..bbb",
      ["src/foo.ts"],
      [{ dotPath: "1", title: "Foo", filePath: "plan/1-foo.md" }],
      " 1 file changed",
      "plan",
      fs
    );

    expect(cardPath).toContain("0.2-upstream-sync.md");
    const content = files[cardPath.replace(/\\/g, "/")];
    expect(content).toContain("# 0.2 Upstream Sync [PLAN]");
  });

  it("includes all sections in the generated card", () => {
    const files: Record<string, string> = {
      "plan/root.md": rootCard,
    };
    const fs = makeFs(files);

    const cardPath = createImpactCard(
      "aaa..bbb",
      ["src/a.ts"],
      [{ dotPath: "2", title: "Bar", filePath: "plan/2-bar.md" }],
      " 1 file changed, 5 insertions(+)",
      "plan",
      fs
    );

    const content = files[cardPath.replace(/\\/g, "/")];
    expect(content).toContain("## Commit Range");
    expect(content).toContain("## Changed Files");
    expect(content).toContain("## Affected Cards");
    expect(content).toContain("## Diffstat");
  });
});
