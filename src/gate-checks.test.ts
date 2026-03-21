import { describe, it, expect } from "vitest";
import {
  checkPlanToArchitect,
  checkArchitectToImplement,
  checkImplementToReview,
  checkReviewToDone,
  GateResult,
} from "./gate-checks";
import { Card } from "./types";

// ── Test Helpers ────────────────────────────────────────────

function makeCard(overrides: Partial<Card> & { rawContent: string }): Card {
  return {
    dotPath: "99",
    title: "Test Card",
    status: "PLAN",
    refs: { parent: null, root: null, children: [], blockedBy: [] },
    isNode: false,
    fileManifest: [],
    filePath: "plan/99-test.md",
    rawContent: overrides.rawContent,
    ...overrides,
  };
}

function hasViolation(result: GateResult, check: string): boolean {
  return result.violations.some((v) => v.check === check);
}

// ── checkPlanToArchitect ────────────────────────────────────

describe("checkPlanToArchitect", () => {
  it("passes when Description and AC with bullets exist", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [PLAN]",
        "",
        "## Description",
        "This card does something.",
        "",
        "## Acceptance Criteria",
        "- It works correctly",
        "- It handles edge cases",
      ].join("\n"),
    });

    const result = checkPlanToArchitect(card);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails with description-exists when no ## Description", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [PLAN]",
        "",
        "## Acceptance Criteria",
        "- Something",
      ].join("\n"),
    });

    const result = checkPlanToArchitect(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "description-exists")).toBe(true);
  });

  it("fails with description-non-empty when Description has no content", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [PLAN]",
        "",
        "## Description",
        "",
        "## Acceptance Criteria",
        "- Something",
      ].join("\n"),
    });

    const result = checkPlanToArchitect(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "description-non-empty")).toBe(true);
  });

  it("fails with ac-exists when no ## Acceptance Criteria", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [PLAN]",
        "",
        "## Description",
        "Something here.",
      ].join("\n"),
    });

    const result = checkPlanToArchitect(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "ac-exists")).toBe(true);
  });

  it("fails with ac-has-bullets when AC section has no bullets", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [PLAN]",
        "",
        "## Description",
        "Something here.",
        "",
        "## Acceptance Criteria",
        "No bullets here, just text.",
      ].join("\n"),
    });

    const result = checkPlanToArchitect(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "ac-has-bullets")).toBe(true);
  });

  it("reports multiple violations at once", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [PLAN]",
      ].join("\n"),
    });

    const result = checkPlanToArchitect(card);
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBe(2);
    expect(hasViolation(result, "description-exists")).toBe(true);
    expect(hasViolation(result, "ac-exists")).toBe(true);
  });
});

// ── checkArchitectToImplement ───────────────────────────────

