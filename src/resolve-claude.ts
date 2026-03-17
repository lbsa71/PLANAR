import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolve the absolute path to the `claude` CLI binary.
 * Caches the result after first resolution.
 *
 * Resolution order:
 * 1. CLAUDE_PATH environment variable (explicit override)
 * 2. `where claude` on Windows / `which claude` on Unix
 * 3. Common install locations
 */
let cachedPath: string | null = null;

export function resolveClaudePath(): string {
  if (cachedPath) return cachedPath;

  // 1. Environment variable override
  if (process.env.CLAUDE_PATH) {
    if (fs.existsSync(process.env.CLAUDE_PATH)) {
      cachedPath = process.env.CLAUDE_PATH;
      return cachedPath;
    }
  }

  // 2. System PATH lookup
  try {
    const cmd = process.platform === "win32" ? "where claude" : "which claude";
    const result = execSync(cmd, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // `where` on Windows may return multiple lines; take the first
    const firstLine = result.split("\n")[0].trim();
    if (firstLine && fs.existsSync(firstLine)) {
      cachedPath = firstLine;
      return cachedPath;
    }
  } catch {
    // Not on PATH — try common locations
  }

  // 3. Common install locations
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env.USERPROFILE ?? "",
            ".local",
            "bin",
            "claude.exe"
          ),
          path.join(
            process.env.LOCALAPPDATA ?? "",
            "Programs",
            "claude",
            "claude.exe"
          ),
          path.join(process.env.APPDATA ?? "", "npm", "claude.cmd"),
        ]
      : [
          path.join(process.env.HOME ?? "", ".local", "bin", "claude"),
          "/usr/local/bin/claude",
          "/usr/bin/claude",
        ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      cachedPath = candidate;
      return cachedPath;
    }
  }

  throw new Error(
    `Cannot find 'claude' CLI. Searched PATH and common locations.\n` +
      `Set CLAUDE_PATH environment variable to the full path of the claude binary.`
  );
}
