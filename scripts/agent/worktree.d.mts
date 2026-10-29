export type WorktreeEntry = {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
};

export function listWorktrees(cwd?: string): WorktreeEntry[];

export function pruneWorktree(
  path: string,
  options?: { cwd?: string; dryRun?: boolean; now?: number },
): { path: string; action: "keep" | "strip" | "remove"; reason: string };