describe("checkArchitectToImplement", () => {
  it("passes with file manifest and no keyword triggers", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "This card builds a widget component that renders data in the dashboard view.",
        "",
        "## File Manifest",
        "- src/widget.ts",
      ].join("\n"),
      fileManifest: ["src/widget.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails with file-manifest-non-empty when manifest is empty", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "A simple widget.",
      ].join("\n"),
      fileManifest: [],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "file-manifest-non-empty")).toBe(true);
  });

  it("passes interface keyword check when Contracts has all 3 subsections", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Define the interface for the parser module that transforms raw input into structured output.",
        "",
        "## File Manifest",
        "- src/parser.ts",
        "",
        "## Contracts",
        "",
        "### Preconditions",
        "- Input is valid",
        "",
        "### Postconditions",
        "- Output is correct",
        "",
        "### Invariants",
        "- State is consistent",
      ].join("\n"),
      fileManifest: ["src/parser.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(true);
  });

  it("fails with contracts-required when Description mentions 'interface' but no Contracts section", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Define the interface for the parser.",
        "",
        "## File Manifest",
        "- src/parser.ts",
      ].join("\n"),
      fileManifest: ["src/parser.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "contracts-required")).toBe(true);
  });

  it("fails with contracts-subsection-missing when Contracts lacks subsections", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Define the API surface.",
        "",
        "## File Manifest",
        "- src/api.ts",
        "",
        "## Contracts",
        "Some contract info but no subsections.",
      ].join("\n"),
      fileManifest: ["src/api.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    const subsectionViolations = result.violations.filter(
      (v) => v.check === "contracts-subsection-missing",
    );
    expect(subsectionViolations.length).toBe(3);
  });

  it("fails with decision-required when Description mentions 'choose' keyword but no Decision", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Select the best approach for caching.",
        "",
        "## File Manifest",
        "- src/cache.ts",
      ].join("\n"),
      fileManifest: ["src/cache.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "decision-required")).toBe(true);
  });

  it("passes decision check when Decision has all required subsections", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Select the best approach for caching data in the application layer.",
        "",
        "## File Manifest",
        "- src/cache.ts",
        "",
        "## Decision",
        "",
        "### Context",
        "We need a caching layer for frequently accessed data.",
        "",
        "### Options Considered",
        "- Redis",
        "- Memcached",
        "",
        "### Choice",
        "Redis",
        "",
        "### Rationale",
        "Better ecosystem support.",
        "",
        "### Consequences",
        "- Adds Redis as a runtime dependency.",
      ].join("\n"),
      fileManifest: ["src/cache.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(true);
  });

  it("fails with decision-subsection-missing when Decision lacks subsections", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Decide on a pattern for routing.",
        "",
        "## File Manifest",
        "- src/router.ts",
        "",
        "## Decision",
        "We will use pattern X.",
      ].join("\n"),
      fileManifest: ["src/router.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    const subsectionViolations = result.violations.filter(
      (v) => v.check === "decision-subsection-missing",
    );
    expect(subsectionViolations.length).toBe(5);
  });

  it("fails with threshold-registry-required when Description mentions 'timeout' but no Threshold Registry", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Configure the timeout values.",
        "",
        "## File Manifest",
        "- src/config.ts",
      ].join("\n"),
      fileManifest: ["src/config.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "threshold-registry-required")).toBe(true);
  });

  it("passes threshold check when Threshold Registry exists", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Set the default timeout limits for all network requests and background job processing.",
        "",
        "## File Manifest",
        "- src/config.ts",
        "",
        "## Threshold Registry",
        "",
        "| Name | Value | Unit | Valid Range | Rationale | Sensitivity |",
        "|---|---|---|---|---|---|",
        "| TIMEOUT | 30 | seconds | 1-300 | Standard | Medium |",
      ].join("\n"),
      fileManifest: ["src/config.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(true);
  });

  it("fails with behavioral-spec-required when Description mentions 'algorithm' but no behavioral spec", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Implement the sorting algorithm.",
        "",
        "## File Manifest",
        "- src/sort.ts",
        "",
        "## Acceptance Criteria",
        "- It sorts correctly",
      ].join("\n"),
      fileManifest: ["src/sort.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "behavioral-spec-required")).toBe(true);
  });

  it("passes flow check when inline Given/When/Then exists in AC", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Implement the state transition logic that governs how agents move between processing phases.",
        "",
        "## File Manifest",
        "- src/state.ts",
        "",
        "## Acceptance Criteria",
        "- Given an idle state, when start is called, then it transitions to running",
      ].join("\n"),
      fileManifest: ["src/state.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(true);
  });

  it("passes flow check when .feature file is linked in File Manifest", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Implement the sequence of operations that processes incoming data through the pipeline stages.",
        "",
        "## File Manifest",
        "- src/ops.ts",
        "- tests/ops.feature",
        "",
        "## Acceptance Criteria",
        "- Operations execute in order",
      ].join("\n"),
      fileManifest: ["src/ops.ts", "tests/ops.feature"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(true);
  });

  it("keyword matching is case-insensitive", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Define the INTERFACE and SCHEMA for the system configuration and data processing pipeline.",
        "",
        "## File Manifest",
        "- src/system.ts",
      ].join("\n"),
      fileManifest: ["src/system.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "contracts-required")).toBe(true);
  });
});

// ── checkImplementToReview ──────────────────────────────────

