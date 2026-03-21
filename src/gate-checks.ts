import { Card, LeafPhase } from "./types";
import { parseCardSections } from "./section-parser";

// ── Type Definitions ────────────────────────────────────────

/** A single gate-check violation */
export interface GateViolation {
  /** Machine-readable check identifier (e.g. "description-exists") */
  check: string;
  /** Human-readable explanation */
  message: string;
}

/** Result of running a gate check */
export interface GateResult {
  pass: boolean;
  violations: GateViolation[];
}

// ── Threshold Registry Constants ────────────────────────────

export const IFACE_KEYWORDS =
  /interface|API|type|contract|shape|schema/i;
export const CHOICE_KEYWORDS =
  /choice|pattern|library|framework|select|decide|approach/i;
export const THRESHOLD_KEYWORDS =
  /threshold|timeout|constant|default|capacity|limit|magic/i;
export const FLOW_KEYWORDS =
  /flow|algorithm|sequence|state|transition|step|escalat/i;
export const MIN_AC_BULLETS = 1;
export const MIN_DECISION_OPTIONS = 2;
export const MIN_SUBSECTION_BULLETS = 1;
export const MIN_DESCRIPTION_WORDS = 10;

// ── Internal Helpers ────────────────────────────────────────

/** Strip YAML frontmatter from raw card content */
function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? raw.slice(match[0].length) : raw;
}

/**
 * Extract the text of a `## <heading>` section from rawContent.
 * Returns null if the section heading is not found.
 */
function extractSection(rawContent: string, heading: string): string | null {
  const body = stripFrontmatter(rawContent);

  const pattern = new RegExp(
    `^## +${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "im",
  );
  const match = pattern.exec(body);
  if (!match) return null;

  const start = match.index + match[0].length;
  const nextSection = body.slice(start).search(/^## /m);
  const end = nextSection === -1 ? body.length : start + nextSection;
  return body.slice(start, end);
}

/** Count bullet lines (`- ` prefixed, possibly indented) in a block of text */
function countBullets(text: string): number {
  return text.split("\n").filter((l) => /^\s*- /.test(l)).length;
}

/** Build a GateResult from a list of violations */
function makeResult(violations: GateViolation[]): GateResult {
  return { pass: violations.length === 0, violations };
}

// ── Gate Functions ──────────────────────────────────────────

/** PLAN → ARCHITECT gate */
export function checkPlanToArchitect(card: Card): GateResult {
  const violations: GateViolation[] = [];

  const descSection = extractSection(card.rawContent, "Description");
  if (descSection === null) {
    violations.push({
      check: "description-exists",
      message: "## Description section is missing",
    });
  } else if (descSection.trim().length === 0) {
    violations.push({
      check: "description-non-empty",
      message: "## Description section is empty",
    });
  }

  const acSection = extractSection(card.rawContent, "Acceptance Criteria");
  if (acSection === null) {
    violations.push({
      check: "ac-exists",
      message: "## Acceptance Criteria section is missing",
    });
  } else if (countBullets(acSection) < MIN_AC_BULLETS) {
    violations.push({
      check: "ac-has-bullets",
      message: `## Acceptance Criteria must have at least ${MIN_AC_BULLETS} bullet(s)`,
    });
  }

  return makeResult(violations);
}

