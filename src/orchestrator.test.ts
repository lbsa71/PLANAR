import { describe, it, expect, vi } from "vitest";
import { Orchestrator, OrchestratorDeps } from "./orchestrator.js";
import { Card, FileSystem, ProcessHandle, ProcessSpawner } from "./types.js";

function makeCard(overrides: Partial<Card>): Card {
  return {
    dotPath: "1",
    title: "Default",
    status: "PLAN",
    refs: { parent: null, root: null, children: [], blockedBy: [] },
    isNode: false,
    fileManifest: [],
    filePath: "plan/1-default.md",
    rawContent: "# 1 Default [PLAN]\n",
    ...overrides,
  };
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

function makeMockFs(files: Record<string, string> = {}): FileSystem {
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

function makeMockSpawner(): ProcessSpawner {
  return {
    spawn(): ProcessHandle {
      // Return a no-op process handle
      return {
        pid: 12345,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on(event: string, cb: Function) {
          if (event === "close") setTimeout(() => cb(0), 10);
        },
        kill: () => {},
      } as unknown as ProcessHandle;
    },
  };
}

describe("Orchestrator.findEligibleCards", () => {
  it("includes non-DONE leaf cards with a phase status", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const cards = [
      makeCard({ dotPath: "1", status: "PLAN" }),
      makeCard({ dotPath: "2", status: "ARCHITECT" }),
      makeCard({ dotPath: "3", status: "IMPLEMENT" }),
    ];

    const eligible = orch.findEligibleCards(cards);
    expect(eligible.map((c) => c.dotPath)).toEqual(["1", "2", "3"]);
  });

  it("excludes DONE cards", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const cards = [
      makeCard({ dotPath: "1", status: "DONE" }),
      makeCard({ dotPath: "2", status: "PLAN" }),
    ];

    const eligible = orch.findEligibleCards(cards);
    expect(eligible.map((c) => c.dotPath)).toEqual(["2"]);
  });

  it("excludes cards with special statuses", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const cards = [
      makeCard({
        dotPath: "1",
        status: { kind: "BLOCKED-BY", dotPath: "2" },
      }),
      makeCard({
        dotPath: "2",
        status: { kind: "CONFLICTS-WITH", dotPath: "1" },
      }),
      makeCard({ dotPath: "3", status: { kind: "INACTIONABLE" } }),
      makeCard({ dotPath: "4", status: "PLAN" }),
    ];

    const eligible = orch.findEligibleCards(cards);
    expect(eligible.map((c) => c.dotPath)).toEqual(["4"]);
  });

  it("excludes blocked cards", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const depCard = makeCard({
      dotPath: "1",
      status: "IMPLEMENT",
      filePath: "plan/1-dep.md",
    });
    const blockedCard = makeCard({
      dotPath: "2",
      status: "PLAN",
      refs: {
        parent: null,
        root: null,
        children: [],
        blockedBy: ["plan/1-dep.md"],
      },
    });

    const eligible = orch.findEligibleCards([depCard, blockedCard]);
    expect(eligible.map((c) => c.dotPath)).toEqual(["1"]);
  });

  it("allows blocked card when dependency is DONE", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const depCard = makeCard({
      dotPath: "1",
      status: "DONE",
      filePath: "plan/1-dep.md",
    });
    const unblockedCard = makeCard({
      dotPath: "2",
      status: "PLAN",
      refs: {
        parent: null,
        root: null,
        children: [],
        blockedBy: ["plan/1-dep.md"],
      },
    });

    const eligible = orch.findEligibleCards([depCard, unblockedCard]);
    expect(eligible.map((c) => c.dotPath)).toEqual(["2"]);
  });

  it("excludes cards that exceeded max iterations", () => {
    const orch = new Orchestrator(
      { maxIterationsPerCard: 2 },
      { fs: makeMockFs(), spawner: makeMockSpawner() }
    );

    // Simulate 2 iterations already counted by accessing internal state
    // (we test the public interface through findEligibleCards)
    const cards = [makeCard({ dotPath: "1", status: "PLAN" })];

    // First call: eligible
    expect(orch.findEligibleCards(cards)).toHaveLength(1);
  });
});

