import { createHash } from "node:crypto";
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
  claude_memory: string | null;
  claude_project_name: string | null;
  contexts: Record<string, { path: string; root: string; memory_root: string }>;
};
type Context = {
  project: MemoryProject;
  agent?: MemoryAgent;
  env: HostEnvironment;
};
type Candidate = Omit<
  MemorySource,
  "id" | "harnesses" | "details" | "project_ids" | "agent_ids" | "state"
>;
export type MemoryAdapter = {
  harness: MemoryHarness;
  candidates(context: Context): Candidate[];
};
const file = (
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
const directory = (
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

function ancestors(cwd: string, stop?: string): string[] {
  const values: string[] = [];
  for (let current = cwd; values.length < 32; current = path.dirname(current)) {
    values.unshift(current);
    if (current === stop || current === path.dirname(current)) break;
  }
  return values;
}
const context = ({ project, agent, env }: Context) =>
  env.contexts[agent?.path ?? project.path]!;

const claude: MemoryAdapter = {
  harness: "claude",
  candidates(c) {
    const { env } = c;
    const at = context(c);
    const name =
      env.claude_project_name &&
      /^[A-Za-z0-9._-]{1,200}$/.test(env.claude_project_name)
        ? env.claude_project_name
        : at.memory_root.replace(/[^a-zA-Z0-9]/g, "-");
    return [
      file(
        path.join(env.claude, "CLAUDE.md"),
        "user",
        "User instructions; imports and harness settings may change loading",
      ),
      directory(
        path.join(env.claude, "rules"),
        "user",
        "rules",
        "User rules; path frontmatter controls applicability",
      ),
      ...ancestors(at.path).flatMap((root) => [
        file(
          path.join(root, "CLAUDE.md"),
          "project",
          "Ancestor instructions; imports are not expanded",
        ),
        file(
          path.join(root, "CLAUDE.local.md"),
          "project",
          "Local ancestor instructions",
        ),
        file(
          path.join(root, ".claude/CLAUDE.md"),
          "project",
          "Project instructions",
        ),
        file(
          path.join(root, "AGENTS.md"),
          "project",
          "Claude fallback when no CLAUDE.md or CLAUDE.local.md loads; version and settings decide availability",
        ),
      ]),
      directory(
        path.join(at.root, ".claude/rules"),
        "project",
        "rules",
        "Project rules; path frontmatter controls applicability",
      ),
      {
        ...directory(
          env.claude_memory ??
            path.join(env.claude, "projects", name, "memory"),
          "project",
          "memory",
          "Default project memory or user-settings override; MEMORY.md is the startup index",
        ),
        load: "startup-candidate",
      },
      directory(
        path.join(at.root, ".claude/agent-memory"),
        "agent",
        "memory",
        "Named subagent memory; subagent configuration decides loading",
      ),
      directory(
        path.join(at.root, ".claude/agent-memory-local"),
        "agent",
        "memory",
        "Local named subagent memory; subagent configuration decides loading",
      ),
      directory(
        path.join(env.claude, "agent-memory"),
        "agent",
        "memory",
        "User named subagent memory; subagent configuration decides loading",
      ),
    ];
  },
};
const codex: MemoryAdapter = {
  harness: "codex",
  candidates(c) {
    const at = context(c);
    const instructions = (root: string, scope: Candidate["scope"]) => [
      file(
        path.join(root, "AGENTS.override.md"),
        scope,
        "First nonempty file takes precedence over AGENTS.md",
      ),
      file(
        path.join(root, "AGENTS.md"),
        scope,
        "Loads if no nonempty override; custom fallback filenames are not expanded",
      ),
    ];
    return [
      ...instructions(c.env.codex, "user"),
      ...ancestors(at.path, at.root).flatMap((root) =>
        instructions(root, "project"),
      ),
      directory(
        path.join(c.env.codex, "memories"),
        "user",
        "memory",
        "Generated v1 recall; per-chat controls decide use; harness may regenerate edits",
      ),
      directory(
        path.join(c.env.codex, "memories_v2"),
        "user",
        "memory",
        "Generated v2 Markdown recall; database state is excluded; harness may regenerate edits",
      ),
    ];
  },
};
const pi: MemoryAdapter = {
  harness: "pi",
  candidates(c) {
    const at = context(c);
    return [
      file(path.join(c.env.pi, "AGENTS.md"), "user", "Pi user instructions"),
      ...ancestors(at.path).map((root) =>
        file(
          path.join(root, "AGENTS.md"),
          "project",
          "Pi ancestor instructions",
        ),
      ),
    ];
  },
};
export const MEMORY_ADAPTERS: readonly MemoryAdapter[] = [claude, codex, pi];

export function memorySources(
  projects: MemoryProject[],
  agents: MemoryAgent[],
  env: HostEnvironment,
): MemorySource[] {
  const sources = new Map<string, MemorySource>();
  for (const project of projects) {
    // Empty projects still expose every supported harness's project sources.
    const subjects = agents.filter((agent) => agent.project_id === project.id);
    const contexts: Array<{ agent?: MemoryAgent; adapter: MemoryAdapter }> =
      subjects.flatMap((agent) =>
        MEMORY_ADAPTERS.filter(
          (adapter) => adapter.harness === agent.harness,
        ).map((adapter) => ({ agent, adapter })),
      );
    for (const adapter of MEMORY_ADAPTERS) contexts.push({ adapter });
    for (const { agent, adapter } of contexts) {
      if (!env.contexts[agent?.path ?? project.path]) continue;
      for (const candidate of adapter.candidates({ project, agent, env })) {
        const key = candidate.path;
        let source = sources.get(key);
        if (!source) {
          source = {
            ...candidate,
            id: createHash("sha256").update(key).digest("hex").slice(0, 24),
            harnesses: [],
            details: {},
            project_ids: [],
            agent_ids: [],
            state: "missing",
          };
          sources.set(key, source);
        }
        if (!source.harnesses.includes(adapter.harness))
          source.harnesses.push(adapter.harness);
        source.details[adapter.harness] = candidate.description;
        if (!source.project_ids.includes(project.id))
          source.project_ids.push(project.id);
        if (agent && !source.agent_ids.includes(agent.id))
          source.agent_ids.push(agent.id);
      }
    }
  }
  return [...sources.values()];
}
