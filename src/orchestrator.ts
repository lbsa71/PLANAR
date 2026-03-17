import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import {
  parseCard,
  discoverCards,
  isPhase,
  updateCardStatus,
  formatStatus,
  checkReferenceIntegrity,
} from "./card.js";
import { dotPathToGuid } from "./guid.js";
import { generateSystemPrompt } from "./system-prompt.js";
import {
  AgentSlot,
  Card,
  FileSystem,
  OrchestratorConfig,
  ProcessHandle,
  ProcessSpawner,
} from "./types.js";

/** Default FileSystem */
const nodeFs: FileSystem = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, c) => fs.writeFileSync(p, c),
  existsSync: (p) => fs.existsSync(p),
  readdirSync: (p) => fs.readdirSync(p) as string[],
};

/** Default ProcessSpawner */
const nodeSpawner: ProcessSpawner = {
  spawn(command: string, args: string[], options: object): ProcessHandle {
    return spawn(command, args, options as Parameters<typeof spawn>[2]) as unknown as ProcessHandle;
  },
};

export interface OrchestratorDeps {
  fs: FileSystem;
  spawner: ProcessSpawner;
}

const defaultDeps: OrchestratorDeps = { fs: nodeFs, spawner: nodeSpawner };

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxParallelAgents: 8,
  maxIterationsPerCard: 50,
  rootPlanFile: "plan/root.md",
  planDir: "plan",
};

/**
 * The Orchestrator manages parallel agents, each working on its own card.
 */
export class Orchestrator {
  private config: OrchestratorConfig;
  private deps: OrchestratorDeps;
  private activeAgents: Map<string, AgentSlot> = new Map();
  private processes: Map<string, ProcessHandle> = new Map();
  private completionPromises: Map<string, Promise<string>> = new Map();
  private iterationCounts: Map<string, number> = new Map();

  constructor(
    config: Partial<OrchestratorConfig> = {},
    deps: OrchestratorDeps = defaultDeps
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
  }

  async run(): Promise<void> {
    console.log(
      `[orchestrator] Starting with root: ${this.config.rootPlanFile}`
    );
    console.log(
      `[orchestrator] Max parallel agents: ${this.config.maxParallelAgents}`
    );

    let staleCycles = 0;
    const maxStaleCycles = 3;

    while (true) {
      const cards = discoverCards(this.config.planDir, this.deps.fs);

      if (cards.length > 0 && cards.every((c) => c.status === "DONE")) {
        console.log("[orchestrator] All cards are DONE. Exiting.");
        break;
      }

      this.propagateConflicts(cards);
      this.checkAllReferences(cards);

      const eligible = this.findEligibleCards(cards);

      if (eligible.length === 0 && this.activeAgents.size === 0) {
        staleCycles++;
        console.log(
          `[orchestrator] No eligible cards and no active agents. Stale cycle ${staleCycles}/${maxStaleCycles}.`
        );
        if (staleCycles >= maxStaleCycles) {
          console.log("[orchestrator] Max stale cycles reached. Exiting.");
          break;
        }
        await sleep(2000);
        continue;
      }

      staleCycles = 0;

      const slotsAvailable =
        this.config.maxParallelAgents - this.activeAgents.size;
      const toSpawn = eligible.slice(0, slotsAvailable);

      for (const card of toSpawn) {
        this.spawnAgent(card);
      }

      if (this.completionPromises.size > 0) {
        const finished = await Promise.race(this.completionPromises.values());
        this.reapAgent(finished);
      }

      await sleep(500);
    }

    this.cleanup();
  }

  /**
   * Find cards eligible for agent spawning.
   */
  findEligibleCards(cards: Card[]): Card[] {
    const eligible: Card[] = [];

    for (const card of cards) {
      if (card.status === "DONE") continue;
      if (!isPhase(card.status)) continue;
      if (this.activeAgents.has(card.dotPath)) continue;

      const count = this.iterationCounts.get(card.dotPath) ?? 0;
      if (count >= this.config.maxIterationsPerCard) continue;

      if (this.isUnderActiveNode(card, cards)) continue;
      if (this.isBlocked(card, cards)) continue;

      eligible.push(card);
    }

    return eligible;
  }

