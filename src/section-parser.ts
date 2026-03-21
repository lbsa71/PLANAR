/** Result of parsing a card's artifact sections */
export interface SectionParseResult {
  description: {
    present: boolean;
    wordCount: number;
  };
  decision: {
    present: boolean;
    optionCount: number;
    subsections: {
      context: boolean;
      optionsConsidered: boolean;
      choice: boolean;
      rationale: boolean;
      consequences: boolean;
    };
  };
  contracts: {
    present: boolean;
    subsections: {
      preconditions: boolean;
      postconditions: boolean;
      invariants: boolean;
    };
    subsectionBullets: {
      preconditions: number;
      postconditions: number;
      invariants: number;
    };
  };
  thresholdRegistry: {
    present: boolean;
    rows: ThresholdRow[];
    hasEmptyCells: boolean;
  };
  behavioralSpec: {
    inlineDetected: boolean;
    linkedFeatureFiles: string[];
  };
  crossCuttingNote: {
    present: boolean;
  };
}

/** A single row from the Threshold Registry table */
export interface ThresholdRow {
  name: string;
  value: string;
  unit: string;
  validRange: string;
  rationale: string;
  sensitivity: string;
}

/** Main entry point — parses artifact sections from card markdown */
export function parseCardSections(rawContent: string): SectionParseResult {
  const body = stripFrontmatter(rawContent);
  const sections = splitSections(body);

  return {
    description: parseDescription(sections),
    decision: parseDecision(sections),
    contracts: parseContracts(sections),
    thresholdRegistry: parseThresholdRegistry(sections),
    behavioralSpec: parseBehavioralSpec(sections),
    crossCuttingNote: parseCrossCuttingNote(sections),
  };
}

// ── Internal helpers ────────────────────────────────────────

interface SectionMap {
  [heading: string]: string; // lowercased heading → content
}

/** Strip YAML frontmatter (between opening --- and closing ---) */
function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? raw.slice(match[0].length) : raw;
}

/**
 * Split markdown body into a map of { lowercased heading → content }.
 * Headings are identified by `## ` at the start of a line.
 * Content spans from the heading line to the next `## ` or EOF.
 */
function splitSections(body: string): SectionMap {
  const map: SectionMap = {};
  const pattern = /^## +(.+)$/gm;
  const headings: { name: string; start: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(body)) !== null) {
    headings.push({ name: m[1].trim().toLowerCase(), start: m.index + m[0].length });
  }

  for (let i = 0; i < headings.length; i++) {
    const end = i + 1 < headings.length
      ? body.lastIndexOf("\n##", headings[i + 1].start)
      : body.length;
    map[headings[i].name] = body.slice(headings[i].start, end);
  }

  return map;
}

