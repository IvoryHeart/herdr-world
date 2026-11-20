import { posix as path } from "node:path";
import type {
  MemoryAgent,
  MemoryHarness,
  MemoryProject,
  MemorySource,
} from "../../../shared/memory";

export type HostEnvironment = {
  home: string;
  codex: string;
  claude: string;
  pi: string;
  config_home?: string;
  copilot?: string;
  hermes?: string;
  kimi?: string;
  qwen?: string;
  claude_memory: string | null;
  claude_project_name: string | null;
  contexts: Record<string, { path: string; root: string; memory_root: string }>;
};
export type Context = {
  project: MemoryProject;
  agent?: MemoryAgent;
  env: HostEnvironment;
};
export type Candidate = Omit<
  MemorySource,
  "id" | "harnesses" | "details" | "project_ids" | "agent_ids" | "state"
>;
export type MemoryAdapter = {
  harness: MemoryHarness;
  candidates(context: Context): Candidate[];
};
export const file = (
  value: string,
  scope: Candidate["scope"],
  description: string,
): Candidate => ({
  path: value,
  shape: "file",
  kind: "instructions",
  scope,
  load: "startup-candidate",
  description,
});
export const directory = (
  value: string,
  scope: Candidate["scope"],
  kind: "memory" | "rules",
  description: string,
): Candidate => ({
  path: value,
  shape: "directory",
  kind,
  scope,
  load: kind === "memory" ? "on-demand" : "startup-candidate",
  description,
});

export function ancestors(cwd: string, stop?: string): string[] {
  const values: string[] = [];
  for (let current = cwd; values.length < 32; current = path.dirname(current)) {
    values.unshift(current);
    if (current === stop || current === path.dirname(current)) break;
  }
  return values;
}
export const context = ({ project, agent, env }: Context) =>
  env.contexts[agent?.path ?? project.path]!;

// Defaults only: imports, configured extra files and per-process overrides are not expanded.
export const files = (
  root: string,
  names: string[],
  scope: Candidate["scope"],
  description: string,
) => names.map((name) => file(path.join(root, name), scope, description));
export const rules = (
  root: string,
  scope: Candidate["scope"],
  description: string,
): Candidate => ({
  ...directory(root, scope, "rules", description),
  load: "on-demand",
});
export const configHome = (env: HostEnvironment) =>
  env.config_home ?? path.join(env.home, ".config");
