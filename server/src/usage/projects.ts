import { basename } from "node:path";
import type { UsageProject } from "../../../shared/usageAnalytics";
import { createWorktreeGit } from "../agent/worktree-git";
import { usageProject } from "./analytics";

/** Bounded numeric attribution cache; path keys never leave this service. */
export function createUsageProjects(deps: {
  git(
    connection: string,
    generation: number,
  ): Pick<ReturnType<typeof createWorktreeGit>, "inspect"> | null;
  current(connection: string, generation: number): boolean;
  now(): number;
}) {
  const cache = new Map<string, { at: number; value: UsageProject | null }>();
  return async (connection: string, generation: number, path: string) => {
    if (!deps.current(connection, generation)) return null;
    const key = JSON.stringify([connection, generation, path]),
      now = deps.now();
    const known = cache.get(key);
    if (known && now - known.at < 120_000) return known.value;
    const git = deps.git(connection, generation);
    if (!git) return null;
    const root = await git.inspect(path).catch(() => null);
    if (!deps.current(connection, generation)) return null;
    const value = root
      ? usageProject(
          connection,
          generation,
          root.gitCommonDir,
          basename(root.canonicalRoot),
        )
      : null;
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now, value });
    return value;
  };
}
