import { describe, it, expect, vi } from "vitest";
import { runCardLoop, parseClaudeOutput, WrapperDeps } from "./wrapper.js";
import { ClaudeInvoker, FileSystem, GateMode } from "./types.js";
import { generateSystemPrompt } from "./system-prompt.js";
import { parseCard } from "./card.js";
import { runGateForTransition } from "./gate-checks.js";

/** Normalize path separators to forward slashes for cross-platform testing */
function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Build an in-memory FileSystem for testing */
function mockFs(files: Record<string, string>): FileSystem {
  return {
    readFileSync(path: string) {
      const key = norm(path);
      if (!(key in files)) throw new Error(`ENOENT: ${path}`);
      return files[key];
    },
    writeFileSync(path: string, content: string) {
      files[norm(path)] = content;
    },
    existsSync(path: string) {
      const key = norm(path);
      return Object.keys(files).some(
        (k) => k === key || k.startsWith(key + "/")
      );
    },
    readdirSync(path: string) {
      const prefix = norm(path).replace(/\/$/, "") + "/";
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((k) => !k.includes("/"));
    },
  };
}

function mockClaude(responses: (string | null)[]): ClaudeInvoker {
  let callIndex = 0;
  return {
    invoke() {
      if (callIndex >= responses.length) return null;
      return responses[callIndex++];
    },
  };
}

function makeDeps(
  files: Record<string, string>,
  claudeResponses: (string | null)[] = [null]
): { deps: WrapperDeps; files: Record<string, string> } {
  const deps: WrapperDeps = {
    fs: mockFs(files),
    claude: mockClaude(claudeResponses),
  };
  return { deps, files };
}

const CARD_PLAN = `---
root: plan/root.md
---
# 2.1 Plan Parser [PLAN]

## Description
Parse plan files.
`;

const CARD_DONE = `---
root: plan/root.md
---
# 2.1 Plan Parser [DONE]

## Description
Parse plan files.
`;

const CARD_BLOCKED = `---
root: plan/root.md
---
# 2.1 Plan Parser [BLOCKED-BY 1.2]

## Description
Parse plan files.
`;

const ROOT_CARD = `---
root: plan/root.md
---
# 0 Root [PLAN]

## Description
Root plan.
`;

const CARD_WITH_PARENT = `---
parent: plan/2-core.md
root: plan/root.md
---
# 2.1 Plan Parser [PLAN]

## Description
Parse plan files.
`;

const PARENT_CARD = `---
root: plan/root.md
children:
  - plan/2.1-parser.md
---
# 2 Core [PLAN]

## Description
Core engine.
`;

describe("runCardLoop", () => {
  it("exits immediately when card is DONE", async () => {
    const { deps } = makeDeps({
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_DONE,
    });

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
    }, deps);

    expect(results).toHaveLength(0);
  });

  it("exits when card has special status (BLOCKED-BY)", async () => {
    const { deps } = makeDeps({
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_BLOCKED,
    });

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
    }, deps);

    expect(results).toHaveLength(0);
  });

  it("detects convergence when card is unchanged after invocation", async () => {
    const { deps } = makeDeps(
      {
        "plan/root.md": ROOT_CARD,
        "plan/2-core.md": PARENT_CARD,
        "plan/2.1-parser.md": CARD_PLAN,
      },
      [null] // claude returns nothing, card stays the same
    );

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 5,
      gateMode: "advisory",
    }, deps);

    expect(results).toHaveLength(1);
    expect(results[0].changed).toBe(false);
  });

  it("detects change when claude modifies the card file", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_PLAN,
    };

    let callCount = 0;
    const claude: ClaudeInvoker = {
      invoke() {
        callCount++;
        if (callCount === 1) {
          // Simulate claude advancing the card
          files["plan/2.1-parser.md"] = CARD_PLAN.replace("[PLAN]", "[ARCHITECT]");
          return JSON.stringify({ result: "Advanced to ARCHITECT" });
        }
        // Second call: simulate DONE
        files["plan/2.1-parser.md"] = CARD_DONE;
        return null;
      },
    };

    const deps: WrapperDeps = { fs: mockFs(files), claude };

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 5,
      gateMode: "advisory",
    }, deps);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].changed).toBe(true);
  });

  it("respects maxIterations", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_PLAN,
    };

    let callCount = 0;
    const claude: ClaudeInvoker = {
      invoke() {
        callCount++;
        // Always change the card slightly so loop continues
        files["plan/2.1-parser.md"] = CARD_PLAN + `\n<!-- iteration ${callCount} -->\n`;
        return null;
      },
    };

    const deps: WrapperDeps = { fs: mockFs(files), claude };

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 3,
      gateMode: "advisory",
    }, deps);

    expect(results).toHaveLength(3);
    expect(callCount).toBe(3);
  });

  it("exits on budget exhaustion", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_PLAN,
    };

    let callCount = 0;
    const claude: ClaudeInvoker = {
      invoke() {
        callCount++;
        files["plan/2.1-parser.md"] = CARD_PLAN + `\n<!-- ${callCount} -->\n`;
        return JSON.stringify({ cost_usd: 0.50 });
      },
    };

    const deps: WrapperDeps = { fs: mockFs(files), claude };

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 100,
      maxCostDollars: 1.0,
      gateMode: "advisory",
    }, deps);

    // Should stop after 2 iterations ($0.50 * 2 = $1.00)
    expect(results).toHaveLength(2);
  });

  it("exits when all cards are DONE", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD.replace("[PLAN]", "[DONE]"),
      "plan/2.1-parser.md": CARD_DONE,
    };

    const deps: WrapperDeps = { fs: mockFs(files), claude: mockClaude([]) };

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
    }, deps);

    expect(results).toHaveLength(0);
  });

  it("aborts on reference integrity errors", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      // Note: plan/2-core.md is missing — broken parent link
      "plan/2.1-parser.md": CARD_WITH_PARENT,
    };

    const deps: WrapperDeps = { fs: mockFs(files), claude: mockClaude([null]) };

    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
    }, deps);

    expect(results).toHaveLength(0); // Aborted before invocation
  });
});

