import { describe, it, expect } from "vitest";
import {
  parseStatus,
  parseHeading,
  parseReferences,
  parseFrontmatter,
  parseFileManifest,
  parseCard,
  updateCardStatus,
  formatStatus,
  nextLeafPhase,
  isPhase,
} from "./card.js";

describe("parseStatus", () => {
  it("parses standard phases", () => {
    expect(parseStatus("# 2.1 Parser [PLAN]")).toBe("PLAN");
    expect(parseStatus("# 1 Root [ARCHITECT]")).toBe("ARCHITECT");
    expect(parseStatus("# 3.1 Widget [IMPLEMENT]")).toBe("IMPLEMENT");
    expect(parseStatus("# 2.2 Tests [REVIEW]")).toBe("REVIEW");
    expect(parseStatus("# 1.1 Setup [DONE]")).toBe("DONE");
  });

  it("parses BLOCKED-BY", () => {
    const result = parseStatus("# 2.1 Parser [BLOCKED-BY 1.2]");
    expect(result).toEqual({ kind: "BLOCKED-BY", dotPath: "1.2" });
  });

  it("parses CONFLICTS-WITH", () => {
    const result = parseStatus("# 2.1 Parser [CONFLICTS-WITH 2.3]");
    expect(result).toEqual({ kind: "CONFLICTS-WITH", dotPath: "2.3" });
  });

  it("parses INACTIONABLE", () => {
    const result = parseStatus("# 5.1 Future [INACTIONABLE]");
    expect(result).toEqual({ kind: "INACTIONABLE" });
  });

  it("defaults to PLAN", () => {
    expect(parseStatus("# 2.1 Parser")).toBe("PLAN");
  });
});

describe("parseHeading", () => {
  it("parses dot-path and title", () => {
    expect(parseHeading("# 2.1 Plan Parser [PLAN]")).toEqual({
      dotPath: "2.1",
      title: "Plan Parser",
    });
  });

  it("handles multi-word titles", () => {
    expect(parseHeading("# 3.1.4 My Complex Title [IMPLEMENT]")).toEqual({
      dotPath: "3.1.4",
      title: "My Complex Title",
    });
  });

  it("handles headings without status", () => {
    expect(parseHeading("# 1 Root")).toEqual({
      dotPath: "1",
      title: "Root",
    });
  });
});

describe("parseFrontmatter", () => {
  it("parses scalar values", () => {
    const content = `---
parent: plan/2-core.md
root: plan/root.md
---
# 2.1 Parser [PLAN]
`;
    const fm = parseFrontmatter(content);
    expect(fm.parent).toBe("plan/2-core.md");
    expect(fm.root).toBe("plan/root.md");
  });

  it("parses list values", () => {
    const content = `---
children:
  - plan/2.1.1-tokenizer.md
  - plan/2.1.2-ast-builder.md
blocked-by:
  - plan/1.2-build-system.md
---
# 2.1 Parser [PLAN]
`;
    const fm = parseFrontmatter(content);
    expect(fm.children).toEqual([
      "plan/2.1.1-tokenizer.md",
      "plan/2.1.2-ast-builder.md",
    ]);
    expect(fm["blocked-by"]).toEqual(["plan/1.2-build-system.md"]);
  });

  it("returns empty object for no frontmatter", () => {
    expect(parseFrontmatter("# 1 Root [PLAN]\n")).toEqual({});
  });

  it("handles mixed scalar and list values", () => {
    const content = `---
parent: plan/2-core.md
root: plan/root.md
children:
  - plan/2.1.1-foo.md
---
# Card
`;
    const fm = parseFrontmatter(content);
    expect(fm.parent).toBe("plan/2-core.md");
    expect(fm.root).toBe("plan/root.md");
    expect(fm.children).toEqual(["plan/2.1.1-foo.md"]);
  });
});

describe("parseReferences", () => {
  it("parses all reference types from frontmatter", () => {
    const content = `---
parent: plan/2-core-engine.md
root: plan/root.md
children:
  - plan/2.1.1-tokenizer.md
  - plan/2.1.2-ast-builder.md
blocked-by:
  - plan/1.2-build-system.md
---
# 2.1 Parser [PLAN]

## Description
`;
    const refs = parseReferences(content);
    expect(refs.parent).toBe("plan/2-core-engine.md");
    expect(refs.root).toBe("plan/root.md");
    expect(refs.children).toEqual([
      "plan/2.1.1-tokenizer.md",
      "plan/2.1.2-ast-builder.md",
    ]);
    expect(refs.blockedBy).toEqual(["plan/1.2-build-system.md"]);
  });

  it("handles missing frontmatter", () => {
    const refs = parseReferences("# 1 Root [PLAN]\n\n## Description\n");
    expect(refs.parent).toBeNull();
    expect(refs.root).toBeNull();
    expect(refs.children).toEqual([]);
    expect(refs.blockedBy).toEqual([]);
  });

  it("handles partial frontmatter", () => {
    const content = `---
root: plan/root.md
---
# 1 Root [PLAN]
`;
    const refs = parseReferences(content);
    expect(refs.root).toBe("plan/root.md");
    expect(refs.parent).toBeNull();
    expect(refs.children).toEqual([]);
    expect(refs.blockedBy).toEqual([]);
  });
});

