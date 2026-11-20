import { expect, test } from "bun:test";
import { MEMORY_HARNESSES } from "../../../shared/memory";
import { coreHarnessNames } from "../herdr-core/harness";
import { memorySources, type HostEnvironment } from "./adapters";
import { memoryLoadEvidence } from "./load-evidence";
import type { MemoryEntry } from "../../../shared/memory";

const project = { id: "project", label: "Example", path: "/workspace/example" };
const env: HostEnvironment = {
  home: "/users/example",
  codex: "/users/example/.codex",
  claude: "/users/example/.claude",
  pi: "/users/example/.pi/agent",
  claude_memory: null,
  claude_project_name: null,
  contexts: {
    [project.path]: {
      path: project.path,
      root: project.path,
      memory_root: project.path,
    },
  },
};
const sources = (harness: string) =>
  memorySources(
    [project],
    [{ id: "agent", project_id: project.id, path: project.path, harness }],
    env,
  );

test("the complete launcher registry has documented memory or an explicit exclusion", () => {
  expect(
    coreHarnessNames()
      .filter((h) => !MEMORY_HARNESSES.includes(h as never))
      .sort(),
  ).toEqual(["letta", "ollama"]);
});

// These examples come from the installed release audit, not a list of aliases.
test.each([
  ["amp", "/users/example/.config/amp/AGENTS.md"],
  ["cline", "/workspace/example/.cline/rules"],
  ["gemini", "/users/example/.gemini/GEMINI.md"],
  ["kiro", "/workspace/example/.kiro/steering"],
  ["maki", "/workspace/example/AGENTS.local.md"],
  ["pig", "/users/example/.config/pig/agent/AGENTS.md"],
  ["crush", "/workspace/example/CRUSH.md"],
  ["command-code", "/workspace/example/.commandcode/AGENTS.md"],
  ["prime-agent", "/users/example/.prime/agent/AGENTS.md"],
  ["dsh-tui", "/users/example/.dsh/AGENTS.md"],
  ["muse", "/workspace/example/.agents/AGENTS.md"],
])("%s exposes its documented native instructions", (harness, path) => {
  expect(sources(harness).find((s) => s.path === path)).toMatchObject({
    harnesses: [harness],
    project_ids: ["project"],
    agent_ids: ["agent"],
  });
});

test.each(["pi", "prime-agent", "pig", "maki", "muse", "command-code"])(
  "%s keeps competing files visible but loads only its preferred file",
  (harness) => {
    const candidates = sources(harness);
    const preferred = harness === "pig" ? "AGENTS.override.md" : "AGENTS.md";
    const fallback =
      harness === "command-code" ? ".commandcode/AGENTS.md" : "CLAUDE.md";
    const selected = [preferred, fallback].map((name) => {
      const source = candidates.find(
        (s) => s.path === `${project.path}/${name}`,
      );
      expect(source).toBeDefined();
      return {
        source_id: source!.id,
        path: name.split("/").pop()!,
        state: "available",
        size: 16,
        load: "startup-candidate",
        harness_loads: {},
      } as MemoryEntry;
    });
    memoryLoadEvidence(selected, candidates);
    expect(selected[0]!.harness_loads[harness as "pi"]?.mode).toBe(
      "startup-candidate",
    );
    expect(selected[1]!.harness_loads[harness as "pi"]?.mode).toBe("shadowed");
  },
);

// Independent priorities from maker docs / the pinned loaders in the audit.
// Enumerate every present/absent combination, including fallback promotion.
test.each([
  ["pi", ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]],
  ["prime-agent", ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]],
  [
    "pig",
    ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"],
  ],
  [
    "maki",
    [
      "AGENTS.md",
      "CLAUDE.md",
      ".github/copilot-instructions.md",
      "COPILOT.md",
      "CONVENTIONS.md",
      "GEMINI.md",
      "CODING_AGENT.md",
    ],
  ],
  [
    "muse",
    ["AGENTS.md", "CLAUDE.md", ".agents/AGENTS.md", ".claude/CLAUDE.md"],
  ],
  ["command-code", ["AGENTS.md", ".commandcode/AGENTS.md"]],
  ["kilo", ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"]],
  [
    "mastracode",
    [
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/AGENTS.md",
      ".claude/CLAUDE.md",
      ".mastracode/AGENTS.md",
      ".mastracode/CLAUDE.md",
    ],
  ],
] as const)(
  "%s matches its loader priority for every file combination",
  (harness, names) => {
    const candidates = sources(harness);
    for (let mask = 0; mask < 2 ** names.length; mask++) {
      const entries = names.flatMap((name, index) => {
        if (!(mask & (1 << index))) return [];
        const source = candidates.find(
          (s) => s.path === `${project.path}/${name}`,
        )!;
        return [
          {
            source_id: source.id,
            path: name.split("/").pop()!,
            state: "available",
            size: 16,
            load: "startup-candidate",
            harness_loads: {},
          } as MemoryEntry,
        ];
      });
      memoryLoadEvidence(entries, candidates);
      const startup = entries.filter(
        (e) => e.harness_loads[harness]?.mode === "startup-candidate",
      );
      expect(
        startup.map((e) => candidates.find((s) => s.id === e.source_id)!.path),
      ).toEqual(
        mask
          ? [`${project.path}/${names.find((_, i) => mask & (1 << i))}`]
          : [],
      );
    }
  },
);