describe("parseClaudeOutput", () => {
  it("returns empty for null output", () => {
    expect(parseClaudeOutput(null)).toEqual({ rateLimited: false });
  });

  it("returns empty for empty string", () => {
    expect(parseClaudeOutput("")).toEqual({ rateLimited: false });
  });

  it("parses cost_usd from JSON", () => {
    const result = parseClaudeOutput(JSON.stringify({ cost_usd: 0.0123 }));
    expect(result.rateLimited).toBe(false);
    expect(result.costUsd).toBeCloseTo(0.0123);
  });

  it("detects rate_limit_error", () => {
    const result = parseClaudeOutput(
      JSON.stringify({
        error: { type: "rate_limit_error", retry_after: 30 },
      })
    );
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSecs).toBe(30);
  });

  it("detects overloaded_error", () => {
    const result = parseClaudeOutput(
      JSON.stringify({
        error: { type: "overloaded_error", retry_after: 15 },
      })
    );
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSecs).toBe(15);
  });

  it("detects rate_limit_event output and preserves resetsAt", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const result = parseClaudeOutput(
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", resetsAt: 102 },
      })
    );
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSecs).toBe(2);
    expect(result.resetsAt).toBe(102);
    nowSpy.mockRestore();
  });

  it("defaults retry_after for rate_limit_error", () => {
    const result = parseClaudeOutput(
      JSON.stringify({ error: { type: "rate_limit_error" } })
    );
    expect(result.retryAfterSecs).toBe(60);
  });

  it("defaults retry_after for overloaded_error", () => {
    const result = parseClaudeOutput(
      JSON.stringify({ error: { type: "overloaded_error" } })
    );
    expect(result.retryAfterSecs).toBe(30);
  });

  it("parses result text from JSON", () => {
    const result = parseClaudeOutput(
      JSON.stringify({ result: "Advanced to ARCHITECT" })
    );
    expect(result.result).toBe("Advanced to ARCHITECT");
  });

  it("handles non-JSON output gracefully", () => {
    const result = parseClaudeOutput("Some plain text output");
    expect(result.rateLimited).toBe(false);
  });
});

// ── Gate enforcement tests ──────────────────────────────────

const CARD_PLAN_FULL = `---
root: plan/root.md
---
# 2.1 Plan Parser [PLAN]

## Description
Parse plan files.

## Acceptance Criteria
- Parses YAML frontmatter correctly
`;

const CARD_ARCHITECT_FULL = `---
root: plan/root.md
---
# 2.1 Plan Parser [ARCHITECT]

## Description
Parse plan files.

## Acceptance Criteria
- Parses YAML frontmatter correctly
`;

const CARD_PLAN_NO_DESC = `---
root: plan/root.md
---
# 2.1 Plan Parser [PLAN]

## Acceptance Criteria
- Something
`;

const CARD_ARCHITECT_NO_DESC = `---
root: plan/root.md
---
# 2.1 Plan Parser [ARCHITECT]

## Acceptance Criteria
- Something
`;

describe("runGateForTransition", () => {
  it("returns pass for unknown transitions (Scenario 5)", () => {
    const card = parseCard("plan/2.1-parser.md", CARD_PLAN_FULL);
    const result = runGateForTransition("PLAN", "DONE", card, () => true);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("passes PLAN→ARCHITECT with valid Description and AC (Scenario 1)", () => {
    const card = parseCard("plan/2.1-parser.md", CARD_ARCHITECT_FULL);
    const result = runGateForTransition("PLAN", "ARCHITECT", card, () => true);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails PLAN→ARCHITECT without Description (Scenario 2)", () => {
    const card = parseCard("plan/2.1-parser.md", CARD_ARCHITECT_NO_DESC);
    const result = runGateForTransition("PLAN", "ARCHITECT", card, () => true);
    expect(result.pass).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v) => v.check === "description-exists")).toBe(true);
  });
});

