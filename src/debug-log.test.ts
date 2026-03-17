import { describe, it, expect } from "vitest";
import { debugLog, debugLogProcessError, DebugLogDeps } from "./debug-log.js";

function mockLogDeps(): { deps: DebugLogDeps; getContent: () => string } {
  const state = { content: "" };
  const deps: DebugLogDeps = {
    appendFileSync(_path: string, data: string) {
      state.content += data;
    },
    readFileSync() {
      return state.content;
    },
    writeFileSync(_path: string, data: string) {
      state.content = data;
    },
    existsSync() {
      return true;
    },
  };
  return { deps, getContent: () => state.content };
}

describe("debugLog", () => {
  it("appends timestamped entries", () => {
    const { deps, getContent } = mockLogDeps();
    debugLog("test message", "debug.log", deps);
    expect(getContent()).toContain("test message");
    expect(getContent()).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
  });

  it("caps at 200 lines", () => {
    const { deps } = mockLogDeps();
    for (let i = 0; i < 250; i++) {
      debugLog(`line ${i}`, "debug.log", deps);
    }
    const finalContent = deps.readFileSync("debug.log");
    const lines = finalContent.split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(200);
    // Should keep the most recent lines
    expect(finalContent).toContain("line 249");
    expect(finalContent).not.toContain("line 0\n");
  });
});

describe("debugLogProcessError", () => {
  it("logs full error context", () => {
    const { deps, getContent } = mockLogDeps();
    debugLogProcessError(
      {
        dotPath: "2.1",
        command: "claude",
        args: ["--print", "--session-id", "abc"],
        error: new Error("spawn ENOENT"),
        stdout: "some output",
        stderr: "some error",
        exitCode: 1,
      },
      "debug.log",
      deps
    );
    expect(getContent()).toContain("Process Error for 2.1");
    expect(getContent()).toContain("Command: claude");
    expect(getContent()).toContain("Exit code: 1");
    expect(getContent()).toContain("spawn ENOENT");
    expect(getContent()).toContain("some output");
    expect(getContent()).toContain("some error");
  });

  it("handles ENOENT with code and path", () => {
    const { deps, getContent } = mockLogDeps();
    const err = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    err.path = "claude";
    debugLogProcessError(
      {
        dotPath: "5",
        command: "claude",
        args: ["--print"],
        error: err,
      },
      "debug.log",
      deps
    );
    expect(getContent()).toContain("Error code: ENOENT");
    expect(getContent()).toContain("Error path: claude");
  });

  it("handles non-Error objects", () => {
    const { deps, getContent } = mockLogDeps();
    debugLogProcessError(
      {
        dotPath: "1",
        command: "claude",
        args: [],
        error: "string error",
      },
      "debug.log",
      deps
    );
    expect(getContent()).toContain("string error");
  });
});