describe("parseFileManifest", () => {
  it("parses file manifest", () => {
    const content = `# 2.1 Parser [PLAN]

## File Manifest
Files of interest:
- src/parser/index.ts
- src/parser/types.ts

## Other Section
`;
    const manifest = parseFileManifest(content);
    expect(manifest).toEqual(["src/parser/index.ts", "src/parser/types.ts"]);
  });

  it("returns empty for no manifest", () => {
    expect(parseFileManifest("# 1 Root [PLAN]\n")).toEqual([]);
  });
});

describe("parseCard", () => {
  it("parses a complete card with frontmatter", () => {
    const content = `---
parent: plan/2-core-engine.md
root: plan/root.md
children:
  - plan/2.1.1-tokenizer.md
---
# 2.1 Plan Parser [ARCHITECT]

## Description
Parse plan files.

## File Manifest
- src/parser/index.ts
`;
    const card = parseCard("plan/2.1-parser.md", content);
    expect(card.dotPath).toBe("2.1");
    expect(card.title).toBe("Plan Parser");
    expect(card.status).toBe("ARCHITECT");
    expect(card.isNode).toBe(true);
    expect(card.refs.children).toHaveLength(1);
    expect(card.refs.parent).toBe("plan/2-core-engine.md");
    expect(card.fileManifest).toEqual(["src/parser/index.ts"]);
  });

  it("identifies leaf cards (no children in frontmatter)", () => {
    const content = `---
parent: plan/2.1-parser.md
root: plan/root.md
---
# 2.1.1 Tokenizer [PLAN]

## Description
Tokenize input.
`;
    const card = parseCard("plan/2.1.1-tokenizer.md", content);
    expect(card.isNode).toBe(false);
  });

  it("parses cards without frontmatter", () => {
    const content = `# 1 Root [PLAN]

## Description
Root card.
`;
    const card = parseCard("plan/root.md", content);
    expect(card.dotPath).toBe("1");
    expect(card.isNode).toBe(false);
    expect(card.refs.parent).toBeNull();
  });
});

describe("updateCardStatus", () => {
  it("updates status in content", () => {
    const content = "# 2.1 Parser [PLAN]\n\nSome content\n";
    const updated = updateCardStatus(content, "ARCHITECT");
    expect(updated).toContain("[ARCHITECT]");
    expect(updated).not.toContain("[PLAN]");
  });

  it("updates to special status", () => {
    const content = "# 2.1 Parser [PLAN]\n";
    const updated = updateCardStatus(content, {
      kind: "BLOCKED-BY",
      dotPath: "1.2",
    });
    expect(updated).toContain("[BLOCKED-BY 1.2]");
  });

  it("updates root-format headings without dot-path", () => {
    const content = "# Root Plan [PLAN]\n\nDescription\n";
    const updated = updateCardStatus(content, "DONE");
    expect(updated).toContain("[DONE]");
    expect(updated).not.toContain("[PLAN]");
  });

  it("updates root-format headings to special status", () => {
    const content = "# My Project [ARCHITECT]\n";
    const updated = updateCardStatus(content, {
      kind: "CONFLICTS-WITH",
      dotPath: "2.3",
    });
    expect(updated).toContain("[CONFLICTS-WITH 2.3]");
    expect(updated).not.toContain("[ARCHITECT]");
  });

  it("preserves frontmatter when updating status", () => {
    const content = `---
parent: plan/2-core.md
root: plan/root.md
---
# 2.1 Parser [PLAN]

## Description
`;
    const updated = updateCardStatus(content, "ARCHITECT");
    expect(updated).toContain("parent: plan/2-core.md");
    expect(updated).toContain("[ARCHITECT]");
  });
});

describe("formatStatus", () => {
  it("formats phases", () => {
    expect(formatStatus("PLAN")).toBe("PLAN");
    expect(formatStatus("DONE")).toBe("DONE");
  });

  it("formats special statuses", () => {
    expect(formatStatus({ kind: "BLOCKED-BY", dotPath: "1.2" })).toBe(
      "BLOCKED-BY 1.2"
    );
    expect(formatStatus({ kind: "CONFLICTS-WITH", dotPath: "2.3" })).toBe(
      "CONFLICTS-WITH 2.3"
    );
    expect(formatStatus({ kind: "INACTIONABLE" })).toBe("INACTIONABLE");
  });
});

describe("nextLeafPhase", () => {
  it("returns next phase", () => {
    expect(nextLeafPhase("PLAN")).toBe("ARCHITECT");
    expect(nextLeafPhase("ARCHITECT")).toBe("IMPLEMENT");
    expect(nextLeafPhase("IMPLEMENT")).toBe("REVIEW");
    expect(nextLeafPhase("REVIEW")).toBe("DONE");
  });

  it("returns null for DONE", () => {
    expect(nextLeafPhase("DONE")).toBeNull();
  });
});

describe("isPhase", () => {
  it("returns true for phases", () => {
    expect(isPhase("PLAN")).toBe(true);
    expect(isPhase("DONE")).toBe(true);
  });

  it("returns false for special statuses", () => {
    expect(isPhase({ kind: "BLOCKED-BY", dotPath: "1" })).toBe(false);
  });
});