describe("gate enforcement in wrapper", () => {
  it("advisory mode — gate passes, no warnings (Scenario 1)", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_PLAN_FULL,
    };

    let callCount = 0;
    const claude: ClaudeInvoker = {
      invoke() {
        callCount++;
        if (callCount === 1) {
          // Simulate advancing to ARCHITECT (with Description & AC present)
          files["plan/2.1-parser.md"] = CARD_ARCHITECT_FULL;
          return JSON.stringify({ result: "ok" });
        }
        // Second iteration: card is ARCHITECT, make it DONE to stop
        files["plan/2.1-parser.md"] = CARD_DONE;
        return null;
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const deps: WrapperDeps = { fs: mockFs(files), claude };
    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 5,
      gateMode: "advisory",
    }, deps);

    // Gate passed — no gate-related warnings
    const gateWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Gate advisory")
    );
    expect(gateWarns).toHaveLength(0);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("advisory mode — gate fails, transition kept, warnings logged (Scenario 2)", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_PLAN_NO_DESC,
    };

    let callCount = 0;
    const claude: ClaudeInvoker = {
      invoke() {
        callCount++;
        if (callCount === 1) {
          // Simulate advancing to ARCHITECT (but no Description)
          files["plan/2.1-parser.md"] = CARD_ARCHITECT_NO_DESC;
          return JSON.stringify({ result: "ok" });
        }
        // Stop the loop
        files["plan/2.1-parser.md"] = CARD_DONE;
        return null;
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const deps: WrapperDeps = { fs: mockFs(files), claude };
    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 5,
      gateMode: "advisory",
    }, deps);

    // Transition was kept (not reverted)
    expect(results[0].changed).toBe(true);
    expect(results[0].afterContent).toBe(CARD_ARCHITECT_NO_DESC);

    // Warnings were logged
    const gateWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Gate advisory")
    );
    expect(gateWarns.length).toBeGreaterThan(0);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("blocking mode — gate fails, transition reverted (Scenario 3)", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_PLAN_NO_DESC,
    };

    let callCount = 0;
    const claude: ClaudeInvoker = {
      invoke() {
        callCount++;
        if (callCount === 1) {
          // Simulate advancing to ARCHITECT (but no Description)
          files["plan/2.1-parser.md"] = CARD_ARCHITECT_NO_DESC;
          return JSON.stringify({ result: "ok" });
        }
        // Second call: no change (convergence)
        return null;
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const deps: WrapperDeps = { fs: mockFs(files), claude };
    const results = await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 5,
      gateMode: "blocking",
    }, deps);

    // Errors were logged (blocking mode)
    const gateErrors = errorSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Gate BLOCKED")
    );
    expect(gateErrors.length).toBeGreaterThan(0);

    // Card file should have been reverted to original content
    expect(files["plan/2.1-parser.md"]).toBe(CARD_PLAN_NO_DESC);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("no transition — no gate check runs (Scenario 4)", async () => {
    const files: Record<string, string> = {
      "plan/root.md": ROOT_CARD,
      "plan/2-core.md": PARENT_CARD,
      "plan/2.1-parser.md": CARD_PLAN_NO_DESC,
    };

    let callCount = 0;
    const claude: ClaudeInvoker = {
      invoke() {
        callCount++;
        // Modify card but don't change status
        files["plan/2.1-parser.md"] = CARD_PLAN_NO_DESC + "\n<!-- touched -->\n";
        return null;
      },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const deps: WrapperDeps = { fs: mockFs(files), claude };
    await runCardLoop("plan/2.1-parser.md", {
      planDir: "plan",
      rootPlanFile: "plan/root.md",
      maxIterations: 2,
      gateMode: "blocking",
    }, deps);

    // No gate-related warnings or errors
    const gateMessages = [
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ].filter(
      (args) => typeof args[0] === "string" && args[0].includes("Gate")
    );
    expect(gateMessages).toHaveLength(0);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe("generateSystemPrompt gate context (Scenario 6)", () => {
  it("includes gate violation section when gateContext is provided", () => {
    const card = parseCard("plan/2.1-parser.md", CARD_PLAN_FULL);
    const prompt = generateSystemPrompt(card, "plan/root.md", "- [description-exists] ## Description section is missing");
    expect(prompt).toContain("## Gate Violations from Previous Iteration");
    expect(prompt).toContain("description-exists");
  });

  it("does not include gate violation section when gateContext is undefined", () => {
    const card = parseCard("plan/2.1-parser.md", CARD_PLAN_FULL);
    const prompt = generateSystemPrompt(card, "plan/root.md");
    expect(prompt).not.toContain("Gate Violations");
  });
});
