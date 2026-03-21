import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { parseCard, discoverCards, checkReferenceIntegrity, isPhase } from "./card.js";
import { debugLog, debugLogProcessError } from "./debug-log.js";
import { runGateForTransition } from "./gate-checks.js";
import { dotPathToGuid } from "./guid.js";
import { resolveClaudePath } from "./resolve-claude.js";
import { generateSystemPrompt } from "./system-prompt.js";
import {
  ClaudeInvoker,
  FileSystem,
  GateMode,
  IterationResult,
  LeafPhase,
  WrapperConfig,
} from "./types.js";

/** Default FileSystem using node:fs */
const nodeFs: FileSystem = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, c) => fs.writeFileSync(p, c),
  existsSync: (p) => fs.existsSync(p),
  readdirSync: (p) => fs.readdirSync(p) as string[],
};

/** Default ClaudeInvoker using execFileSync with resolved claude path */
const defaultClaude: ClaudeInvoker = {
  invoke(args: string[], timeoutMs: number): string | null {
    const claudePath = resolveClaudePath();
    try {
      return execFileSync(claudePath, args, {
        stdio: ["pipe", "pipe", "inherit"],
        encoding: "utf-8",
        timeout: timeoutMs,
      });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "stdout" in err) {
        return (err as { stdout: string }).stdout;
      }
      throw err;
    }
  },
};

export interface WrapperDeps {
  fs: FileSystem;
  claude: ClaudeInvoker;
}

const defaultDeps: WrapperDeps = { fs: nodeFs, claude: defaultClaude };

/**
 * Run the Ralph Wiggum loop on a single card file.
 *
 * Termination conditions (per spec):
 * - All cards in plan dir are DONE
 * - No operation was performed (card unchanged = convergence)
 * - Max iterations reached
 * - Budget exhausted (max cost in dollars)
 */
export async function runCardLoop(
  cardFile: string,
  config: Partial<WrapperConfig> = {},
  deps: WrapperDeps = defaultDeps
): Promise<IterationResult[]> {
  const maxIterations = config.maxIterations ?? 50;
  const rootPlanFile = config.rootPlanFile ?? "plan/root.md";
  const planDir = config.planDir ?? "plan";
  const maxCostDollars = config.maxCostDollars ?? Infinity;
  const gateMode: GateMode = config.gateMode ?? "advisory";
  const results: IterationResult[] = [];
  let accumulatedCost = 0;
  let gateContext: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
    // Termination: all cards DONE
    const allCards = discoverCards(planDir, deps.fs);
    if (allCards.length > 0 && allCards.every((c) => c.status === "DONE")) {
      console.log(`[wrapper] All cards in ${planDir}/ are DONE. Exiting loop.`);
      break;
    }

    // Termination: budget exhausted
    if (accumulatedCost >= maxCostDollars) {
      console.log(
        `[wrapper] Budget exhausted ($${accumulatedCost.toFixed(2)} >= $${maxCostDollars}). Exiting loop.`
      );
      break;
    }

    const beforeContent = deps.fs.readFileSync(cardFile, "utf-8");
    const card = parseCard(cardFile, beforeContent);

    if (card.status === "DONE") {
      console.log(`[${card.dotPath}] Card is DONE. Exiting loop.`);
      break;
    }

    if (typeof card.status !== "string") {
      console.log(
        `[${card.dotPath}] Card has special status [${card.status.kind}]. Exiting loop.`
      );
      break;
    }

    const refErrors = checkReferenceIntegrity(card, allCards);
    if (refErrors.length > 0) {
      console.error(
        `[${card.dotPath}] Link integrity errors:\n  ${refErrors.join("\n  ")}`
      );
      break;
    }

    const sessionId = dotPathToGuid(card.dotPath);
    const systemPrompt = generateSystemPrompt(card, rootPlanFile, gateContext);
    gateContext = undefined; // Clear after consumption

    console.log(
      `[${card.dotPath}] Iteration ${i + 1}/${maxIterations} — phase: [${card.status}]`
    );

    const invokeArgs = [
      "--dangerously-skip-permissions",
      "--print",
      "--output-format",
      "json",
      "--session-id",
      sessionId,
      "--system-prompt",
      systemPrompt,
      "--",
      `@${cardFile} @${rootPlanFile}\n\nDo the next thing for this card. Perform exactly one operation, update the card file, and exit.`,
    ];

    debugLog(
      `[${card.dotPath}] Iteration ${i + 1} — invoking claude`
    );

    try {
      const output = deps.claude.invoke(invokeArgs, 5 * 60 * 1000);

      const parsed = parseClaudeOutput(output);
      if (parsed.costUsd !== undefined) {
        accumulatedCost += parsed.costUsd;
        debugLog(`[${card.dotPath}] Cost: $${parsed.costUsd.toFixed(4)}`);
      }
      if (parsed.rateLimited) {
        const wait = parsed.retryAfterSecs ?? 60;
        const retryAt = parsed.resetsAt
          ? new Date(parsed.resetsAt * 1000).toLocaleTimeString()
          : new Date(Date.now() + wait * 1000).toLocaleTimeString();
        console.warn(
          `[${card.dotPath}] Rate limited (429). Retrying at ${retryAt}.`
        );
        debugLog(
          `[${card.dotPath}] Rate limited, waiting ${wait}s until ${retryAt}`
        );
        await waitWithCountdown(card.dotPath, wait, retryAt);
        i--;
        continue;
      }
    } catch (err) {
      console.error(
        `[${card.dotPath}] Claude invocation failed: ${err instanceof Error ? err.message : err}`
      );
      debugLogProcessError({
        dotPath: card.dotPath,
        command: "claude",
        args: invokeArgs,
        error: err,
      });
      break;
    }

    let afterContent = deps.fs.readFileSync(cardFile, "utf-8");
    const changed = beforeContent !== afterContent;

    results.push({
      cardFile,
      changed,
      beforeContent,
      afterContent,
      iterationNumber: i + 1,
    });

    if (!changed) {
      console.log(
        `[${card.dotPath}] No changes detected — card has converged. Exiting loop.`
      );
      break;
    }

    const postCard = parseCard(cardFile, afterContent);

    // Gate checking: only when a phase transition is detected
    const beforePhase = card.status;
    const afterPhase = postCard.status;
    if (
      isPhase(beforePhase) &&
      isPhase(afterPhase) &&
      beforePhase !== afterPhase
    ) {
      const gateResult = runGateForTransition(
        beforePhase as LeafPhase,
        afterPhase as LeafPhase,
        postCard,
        (p: string) => deps.fs.existsSync(p),
      );

      if (!gateResult.pass) {
        const violationMessages = gateResult.violations
          .map((v) => `- [${v.check}] ${v.message}`)
          .join("\n");

        if (gateMode === "blocking") {
          // Revert the transition
          deps.fs.writeFileSync(cardFile, beforeContent);
          afterContent = beforeContent;
          console.error(
            `[${card.dotPath}] Gate BLOCKED transition ${beforePhase}→${afterPhase}:\n${violationMessages}`
          );
        } else {
          // Advisory: log warnings but allow the transition
          console.warn(
            `[${card.dotPath}] Gate advisory warnings for ${beforePhase}→${afterPhase}:\n${violationMessages}`
          );
        }

        gateContext = `Transition ${beforePhase}→${afterPhase} had gate violations:\n${violationMessages}`;
      }
    }

    const postAllCards = discoverCards(planDir, deps.fs);
    const postErrors = checkReferenceIntegrity(postCard, postAllCards);
    if (postErrors.length > 0) {
      console.warn(
        `[${card.dotPath}] Post-iteration reference integrity warnings:\n  ${postErrors.join("\n  ")}`
      );
    }

    console.log(`[${card.dotPath}] Card updated.`);
  }

  return results;
}

