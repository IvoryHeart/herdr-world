import { sshCommandArgv } from "../bridge/ssh-command";
import type { RunProcessWithCodeTimeout } from "../workspace/file-types";

export type WorktreeGitRoot = {
  canonicalRoot: string;
  gitCommonDir: string;
  gitIdentity?: string;
  branch: string | null;
  head?: string;
};
export type ListedWorktree = {
  path: string;
  branch: string | null;
  bare?: boolean;
  prunable?: boolean;
};

export function parseWorktreeList(output: string): ListedWorktree[] {
  const result: ListedWorktree[] = [];
  let current: ListedWorktree | undefined;
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) {
      current = { path: field.slice(9), branch: null };
      result.push(current);
    } else if (current) {
      if (field.startsWith("branch refs/heads/"))
        current.branch = field.slice(18);
      else if (field === "bare") current.bare = true;
      else if (field.startsWith("prunable")) current.prunable = true;
    }
  }
  return result;
}

/** Both canonical paths are computed by the target filesystem, including SSH. */
export function createWorktreeGit(args: {
  sshHost(): string | undefined;
  shQuote(value: string): string;
  runProcessWithCodeTimeout: RunProcessWithCodeTimeout;
}) {
  const run = (command: string) =>
    args.runProcessWithCodeTimeout(
      args.sshHost()
        ? sshCommandArgv(args.sshHost()!, command)
        : ["sh", "-lc", command],
      8_000,
    );
  return {
    async inspect(path: string): Promise<WorktreeGitRoot | null> {
      if (!path.startsWith("/") || path.includes("\0")) return null;
      const result = await run(`cd -P ${args.shQuote(path)} || exit 1
root=$(git rev-parse --show-toplevel) || exit 1
cd -P "$root" || exit 1
root=$(pwd -P) || exit 1
common=$(git rev-parse --git-common-dir) || exit 1
common=$(cd -P "$common" && pwd -P) || exit 1
branch=$(git symbolic-ref --quiet --short HEAD) || branch=
head=$(git rev-parse --verify HEAD 2>/dev/null) || head=
identity=$(stat -Lc '%d:%i:%w' "$root" "$common" 2>/dev/null || stat -f '%d:%i:%B' "$root" "$common" 2>/dev/null) || exit 1
printf '%s\\0%s\\0%s\\0%s\\0%s\\0' "$root" "$common" "$branch" "$head" "$identity"`);
      if (result.code !== 0) return null;
      const [canonicalRoot, gitCommonDir, branch, head, gitIdentity] =
        result.stdout.split("\0");
      if (!canonicalRoot?.startsWith("/") || !gitCommonDir?.startsWith("/"))
        return null;
      return {
        canonicalRoot,
        gitCommonDir,
        ...(gitIdentity ? { gitIdentity } : {}),
        branch: branch || null,
        ...(head ? { head } : {}),
      };
    },
    async list(root: string): Promise<ListedWorktree[]> {
      const result = await run(
        `git -C ${args.shQuote(root)} worktree list --porcelain -z`,
      );
      if (result.code !== 0) return [];
      return parseWorktreeList(result.stdout);
    },
  };
}
