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
  config_home?: string;
  copilot?: string;
  hermes?: string;
  kimi?: string;
  qwen?: string;
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

// https://code.claude.com/docs/en/memory
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
// https://developers.openai.com/codex/guides/agents-md/
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
// https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#context-files
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
// Defaults only: imports, configured extra files and per-process overrides are not expanded.
const files = (
  root: string,
  names: string[],
  scope: Candidate["scope"],
  description: string,
) => names.map((name) => file(path.join(root, name), scope, description));
const rules = (
  root: string,
  scope: Candidate["scope"],
  description: string,
): Candidate => ({
  ...directory(root, scope, "rules", description),
  load: "on-demand",
});
const configHome = (env: HostEnvironment) =>
  env.config_home ?? path.join(env.home, ".config");

// https://opencode.ai/docs/instructions/
const opencode: MemoryAdapter = {
  harness: "opencode",
  candidates(c) {
    const at = context(c);
    const stop = at.path.startsWith(`${c.env.home}/`) ? c.env.home : at.root;
    return [
      file(
        path.join(configHome(c.env), "opencode/AGENTS.md"),
        "user",
        "OpenCode user instructions",
      ),
      file(
        path.join(c.env.claude, "CLAUDE.md"),
        "user",
        "OpenCode fallback when global AGENTS.md is absent; compatibility can be disabled",
      ),
      ...ancestors(at.path, stop).flatMap((root) => [
        file(
          path.join(root, "AGENTS.md"),
          "project",
          "OpenCode ancestor instructions",
        ),
        file(
          path.join(root, "CLAUDE.md"),
          "project",
          "OpenCode fallback when this directory has no AGENTS.md; compatibility can be disabled",
        ),
      ]),
    ];
  },
};

// https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
const copilot: MemoryAdapter = {
  harness: "copilot",
  candidates(c) {
    const at = context(c);
    const user = c.env.copilot ?? path.join(c.env.home, ".copilot");
    return [
      file(
        path.join(user, "copilot-instructions.md"),
        "user",
        "Copilot CLI personal instructions",
      ),
      rules(
        path.join(user, "instructions"),
        "user",
        "Copilot CLI *.instructions.md rules; applyTo controls matching files",
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          [
            "AGENTS.md",
            "CLAUDE.md",
            ".claude/CLAUDE.md",
            "GEMINI.md",
            ".github/copilot-instructions.md",
          ],
          "project",
          "Copilot CLI ancestor instructions; imports are not expanded",
        ),
      ),
      ...[...new Set([at.root, at.path])].map((root) =>
        rules(
          path.join(root, ".github/instructions"),
          "project",
          "Copilot CLI *.instructions.md rules; applyTo controls matching files",
        ),
      ),
    ];
  },
};

// https://cursor.com/docs/cli/using#rules and https://cursor.com/docs/rules
const cursor: MemoryAdapter = {
  harness: "cursor",
  candidates(c) {
    const at = context(c);
    return [
      ...files(
        at.root,
        ["AGENTS.md", "CLAUDE.md"],
        "project",
        "Cursor CLI project instructions",
      ),
      rules(
        path.join(at.root, ".cursor/rules"),
        "project",
        "Cursor .mdc rules; alwaysApply loads at start, other rules load by relevance, globs or mention",
      ),
    ];
  },
};

// https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/
// https://qwenlm.github.io/qwen-code-docs/en/users/features/rules/
// The documented per-project auto-memory key is opaque; do not guess it.
const qwen: MemoryAdapter = {
  harness: "qwen",
  candidates(c) {
    const at = context(c);
    return [
      file(
        path.join(c.env.qwen ?? path.join(c.env.home, ".qwen"), "QWEN.md"),
        "user",
        "Qwen Code user instructions",
      ),
      ...files(
        at.root,
        ["QWEN.md", "AGENTS.md", ".qwen/QWEN.local.md"],
        "project",
        "Qwen Code project instructions; local instructions supplement shared guidance",
      ),
      rules(
        path.join(c.env.qwen ?? path.join(c.env.home, ".qwen"), "rules"),
        "user",
        "Qwen Code rules; baseline rules load at start, paths frontmatter defers matching rules",
      ),
      rules(
        path.join(at.root, ".qwen/rules"),
        "project",
        "Qwen Code trusted project rules; paths frontmatter controls applicability",
      ),
      {
        ...directory(
          path.join(c.env.qwen ?? path.join(c.env.home, ".qwen"), "memories"),
          "user",
          "memory",
          "Qwen Code user memory; MEMORY.md is the startup index when memory is enabled",
        ),
        load: "startup-candidate",
      },
    ];
  },
};

// https://docs.factory.com/harness/agents-md
const droid: MemoryAdapter = {
  harness: "droid",
  candidates(c) {
    const at = context(c);
    const names = [
      "AGENTS.md",
      "agents.md",
      "Agents.md",
      "CLAUDE.md",
      "Claude.md",
    ];
    const dirs = [".factory", ".agents", ".agent"];
    return [
      ...dirs.flatMap((dir) =>
        files(
          path.join(c.env.home, dir),
          names,
          "user",
          "Droid personal instructions",
        ),
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        ["", ...dirs].flatMap((dir) =>
          files(
            path.join(root, dir),
            names,
            "project",
            "Droid ancestor instructions; deeper guidance refines root guidance",
          ),
        ),
      ),
    ];
  },
};