/** Check if a subsection heading exists in section content (case-insensitive) */
function hasSubsection(content: string, name: string): boolean {
  const pattern = new RegExp(`^### +${escapeRegex(name)}\\s*$`, "im");
  return pattern.test(content);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count bullet lines (`- ` or `* ` prefixed, possibly indented) */
function countBullets(text: string): number {
  return text.split("\n").filter((l) => /^\s*[-*] /.test(l)).length;
}

/** Count words in text, excluding heading lines (### ...) */
function countWords(text: string): number {
  const lines = text.split("\n").filter((l) => !l.match(/^#{1,6}\s/));
  return lines.join(" ").split(/\s+/).filter((w) => w.length > 0).length;
}

/** Extract content of a ### subsection within a ## section's content */
function extractSubsectionContent(sectionContent: string, subsectionName: string): string | null {
  const pattern = new RegExp(
    `^### +${escapeRegex(subsectionName)}\\s*$`,
    "im",
  );
  const match = pattern.exec(sectionContent);
  if (!match) return null;

  const start = match.index + match[0].length;
  const nextSub = sectionContent.slice(start).search(/^### /m);
  const end = nextSub === -1 ? sectionContent.length : start + nextSub;
  return sectionContent.slice(start, end);
}

function parseDescription(sections: SectionMap): SectionParseResult["description"] {
  const content = sections["description"];
  if (content === undefined) {
    return { present: false, wordCount: 0 };
  }
  return { present: true, wordCount: countWords(content) };
}

function parseDecision(sections: SectionMap): SectionParseResult["decision"] {
  const content = sections["decision"];
  const present = content !== undefined;
  let optionCount = 0;
  if (present) {
    const optionsContent = extractSubsectionContent(content, "Options Considered");
    if (optionsContent) {
      optionCount = countBullets(optionsContent);
    }
  }
  return {
    present,
    optionCount,
    subsections: {
      context: present && hasSubsection(content, "Context"),
      optionsConsidered: present && hasSubsection(content, "Options Considered"),
      choice: present && hasSubsection(content, "Choice"),
      rationale: present && hasSubsection(content, "Rationale"),
      consequences: present && hasSubsection(content, "Consequences"),
    },
  };
}

function parseContracts(sections: SectionMap): SectionParseResult["contracts"] {
  const content = sections["contracts"];
  const present = content !== undefined;
  const subsectionBullets = { preconditions: 0, postconditions: 0, invariants: 0 };
  if (present) {
    for (const sub of ["Preconditions", "Postconditions", "Invariants"] as const) {
      const subContent = extractSubsectionContent(content, sub);
      if (subContent) {
        subsectionBullets[sub.toLowerCase() as keyof typeof subsectionBullets] = countBullets(subContent);
      }
    }
  }
  return {
    present,
    subsections: {
      preconditions: present && hasSubsection(content, "Preconditions"),
      postconditions: present && hasSubsection(content, "Postconditions"),
      invariants: present && hasSubsection(content, "Invariants"),
    },
    subsectionBullets,
  };
}

function parseThresholdRegistry(sections: SectionMap): SectionParseResult["thresholdRegistry"] {
  const content = sections["threshold registry"];
  if (content === undefined) {
    return { present: false, rows: [], hasEmptyCells: false };
  }

  const rows: ThresholdRow[] = [];
  const lines = content.split("\n");

  // Find table lines: lines starting with |
  const tableLines = lines.filter((l) => l.trim().startsWith("|"));

  // Skip header (index 0) and separator (index 1), parse data rows
  let hasEmptyCell = false;
  for (let i = 2; i < tableLines.length; i++) {
    // Split on | but keep empty cells — trim the leading/trailing empty strings from | borders
    const rawCells = tableLines[i].split("|").map((c) => c.trim());
    // Remove first and last entries (empty strings from leading/trailing |)
    const cells = rawCells.slice(1, -1);

    if (cells.length >= 6) {
      if (cells.slice(0, 6).some((c) => !c || /^[-—\s]*$/.test(c))) {
        hasEmptyCell = true;
      }
      rows.push({
        name: cells[0],
        value: cells[1],
        unit: cells[2],
        validRange: cells[3],
        rationale: cells[4],
        sensitivity: cells[5],
      });
    }
  }

  return { present: true, rows, hasEmptyCells: hasEmptyCell };
}

function parseBehavioralSpec(sections: SectionMap): SectionParseResult["behavioralSpec"] {
  // Inline: Given/When/Then in Acceptance Criteria section
  const acContent = sections["acceptance criteria"] ?? "";
  const gwt = /given\b.*\bwhen\b.*\bthen\b/i;
  const inlineDetected = gwt.test(acContent);

  // Linked: .feature files in File Manifest section
  const fmContent = sections["file manifest"] ?? "";
  const linkedFeatureFiles: string[] = [];
  for (const line of fmContent.split("\n")) {
    const match = line.match(/[-*]\s+(\S+\.feature)/);
    if (match) {
      linkedFeatureFiles.push(match[1]);
    }
  }

  return { inlineDetected, linkedFeatureFiles };
}

function parseCrossCuttingNote(sections: SectionMap): SectionParseResult["crossCuttingNote"] {
  const descContent = sections["description"] ?? "";
  return {
    present: hasSubsection(descContent, "Cross-Cutting Concerns"),
  };
}
