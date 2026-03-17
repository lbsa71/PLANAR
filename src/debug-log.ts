import * as fs from "node:fs";
import * as path from "node:path";
import { FileSystem } from "./types.js";

const MAX_LINES = 200;
const DEFAULT_LOG_FILE = "debug.log";

/** Default fs for debug logging */
const nodeFs = {
  appendFileSync: (p: string, data: string) => fs.appendFileSync(p, data),
  readFileSync: (p: string) => fs.readFileSync(p, "utf-8"),
  writeFileSync: (p: string, data: string) => fs.writeFileSync(p, data),
  existsSync: (p: string) => fs.existsSync(p),
};

export interface DebugLogDeps {
  appendFileSync(path: string, data: string): void;
  readFileSync(path: string): string;
  writeFileSync(path: string, data: string): void;
  existsSync(path: string): boolean;
}

/**
 * Log a restart banner with timestamp.
 */
export function debugLogBanner(
  command: string,
  logFile: string = DEFAULT_LOG_FILE,
  deps: DebugLogDeps = nodeFs
): void {
  const timestamp = new Date().toISOString();
  const banner = `\n${"=".repeat(60)}\n  PLANAR ${command} — started at ${timestamp}\n${"=".repeat(60)}\n`;
  deps.appendFileSync(logFile, banner);
  capLogFile(logFile, deps);
}

/**
 * Append a debug log entry, then cap the file at MAX_LINES.
 */
export function debugLog(
  message: string,
  logFile: string = DEFAULT_LOG_FILE,
  deps: DebugLogDeps = nodeFs
): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;

  deps.appendFileSync(logFile, entry);
  capLogFile(logFile, deps);
}

/**
 * Log a process error with full context (command, args, error, stdout, stderr).
 */
export function debugLogProcessError(
  context: {
    dotPath: string;
    command: string;
    args: string[];
    error: unknown;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
  },
  logFile: string = DEFAULT_LOG_FILE,
  deps: DebugLogDeps = nodeFs
): void {
  const lines: string[] = [
    `--- Process Error for ${context.dotPath} ---`,
    `Command: ${context.command} ${context.args.slice(0, 5).join(" ")}${context.args.length > 5 ? " ..." : ""}`,
  ];

  if (context.exitCode !== undefined) {
    lines.push(`Exit code: ${context.exitCode}`);
  }

  if (context.error instanceof Error) {
    lines.push(`Error: ${context.error.message}`);
    if ("code" in context.error) {
      lines.push(`Error code: ${(context.error as NodeJS.ErrnoException).code}`);
    }
    if ("path" in context.error) {
      lines.push(`Error path: ${(context.error as NodeJS.ErrnoException).path}`);
    }
  } else if (context.error) {
    lines.push(`Error: ${String(context.error)}`);
  }

  if (context.stdout) {
    lines.push(`Stdout (last 500 chars): ${context.stdout.slice(-500)}`);
  }

  if (context.stderr) {
    lines.push(`Stderr (last 500 chars): ${context.stderr.slice(-500)}`);
  }

  lines.push(`--- End Process Error ---`);

  debugLog(lines.join("\n"), logFile, deps);
}

/**
 * Cap a log file at MAX_LINES, keeping the most recent lines.
 */
function capLogFile(logFile: string, deps: DebugLogDeps): void {
  if (!deps.existsSync(logFile)) return;

  try {
    const content = deps.readFileSync(logFile);
    const lines = content.split("\n");
    if (lines.length > MAX_LINES) {
      const trimmed = lines.slice(lines.length - MAX_LINES).join("\n");
      deps.writeFileSync(logFile, trimmed);
    }
  } catch {
    // Best-effort capping — don't crash on log file issues
  }
}