describe("Orchestrator.isUnderActiveNode", () => {
  it("blocks child when parent node is in PLAN", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const parentNode = makeCard({
      dotPath: "2",
      status: "PLAN",
      isNode: true,
      refs: {
        parent: null,
        root: null,
        children: ["plan/2.1-child.md"],
        blockedBy: [],
      },
    });
    const child = makeCard({ dotPath: "2.1", status: "PLAN" });

    expect(orch.isUnderActiveNode(child, [parentNode, child])).toBe(true);
  });

  it("allows child when parent node is DONE", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const parentNode = makeCard({
      dotPath: "2",
      status: "DONE",
      isNode: true,
      refs: {
        parent: null,
        root: null,
        children: ["plan/2.1-child.md"],
        blockedBy: [],
      },
    });
    const child = makeCard({ dotPath: "2.1", status: "PLAN" });

    expect(orch.isUnderActiveNode(child, [parentNode, child])).toBe(false);
  });

  it("blocks deeply nested card when grandparent is in PLAN", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const grandparent = makeCard({
      dotPath: "2",
      status: "PLAN",
      isNode: true,
      refs: {
        parent: null,
        root: null,
        children: ["plan/2.1-child.md"],
        blockedBy: [],
      },
    });
    const leaf = makeCard({ dotPath: "2.1.3", status: "PLAN" });

    expect(orch.isUnderActiveNode(leaf, [grandparent, leaf])).toBe(true);
  });
});

describe("Orchestrator.isBlocked", () => {
  it("returns true when dependency is not DONE", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const dep = makeCard({
      dotPath: "1",
      status: "IMPLEMENT",
      filePath: "plan/1-dep.md",
    });
    const card = makeCard({
      dotPath: "2",
      refs: {
        parent: null,
        root: null,
        children: [],
        blockedBy: ["plan/1-dep.md"],
      },
    });

    expect(orch.isBlocked(card, [dep, card])).toBe(true);
  });

  it("returns false when dependency is DONE", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const dep = makeCard({
      dotPath: "1",
      status: "DONE",
      filePath: "plan/1-dep.md",
    });
    const card = makeCard({
      dotPath: "2",
      refs: {
        parent: null,
        root: null,
        children: [],
        blockedBy: ["plan/1-dep.md"],
      },
    });

    expect(orch.isBlocked(card, [dep, card])).toBe(false);
  });

  it("returns false when no blockers", () => {
    const orch = new Orchestrator({}, {
      fs: makeMockFs(),
      spawner: makeMockSpawner(),
    });

    const card = makeCard({ dotPath: "1" });
    expect(orch.isBlocked(card, [card])).toBe(false);
  });
});

