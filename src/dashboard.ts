import { Card, AgentSlot } from "./types.js";
import { isPhase, formatStatus } from "./card.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MAX_LOG_LINES = 12;

/** A single log event for the dashboard feed */
export interface DashboardEvent {
  timestamp: Date;
  dotPath: string;
  message: string;
}

/**
 * Live dashboard that renders orchestrator state to the terminal.
 * Uses ANSI escape codes to redraw in-place.
 */
export class Dashboard {
  private events: DashboardEvent[] = [];
  /** Per-agent spinner frame — advances only when that agent emits an event */
  private agentFrames: Map<string, number> = new Map();
  private startedAt = new Date();
  private totalCost = 0;
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled && process.stdout.isTTY === true;
  }

  /** Add a log event to the feed and advance that agent's spinner */
  log(dotPath: string, message: string): void {
    this.events.push({ timestamp: new Date(), dotPath, message });
    if (this.events.length > MAX_LOG_LINES * 2) {
      this.events = this.events.slice(-MAX_LOG_LINES);
    }
    // Advance spinner for this agent
    if (dotPath !== "*") {
      const frame = this.agentFrames.get(dotPath) ?? 0;
      this.agentFrames.set(dotPath, frame + 1);
    }
  }

  /** Track cost */
  addCost(amount: number): void {
    this.totalCost += amount;
  }

  /** Render the full dashboard to stdout */
  render(
    cards: Card[],
    activeAgents: Map<string, AgentSlot>,
    iterationCounts: Map<string, number>,
    draining = false
  ): void {
    if (!this.enabled) return;

    const elapsed = formatElapsed(this.startedAt);
    const lines: string[] = [];

    // Header
    lines.push("");
    const status = draining ? `  ${yellow("⏳ DRAINING")}` : "";
    lines.push(
      `${bold("PLANAR")}${status}  ${dim(`elapsed: ${elapsed}  cost: $${this.totalCost.toFixed(2)}`)}`
    );
    lines.push(dim("─".repeat(76)));

    // Card tree — skip DONE cards
    const sorted = [...cards]
      .filter((c) => c.status !== "DONE")
      .sort((a, b) => compareDotPaths(a.dotPath, b.dotPath));

    for (const card of sorted) {
      const depth = card.dotPath.split(".").length - 1;
      const indent = "  ".repeat(depth);
      const agent = activeAgents.get(card.dotPath);
      const iters = iterationCounts.get(card.dotPath) ?? 0;

      const statusStr = isPhase(card.status)
        ? card.status
        : formatStatus(card.status);

      let line = `${indent}${card.dotPath.padEnd(8 - depth * 2)}`;

      if (agent) {
        line += `  ${yellow(`[${statusStr}]`.padEnd(18))}`;
        if (agent.waitingForRateLimitUntil) {
          const retryAt = agent.waitingForRateLimitUntil.toLocaleTimeString();
          line += `  ${yellow("⏳")} ${dim(`rate limit ${formatRemaining(agent.waitingForRateLimitUntil)}  retry @ ${retryAt}  iter #${iters}`)}`;
        } else {
          const agentFrame = this.agentFrames.get(card.dotPath) ?? 0;
          const spinner = SPINNER[agentFrame % SPINNER.length];
          const agentElapsed = formatElapsed(agent.startedAt);
          line += `  ${green(spinner)} ${dim(`${agentElapsed}  iter #${iters}`)}`;
        }
      } else if (!isPhase(card.status)) {
        line += `  ${red(`[${statusStr}]`.padEnd(18))}`;
      } else {
        line += `  ${cyan(`[${statusStr}]`.padEnd(18))}`;
        if (iters > 0) {
          line += `  ${dim(`(${iters} iters)`)}`;
        }
      }

      line += `  ${card.title}`;
      lines.push(line);
    }

    if (sorted.length === 0) {
      lines.push(dim("  (all cards done)"));
    }

    // Summary bar
    const done = cards.filter((c) => c.status === "DONE").length;
    const total = cards.length;
    const active = activeAgents.size;
    const barWidth = 30;
    const filled = total > 0 ? Math.round((done / total) * barWidth) : 0;
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

    lines.push(dim("─".repeat(76)));
    lines.push(
      `  ${bar}  ${bold(`${done}/${total}`)} done  ${green(`${active} active`)}  ${dim(`${total - done - active} pending`)}`
    );

    // Event log
    lines.push("");
    lines.push(dim("  Recent activity:"));
    const recentEvents = this.events.slice(-MAX_LOG_LINES);
    if (recentEvents.length === 0) {
      lines.push(dim("    (no activity yet)"));
    } else {
      for (const evt of recentEvents) {
        const time = evt.timestamp.toLocaleTimeString();
        lines.push(
          `    ${dim(time)} ${cyan(evt.dotPath.padEnd(6))} ${evt.message}`
        );
      }
    }
    lines.push("");

    // Clear screen and draw
    process.stdout.write("\x1B[2J\x1B[H");
    process.stdout.write(lines.join("\n"));
  }

  /** Clean up — show cursor, reset terminal */
  cleanup(): void {
    if (!this.enabled) return;
    process.stdout.write("\x1B[?25h");
  }
}

// -- ANSI helpers --

function bold(s: string): string {
  return `\x1B[1m${s}\x1B[22m`;
}

function dim(s: string): string {
  return `\x1B[2m${s}\x1B[22m`;
}

function green(s: string): string {
  return `\x1B[32m${s}\x1B[39m`;
}

function yellow(s: string): string {
  return `\x1B[33m${s}\x1B[39m`;
}

function red(s: string): string {
  return `\x1B[31m${s}\x1B[39m`;
}

function cyan(s: string): string {
  return `\x1B[36m${s}\x1B[39m`;
}

function formatElapsed(since: Date): string {
  const ms = Date.now() - since.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m${remSecs.toString().padStart(2, "0")}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h${remMins.toString().padStart(2, "0")}m`;
}

function compareDotPaths(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

function formatRemaining(until: Date): string {
  const ms = until.getTime() - Date.now();
  if (ms <= 0) return "clearing…";

  const totalSecs = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  if (mins < 60) return `${mins}m${secs.toString().padStart(2, "0")}s`;

  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h${remMins.toString().padStart(2, "0")}m`;
}
