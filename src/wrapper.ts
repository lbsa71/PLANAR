import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { parseCard, discoverCards, checkReferenceIntegrity } from "./card.js";
import { debugLog, debugLogProcessError } from "./debug-log.js";
import { dotPathToGuid } from "./guid.js";
import { generateSystemPrompt } from "./system-prompt.js";
import {
  ClaudeInvoker,
  FileSystem,
  IterationResult,
  WrapperConfig,
} from "./types.js";

/** Default FileSystem using node:fs */
const nodeFs: FileSystem = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, c) => fs.writeFileSync(p, c),
  existsSync: (p) => fs.existsSync(p),
  readdirSync: (p) => fs.readdirSync(p) as string[],
};

/** Default ClaudeInvoker using execFileSync */
const defaultClaude: ClaudeInvoker = {
  invoke(args: string[], timeoutMs: number): string | null {
    try {
      return execFileSync("claude", args, {
        stdio: ["pipe", "pipe", "inherit"],
        encoding: "utf-8",
        timeout: timeoutMs,
        shell: true,
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
  const results: IterationResult[] = [];
  let accumulatedCost = 0;

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
    const systemPrompt = generateSystemPrompt(card, rootPlanFile);

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
        console.warn(
          `[${card.dotPath}] Rate limited (429). Waiting ${wait}s...`
        );
        debugLog(`[${card.dotPath}] Rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
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

    const afterContent = deps.fs.readFileSync(cardFile, "utf-8");
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