describe("checkImplementToReview", () => {
  it("passes when all manifest files exist", () => {
    const card = makeCard({
      rawContent: "---\nroot: plan/root.md\n---\n# 99 Test [IMPLEMENT]\n",
      fileManifest: ["src/foo.ts", "src/bar.ts"],
    });

    const existsSync = () => true;
    const result = checkImplementToReview(card, existsSync);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails with file-exists when a manifest file is missing", () => {
    const card = makeCard({
      rawContent: "---\nroot: plan/root.md\n---\n# 99 Test [IMPLEMENT]\n",
      fileManifest: ["src/foo.ts"],
    });

    const existsSync = () => false;
    const result = checkImplementToReview(card, existsSync);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "file-exists")).toBe(true);
    expect(result.violations[0].message).toContain("src/foo.ts");
  });

  it("strips annotation suffixes before checking existence", () => {
    const card = makeCard({
      rawContent: "---\nroot: plan/root.md\n---\n# 99 Test [IMPLEMENT]\n",
      fileManifest: [
        "src/foo.ts (create)",
        "src/bar.ts (dependency — consumed by gate checks, read-only)",
      ],
    });

    const checkedPaths: string[] = [];
    const existsSync = (path: string) => {
      checkedPaths.push(path);
      return true;
    };

    checkImplementToReview(card, existsSync);
    expect(checkedPaths).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("reports multiple missing files", () => {
    const card = makeCard({
      rawContent: "---\nroot: plan/root.md\n---\n# 99 Test [IMPLEMENT]\n",
      fileManifest: ["src/a.ts", "src/b.ts", "src/c.ts"],
    });

    const existsSync = (path: string) => path === "src/b.ts";
    const result = checkImplementToReview(card, existsSync);
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBe(2);
  });

  it("passes with empty file manifest", () => {
    const card = makeCard({
      rawContent: "---\nroot: plan/root.md\n---\n# 99 Test [IMPLEMENT]\n",
      fileManifest: [],
    });

    const result = checkImplementToReview(card, () => false);
    expect(result.pass).toBe(true);
  });
});

// ── checkReviewToDone ───────────────────────────────────────

describe("checkReviewToDone", () => {
  it("passes when no regression notes and AC has bullets", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [REVIEW]",
        "",
        "## Acceptance Criteria",
        "- Everything works",
        "- Edge cases handled",
      ].join("\n"),
    });

    const result = checkReviewToDone(card);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails with no-open-regressions when regression callout exists", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [REVIEW]",
        "",
        "> [!NOTE] regression: something broke",
        "",
        "## Acceptance Criteria",
        "- Works",
      ].join("\n"),
    });

    const result = checkReviewToDone(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "no-open-regressions")).toBe(true);
  });

  it("fails with no-open-regressions when ## Regression heading exists", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [REVIEW]",
        "",
        "## Regression",
        "Something went wrong.",
        "",
        "## Acceptance Criteria",
        "- Works",
      ].join("\n"),
    });

    const result = checkReviewToDone(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "no-open-regressions")).toBe(true);
  });

  it("fails with ac-bullets-present when AC has no bullets", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [REVIEW]",
        "",
        "## Acceptance Criteria",
        "No bullets here.",
      ].join("\n"),
    });

    const result = checkReviewToDone(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "ac-bullets-present")).toBe(true);
  });

  it("fails with ac-bullets-present when AC section is missing", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [REVIEW]",
      ].join("\n"),
    });

    const result = checkReviewToDone(card);
    expect(result.pass).toBe(false);
    expect(hasViolation(result, "ac-bullets-present")).toBe(true);
  });

  it("passes when content mentions 'regression' outside of callout/heading patterns", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [REVIEW]",
        "",
        "## Description",
        "This card prevents regression in the parser.",
        "",
        "## Acceptance Criteria",
        "- No regressions introduced",
      ].join("\n"),
    });

    const result = checkReviewToDone(card);
    expect(result.pass).toBe(true);
  });
});

// ── Depth checks ──────────────────────────────────────────────