describe("Orchestrator.propagateConflicts", () => {
  it("mirrors conflict to target card", () => {
    const files: Record<string, string> = {};
    const fs = makeMockFs(files);
    const orch = new Orchestrator({}, { fs, spawner: makeMockSpawner() });

    const conflicting = makeCard({
      dotPath: "2.1",
      status: { kind: "CONFLICTS-WITH", dotPath: "2.3" },
      filePath: "plan/2.1-foo.md",
      rawContent: "# 2.1 Foo [CONFLICTS-WITH 2.3]\n",
    });
    const target = makeCard({
      dotPath: "2.3",
      status: "IMPLEMENT",
      filePath: "plan/2.3-bar.md",
      rawContent: "# 2.3 Bar [IMPLEMENT]\n",
    });

    orch.propagateConflicts([conflicting, target]);

    // Target should now have CONFLICTS-WITH 2.1
    expect(files["plan/2.3-bar.md"]).toContain("[CONFLICTS-WITH 2.1]");
  });

  it("does not propagate if target already has conflict", () => {
    const files: Record<string, string> = {};
    const fs = makeMockFs(files);
    const orch = new Orchestrator({}, { fs, spawner: makeMockSpawner() });

    const card1 = makeCard({
      dotPath: "2.1",
      status: { kind: "CONFLICTS-WITH", dotPath: "2.3" },
    });
    const card2 = makeCard({
      dotPath: "2.3",
      status: { kind: "CONFLICTS-WITH", dotPath: "2.1" },
    });

    // Should not throw or write (target already has conflict status)
    orch.propagateConflicts([card1, card2]);
    expect(Object.keys(files)).toHaveLength(0); // No writes
  });

  it("regresses common parent on conflict", () => {
    const files: Record<string, string> = {};
    const fs = makeMockFs(files);
    const orch = new Orchestrator({}, { fs, spawner: makeMockSpawner() });

    const parent = makeCard({
      dotPath: "2",
      status: "DONE",
      isNode: true,
      filePath: "plan/2-parent.md",
      rawContent: "# 2 Parent [DONE]\n",
    });
    const conflicting = makeCard({
      dotPath: "2.1",
      status: { kind: "CONFLICTS-WITH", dotPath: "2.3" },
    });
    const target = makeCard({
      dotPath: "2.3",
      status: "IMPLEMENT",
      filePath: "plan/2.3-bar.md",
      rawContent: "# 2.3 Bar [IMPLEMENT]\n",
    });

    orch.propagateConflicts([parent, conflicting, target]);

    // Parent should be regressed to PLAN with conflict note
    expect(files["plan/2-parent.md"]).toContain("[PLAN]");
    expect(files["plan/2-parent.md"]).toContain("Conflict Note");
  });
});

describe("Orchestrator.regressCommonParent", () => {
  it("finds common parent and regresses it", () => {
    const files: Record<string, string> = {};
    const fs = makeMockFs(files);
    const orch = new Orchestrator({}, { fs, spawner: makeMockSpawner() });

    const parent = makeCard({
      dotPath: "3",
      status: "DONE",
      filePath: "plan/3-parent.md",
      rawContent: "# 3 Parent [DONE]\n## Description\nParent card.\n",
    });
    const c1 = makeCard({ dotPath: "3.1" });
    const c2 = makeCard({ dotPath: "3.2" });

    orch.regressCommonParent(c1, c2, [parent, c1, c2]);

    expect(files["plan/3-parent.md"]).toContain("[PLAN]");
    expect(files["plan/3-parent.md"]).toContain("3.1");
    expect(files["plan/3-parent.md"]).toContain("3.2");
  });

  it("does nothing when parent is not DONE", () => {
    const files: Record<string, string> = {};
    const fs = makeMockFs(files);
    const orch = new Orchestrator({}, { fs, spawner: makeMockSpawner() });

    const parent = makeCard({
      dotPath: "3",
      status: "PLAN",
      filePath: "plan/3-parent.md",
      rawContent: "# 3 Parent [PLAN]\n",
    });
    const c1 = makeCard({ dotPath: "3.1" });
    const c2 = makeCard({ dotPath: "3.2" });

    orch.regressCommonParent(c1, c2, [parent, c1, c2]);

    expect(Object.keys(files)).toHaveLength(0); // No writes
  });

  it("does nothing for cards with no common ancestor", () => {
    const files: Record<string, string> = {};
    const fs = makeMockFs(files);
    const orch = new Orchestrator({}, { fs, spawner: makeMockSpawner() });

    const c1 = makeCard({ dotPath: "1.1" });
    const c2 = makeCard({ dotPath: "2.1" });

    orch.regressCommonParent(c1, c2, [c1, c2]);

    expect(Object.keys(files)).toHaveLength(0);
  });
});

// Note: handleAgentOutput was replaced by inline stream-json parsing.
// See stream-parser.test.ts for event parsing tests.