export interface ParsedOutput {
  costUsd?: number;
  rateLimited: boolean;
  retryAfterSecs?: number;
  resetsAt?: number;
  result?: string;
}

/**
 * Parse Claude Code JSON output, handling rate limit (429) responses.
 */
export function parseClaudeOutput(output: string | null): ParsedOutput {
  if (!output?.trim()) {
    return { rateLimited: false };
  }

  try {
    const json = JSON.parse(output);

    if (json.type === "rate_limit_event") {
      const resetsAt =
        typeof json.rate_limit_info?.resetsAt === "number"
          ? json.rate_limit_info.resetsAt
          : undefined;
      return {
        rateLimited: true,
        retryAfterSecs:
          resetsAt !== undefined
            ? Math.max(0, Math.ceil((resetsAt * 1000 - Date.now()) / 1000))
            : 60,
        resetsAt,
      };
    }

    if (json.error && json.error.type === "rate_limit_error") {
      return {
        rateLimited: true,
        retryAfterSecs: json.error.retry_after ?? 60,
      };
    }

    if (json.error && json.error.type === "overloaded_error") {
      return {
        rateLimited: true,
        retryAfterSecs: json.error.retry_after ?? 30,
      };
    }

    const result: ParsedOutput = { rateLimited: false };
    if (json.cost_usd !== undefined) {
      result.costUsd = json.cost_usd;
    }
    if (json.result) {
      result.result = String(json.result);
    }
    return result;
  } catch {
    return { rateLimited: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitWithCountdown(
  dotPath: string,
  totalSecs: number,
  retryAt: string
): Promise<void> {
  const endMs = Date.now() + totalSecs * 1000;
  let wroteInteractiveLine = false;

  while (true) {
    const remainingMs = endMs - Date.now();
    if (remainingMs <= 0) break;

    const remainingSecs = Math.ceil(remainingMs / 1000);
    const message = `[${dotPath}] Rate limited. Retrying in ${formatCountdown(remainingSecs)} (at ${retryAt})`;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${message.padEnd(100)}`);
      wroteInteractiveLine = true;
    } else {
      console.warn(message);
    }

    await sleep(Math.min(1000, remainingMs));
  }

  if (wroteInteractiveLine) {
    process.stdout.write("\n");
  }
}

function formatCountdown(totalSecs: number): string {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m${secs.toString().padStart(2, "0")}s`;
}
