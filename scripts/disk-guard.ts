import { statfsSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Heavy local checks build bundles, unpack checkers and start Chrome; on a
 * nearly full disk they fail halfway with ENOSPC and leave debris. They now
 * refuse to start below a free-space floor on the checkout's filesystem and
 * on the temporary directory (HERDR_WORLD_MIN_FREE_GB, default 3; 0 turns
 * the guard off). CI runners have their own disks and skip it.
 */
export const DEFAULT_MIN_FREE_GB = 3;

export function freeBytes(path: string): number {
  const stats = statfsSync(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

export function diskSpaceProblems(
  paths: string[],
  env: Record<string, string | undefined> = process.env,
  free: (path: string) => number = freeBytes,
): string[] {
  if (env.CI === "true") return [];
  const configured = env.HERDR_WORLD_MIN_FREE_GB;
  const floorGb =
    configured !== undefined &&
    configured.trim() !== "" &&
    Number.isFinite(Number(configured))
      ? Number(configured)
      : DEFAULT_MIN_FREE_GB;
  if (floorGb <= 0) return [];
  const problems: string[] = [];
  for (const path of [...new Set(paths)]) {
    const gb = free(path) / 2 ** 30;
    if (gb < floorGb)
      problems.push(
        `${path} has ${gb.toFixed(1)} GB free (needs ${floorGb} GB)`,
      );
  }
  return problems;
}

/** Print why and exit before a heavy check starts on a nearly full disk. */
export function guardDiskSpace(what: string, root = process.cwd()) {
  const problems = diskSpaceProblems([root, tmpdir()]);
  if (!problems.length) return;
  console.error(
    `[disk] not starting ${what}: ${problems.join("; ")}. Free space (for example \`bun run agent:worktree -- prune\` for merged worktrees), or set HERDR_WORLD_MIN_FREE_GB to change the floor.`,
  );
  process.exit(75); // EX_TEMPFAIL: try again once there is room
}
