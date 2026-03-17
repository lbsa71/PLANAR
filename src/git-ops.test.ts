import { describe, it, expect } from "vitest";
import { fetchDetectPull } from "./git-ops.js";
import type { GitRunner } from "./types.js";

/** Helper: create a mock GitRunner from a map of command patterns to responses */
function mockGit(responses: [string, string | Error][]): {
  runner: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: GitRunner = {
    async run(args: string[]): Promise<string> {
      calls.push(args);
      const key = args.join(" ");
      for (const [pattern, response] of responses) {
        if (key.includes(pattern)) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
      return "";
    },
  };
  return { runner, calls };
}

describe("fetchDetectPull", () => {
  it("returns up-to-date when HEAD matches remote", async () => {
    const sha = "abc123";
    const { runner, calls } = mockGit([
      ["rev-parse --abbrev-ref HEAD", "main"],
      ["fetch origin", ""],
      ["rev-parse HEAD", sha],
      ["rev-parse origin/main", sha],
    ]);

    const result = await fetchDetectPull(runner);

    expect(result).toEqual({ status: "up-to-date" });
    expect(calls[0]).toEqual(["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(calls[1]).toEqual(["fetch", "origin"]);
  });

  it("returns pulled with diff and changed files on fast-forward", async () => {
    const { runner } = mockGit([
      ["rev-parse --abbrev-ref HEAD", "main"],
      ["fetch origin", ""],
      ["rev-parse HEAD", "aaa111"],
      ["rev-parse origin/main", "bbb222"],
      ["merge-base --is-ancestor", ""],
      ["--name-only", "src/foo.ts\nsrc/bar.ts"],
      ["diff HEAD", "diff --git a/foo.ts\n+added line"],
      ["pull --ff-only", ""],
    ]);

    const result = await fetchDetectPull(runner);

    expect(result).toEqual({
      status: "pulled",
      diff: "diff --git a/foo.ts\n+added line",
      changedFiles: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("returns diverged when merge-base fails (not ancestor)", async () => {
    const { runner } = mockGit([
      ["rev-parse --abbrev-ref HEAD", "main"],
      ["fetch origin", ""],
      ["rev-parse HEAD", "aaa111"],
      ["rev-parse origin/main", "bbb222"],
      [
        "merge-base --is-ancestor",
        new Error("not ancestor"),
      ],
    ]);

    const result = await fetchDetectPull(runner);

    expect(result.status).toBe("diverged");
    if (result.status === "diverged") {
      expect(result.warning).toContain("diverged");
    }
  });

  it("returns diverged when pull --ff-only fails", async () => {
    const { runner } = mockGit([
      ["rev-parse --abbrev-ref HEAD", "main"],
      ["fetch origin", ""],
      ["rev-parse HEAD", "aaa111"],
      ["rev-parse origin/main", "bbb222"],
      ["merge-base --is-ancestor", ""],
      ["--name-only", "file.ts"],
      ["diff HEAD", "some diff"],
      ["pull --ff-only", new Error("fatal: Not possible to fast-forward")],
    ]);

    const result = await fetchDetectPull(runner);

    expect(result.status).toBe("diverged");
    if (result.status === "diverged") {
      expect(result.warning).toBeTruthy();
    }
  });

  it("uses explicit branch when provided", async () => {
    const sha = "same123";
    const { runner, calls } = mockGit([
      ["fetch origin", ""],
      ["rev-parse HEAD", sha],
      ["rev-parse origin/feature-x", sha],
    ]);

    const result = await fetchDetectPull(runner, "feature-x");

    expect(result).toEqual({ status: "up-to-date" });
    // Should NOT call rev-parse --abbrev-ref HEAD when branch is explicit
    expect(calls[0]).toEqual(["fetch", "origin"]);
  });

  it("detects branch automatically via rev-parse --abbrev-ref HEAD", async () => {
    const { runner, calls } = mockGit([
      ["rev-parse --abbrev-ref HEAD", "feature-x"],
      ["fetch origin", ""],
      ["rev-parse HEAD", "same"],
      ["rev-parse origin/feature-x", "same"],
    ]);

    const result = await fetchDetectPull(runner);

    expect(result).toEqual({ status: "up-to-date" });
    expect(calls[0]).toEqual(["rev-parse", "--abbrev-ref", "HEAD"]);
  });
});
