#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCardLoop } from "./wrapper.js";
import { Orchestrator } from "./orchestrator.js";
import {
  discoverCards,
  isPhase,
  formatStatus,
  checkReferenceIntegrity,
} from "./card.js";
import { fetchDetectPull } from "./git-ops.js";
import { findAffectedCards, createImpactCard } from "./impact.js";
import { invalidateCards } from "./invalidation.js";
import { debugLogBanner } from "./debug-log.js";
import {
  checkTreeIntegrity,
  applyIntegrityResults,
  formatIntegrityReport,
} from "./integrity.js";
import type { CardStatus, GitRunner, FileSystem } from "./types.js";

const execFileAsync = promisify(execFile);

const nodeFs: FileSystem = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, c) => fs.writeFileSync(p, c),
  existsSync: (p) => fs.existsSync(p),
  readdirSync: (p) => fs.readdirSync(p) as string[],
};

function makeGitRunner(cwd?: string): GitRunner {
  return {
    async run(args: string[]): Promise<string> {
      const { stdout } = await execFileAsync("git", args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    },
  };
}

function printUsage(): void {
  console.log(`PLANAR — Plan-Level Adaptive Narrowing And Refinement

Usage:
  planar <card-file>              Run the Ralph Wiggum loop on a single card
  planar orchestrate <root-file>  Run full orchestration with parallel agents
  planar status [plan-dir]        Show status of all cards
  planar integrity [plan-dir]     Check tree integrity and codebase compliance
  planar watch [plan-dir]         Git watch mode — monitor upstream for changes

Options:
  --cwd <dir>                    Set working directory (default: current directory)
  --max-iterations <n>           Max iterations per card (default: 50)
  --max-agents <n>               Max parallel agents (default: 8)
  --max-cost <dollars>           Max cost budget in dollars (default: unlimited)
  --plan-dir <dir>               Plan directory (default: plan)
  --root <file>                  Root plan file (default: plan/root.md)
  --integrity-interval <secs>    Integrity check interval during orchestration (default: 0/disabled)
  --interval <seconds>           Git watch poll interval (default: 30)
  --branch <name>                Git watch branch to track
  --regress                      (integrity) Regress DONE cards with issues to PLAN/REVIEW
  --gate-mode <mode>             Gate enforcement: "blocking" (default) or "advisory"
  --no-scan-src                  (integrity) Skip unowned source file detection
  --src-dir <dir>                (integrity) Source directory to scan (default: src)
  --help                         Show this help message`);
}

function parseArgs(args: string[]): {
  command: string;
  target: string;
  options: Record<string, string>;
} {
  const options: Record<string, string> = {};
  let command = "";
  let target = "";

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        options[key] = val;
        i += 2;
      } else {
        options[key] = "true";
        i++;
      }
    } else if (!command) {
      if (arg === "orchestrate" || arg === "status" || arg === "watch" || arg === "integrity") {
        command = arg;
      } else {
        command = "run";
        target = arg;
      }
      i++;
    } else if (!target) {
      target = arg;
      i++;
    } else {
      i++;
    }
  }

  return { command, target, options };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  const { command, target, options } = parseArgs(args);

  // --cwd: change working directory before anything else
  if (options["cwd"]) {
    process.chdir(options["cwd"]);
    console.log(`[planar] Working directory: ${options["cwd"]}`);
  }

  debugLogBanner(`${command} ${target || ""}`);

  const planDir = options["plan-dir"] ?? "plan";
  const rootFile = options["root"] ?? "plan/root.md";
  const maxIterations = parseInt(options["max-iterations"] ?? "50", 10);
  const maxAgents = parseInt(options["max-agents"] ?? "8", 10);
  const maxCost = options["max-cost"]
    ? parseFloat(options["max-cost"])
    : Infinity;
  const integrityInterval = parseInt(options["integrity-interval"] ?? "0", 10);

  if (isNaN(maxIterations) || maxIterations < 1) {
    console.error(`Error: --max-iterations must be a positive integer (got: ${options["max-iterations"]})`);
    printUsage();
    process.exit(1);
  }
  if (isNaN(maxAgents) || maxAgents < 1) {
    console.error(`Error: --max-agents must be a positive integer (got: ${options["max-agents"]})`);
    printUsage();
    process.exit(1);
  }
  if (isNaN(maxCost) || maxCost <= 0) {
    console.error(`Error: --max-cost must be a positive number (got: ${options["max-cost"]})`);
    printUsage();
    process.exit(1);
  }

  switch (command) {
    case "run": {
      if (!target) {
        console.error("Error: No card file specified.");
        printUsage();
        process.exit(1);
      }
      const gateMode = options["gate-mode"] === "advisory" ? "advisory" as const : "blocking" as const;
      console.log(`Running card loop on: ${target} (gate-mode: ${gateMode})`);
      const results = await runCardLoop(target, {
        maxIterations,
        rootPlanFile: rootFile,
        planDir,
        maxCostDollars: maxCost,
        gateMode,
      });
      console.log(`\nCompleted ${results.length} iteration(s).`);
      const lastChanged = results.filter((r) => r.changed).length;
      console.log(`  ${lastChanged} iteration(s) made changes.`);
      break;
    }

    case "orchestrate": {
      const rootPlanFile = target || rootFile;
      console.log(`Orchestrating from: ${rootPlanFile}`);
      const orchestrator = new Orchestrator({
        maxParallelAgents: maxAgents,
        maxIterationsPerCard: maxIterations,
        rootPlanFile,
        planDir,
        integrityIntervalSeconds: integrityInterval,
      });
      await orchestrator.run();
      break;
    }

    case "status": {
      const dir = target || planDir;
      const cards = discoverCards(dir);
      if (cards.length === 0) {
        console.log(`No cards found in ${dir}/`);
        break;
      }

      console.log(`\nPLANAR Status — ${cards.length} card(s) in ${dir}/\n`);
      console.log(
        "Dot-Path".padEnd(12) +
          "Status".padEnd(24) +
          "Type".padEnd(8) +
          "Title"
      );
      console.log("─".repeat(76));

      cards.sort((a, b) => compareDotPaths(a.dotPath, b.dotPath));

      for (const card of cards) {
        const status = isPhase(card.status)
          ? card.status
          : formatStatus(card.status);
        const type = card.isNode ? "Node" : "Leaf";
        const indent = "  ".repeat(card.dotPath.split(".").length - 1);
        console.log(
          `${indent}${card.dotPath}`.padEnd(12) +
            `[${status}]`.padEnd(24) +
            type.padEnd(8) +
            card.title
        );
      }

      // Show blocked/conflict relationships
      const blocked = cards.filter(
        (c) => typeof c.status !== "string" && c.status.kind === "BLOCKED-BY"
      );
      const conflicts = cards.filter(
        (c) =>
          typeof c.status !== "string" && c.status.kind === "CONFLICTS-WITH"
      );

      if (blocked.length > 0) {
        console.log("\nBlocked cards:");
        for (const card of blocked) {
          const s = card.status as { kind: string; dotPath: string };
          console.log(`  ${card.dotPath} blocked by ${s.dotPath}`);
        }
      }

      if (conflicts.length > 0) {
        console.log("\nConflicting cards:");
        const seen = new Set<string>();
        for (const card of conflicts) {
          const s = card.status as { kind: string; dotPath: string };
          const pair = [card.dotPath, s.dotPath].sort().join(" ↔ ");
          if (!seen.has(pair)) {
            seen.add(pair);
            console.log(`  ${pair}`);
          }
        }
      }

      // Link integrity check
      const allErrors: { dotPath: string; errors: string[] }[] = [];
      for (const card of cards) {
        const errors = checkReferenceIntegrity(card, cards);
        if (errors.length > 0) {
          allErrors.push({ dotPath: card.dotPath, errors });
        }
      }
      if (allErrors.length > 0) {
        console.log("\nLink integrity errors:");
        for (const { dotPath, errors } of allErrors) {
          for (const err of errors) {
            console.log(`  ${dotPath}: ${err}`);
          }
        }
      }

      // Summary
      const done = cards.filter((c) => c.status === "DONE").length;
      const nodes = cards.filter((c) => c.isNode).length;
      const leaves = cards.filter((c) => !c.isNode).length;
      console.log(
        `\n${done}/${cards.length} done — ${nodes} nodes, ${leaves} leaves`
      );
      break;
    }

    case "integrity": {
      const dir = target || planDir;
      const shouldRegress = options["regress"] === "true";
      const scanSrc = options["no-scan-src"] !== "true";
      const srcDir = options["src-dir"] ?? "src";

      const cards = discoverCards(dir);
      if (cards.length === 0) {
        console.log(`No cards found in ${dir}/`);
        break;
      }

      const report = checkTreeIntegrity(cards, process.cwd(), {
        scanSourceDir: scanSrc ? srcDir : undefined,
      });

      console.log(formatIntegrityReport(report));

      console.log("\nUpdating cards (last-integrity-check + revision history)…");
      const { updated, regressed } = applyIntegrityResults(
        report,
        cards,
        { regressProblematic: shouldRegress },
        nodeFs
      );
      console.log(`Updated ${updated} card(s).`);
      if (regressed.length > 0) {
        console.log("Regressed:");
        for (const r of regressed) console.log(`  ${r}`);
      }
      break;
    }

    case "watch": {
      const dir = target || planDir;
      const resolvedDir = path.resolve(dir);
      const interval = parseInt(options["interval"] ?? "30", 10);
      const branch = options["branch"];

      // Resolve the git repo root from the plan directory
      const { stdout: repoRoot } = await execFileAsync("git", [
        "-C",
        resolvedDir,
        "rev-parse",
        "--show-toplevel",
      ]);
      const repoCwd = repoRoot.trim();

      console.log(
        `[watch] Git watch mode on ${dir}/ (repo: ${repoCwd}) — polling every ${interval}s` +
          (branch ? ` (branch: ${branch})` : "")
      );

      const git = makeGitRunner(repoCwd);
      let running = true;

      const shutdown = () => {
        console.log("\n[watch] Shutting down...");
        running = false;
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      while (running) {
        try {
          const result = await fetchDetectPull(git, branch);

          switch (result.status) {
            case "up-to-date":
              // silent
              break;

            case "diverged":
              console.warn(`[watch] ${result.warning}`);
              break;

            case "merged":
            case "pulled": {
              if (result.status === "merged") {
                console.log(
                  `[watch] Merged diverged upstream — ${result.changedFiles.length} file(s) changed`
                );
              } else {
                console.log(
                  `[watch] Pulled upstream changes — ${result.changedFiles.length} file(s) changed`
                );
              }

              const affected = findAffectedCards(
                result.changedFiles,
                dir,
                nodeFs
              );

              if (affected.length === 0) {
                console.log("[watch] No cards affected by upstream changes.");
                break;
              }

              // Get commit range and diffstat for the impact card
              const localHead = (
                await git.run(["rev-parse", "HEAD"])
              ).trim();
              const diffstat = (
                await git.run([
                  "diff",
                  "--stat",
                  `${localHead}~1..${localHead}`,
                ])
              ).trim();
              const commitRange = `${localHead}~${result.changedFiles.length > 0 ? "1" : "0"}..${localHead}`;

              const impactPath = createImpactCard(
                commitRange,
                result.changedFiles,
                affected.map((c) => ({
                  dotPath: c.dotPath,
                  title: c.title,
                  filePath: c.filePath,
                })),
                diffstat,
                dir,
                nodeFs
              );
              console.log(`[watch] Created impact card: ${impactPath}`);

              const results = invalidateCards(
                affected,
                result.changedFiles,
                nodeFs
              );
              const modified = results.filter((r) => r.modified);
              if (modified.length > 0) {
                console.log(
                  `[watch] Invalidated ${modified.length} card(s):`
                );
                for (const r of modified) {
                  console.log(
                    `  ${r.dotPath}: ${r.previousStatus} → ${r.newStatus}`
                  );
                }
              }

              // Commit impact card + invalidated cards in the target repo
              const changedCardPaths = [
                impactPath,
                ...modified.map((r) => r.filePath),
              ];
              try {
                await git.run(["add", ...changedCardPaths]);
                const cardList = modified
                  .map((r) => `${r.dotPath} (${r.previousStatus}→${r.newStatus})`)
                  .join(", ");
                const msg = `chore(planar): upstream sync — ${modified.length} card(s) invalidated\n\n` +
                  `Impact card: ${path.basename(impactPath)}\n` +
                  `Invalidated: ${cardList || "none"}`;
                await git.run(["commit", "-m", msg]);
                console.log("[watch] Committed card changes to target repo.");
              } catch (commitErr) {
                console.error(
                  `[watch] Failed to commit: ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`
                );
              }
              break;
            }
          }
        } catch (err) {
          console.error(
            `[watch] Error during poll: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        // Sleep for the interval, but check running flag every second
        for (let s = 0; s < interval && running; s++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