describe("depth checks in checkArchitectToImplement", () => {
  it("fails description-depth when Description has fewer than 10 words", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Too short.",
        "",
        "## File Manifest",
        "- src/foo.ts",
      ].join("\n"),
      fileManifest: ["src/foo.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "description-depth")).toBe(true);
  });

  it("passes description-depth when Description has 10+ words", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "This card implements a comprehensive widget system for rendering data in dashboards.",
        "",
        "## File Manifest",
        "- src/foo.ts",
      ].join("\n"),
      fileManifest: ["src/foo.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "description-depth")).toBe(false);
  });

  it("fails decision-option-count when Options Considered has fewer than 2 bullets", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Select the best approach for handling data persistence in the application layer.",
        "",
        "## File Manifest",
        "- src/cache.ts",
        "",
        "## Decision",
        "",
        "### Context",
        "Need caching.",
        "",
        "### Options Considered",
        "- Redis only",
        "",
        "### Choice",
        "Redis",
        "",
        "### Rationale",
        "It works.",
        "",
        "### Consequences",
        "- Adds dependency.",
      ].join("\n"),
      fileManifest: ["src/cache.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "decision-option-count")).toBe(true);
  });

  it("passes decision-option-count with 2+ options", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Select the best approach for handling data persistence in the application layer.",
        "",
        "## File Manifest",
        "- src/cache.ts",
        "",
        "## Decision",
        "",
        "### Context",
        "Need caching.",
        "",
        "### Options Considered",
        "- Redis",
        "- Memcached",
        "",
        "### Choice",
        "Redis",
        "",
        "### Rationale",
        "Better support.",
        "",
        "### Consequences",
        "- Adds dependency.",
      ].join("\n"),
      fileManifest: ["src/cache.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "decision-option-count")).toBe(false);
  });

  it("fails contracts-subsection-depth when subsection has 0 bullets", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Define the interface for the data parser that handles structured input transformation.",
        "",
        "## File Manifest",
        "- src/parser.ts",
        "",
        "## Contracts",
        "",
        "### Preconditions",
        "TBD",
        "",
        "### Postconditions",
        "- Output is correct",
        "",
        "### Invariants",
        "- State is consistent",
      ].join("\n"),
      fileManifest: ["src/parser.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "contracts-subsection-depth")).toBe(true);
  });

  it("passes contracts-subsection-depth when all subsections have bullets", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Define the interface for the data parser that handles structured input transformation.",
        "",
        "## File Manifest",
        "- src/parser.ts",
        "",
        "## Contracts",
        "",
        "### Preconditions",
        "- Input is valid",
        "",
        "### Postconditions",
        "- Output is correct",
        "",
        "### Invariants",
        "- State is consistent",
      ].join("\n"),
      fileManifest: ["src/parser.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "contracts-subsection-depth")).toBe(false);
  });

  it("fails threshold-empty-cells when a Threshold Registry row has empty cells", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Configure the timeout values and connection limits for all external service calls.",
        "",
        "## File Manifest",
        "- src/config.ts",
        "",
        "## Threshold Registry",
        "",
        "| Name | Value | Unit | Valid Range | Rationale | Sensitivity |",
        "|---|---|---|---|---|---|",
        "| TIMEOUT | 30 |  | --- | TBD | --- |",
      ].join("\n"),
      fileManifest: ["src/config.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "threshold-empty-cells")).toBe(true);
  });

  it("passes threshold-empty-cells when all cells are filled", () => {
    const card = makeCard({
      rawContent: [
        "---",
        "root: plan/root.md",
        "---",
        "# 99 Test [ARCHITECT]",
        "",
        "## Description",
        "Configure the timeout values and connection limits for all external service calls.",
        "",
        "## File Manifest",
        "- src/config.ts",
        "",
        "## Threshold Registry",
        "",
        "| Name | Value | Unit | Valid Range | Rationale | Sensitivity |",
        "|---|---|---|---|---|---|",
        "| TIMEOUT | 30 | seconds | 1-300 | Standard UX | Medium |",
      ].join("\n"),
      fileManifest: ["src/config.ts"],
    });

    const result = checkArchitectToImplement(card);
    expect(hasViolation(result, "threshold-empty-cells")).toBe(false);
  });
});
