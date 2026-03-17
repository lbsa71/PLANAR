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
  const canFastForward = await git
    .run(["merge-base", "--is-ancestor", "HEAD", remoteBranch])
    .then(() => true)
    .catch(() => false);

  // 5. Capture diff before pulling/merging
  //    For diverged branches, use merge-base to find common ancestor for the diff
  let diffBase: string;
  if (canFastForward) {
    diffBase = "HEAD";
  } else {
    diffBase = (
      await git.run(["merge-base", "HEAD", remoteBranch])
    ).trim();
  }

  const diff = (await git.run(["diff", `${diffBase}..${remoteBranch}`])).trim();

  // 6. Capture changed files
  const nameOnly = (
    await git.run(["diff", "--name-only", `${diffBase}..${remoteBranch}`])
  ).trim();
  const changedFiles = nameOnly
    .split("\n")
    .filter((f) => f.length > 0);

  // 7. Pull or merge
  if (canFastForward) {
    try {
      await git.run(["pull", "--ff-only"]);
    } catch (err) {
      return {
        status: "diverged",
        warning: `git pull --ff-only failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return { status: "pulled", diff, changedFiles };
  }

  // 8. Diverged — attempt a merge commit
  try {
    await git.run([
      "merge",
      remoteBranch,
      "-m",
      `chore(planar): merge ${remoteBranch} into ${branchName}`,
    ]);
  } catch (err) {
    // Merge conflict or other failure — abort and report
    try {
      await git.run(["merge", "--abort"]);
    } catch {
      // ignore abort failure
    }
    return {
      status: "diverged",
      warning: `Local branch '${branchName}' has diverged from ${remoteBranch}. Merge failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { status: "merged", diff, changedFiles };
}
