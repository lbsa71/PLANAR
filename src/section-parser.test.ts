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
});