// https://moonshotai.github.io/kimi-cli/en/customization/agents.html#system-prompt-built-in-parameters
// https://moonshotai.github.io/kimi-code/en/customization/agents#instruction-files
const kimi: MemoryAdapter = {
  harness: "kimi",
  candidates(c) {
    const at = context(c);
    return [
      ...files(
        c.env.kimi ?? path.join(c.env.home, ".kimi-code"),
        ["AGENTS.md", "SYSTEM.md"],
        "user",
        "Kimi Code user instructions or default-agent system prompt override; version and template decide loading",
      ),
      file(
        path.join(c.env.home, ".agents/AGENTS.md"),
        "user",
        "Kimi Code shared user instructions",
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          ["AGENTS.md", ".kimi/AGENTS.md", ".kimi-code/AGENTS.md"],
          "project",
          "Kimi CLI root-to-cwd instructions; version and agent template decide inclusion",
        ),
      ),
    ];
  },
};

// https://github.com/can1357/oh-my-pi/blob/main/docs/config-usage.md
const omp: MemoryAdapter = {
  harness: "omp",
  candidates(c) {
    const at = context(c);
    const user = path.join(c.env.home, ".omp/agent");
    const native = (root: string, scope: Candidate["scope"]) => [
      ...files(
        root,
        ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md", "RULES.md"],
        scope,
        "oh-my-pi native instructions; profile, source toggles and nearest nonempty .omp directory decide loading",
      ),
      rules(
        path.join(root, "rules"),
        scope,
        "oh-my-pi .md/.mdc rules; rule configuration decides applicability",
      ),
      {
        ...rules(
          path.join(root, "instructions"),
          scope,
          "oh-my-pi instructions loaded when relevant",
        ),
        kind: "instructions" as const,
      },
    ];
    return [
      ...native(user, "user"),
      ...ancestors(at.path, at.root).flatMap((root) => [
        file(
          path.join(root, "AGENTS.md"),
          "project",
          "oh-my-pi ancestor context; subagents may exclude these files",
        ),
        ...native(path.join(root, ".omp"), "project"),
      ]),
    ];
  },
};

// https://kilo.ai/docs/customize/custom-instructions
const kilo: MemoryAdapter = {
  harness: "kilo",
  candidates(c) {
    const at = context(c);
    return [
      file(
        path.join(configHome(c.env), "kilo/AGENTS.md"),
        "user",
        "Kilo CLI global instructions",
      ),
      file(
        path.join(c.env.claude, "CLAUDE.md"),
        "user",
        "Kilo CLI compatibility fallback until Claude migration is attempted",
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"],
          "project",
          "Kilo CLI ancestor instructions; additional configured instructions are not expanded",
        ),
      ),
    ];
  },
};

// https://hermes-agent.nousresearch.com/docs/user-guide/which-file-does-what
const hermes: MemoryAdapter = {
  harness: "hermes",
  candidates(c) {
    const at = context(c);
    const user = c.env.hermes ?? path.join(c.env.home, ".hermes");
    return [
      file(
        path.join(user, "SOUL.md"),
        "user",
        "Hermes agent identity, loaded independently of project context",
      ),
      ...files(
        path.join(user, "memories"),
        ["MEMORY.md", "USER.md"],
        "user",
        "Hermes frozen memory snapshot at session start",
      ).map((source) => ({ ...source, kind: "memory" as const })),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          [".hermes.md", "HERMES.md", "AGENTS.md", "CLAUDE.md"],
          "project",
          "Hermes project context candidates; only the first matching context type loads",
        ),
      ),
    ];
  },
};

// https://docs.qoder.com/cli/memory
const qoder: MemoryAdapter = {
  harness: "qodercli",
  candidates(c) {
    const at = context(c);
    return [
      file(
        path.join(c.env.home, ".qoder/AGENTS.md"),
        "user",
        "Qoder CLI user instructions; custom filenames are not expanded",
      ),
      ...ancestors(at.path, at.root).flatMap((root) =>
        files(
          root,
          ["AGENTS.md", "AGENTS.local.md"],
          "project",
          "Qoder CLI project instructions; trust and exclusions decide applicability",
        ),
      ),
      ...ancestors(at.path, at.root).map((root) =>
        rules(
          path.join(root, ".qoder/rules"),
          "project",
          "Qoder CLI rules; frontmatter controls startup or file-triggered loading",
        ),
      ),
      {
        ...directory(
          path.join(c.env.home, ".qoder/memory"),
          "user",
          "memory",
          "Qoder CLI user auto-memory when enabled; MEMORY.md is the startup index",
        ),
        load: "startup-candidate",
      },
    ];
  },
};