  /**
   * Check if a card is under a node that still has an active agent
   * or is still being decomposed (PLAN phase).
   */
  isUnderActiveNode(card: Card, allCards: Card[]): boolean {
    const parts = card.dotPath.split(".");
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join(".");
      if (this.activeAgents.has(ancestorPath)) return true;

      const ancestor = allCards.find((c) => c.dotPath === ancestorPath);
      if (ancestor && ancestor.isNode && ancestor.status === "PLAN")
        return true;
    }
    return false;
  }

  /**
   * Check if a card is blocked by dependencies.
   */
  isBlocked(card: Card, allCards: Card[]): boolean {
    for (const dep of card.refs.blockedBy) {
      const depCard = allCards.find((c) => c.filePath.endsWith(dep));
      if (depCard && depCard.status !== "DONE") return true;
    }
    return false;
  }

  /**
   * Spawn a Claude Code agent for a card.
   */
  private spawnAgent(card: Card): void {
    const sessionId = dotPathToGuid(card.dotPath);
    const systemPrompt = generateSystemPrompt(card, this.config.rootPlanFile);

    const prompt = `@${card.filePath} @${this.config.rootPlanFile}\n\nDo the next thing for this card. Perform exactly one operation, update the card file, and exit.`;

    console.log(
      `[orchestrator] Spawning agent for ${card.dotPath} [${isPhase(card.status) ? card.status : formatStatus(card.status)}]`
    );

    const proc = this.deps.spawner.spawn(
      "claude",
      [
        "--dangerously-skip-permissions",
        "--print",
        "--output-format",
        "json",
        "--session-id",
        sessionId,
        "--system-prompt",
        systemPrompt,
        "--",
        prompt,
      ],
      { stdio: "pipe" }
    );

    const slot: AgentSlot = {
      dotPath: card.dotPath,
      sessionId,
      cardFile: card.filePath,
      pid: proc.pid,
      startedAt: new Date(),
    };

    this.activeAgents.set(card.dotPath, slot);
    this.processes.set(card.dotPath, proc);

    const count = this.iterationCounts.get(card.dotPath) ?? 0;
    this.iterationCounts.set(card.dotPath, count + 1);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const completionPromise = new Promise<string>((resolve) => {
      proc.on("close", (code) => {
        if (stderr) {
          process.stderr.write(`[${card.dotPath}] ${stderr}`);
        }
        this.handleAgentOutput(card.dotPath, stdout, code);
        resolve(card.dotPath);
      });
      proc.on("error", (err) => {
        console.error(`[${card.dotPath}] Process error:`, err.message);
        resolve(card.dotPath);
      });
    });

    this.completionPromises.set(card.dotPath, completionPromise);
  }

  /**
   * Handle agent output, parsing JSON and detecting 429 rate limits.
   */
  handleAgentOutput(
    dotPath: string,
    output: string,
    exitCode: number | null
  ): void {
    if (!output.trim()) {
      console.log(
        `[${dotPath}] Agent exited with code ${exitCode} (no output)`
      );
      return;
    }

    try {
      const json = JSON.parse(output);

      if (json.error && json.error.type === "rate_limit_error") {
        const retryAfter = json.error.retry_after ?? 60;
        console.warn(
          `[${dotPath}] Rate limited (429). Retry after ${retryAfter}s. Will retry on next cycle.`
        );
        const count = this.iterationCounts.get(dotPath) ?? 1;
        this.iterationCounts.set(dotPath, Math.max(0, count - 1));
        return;
      }

      if (json.cost_usd !== undefined) {
        console.log(`[${dotPath}] Cost: $${json.cost_usd.toFixed(4)}`);
      }

      if (json.result) {
        console.log(`[${dotPath}] ${String(json.result).slice(0, 200)}`);
      }
    } catch {
      console.log(`[${dotPath}] ${output.slice(0, 200)}`);
    }
  }

  private reapAgent(dotPath: string): void {
    console.log(`[orchestrator] Reaping agent for ${dotPath}`);
    this.activeAgents.delete(dotPath);
    this.processes.delete(dotPath);
    this.completionPromises.delete(dotPath);
  }

  /**
   * Propagate CONFLICTS-WITH markers between cards.
   */
  propagateConflicts(cards: Card[]): void {
    for (const card of cards) {
      if (
        typeof card.status !== "string" &&
        card.status.kind === "CONFLICTS-WITH"
      ) {
        const targetDotPath = card.status.dotPath;
        const target = cards.find((c) => c.dotPath === targetDotPath);

        if (target && isPhase(target.status)) {
          console.log(
            `[orchestrator] Propagating conflict: ${card.dotPath} ↔ ${targetDotPath}`
          );
          const updatedContent = updateCardStatus(target.rawContent, {
            kind: "CONFLICTS-WITH",
            dotPath: card.dotPath,
          });
          this.deps.fs.writeFileSync(target.filePath, updatedContent);

          this.regressCommonParent(card, target, cards);
        }
      }
    }
  }

  /**
   * Find and regress the common parent of two conflicting cards.
   */
  regressCommonParent(card1: Card, card2: Card, allCards: Card[]): void {
    const parts1 = card1.dotPath.split(".");
    const parts2 = card2.dotPath.split(".");

    let commonLen = 0;
    while (
      commonLen < parts1.length &&
      commonLen < parts2.length &&
      parts1[commonLen] === parts2[commonLen]
    ) {
      commonLen++;
    }

    if (commonLen === 0) return;

    const parentPath = parts1.slice(0, commonLen).join(".");
    const parent = allCards.find((c) => c.dotPath === parentPath);

    if (parent && parent.status === "DONE") {
      console.log(
        `[orchestrator] Regressing common parent ${parentPath} to [PLAN] due to conflict between ${card1.dotPath} and ${card2.dotPath}`
      );
      let content = updateCardStatus(parent.rawContent, "PLAN");
      content += `\n\n## Conflict Note\nCards ${card1.dotPath} and ${card2.dotPath} are in conflict. Re-decomposition needed.\n`;
      this.deps.fs.writeFileSync(parent.filePath, content);
    }
  }

  private checkAllReferences(cards: Card[]): void {
    for (const card of cards) {
      const errors = checkReferenceIntegrity(card, cards);
      if (errors.length > 0) {
        console.warn(
          `[orchestrator] Link integrity issues in ${card.dotPath}:\n  ${errors.join("\n  ")}`
        );
      }
    }
  }

  getStatus(): {
    active: AgentSlot[];
    cards: { dotPath: string; status: string; isNode: boolean }[];
  } {
    const cards = discoverCards(this.config.planDir, this.deps.fs);
    return {
      active: Array.from(this.activeAgents.values()),
      cards: cards.map((c) => ({
        dotPath: c.dotPath,
        status: isPhase(c.status) ? c.status : formatStatus(c.status),
        isNode: c.isNode,
      })),
    };
  }

  private cleanup(): void {
    for (const [dotPath, proc] of this.processes) {
      console.log(`[orchestrator] Killing agent for ${dotPath}`);
      proc.kill();
    }
    this.activeAgents.clear();
    this.processes.clear();
    this.completionPromises.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