/** ARCHITECT → IMPLEMENT gate */
export function checkArchitectToImplement(card: Card): GateResult {
  const violations: GateViolation[] = [];

  // 1. File manifest non-empty
  if (card.fileManifest.length < 1) {
    violations.push({
      check: "file-manifest-non-empty",
      message: "## File Manifest must have at least 1 entry",
    });
  }

  // 2. Extract Description text
  const descText = extractSection(card.rawContent, "Description") ?? "";

  // 3. Parse sections for structure checks
  const sections = parseCardSections(card.rawContent);

  // 4. Interface/API/type keywords → Contracts required
  if (IFACE_KEYWORDS.test(descText)) {
    if (!sections.contracts.present) {
      violations.push({
        check: "contracts-required",
        message:
          "## Contracts section is required when Description mentions interface/API/type keywords",
      });
    } else {
      if (!sections.contracts.subsections.preconditions) {
        violations.push({
          check: "contracts-subsection-missing",
          message: "### Preconditions subsection is missing from ## Contracts",
        });
      }
      if (!sections.contracts.subsections.postconditions) {
        violations.push({
          check: "contracts-subsection-missing",
          message:
            "### Postconditions subsection is missing from ## Contracts",
        });
      }
      if (!sections.contracts.subsections.invariants) {
        violations.push({
          check: "contracts-subsection-missing",
          message: "### Invariants subsection is missing from ## Contracts",
        });
      }
    }
  }

  // 5. Choice/pattern/library keywords → Decision required
  if (CHOICE_KEYWORDS.test(descText)) {
    if (!sections.decision.present) {
      violations.push({
        check: "decision-required",
        message:
          "## Decision section is required when Description mentions choice/pattern/library keywords",
      });
    } else {
      if (!sections.decision.subsections.context) {
        violations.push({
          check: "decision-subsection-missing",
          message: "### Context subsection is missing from ## Decision",
        });
      }
      if (!sections.decision.subsections.optionsConsidered) {
        violations.push({
          check: "decision-subsection-missing",
          message:
            "### Options Considered subsection is missing from ## Decision",
        });
      }
      if (!sections.decision.subsections.choice) {
        violations.push({
          check: "decision-subsection-missing",
          message: "### Choice subsection is missing from ## Decision",
        });
      }
      if (!sections.decision.subsections.rationale) {
        violations.push({
          check: "decision-subsection-missing",
          message: "### Rationale subsection is missing from ## Decision",
        });
      }
      if (!sections.decision.subsections.consequences) {
        violations.push({
          check: "decision-subsection-missing",
          message: "### Consequences subsection is missing from ## Decision",
        });
      }
    }
  }

  // 6. Threshold/timeout/constant keywords → Threshold Registry required
  if (THRESHOLD_KEYWORDS.test(descText)) {
    if (!sections.thresholdRegistry.present) {
      violations.push({
        check: "threshold-registry-required",
        message:
          "## Threshold Registry section is required when Description mentions threshold/timeout/constant keywords",
      });
    }
  }

  // 7. Flow/algorithm/sequence keywords → Behavioral Spec required
  if (FLOW_KEYWORDS.test(descText)) {
    if (
      !sections.behavioralSpec.inlineDetected &&
      sections.behavioralSpec.linkedFeatureFiles.length === 0
    ) {
      violations.push({
        check: "behavioral-spec-required",
        message:
          "Behavioral spec (inline Given/When/Then or linked .feature) is required when Description mentions flow/algorithm/sequence keywords",
      });
    }
  }

  // ── Depth checks (catch hollow sections) ──────────────────

  // 8. Description depth
  if (sections.description.present && sections.description.wordCount < MIN_DESCRIPTION_WORDS) {
    violations.push({
      check: "description-depth",
      message: `## Description must have at least ${MIN_DESCRIPTION_WORDS} words (has ${sections.description.wordCount})`,
    });
  }

  // 9. Decision option count
  if (sections.decision.present && sections.decision.optionCount < MIN_DECISION_OPTIONS) {
    violations.push({
      check: "decision-option-count",
      message: `### Options Considered must list at least ${MIN_DECISION_OPTIONS} options (has ${sections.decision.optionCount})`,
    });
  }

  // 10. Contracts subsection depth
  if (sections.contracts.present) {
    for (const sub of ["preconditions", "postconditions", "invariants"] as const) {
      if (
        sections.contracts.subsections[sub] &&
        sections.contracts.subsectionBullets[sub] < MIN_SUBSECTION_BULLETS
      ) {
        violations.push({
          check: "contracts-subsection-depth",
          message: `### ${sub.charAt(0).toUpperCase() + sub.slice(1)} must have at least ${MIN_SUBSECTION_BULLETS} bullet(s) (has ${sections.contracts.subsectionBullets[sub]})`,
        });
      }
    }
  }

  // 11. Threshold Registry empty cells
  if (sections.thresholdRegistry.present && sections.thresholdRegistry.hasEmptyCells) {
    violations.push({
      check: "threshold-empty-cells",
      message: "## Threshold Registry has rows with empty cells — all columns must be filled",
    });
  }

  return makeResult(violations);
}

/** IMPLEMENT → REVIEW gate (requires filesystem access for file checks) */
export function checkImplementToReview(
  card: Card,
  existsSync: (path: string) => boolean,
): GateResult {
  const violations: GateViolation[] = [];

  for (const entry of card.fileManifest) {
    // Strip annotation suffixes like " (create)", " (dependency — ...)"
    const cleanPath = entry.replace(/\s*\(.*\)\s*$/, "").trim();
    if (!existsSync(cleanPath)) {
      violations.push({
        check: "file-exists",
        message: `File not found: ${cleanPath}`,
      });
    }
  }

  return makeResult(violations);
}

/**
 * Dispatcher: map a (from, to) phase transition to the appropriate gate function.
 * Returns { pass: true, violations: [] } if no gate is registered for the transition.
 */
export function runGateForTransition(
  from: LeafPhase,
  to: LeafPhase,
  card: Card,
  existsSync: (path: string) => boolean,
): GateResult {
  if (from === "PLAN" && to === "ARCHITECT") {
    return checkPlanToArchitect(card);
  }
  if (from === "ARCHITECT" && to === "IMPLEMENT") {
    return checkArchitectToImplement(card);
  }
  if (from === "IMPLEMENT" && to === "REVIEW") {
    return checkImplementToReview(card, existsSync);
  }
  if (from === "REVIEW" && to === "DONE") {
    return checkReviewToDone(card);
  }
  // No registered gate for this transition — pass through
  return { pass: true, violations: [] };
}

/** REVIEW → DONE gate */
export function checkReviewToDone(card: Card): GateResult {
  const violations: GateViolation[] = [];

  // 1. Check for open regression notes
  const regressionCallout = /^>\s*\[!NOTE\].*regression/im;
  const regressionHeading = /^## Regression/im;
  if (
    regressionCallout.test(card.rawContent) ||
    regressionHeading.test(card.rawContent)
  ) {
    violations.push({
      check: "no-open-regressions",
      message: "Card has open regression notes",
    });
  }

  // 2. AC bullets presence check
  const acSection = extractSection(card.rawContent, "Acceptance Criteria");
  if (!acSection || countBullets(acSection) === 0) {
    violations.push({
      check: "ac-bullets-present",
      message: "## Acceptance Criteria must have at least 1 bullet",
    });
  }

  return makeResult(violations);
}