// https://antigravity.google/docs/rules/#antigravity-cli
const antigravity: MemoryAdapter = {
  harness: "antigravity-cli",
  candidates(c) {
    const at = context(c);
    return [
      ...files(
        path.join(c.env.home, ".gemini"),
        ["AGENTS.md", "GEMINI.md", "config/AGENTS.md", "config/GEMINI.md"],
        "user",
        "Antigravity CLI global instructions",
      ),
      rules(
        path.join(c.env.home, ".gemini/config/rules"),
        "user",
        "Antigravity CLI rules; trigger and prompt budget decide startup or on-demand loading",
      ),
      ...ancestors(at.path, at.root).flatMap((root) => [
        ...files(
          root,
          ["AGENTS.md", "GEMINI.md", ".agents/AGENTS.md", ".agents/GEMINI.md"],
          "project",
          "Antigravity CLI ancestor instructions",
        ),
        rules(
          path.join(root, ".agents/rules"),
          "project",
          "Antigravity CLI immediate .md rules; trigger decides startup or on-demand loading",
        ),
      ]),
    ];
  },
};

// https://docs.x.ai/build/features/project-rules
const grok: MemoryAdapter = {
  harness: "grok",
  candidates(c) {
    const at = context(c);
    const named = (root: string, scope: Candidate["scope"]) =>
      files(
        root,
        [
          "AGENTS.md",
          "Agents.md",
          "AGENT.md",
          "CLAUDE.md",
          "Claude.md",
          "CLAUDE.local.md",
        ],
        scope,
        "Grok instructions; gitignore and session settings may exclude candidates",
      );
    return [
      ...named(path.join(c.env.home, ".grok"), "user"),
      directory(
        path.join(c.env.home, ".grok/rules"),
        "user",
        "rules",
        "Grok global Markdown rules",
      ),
      ...ancestors(at.path, at.root).flatMap((root) => [
        ...named(root, "project"),
        ...[".grok/rules", ".claude/rules"].map((dir) =>
          directory(
            path.join(root, dir),
            "project",
            "rules",
            "Grok Markdown rules; ignored files are not loaded by the harness",
          ),
        ),
      ]),
    ];
  },
};

// https://docs.devin.ai/cli/extensibility/rules
const devin: MemoryAdapter = {
  harness: "devin",
  candidates(c) {
    const at = context(c);
    const names = ["AGENTS.md", "AGENTS.local.md", "AGENT.md", "CLAUDE.md"];
    return [
      ...files(
        path.join(configHome(c.env), "devin"),
        names.filter((name) => name !== "CLAUDE.md"),
        "user",
        "Devin CLI global instructions",
      ),
      file(
        path.join(c.env.claude, "CLAUDE.md"),
        "user",
        "Devin CLI global Claude-compatible instructions",
      ),
      ...files(
        at.root,
        names,
        "project",
        "Devin CLI workspace instructions, loaded at session start",
      ),
      ...ancestors(at.path, at.root)
        .filter((root) => root !== at.root)
        .flatMap((root) =>
          files(
            root,
            names,
            "project",
            "Devin CLI subdirectory instructions, discovered when the agent accesses files here",
          ).map((source) => ({ ...source, load: "on-demand" as const })),
        ),
    ];
  },
};

// https://code.mastra.ai/configuration#agent-instructions
// Observational memory lives in a database and stays outside this Markdown model.
const mastracode: MemoryAdapter = {
  harness: "mastracode",
  candidates(c) {
    const at = context(c);
    return [
      ...[
        ".claude",
        ".mastracode",
        ".config/claude",
        ".config/mastracode",
      ].flatMap((dir) =>
        files(
          path.join(c.env.home, dir),
          ["AGENTS.md", "CLAUDE.md"],
          "user",
          "Mastra Code global instruction candidates; first location wins and AGENTS.md precedes CLAUDE.md",
        ),
      ),
      ...["", ".claude", ".mastracode"].flatMap((dir) =>
        files(
          path.join(at.root, dir),
          ["AGENTS.md", "CLAUDE.md"],
          "project",
          "Mastra Code project instruction candidates; first location wins and AGENTS.md precedes CLAUDE.md",
        ),
      ),
    ];
  },
};

export const MEMORY_ADAPTERS: readonly MemoryAdapter[] = [
  claude,
  codex,
  pi,
  opencode,
  copilot,
  cursor,
  qwen,
  droid,
  kimi,
  omp,
  kilo,
  hermes,
  qoder,
  antigravity,
  grok,
  devin,
  mastracode,
];

export function memorySources(
  projects: MemoryProject[],
  agents: MemoryAgent[],
  env: HostEnvironment,
): MemorySource[] {
  const sources = new Map<string, MemorySource>();
  for (const project of projects) {
    // Only observed readers contribute candidates, including missing files.
    const subjects = agents.filter((agent) => agent.project_id === project.id);
    const contexts: Array<{ agent?: MemoryAgent; adapter: MemoryAdapter }> =
      subjects.flatMap((agent) =>
        MEMORY_ADAPTERS.filter(
          (adapter) => adapter.harness === agent.harness,
        ).map((adapter) => ({ agent, adapter })),
      );
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
