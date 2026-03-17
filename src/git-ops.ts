import type { GitRunner, FetchResult } from "./types.js";

/**
 * Fetch from origin, detect if behind, capture diff, and pull with --ff-only.
 *
 * @param git - Injected git command runner
 * @param branch - Explicit branch name; auto-detected if omitted
 * @returns Discriminated union: up-to-date | pulled | diverged
 */
export async function fetchDetectPull(
  git: GitRunner,
  branch?: string
): Promise<FetchResult> {
  // 1. Resolve branch
  const branchName =
    branch ?? (await git.run(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const remoteBranch = `origin/${branchName}`;

  // 2. Fetch
  await git.run(["fetch", "origin"]);

  // 3. Compare HEAD to remote
  const localSha = (await git.run(["rev-parse", "HEAD"])).trim();
  const remoteSha = (await git.run(["rev-parse", remoteBranch])).trim();

  if (localSha === remoteSha) {
    return { status: "up-to-date" };
  }

  // 4. Check fast-forward possibility
  try {
    await git.run(["merge-base", "--is-ancestor", "HEAD", remoteBranch]);
  } catch {
    return {
      status: "diverged",
      warning: `Local branch '${branchName}' has diverged from ${remoteBranch}. Cannot fast-forward.`,
    };
  }

  // 5. Capture diff before pulling
  const diff = (await git.run(["diff", `HEAD..${remoteBranch}`])).trim();

  // 6. Capture changed files
  const nameOnly = (
    await git.run(["diff", "--name-only", `HEAD..${remoteBranch}`])
  ).trim();
  const changedFiles = nameOnly
    .split("\n")
    .filter((f) => f.length > 0);

  // 7. Pull
  try {
    await git.run(["pull", "--ff-only"]);
  } catch (err) {
    return {
      status: "diverged",
      warning: `git pull --ff-only failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 8. Return
  return { status: "pulled", diff, changedFiles };
}
