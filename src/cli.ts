#!/usr/bin/env node

import { runCardLoop } from "./wrapper.js";
import { Orchestrator } from "./orchestrator.js";
import {
  discoverCards,
  isPhase,
  formatStatus,
  checkReferenceIntegrity,
} from "./card.js";
import type { CardStatus } from "./types.js";

function printUsage(): void {
  console.log(`PLANAR — Plan-Level Adaptive Narrowing And Refinement

Usage:
  planar <card-file>              Run the Ralph Wiggum loop on a single card
  planar orchestrate <root-file>  Run full orchestration with parallel agents
  planar status [plan-dir]        Show status of all cards

Options:
  --max-iterations <n>     Max iterations per card (default: 50)
  --max-agents <n>         Max parallel agents (default: 8)
  --max-cost <dollars>     Max cost budget in dollars (default: unlimited)
  --plan-dir <dir>         Plan directory (default: plan)
  --root <file>            Root plan file (default: plan/root.md)
  --help                   Show this help message`);
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
      if (arg === "orchestrate" || arg === "status") {
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
  const planDir = options["plan-dir"] ?? "plan";
  const rootFile = options["root"] ?? "plan/root.md";
  const maxIterations = parseInt(options["max-iterations"] ?? "50", 10);
  const maxAgents = parseInt(options["max-agents"] ?? "8", 10);
  const maxCost = options["max-cost"]
    ? parseFloat(options["max-cost"])
    : Infinity;

  switch (command) {
    case "run": {
      if (!target) {
        console.error("Error: No card file specified.");
        printUsage();
        process.exit(1);
      }
      console.log(`Running card loop on: ${target}`);
      const results = await runCardLoop(target, {
        maxIterations,
        rootPlanFile: rootFile,
        planDir,
        maxCostDollars: maxCost,
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

      // Reference integrity check
      const allErrors: { dotPath: string; errors: string[] }[] = [];
      for (const card of cards) {
        const errors = checkReferenceIntegrity(card, cards);
        if (errors.length > 0) {
          allErrors.push({ dotPath: card.dotPath, errors });
        }
      }
      if (allErrors.length > 0) {
        console.log("\nReference integrity errors:");
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
