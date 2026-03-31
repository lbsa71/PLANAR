import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseCard,
  discoverCards,
  isPhase,
  updateCardStatus,
  formatStatus,
  checkReferenceIntegrity,
  parseFrontmatter,
  stripFrontmatter,
  appendRevisionEntry,
} from "./card.js";
import { checkTreeIntegrity, applyIntegrityResults, formatIntegrityReport, smokeTestDescendants } from "./integrity.js";
import { debugLog, debugLogProcessError } from "./debug-log.js";
import { resolveClaudePath } from "./resolve-claude.js";
import { generateSystemPrompt } from "./system-prompt.js";
import { Dashboard } from "./dashboard.js";
import {
  parseStreamChunk,
  summarizeEvent,
  extractCost,
  isRateLimitError,
  RateLimitErrorInfo,
} from "./stream-parser.js";
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
  integrityIntervalSeconds: 0,
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
  /** Consecutive error count per card — for backoff */
  private errorCounts: Map<string, number> = new Map();
  private dashboard: Dashboard;
  /** Soft shutdown: let running agents finish, don't spawn new ones */
  private draining = false;
  /** Track Ctrl-C presses for double-tap hard exit */
  private lastCtrlC = 0;
  private stdinCleanup: (() => void) | null = null;
  /** High-water mark: peak concurrent agents ever seen */
  private peakConcurrent = 0;
  /** Cycle counter for periodic peak logging */
  private cycleSinceLastPeakLog = 0;
  /** Whether a cycle-breaker agent is currently running */
  private cycleBreakInFlight = false;
  /** Card status recorded just before spawning an agent, for revision history */
  private statusBeforeSpawn: Map<string, string> = new Map();
  /** Timestamp of last automated integrity check */
  private lastIntegrityCheckAt: Date | null = null;

  constructor(
    config: Partial<OrchestratorConfig> = {},
    deps: OrchestratorDeps = defaultDeps
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.dashboard = new Dashboard();
  }

  async run(): Promise<void> {
    // Derive planDir from root file if it wasn't explicitly configured
    this.config.planDir = path.dirname(this.config.rootPlanFile);

    this.initializeRootCard();
    this.setupKeyboardHandler();

    this.dashboard.log("*", `Starting with root: ${this.config.rootPlanFile}`);
    this.dashboard.log("*", `Plan dir: ${this.config.planDir}`);
    this.dashboard.log("*", `Max parallel agents: ${this.config.maxParallelAgents} (--max-agents <n> to change)`);
    this.dashboard.log("*", `Press ESC to drain (finish running, stop new). Ctrl-C twice to force quit.`);

    let staleCycles = 0;
    const maxStaleCycles = 3;

    while (true) {
      const cards = discoverCards(this.config.planDir, this.deps.fs);

      // Render dashboard each cycle
      this.dashboard.render(cards, this.activeAgents, this.iterationCounts, this.draining);

      if (cards.length > 0 && cards.every((c) => c.status === "DONE")) {
        this.dashboard.log("*", "All cards are DONE. Exiting.");
        break;
      }

      // Soft shutdown: wait for active agents to finish, then exit
      if (this.draining && this.activeAgents.size === 0) {
        this.dashboard.log("*", "All agents drained. Exiting.");
        break;
      }

      this.propagateConflicts(cards);
      this.checkAllReferences(cards);
      this.maybeRunIntegrityCheck(cards);

      const eligible = this.draining ? [] : this.findEligibleCards(cards);

      if (eligible.length === 0 && this.activeAgents.size === 0) {
        // Before counting stale cycles, check for dependency cycles
        const nonDone = cards.filter((c) => c.status !== "DONE" && isPhase(c.status));
        const cycles = detectDependencyCycles(nonDone, cards);

        if (cycles.length > 0 && !this.cycleBreakInFlight) {
          this.dashboard.log("*", `Dependency cycle detected: ${cycles[0].map((c) => c.dotPath).join(" → ")}`);
          staleCycles = 0;
          this.cycleBreakInFlight = true;
          this.spawnCycleBreaker(cycles[0], cards);
        } else if (!this.cycleBreakInFlight) {
          staleCycles++;
          this.dashboard.log("*", `No eligible cards. Stale cycle ${staleCycles}/${maxStaleCycles}.`);
          if (staleCycles >= maxStaleCycles) {
            this.dashboard.log("*", "Max stale cycles reached. Exiting.");
            break;
          }
          // Render once more to show stale message, then wait
          this.dashboard.render(cards, this.activeAgents, this.iterationCounts, this.draining);
          await sleep(2000);
        }
        continue;
      }

      staleCycles = 0;

      // Periodically log current concurrency (every 10 cycles when not at peak)
      this.cycleSinceLastPeakLog++;
      if (this.cycleSinceLastPeakLog >= 10 && this.activeAgents.size > 0) {
        this.cycleSinceLastPeakLog = 0;
        this.dashboard.log("*", `Active agents: ${this.activeAgents.size} / ${this.config.maxParallelAgents} (peak: ${this.peakConcurrent})`);
      }

      const slotsAvailable =
        this.config.maxParallelAgents - this.activeAgents.size;
      const toSpawn = eligible.slice(0, slotsAvailable);

      for (const card of toSpawn) {
        this.spawnAgent(card);
      }

      if (this.completionPromises.size > 0) {
        // Start a render tick so the dashboard stays alive while agents run
        let tick = 0;
        const renderInterval = setInterval(() => {
          tick++;
          if (tick % 5 === 0) {
            debugLog(`[heartbeat] tick=${tick} active=${this.activeAgents.size} promises=${this.completionPromises.size}`);
          }
          const freshCards = discoverCards(this.config.planDir, this.deps.fs);
          this.dashboard.render(freshCards, this.activeAgents, this.iterationCounts, this.draining);
        }, 1000);

        const finished = await Promise.race(this.completionPromises.values());
        clearInterval(renderInterval);
        this.reapAgent(finished);
      } else {
        await sleep(500);
      }
    }

    // Final render and cleanup
    this.teardownKeyboardHandler();
    const finalCards = discoverCards(this.config.planDir, this.deps.fs);
    this.dashboard.render(finalCards, this.activeAgents, this.iterationCounts, this.draining);
    this.dashboard.cleanup();
    this.cleanup();
  }

  /**
   * Initialize an uninitialized root card.
   * Adds YAML frontmatter and [PLAN] status tag if missing.
   */
  private initializeRootCard(): void {
    const rootFile = this.config.rootPlanFile;
    if (!this.deps.fs.existsSync(rootFile)) return;

    const content = this.deps.fs.readFileSync(rootFile, "utf-8");
    const fm = parseFrontmatter(content);

    // Already has frontmatter with root — assume initialized
    if (fm.root) return;

    const body = stripFrontmatter(content);
    const headingMatch = body.match(/^(#\s+.+)$/m);
    if (!headingMatch) return;

    // Check if heading already has a status tag
    if (/\[(?:PLAN|ARCHITECT|IMPLEMENT|REVIEW|DONE)\]/.test(headingMatch[1])) return;

    const frontmatter = `---\nroot: ${rootFile}\n---\n`;
    const newBody = body.replace(
      headingMatch[1],
      `${headingMatch[1]} [PLAN]`
    );

    this.deps.fs.writeFileSync(rootFile, frontmatter + newBody);
    this.dashboard.log("*", `Initialized root card: ${rootFile}`);
  }

  /**
   * Find cards eligible for agent spawning, ordered breadth-first.
   *
   * Cards are sorted so that slots are filled by round-robining across
   * top-level plan sections (0.1, 0.3, 0.4, 0.5, 0.7, …) before any
   * section gets a second slot. Within a section, cards with fewer
   * prior iterations come first (least-recently-worked).
   */
  findEligibleCards(cards: Card[]): Card[] {
    const candidates: Card[] = [];

    for (const card of cards) {
      if (card.status === "DONE") continue;
      if (!isPhase(card.status)) continue;
      if (this.activeAgents.has(card.dotPath)) continue;

      const count = this.iterationCounts.get(card.dotPath) ?? 0;
      if (count >= this.config.maxIterationsPerCard) continue;

      if (this.isUnderActiveNode(card, cards)) continue;
      if (this.isBlocked(card, cards)) continue;

      // Error backoff: skip if card has consecutive errors (max 3 retries)
      const errors = this.errorCounts.get(card.dotPath) ?? 0;
      if (errors >= 3) continue;

      candidates.push(card);
    }

    return breadthFirstSort(candidates, this.iterationCounts);
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
   * Uses --output-format stream-json to get real-time events.
   */
  private spawnAgent(card: Card): void {
    // Smoke test: when a node enters PLAN, recursively check all descendants
    // and regress any whose artifacts are invalid back to PLAN
    if (card.isNode && card.status === "PLAN") {
      const allCards = discoverCards(this.config.planDir, this.deps.fs);
      const regressed = smokeTestDescendants(card, allCards, process.cwd(), this.deps.fs);
      if (regressed.length > 0) {
        this.dashboard.log(
          card.dotPath,
          `Smoke test regressed ${regressed.length} descendant(s)`
        );
        for (const entry of regressed) {
          this.dashboard.log(card.dotPath, `  ${entry}`);
        }
      }
    }

    const slot: AgentSlot = {
      dotPath: card.dotPath,
      cardFile: card.filePath,
      pid: 0,
      startedAt: new Date(),
    };

    this.activeAgents.set(card.dotPath, slot);
    // Record status before the agent runs so reapAgent can detect changes
    this.statusBeforeSpawn.set(
      card.dotPath,
      isPhase(card.status) ? card.status : formatStatus(card.status)
    );

    const concurrent = this.activeAgents.size;
    if (concurrent > this.peakConcurrent) {
      this.peakConcurrent = concurrent;
      this.dashboard.log("*", `New peak concurrent agents: ${this.peakConcurrent} / ${this.config.maxParallelAgents}`);
    }

    const completionPromise = new Promise<string>((resolve) => {
      this.startAgentAttempt(card, slot, resolve);
    });

    this.completionPromises.set(card.dotPath, completionPromise);
  }

  private startAgentAttempt(
    card: Card,
    slot: AgentSlot,
    resolve: (dotPath: string) => void
  ): void {
    const iterNum = this.iterationCounts.get(card.dotPath) ?? 0;
    const systemPrompt = generateSystemPrompt(card, this.config.rootPlanFile);
    const prompt = `@${card.filePath} @${this.config.rootPlanFile}\n\nDo the next thing for this card. Perform exactly one operation, update the card file, and exit.`;
    const spawnArgs = [
      "--dangerously-skip-permissions",
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--system-prompt",
      systemPrompt,
      "--",
      prompt,
    ];
    const claudePath = resolveClaudePath();
    const statusLabel = isPhase(card.status) ? card.status : formatStatus(card.status);
    this.dashboard.log(card.dotPath, `Spawning [${statusLabel}]`);
    debugLog(
      `Spawning agent for ${card.dotPath} — ${claudePath} ${spawnArgs.slice(0, 4).join(" ")} ...`
    );
    const proc = this.deps.spawner.spawn(claudePath, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    slot.pid = proc.pid;
    slot.cardFile = card.filePath;
    slot.waitingForRateLimitUntil = undefined;
    slot.rateLimitType = undefined;
    this.processes.set(card.dotPath, proc);
    this.iterationCounts.set(card.dotPath, iterNum + 1);

    debugLog(`[${card.dotPath}] pid=${proc.pid} stdout=${!!proc.stdout} stderr=${!!proc.stderr}`);

    let stdoutBuffer = "";
    let stderr = "";
    let rateLimitInfo: RateLimitErrorInfo | null = null;

    proc.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      debugLog(`[${card.dotPath}] stdout chunk (${chunk.length} bytes): ${chunk.slice(0, 200)}`);
      stdoutBuffer += chunk;
      const { events, remainder } = parseStreamChunk(stdoutBuffer);
      stdoutBuffer = remainder;

      debugLog(`[${card.dotPath}] Parsed ${events.length} events, remainder: ${remainder.length} bytes`);

      for (const event of events) {
        rateLimitInfo = this.handleEvent(card.dotPath, slot, event, rateLimitInfo);
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      debugLog(`[${card.dotPath}] stderr chunk: ${chunk.slice(0, 200)}`);
      stderr += chunk;
    });

    proc.on("close", (code) => {
      debugLog(`Agent ${card.dotPath} exited with code ${code}`);
      if (stdoutBuffer.trim()) {
        const { events } = parseStreamChunk(stdoutBuffer + "\n");
        for (const event of events) {
          rateLimitInfo = this.handleEvent(card.dotPath, slot, event, rateLimitInfo);
        }
      }

      if (code !== 0 && rateLimitInfo) {
        this.processes.delete(card.dotPath);
        void this.waitForRateLimit(card.filePath, card.dotPath, slot, rateLimitInfo, resolve);
        return;
      }

      if (code !== 0) {
        const prevErrors = this.errorCounts.get(card.dotPath) ?? 0;
        this.errorCounts.set(card.dotPath, prevErrors + 1);
        this.dashboard.log(
          card.dotPath,
          `Error (exit ${code}) — ${prevErrors + 1} consecutive failures`
        );
        debugLogProcessError({
          dotPath: card.dotPath,
          command: claudePath,
          args: spawnArgs,
          error: new Error(`Process exited with code ${code}`),
          stdout: stdoutBuffer,
          stderr,
          exitCode: code,
        });
      } else {
        this.errorCounts.set(card.dotPath, 0);
      }

      if (stderr) {
        debugLog(`[${card.dotPath}] stderr: ${stderr.slice(-500)}`);
      }

      this.dashboard.log(card.dotPath, `Agent finished (exit ${code})`);
      resolve(card.dotPath);
    });

    proc.on("error", (err) => {
      this.dashboard.log(card.dotPath, `Error: ${err.message}`);
      debugLogProcessError({
        dotPath: card.dotPath,
        command: claudePath,
        args: spawnArgs,
        error: err,
        stdout: stdoutBuffer,
        stderr,
      });
      resolve(card.dotPath);
    });
  }

  private handleEvent(
    dotPath: string,
    slot: AgentSlot,
    event: { type: string; subtype?: string; [key: string]: unknown },
    currentRateLimit: RateLimitErrorInfo | null
  ): RateLimitErrorInfo | null {
    debugLog(`[${dotPath}] Event: type=${event.type} subtype=${event.subtype ?? ""}`);
    const summary = summarizeEvent(event);
    if (summary) {
      this.dashboard.log(dotPath, summary);
    }

    const cost = extractCost(event);
    if (cost !== null) {
      this.dashboard.addCost(cost);
    }

    const rateLimit = isRateLimitError(event);
    if (!rateLimit) {
      return currentRateLimit;
    }

    const waitUntilMs =
      rateLimit.resetsAt !== undefined
        ? rateLimit.resetsAt * 1000
        : Date.now() + rateLimit.retryAfterSecs * 1000;
    const previousWaitMs = slot.waitingForRateLimitUntil?.getTime() ?? 0;
    if (waitUntilMs > previousWaitMs) {
      slot.waitingForRateLimitUntil = new Date(waitUntilMs);
      slot.rateLimitType = rateLimit.rateLimitType;
      this.dashboard.log(
        dotPath,
        `Rate limited — retrying at ${slot.waitingForRateLimitUntil.toLocaleTimeString()}`
      );
      debugLog(
        `[${dotPath}] Rate limited (${rateLimit.rateLimitType ?? "unknown"}), waiting until ${slot.waitingForRateLimitUntil.toISOString()}`
      );
    }

    const c = this.iterationCounts.get(dotPath) ?? 1;
    this.iterationCounts.set(dotPath, Math.max(0, c - 1));

    if (!currentRateLimit) {
      return rateLimit;
    }

    const currentResetsAt = currentRateLimit.resetsAt ?? 0;
    const nextResetsAt = rateLimit.resetsAt ?? 0;
    return nextResetsAt >= currentResetsAt ? rateLimit : currentRateLimit;
  }

  private async waitForRateLimit(
    cardFile: string,
    dotPath: string,
    slot: AgentSlot,
    rateLimit: RateLimitErrorInfo,
    resolve: (dotPath: string) => void
  ): Promise<void> {
    const waitUntil =
      slot.waitingForRateLimitUntil ??
      new Date(Date.now() + rateLimit.retryAfterSecs * 1000);
    const waitMs = Math.max(0, waitUntil.getTime() - Date.now());

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    if (!this.activeAgents.has(dotPath)) {
      resolve(dotPath);
      return;
    }

    let latestCard: Card;
    try {
      const latestContent = this.deps.fs.readFileSync(cardFile, "utf-8");
      latestCard = parseCard(cardFile, latestContent);
    } catch (err) {
      this.dashboard.log(
        dotPath,
        `Rate limit cleared, but card could not be reloaded: ${err instanceof Error ? err.message : err}`
      );
      resolve(dotPath);
      return;
    }

    slot.waitingForRateLimitUntil = undefined;
    slot.rateLimitType = undefined;

    if (latestCard.status === "DONE" || !isPhase(latestCard.status)) {
      this.errorCounts.set(dotPath, 0);
      this.dashboard.log(dotPath, "Rate limit cleared — card no longer runnable");
      resolve(dotPath);
      return;
    }

    this.dashboard.log(dotPath, "Rate limit cleared — retrying");
    this.startAgentAttempt(latestCard, slot, resolve);
  }

  private reapAgent(dotPath: string): void {
    this.dashboard.log(dotPath, "Agent finished");

    // Detect status change and write a revision history entry
    const slot = this.activeAgents.get(dotPath);
    const prevStatus = this.statusBeforeSpawn.get(dotPath);
    if (slot && prevStatus) {
      try {
        const content = this.deps.fs.readFileSync(slot.cardFile, "utf-8");
        const card = parseCard(slot.cardFile, content);
        const newStatus = isPhase(card.status)
          ? card.status
          : formatStatus(card.status);
        if (prevStatus !== newStatus) {
          const ts = new Date().toISOString();
          const updated = appendRevisionEntry(
            content,
            `${ts}: status ${prevStatus} → ${newStatus}`
          );
          this.deps.fs.writeFileSync(slot.cardFile, updated);
        }
      } catch {
        // card may have been deleted or is temporarily invalid — ignore
      }
      this.statusBeforeSpawn.delete(dotPath);
    }

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
          this.dashboard.log(card.dotPath, `Conflict propagated ↔ ${targetDotPath}`);
          const ts = new Date().toISOString();
          let updatedContent = updateCardStatus(target.rawContent, {
            kind: "CONFLICTS-WITH",
            dotPath: card.dotPath,
          });
          updatedContent = appendRevisionEntry(
            updatedContent,
            `${ts}: CONFLICTS-WITH ${card.dotPath} propagated by orchestrator`
          );
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
      this.dashboard.log(parentPath, `Regressed to [PLAN] — conflict between ${card1.dotPath} and ${card2.dotPath}`);
      const ts = new Date().toISOString();
      let content = updateCardStatus(parent.rawContent, "PLAN");
      content = appendRevisionEntry(
        content,
        `${ts}: regressed to PLAN — conflict between ${card1.dotPath} and ${card2.dotPath}`
      );
      content += `\n\n## Conflict Note\nCards ${card1.dotPath} and ${card2.dotPath} are in conflict. Re-decomposition needed.\n`;
      this.deps.fs.writeFileSync(parent.filePath, content);
    }
  }

  /**
   * Spawn a special agent to break a dependency cycle.
   * The agent gets a system prompt explaining the cycle and instructions
   * to edit the card files to remove the circular blocked-by links.
   */
  private spawnCycleBreaker(cycle: Card[], allCards: Card[]): void {
    const cycleDesc = cycle.map((c) => `  - ${c.dotPath} "${c.title}" [${isPhase(c.status) ? c.status : formatStatus(c.status)}] (file: ${c.filePath})`).join("\n");
    const blockedByDesc = cycle.map((c) => {
      const deps = c.refs.blockedBy.join(", ") || "(none)";
      return `  - ${c.dotPath}: blocked-by [${deps}]`;
    }).join("\n");

    // Find the common parent node if one exists
    const parentPath = this.findCommonParent(cycle, allCards);
    const parentClause = parentPath
      ? `\nThe common parent node is: ${parentPath.filePath}\nYou may regress it to [PLAN] if re-decomposition is needed.`
      : "";

    const systemPrompt = `You are a PLANAR cycle-breaker agent.

A dependency cycle has been detected that prevents any card from being eligible for processing.
Your job is to break this cycle by editing the blocked-by frontmatter in the card files.

## The Cycle
${cycleDesc}

## Current blocked-by relationships
${blockedByDesc}
${parentClause}

## Instructions
1. Read each card file in the cycle
2. Analyze the actual dependencies — which cards TRULY need to wait for which others?
3. Remove or reorder blocked-by entries to break the cycle while preserving genuine dependencies
4. A card should only be blocked-by another card if it truly cannot start until that card is DONE
5. If the cards can actually be worked on in parallel, remove the blocked-by entries
6. If there's a natural ordering, keep only the forward edges and remove the back-edge(s)
7. Update the YAML frontmatter in each affected card file

## Rules
- You MUST break the cycle — at least one blocked-by link must be removed
- Preserve dependencies that are genuinely necessary
- Do NOT change card statuses — only modify blocked-by frontmatter
- Do NOT modify any files other than the card files listed above`;

    const prompt = cycle.map((c) => `@${c.filePath}`).join(" ") + `\n@${this.config.rootPlanFile}\n\nBreak the dependency cycle described in your system prompt. Read the cards, determine the correct dependency ordering, and edit the blocked-by frontmatter to eliminate the cycle.`;

    const slot: AgentSlot = {
      dotPath: "*cycle-breaker",
      cardFile: cycle[0].filePath,
      pid: 0,
      startedAt: new Date(),
    };

    this.activeAgents.set("*cycle-breaker", slot);

    const completionPromise = new Promise<string>((resolve) => {
      const claudePath = resolveClaudePath();
      const spawnArgs = [
        "--dangerously-skip-permissions",
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--system-prompt",
        systemPrompt,
        "--",
        prompt,
      ];

      this.dashboard.log("*", "Spawning cycle-breaker agent");
      const proc = this.deps.spawner.spawn(claudePath, spawnArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      slot.pid = proc.pid;
      this.processes.set("*cycle-breaker", proc);

      let stdoutBuffer = "";
      let rateLimitInfo: RateLimitErrorInfo | null = null;

      proc.stdout?.on("data", (data: Buffer) => {
        stdoutBuffer += data.toString();
        const { events, remainder } = parseStreamChunk(stdoutBuffer);
        stdoutBuffer = remainder;
        for (const event of events) {
          rateLimitInfo = this.handleEvent("*cycle-breaker", slot, event, rateLimitInfo);
        }
      });

      proc.stderr?.on("data", () => {});

      proc.on("close", (code) => {
        this.dashboard.log("*", `Cycle-breaker finished (exit ${code})`);
        this.cycleBreakInFlight = false;
        resolve("*cycle-breaker");
      });

      proc.on("error", (err) => {
        this.dashboard.log("*", `Cycle-breaker error: ${err.message}`);
        this.cycleBreakInFlight = false;
        resolve("*cycle-breaker");
      });
    });

    this.completionPromises.set("*cycle-breaker", completionPromise);
  }

  /**
   * Find the common parent node for a set of cards.
   */
  private findCommonParent(cycle: Card[], allCards: Card[]): Card | null {
    const dotPaths = cycle.map((c) => c.dotPath.split("."));
    let commonLen = 0;
    for (let i = 0; i < Math.min(...dotPaths.map((p) => p.length)); i++) {
      const seg = dotPaths[0][i];
      if (dotPaths.every((p) => p[i] === seg)) {
        commonLen = i + 1;
      } else {
        break;
      }
    }
    if (commonLen === 0) return null;
    const parentDotPath = dotPaths[0].slice(0, commonLen).join(".");
    return allCards.find((c) => c.dotPath === parentDotPath && c.isNode) ?? null;
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

  /**
   * Run a full integrity check if enough time has elapsed since the last one.
   * Applies results (timestamps + revision history) to all card files.
   * Triggers immediately if structural issues are detected even before the
   * interval has elapsed.
   */
  private maybeRunIntegrityCheck(cards: Card[]): void {
    const intervalMs = (this.config.integrityIntervalSeconds ?? 0) * 1000;
    if (intervalMs <= 0) return;

    const now = Date.now();
    const elapsed = this.lastIntegrityCheckAt
      ? now - this.lastIntegrityCheckAt.getTime()
      : Infinity;

    if (elapsed < intervalMs) return;

    this.lastIntegrityCheckAt = new Date(now);
    this.dashboard.log("*", "Running automated integrity check…");

    const report = checkTreeIntegrity(cards, process.cwd(), {
      scanSourceDir: "src",
      fs: {
        existsSync: (p: string) => this.deps.fs.existsSync(p),
      },
    });

    const { updated, regressed } = applyIntegrityResults(
      report,
      cards,
      { regressProblematic: true },
      this.deps.fs
    );

    const issueCount =
      report.cardIssues.length + report.complianceIssues.length;
    this.dashboard.log(
      "*",
      `Integrity check: ${issueCount} issue(s), ${updated} card(s) updated` +
        (regressed.length > 0 ? `, regressed: ${regressed.join(", ")}` : "")
    );

    if (issueCount > 0) {
      this.dashboard.log("*", formatIntegrityReport(report));
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

  private setupKeyboardHandler(): void {
    if (!process.stdin.isTTY) return;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const handler = (key: string) => {
      // ESC (0x1b) — soft shutdown
      if (key === "\x1b") {
        if (this.draining) return; // already draining
        this.draining = true;
        this.dashboard.log("*", "ESC pressed — draining. Waiting for running agents to finish...");
      }

      // Ctrl-C (0x03) — double-tap for hard exit
      if (key === "\x03") {
        const now = Date.now();
        if (now - this.lastCtrlC < 1000) {
          // Second Ctrl-C within 1 second — force exit
          this.dashboard.log("*", "Force exit.");
          this.teardownKeyboardHandler();
          this.dashboard.cleanup();
          this.cleanup();
          process.exit(1);
        }
        this.lastCtrlC = now;
        // First Ctrl-C — start draining and hint about force exit
        if (!this.draining) {
          this.draining = true;
          this.dashboard.log("*", "Ctrl-C — draining. Press Ctrl-C again to force quit.");
        } else {
          this.dashboard.log("*", "Press Ctrl-C again to force quit.");
        }
      }
    };

    process.stdin.on("data", handler);
    this.stdinCleanup = () => {
      process.stdin.removeListener("data", handler);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };
  }

  private teardownKeyboardHandler(): void {
    if (this.stdinCleanup) {
      this.stdinCleanup();
      this.stdinCleanup = null;
    }
  }

  private cleanup(): void {
    for (const [dotPath, proc] of this.processes) {
      this.dashboard.log(dotPath, "Killing agent");
      proc.kill();
    }
    this.activeAgents.clear();
    this.processes.clear();
    this.completionPromises.clear();
  }
}

/**
 * Detect dependency cycles among non-DONE cards.
 * Returns an array of cycles, where each cycle is an array of cards
 * forming a closed loop via blocked-by references.
 */
export function detectDependencyCycles(nonDoneCards: Card[], allCards: Card[]): Card[][] {
  const cycles: Card[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: Card[] = [];

  // Build a map for quick lookup: filePath-suffix → Card
  const cardByPath = new Map<string, Card>();
  for (const card of allCards) {
    cardByPath.set(card.filePath, card);
  }

  // Map dotPath → Card for non-DONE cards
  const nonDoneByDotPath = new Map<string, Card>();
  for (const card of nonDoneCards) {
    nonDoneByDotPath.set(card.dotPath, card);
  }

  function dfs(card: Card): void {
    if (visited.has(card.dotPath)) return;

    inStack.add(card.dotPath);
    stack.push(card);

    for (const dep of card.refs.blockedBy) {
      const depCard = allCards.find((c) => c.filePath.endsWith(dep));
      if (!depCard || depCard.status === "DONE") continue;

      if (inStack.has(depCard.dotPath)) {
        // Found a cycle — extract it from the stack
        const cycleStart = stack.findIndex((c) => c.dotPath === depCard.dotPath);
        if (cycleStart >= 0) {
          cycles.push(stack.slice(cycleStart));
        }
        return;
      }

      if (!visited.has(depCard.dotPath)) {
        dfs(depCard);
      }
    }

    stack.pop();
    inStack.delete(card.dotPath);
    visited.add(card.dotPath);
  }

  for (const card of nonDoneCards) {
    if (!visited.has(card.dotPath)) {
      dfs(card);
    }
  }

  return cycles;
}

/**
 * Sort eligible cards breadth-first across top-level plan sections.
 *
 * Groups cards by their top-level section key (the first two dot-path
 * segments, e.g. "0.1", "0.3", "0.7"). Within each group, cards are
 * ordered by (iterationCount ASC, depth ASC, dotPath ASC) so that
 * untouched and shallower work comes first.
 *
 * The groups are then interleaved round-robin, so the first N slots
 * span N different sections before any section gets a second pick.
 * This prevents the alphabetically-first sections from monopolising
 * all available agent slots.
 */
function breadthFirstSort(
  cards: Card[],
  iterationCounts: Map<string, number>
): Card[] {
  if (cards.length === 0) return cards;

  // Group by top-level section (e.g. "0.1", "0.3", "0.7")
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const parts = card.dotPath.split(".");
    const key = parts.slice(0, 2).join(".");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(card);
  }

  // Within each group: least-recently-worked first, then shallower, then lexicographic
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const ia = iterationCounts.get(a.dotPath) ?? 0;
      const ib = iterationCounts.get(b.dotPath) ?? 0;
      if (ia !== ib) return ia - ib;
      const da = a.dotPath.split(".").length;
      const db = b.dotPath.split(".").length;
      if (da !== db) return da - db;
      return a.dotPath.localeCompare(b.dotPath);
    });
  }

  // Round-robin through sections (sorted by key for determinism)
  const sectionKeys = Array.from(groups.keys()).sort();
  const result: Card[] = [];
  let round = 0;
  while (result.length < cards.length) {
    let added = 0;
    for (const key of sectionKeys) {
      const group = groups.get(key)!;
      if (round < group.length) {
        result.push(group[round]);
        added++;
      }
    }
    if (added === 0) break;
    round++;
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
