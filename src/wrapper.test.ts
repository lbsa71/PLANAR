import { describe, it, expect, vi } from "vitest";
import { runCardLoop, parseClaudeOutput, WrapperDeps } from "./wrapper.js";
import { ClaudeInvoker, FileSystem } from "./types.js";

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
