import { describe, it, expect } from "vitest";
import { parseCardSections } from "./section-parser.js";
import type { SectionParseResult, ThresholdRow } from "./section-parser.js";

// Helper to build a minimal card with frontmatter
function card(body: string): string {
  return `---\nparent: plan/root.md\nroot: plan/root.md\n---\n# 1.1 Test Card [IMPLEMENT]\n\n${body}`;
}

describe("parseCardSections", () => {
  // ── Decision ──────────────────────────────────────────────

  describe("Decision section", () => {
    it("detects ## Decision heading", () => {
      const result = parseCardSections(card("## Decision\n\nSome content"));
      expect(result.decision.present).toBe(true);
    });

    it("detects Decision subsections", () => {
      const result = parseCardSections(card(
        "## Decision\n\n### Context\nfoo\n\n### Options Considered\nbar\n\n### Choice\nbaz\n\n### Rationale\nqux\n\n### Consequences\nquux"
      ));
      expect(result.decision.present).toBe(true);
      expect(result.decision.subsections.context).toBe(true);
      expect(result.decision.subsections.optionsConsidered).toBe(true);
      expect(result.decision.subsections.choice).toBe(true);
      expect(result.decision.subsections.rationale).toBe(true);
      expect(result.decision.subsections.consequences).toBe(true);
    });

    it("returns false when ## Decision is absent", () => {
      const result = parseCardSections(card("## Description\nSome content"));
      expect(result.decision.present).toBe(false);
    });

    it("detects ## Decision with no content below (malformed)", () => {
      const result = parseCardSections(card("## Decision\n\n## Contracts\nfoo"));
      expect(result.decision.present).toBe(true);
    });

    it("is case-insensitive for heading text", () => {
      const result = parseCardSections(card("## decision\n\nSome content"));
      expect(result.decision.present).toBe(true);
    });
  });

  // ── Contracts ─────────────────────────────────────────────

  describe("Contracts section", () => {
    it("detects ## Contracts with all subsections", () => {
      const result = parseCardSections(card(
        "## Contracts\n\n### Preconditions\nfoo\n\n### Postconditions\nbar\n\n### Invariants\nbaz"
      ));
      expect(result.contracts.present).toBe(true);
      expect(result.contracts.subsections.preconditions).toBe(true);
      expect(result.contracts.subsections.postconditions).toBe(true);
      expect(result.contracts.subsections.invariants).toBe(true);
    });

    it("detects missing ### Invariants subsection", () => {
      const result = parseCardSections(card(
        "## Contracts\n\n### Preconditions\nfoo\n\n### Postconditions\nbar"
      ));
      expect(result.contracts.present).toBe(true);
      expect(result.contracts.subsections.invariants).toBe(false);
    });

    it("returns false when ## Contracts is absent", () => {
      const result = parseCardSections(card("## Description\nfoo"));
      expect(result.contracts.present).toBe(false);
    });

    it("does not match subsections from a different parent section", () => {
      // ### Preconditions appears under ## Decision, not ## Contracts
      const result = parseCardSections(card(
        "## Decision\n\n### Preconditions\nfoo\n\n## Other\nbar"
      ));
      expect(result.contracts.present).toBe(false);
      expect(result.contracts.subsections.preconditions).toBe(false);
    });
  });

  // ── Threshold Registry ────────────────────────────────────

  describe("Threshold Registry section", () => {
    it("parses a table with data rows", () => {
      const result = parseCardSections(card(
        "## Threshold Registry\n\n" +
        "| Name | Value | Unit | Valid Range | Rationale | Sensitivity |\n" +
        "|------|-------|------|-------------|-----------|-------------|\n" +
        "| maxRetries | 3 | count | 1-10 | Balances reliability | low |\n" +
        "| timeout | 5000 | ms | 1000-30000 | User experience | high |\n"
      ));
      expect(result.thresholdRegistry.present).toBe(true);
      expect(result.thresholdRegistry.rows).toHaveLength(2);
      expect(result.thresholdRegistry.rows[0]).toEqual({
        name: "maxRetries",
        value: "3",
        unit: "count",
        validRange: "1-10",
        rationale: "Balances reliability",
        sensitivity: "low",
      });
      expect(result.thresholdRegistry.rows[1]).toEqual({
        name: "timeout",
        value: "5000",
        unit: "ms",
        validRange: "1000-30000",
        rationale: "User experience",
        sensitivity: "high",
      });
    });

    it("returns empty rows for header-only table", () => {
      const result = parseCardSections(card(
        "## Threshold Registry\n\n" +
        "| Name | Value | Unit | Valid Range | Rationale | Sensitivity |\n" +
        "|------|-------|------|-------------|-----------|-------------|\n"
      ));
      expect(result.thresholdRegistry.present).toBe(true);
      expect(result.thresholdRegistry.rows).toEqual([]);
    });

    it("returns false when absent", () => {
      const result = parseCardSections(card("## Description\nfoo"));
      expect(result.thresholdRegistry.present).toBe(false);
      expect(result.thresholdRegistry.rows).toEqual([]);
    });
  });

  // ── Behavioral Spec ───────────────────────────────────────

  describe("Behavioral Spec section", () => {
    it("detects inline Given/When/Then in Acceptance Criteria", () => {
      const result = parseCardSections(card(
        "## Acceptance Criteria\n\n- Given a user, when they log in, then they see the dashboard"
      ));
      expect(result.behavioralSpec.inlineDetected).toBe(true);
    });

    it("is case-insensitive for Given/When/Then", () => {
      const result = parseCardSections(card(
        "## Acceptance Criteria\n\n- given a thing when it happens then it works"
      ));
      expect(result.behavioralSpec.inlineDetected).toBe(true);
    });

    it("does not detect Given/When/Then outside Acceptance Criteria", () => {
      const result = parseCardSections(card(
        "## Description\n\nGiven a user, when they log in, then they see the dashboard"
      ));
      expect(result.behavioralSpec.inlineDetected).toBe(false);
    });

    it("detects linked .feature files in File Manifest", () => {
      const result = parseCardSections(card(
        "## File Manifest\n\n- src/foo.feature\n- src/bar.ts\n- tests/login.feature"
      ));
      expect(result.behavioralSpec.linkedFeatureFiles).toEqual([
        "src/foo.feature",
        "tests/login.feature",
      ]);
    });

    it("returns empty array when no .feature files", () => {
      const result = parseCardSections(card(
        "## File Manifest\n\n- src/bar.ts"
      ));
      expect(result.behavioralSpec.linkedFeatureFiles).toEqual([]);
    });
  });

  // ── Cross-Cutting Note ────────────────────────────────────

  describe("Cross-Cutting Note", () => {
    it("detects ### Cross-Cutting Concerns in ## Description", () => {
      const result = parseCardSections(card(
        "## Description\n\nSome text\n\n### Cross-Cutting Concerns\n\nSome concerns"
      ));
      expect(result.crossCuttingNote.present).toBe(true);
    });

    it("returns false when ### Cross-Cutting Concerns is absent", () => {
      const result = parseCardSections(card("## Description\n\nSome text"));
      expect(result.crossCuttingNote.present).toBe(false);
    });

    it("does not match Cross-Cutting Concerns outside Description", () => {
      const result = parseCardSections(card(
        "## Decision\n\n### Cross-Cutting Concerns\nfoo\n\n## Description\nbar"
      ));
      expect(result.crossCuttingNote.present).toBe(false);
    });
  });

  // ── Empty / no sections ───────────────────────────────────

  describe("empty / no sections", () => {
    it("returns all false/empty for a card with no artifact sections", () => {
      const result = parseCardSections(card("## Description\n\nJust a description"));
      expect(result.decision.present).toBe(false);
      expect(result.contracts.present).toBe(false);
      expect(result.thresholdRegistry.present).toBe(false);
      expect(result.thresholdRegistry.rows).toEqual([]);
      expect(result.behavioralSpec.inlineDetected).toBe(false);
      expect(result.behavioralSpec.linkedFeatureFiles).toEqual([]);
      expect(result.crossCuttingNote.present).toBe(false);
    });

    it("handles empty string input without throwing", () => {
      const result = parseCardSections("");
      expect(result.decision.present).toBe(false);
      expect(result.contracts.present).toBe(false);
      expect(result.thresholdRegistry.present).toBe(false);
      expect(result.behavioralSpec.inlineDetected).toBe(false);
      expect(result.behavioralSpec.linkedFeatureFiles).toEqual([]);
      expect(result.crossCuttingNote.present).toBe(false);
    });

    it("handles content with no frontmatter", () => {
      const result = parseCardSections("# 1.1 Card [PLAN]\n\n## Decision\nfoo");
      expect(result.decision.present).toBe(true);
    });
  });

  // ── Depth metrics ─────────────────────────────────────────

  describe("depth metrics", () => {
    it("counts Description word count", () => {
      const result = parseCardSections(card(
        "## Description\n\nThis is a description with several words in it."
      ));
      expect(result.description.present).toBe(true);
      expect(result.description.wordCount).toBeGreaterThanOrEqual(8);
    });

    it("returns present=false and wordCount=0 when Description missing", () => {
      const result = parseCardSections(card("## Acceptance Criteria\n- foo"));
      expect(result.description.present).toBe(false);
      expect(result.description.wordCount).toBe(0);
    });

    it("counts Decision optionCount from ### Options Considered bullets", () => {
      const result = parseCardSections(card(
        "## Decision\n\n### Context\nfoo\n\n### Options Considered\n- Option A\n- Option B\n- Option C\n\n### Choice\nA"
      ));
      expect(result.decision.optionCount).toBe(3);
    });

    it("returns optionCount=0 when Options Considered has no bullets", () => {
      const result = parseCardSections(card(
        "## Decision\n\n### Options Considered\n\n### Choice\nA"
      ));
      expect(result.decision.optionCount).toBe(0);
    });

    it("returns optionCount=0 when Decision is absent", () => {
      const result = parseCardSections(card("## Description\nfoo"));
      expect(result.decision.optionCount).toBe(0);
    });

    it("counts Contracts subsection bullets", () => {
      const result = parseCardSections(card(
        "## Contracts\n\n### Preconditions\n- P1\n- P2\n\n### Postconditions\n- Q1\n\n### Invariants\n- I1\n- I2\n- I3"
      ));
      expect(result.contracts.subsectionBullets.preconditions).toBe(2);
      expect(result.contracts.subsectionBullets.postconditions).toBe(1);
      expect(result.contracts.subsectionBullets.invariants).toBe(3);
    });

    it("returns 0 bullets for missing Contracts subsections", () => {
      const result = parseCardSections(card("## Description\nfoo"));
      expect(result.contracts.subsectionBullets.preconditions).toBe(0);
      expect(result.contracts.subsectionBullets.postconditions).toBe(0);
      expect(result.contracts.subsectionBullets.invariants).toBe(0);
    });

    it("detects empty cells in Threshold Registry", () => {
      const result = parseCardSections(card(
        "## Threshold Registry\n\n" +
        "| Name | Value | Unit | Valid Range | Rationale | Sensitivity |\n" +
        "|------|-------|------|-------------|-----------|-------------|\n" +
        "| timeout | 5000 |  | 1000-30000 | UX | high |\n"
      ));
      expect(result.thresholdRegistry.hasEmptyCells).toBe(true);
    });

    it("returns hasEmptyCells=false when all cells filled", () => {
      const result = parseCardSections(card(
        "## Threshold Registry\n\n" +
        "| Name | Value | Unit | Valid Range | Rationale | Sensitivity |\n" +
        "|------|-------|------|-------------|-----------|-------------|\n" +
        "| timeout | 5000 | ms | 1000-30000 | UX | high |\n"
      ));
      expect(result.thresholdRegistry.hasEmptyCells).toBe(false);
    });

    it("returns hasEmptyCells=false when no rows", () => {
      const result = parseCardSections(card("## Description\nfoo"));
      expect(result.thresholdRegistry.hasEmptyCells).toBe(false);
    });
  });
});
