import { describe, it, expect } from "vitest";
import { generateSystemPrompt } from "./system-prompt.js";
import { Card } from "./types.js";

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    dotPath: "2.1",
    title: "Plan Parser",
    status: "PLAN",
    refs: { parent: null, root: null, children: [], blockedBy: [] },
    isNode: false,
    fileManifest: [],
    filePath: "plan/2.1-parser.md",
    rawContent: "",
    ...overrides,
  };
}

describe("generateSystemPrompt", () => {
  it("includes card identity in preamble", () => {
    const prompt = generateSystemPrompt(makeCard(), "plan/root.md");
    expect(prompt).toContain("2.1 Plan Parser");
    expect(prompt).toContain("plan/2.1-parser.md");
    expect(prompt).toContain("plan/root.md");
  });

  it("includes challenge rules in preamble", () => {
    const prompt = generateSystemPrompt(makeCard(), "plan/root.md");
    expect(prompt).toContain("Challenging a Status");
    expect(prompt).toContain("BOTH conditions");
    expect(prompt).toContain("Regress the phase");
    expect(prompt).toContain("Change the card content");
  });

  it("includes sibling discovery instruction", () => {
    const prompt = generateSystemPrompt(makeCard(), "plan/root.md");
    expect(prompt).toContain("plan/2.*");
  });

  // -- Leaf phases --

  it("generates PLAN phase prompt for leaf", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: "PLAN" }),
      "plan/root.md"
    );
    expect(prompt).toContain("PLAN Phase");
    expect(prompt).toContain("Leaf lifecycle");
    expect(prompt).toContain("advance status to [ARCHITECT]");
    expect(prompt).toContain("Do NOT write to src/ or docs/");
  });

  it("generates ARCHITECT phase prompt for leaf", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: "ARCHITECT" }),
      "plan/root.md"
    );
    expect(prompt).toContain("ARCHITECT Phase");
    expect(prompt).toContain("ARCHITECTURE.md");
    expect(prompt).toContain("Do NOT write to src/");
  });

  it("generates IMPLEMENT phase prompt for leaf", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: "IMPLEMENT" }),
      "plan/root.md"
    );
    expect(prompt).toContain("IMPLEMENT Phase");
    expect(prompt).toContain("Smallest valuable increment");
    expect(prompt).toContain("Pre-refactor");
    expect(prompt).toContain("Red/Green/Refactor");
    expect(prompt).toContain("Do NOT write to docs/");
  });

  it("generates REVIEW phase prompt for leaf", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: "REVIEW" }),
      "plan/root.md"
    );
    expect(prompt).toContain("REVIEW Phase");
    expect(prompt).toContain("acceptance criterion");
    expect(prompt).toContain("Do NOT write to src/ or docs/");
  });

  it("generates DONE phase prompt for leaf", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: "DONE" }),
      "plan/root.md"
    );
    expect(prompt).toContain("DONE Phase");
    expect(prompt).toContain("MUST change card content when regressing");
  });

  // -- Node --

  it("generates node prompt for PLAN phase", () => {
    const prompt = generateSystemPrompt(
      makeCard({
        isNode: true,
        refs: {
          parent: null,
          root: null,
          children: ["plan/2.1.1-foo.md"],
          blockedBy: [],
        },
      }),
      "plan/root.md"
    );
    expect(prompt).toContain("NODE");
    expect(prompt).toContain("PLAN → DONE");
    expect(prompt).toContain("Decompose this node");
  });

  it("generates node prompt for DONE phase", () => {
    const prompt = generateSystemPrompt(
      makeCard({
        status: "DONE",
        isNode: true,
        refs: {
          parent: null,
          root: null,
          children: ["plan/2.1.1-foo.md"],
          blockedBy: [],
        },
      }),
      "plan/root.md"
    );
    expect(prompt).toContain("NODE");
    expect(prompt).toContain("[DONE]");
    expect(prompt).toContain("Challenge this card back to [PLAN]");
  });

  // -- File manifest --

  it("includes file manifest when present", () => {
    const prompt = generateSystemPrompt(
      makeCard({ fileManifest: ["src/parser/index.ts", "src/parser/types.ts"] }),
      "plan/root.md"
    );
    expect(prompt).toContain("File Manifest — Read These First");
    expect(prompt).toContain("src/parser/index.ts");
    expect(prompt).toContain("src/parser/types.ts");
  });

  it("omits file manifest section when empty", () => {
    const prompt = generateSystemPrompt(
      makeCard({ fileManifest: [] }),
      "plan/root.md"
    );
    expect(prompt).not.toContain("File Manifest — Read These First");
  });

  // -- Special statuses --

  it("handles BLOCKED-BY status", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: { kind: "BLOCKED-BY", dotPath: "1.2" } }),
      "plan/root.md"
    );
    expect(prompt).toContain("BLOCKED-BY 1.2");
    expect(prompt).toContain("Special Status");
  });

  it("handles CONFLICTS-WITH status", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: { kind: "CONFLICTS-WITH", dotPath: "2.3" } }),
      "plan/root.md"
    );
    expect(prompt).toContain("CONFLICTS-WITH 2.3");
  });

  it("handles INACTIONABLE status", () => {
    const prompt = generateSystemPrompt(
      makeCard({ status: { kind: "INACTIONABLE" } }),
      "plan/root.md"
    );
    expect(prompt).toContain("INACTIONABLE");
  });
});
