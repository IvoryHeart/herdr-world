import { MEMORY_HARNESSES, memoryHarness } from "../../../shared/memory";
import { WORLD_HARNESSES } from "../cli/harness-names";
import { expect, test } from "bun:test";
import {
  MEMORY_ADAPTERS,
  memorySources,
  type HostEnvironment,
} from "./adapters";

const project = { id: "w1", label: "Example", path: "/workspace/example" };
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
const sources = (harness: string | null) =>
  memorySources(
    [project],
    [{ id: "p1", project_id: project.id, path: project.path, harness }],
    env,
  );

test("OpenCode exposes project and user instructions as startup candidates", () => {
  const result = sources("opencode");
  for (const path of [
    "/workspace/example/AGENTS.md",
    "/users/example/.config/opencode/AGENTS.md",
  ])
    expect(result.find((s) => s.path === path)).toMatchObject({
      harnesses: ["opencode"],
      kind: "instructions",
      load: "startup-candidate",
      project_ids: ["w1"],
      agent_ids: ["p1"],
    });
});

test("unsupported-only, shell-only and empty projects invent no memory sources", () => {
  expect(sources("letta")).toEqual([]);
  expect(sources(null)).toEqual([]);
  expect(memorySources([project], [], env)).toEqual([]);
});

test("a project offers only its observed supported harnesses", () => {
  expect([...new Set(sources("codex").flatMap((s) => s.harnesses))]).toEqual([
    "codex",
  ]);
});

test("browser capabilities and service adapters name exactly the same supported World harnesses", () => {
  expect(MEMORY_ADAPTERS.map((a) => a.harness)).toEqual([...MEMORY_HARNESSES]);
  expect(MEMORY_HARNESSES.every((h) => WORLD_HARNESSES.includes(h))).toBe(true);
  expect(memoryHarness("cursor-agent")).toBe("cursor");
  expect(memoryHarness("/opt/bin/oh-my-pi")).toBe("omp");
  expect(memoryHarness("unknown-harness")).toBeNull();
});

test.each([
  [
    "devin",
    "/users/example/.config/devin/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  [
    "devin",
    "/workspace/example/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  [
    "mastracode",
    "/users/example/.mastracode/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  [
    "copilot",
    "/users/example/.copilot/copilot-instructions.md",
    "instructions",
    "startup-candidate",
  ],
  ["copilot", "/workspace/example/.github/instructions", "rules", "on-demand"],
  ["cursor", "/workspace/example/.cursor/rules", "rules", "on-demand"],
  ["qwen", "/users/example/.qwen/QWEN.md", "instructions", "startup-candidate"],
  ["qwen", "/users/example/.qwen/memories", "memory", "startup-candidate"],
  [
    "droid",
    "/users/example/.factory/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  [
    "kimi",
    "/workspace/example/.kimi/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  [
    "kimi",
    "/users/example/.kimi-code/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  [
    "omp",
    "/users/example/.omp/agent/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  ["omp", "/workspace/example/.omp/rules", "rules", "on-demand"],
  [
    "kilo",
    "/users/example/.config/kilo/AGENTS.md",
    "instructions",
    "startup-candidate",
  ],
  [
    "hermes",
    "/users/example/.hermes/memories/USER.md",
    "memory",
    "startup-candidate",
  ],
  [
    "qodercli",
    "/workspace/example/AGENTS.local.md",
    "instructions",
    "startup-candidate",
  ],
  ["qodercli", "/workspace/example/.qoder/rules", "rules", "on-demand"],
  [
    "antigravity-cli",
    "/users/example/.gemini/GEMINI.md",
    "instructions",
    "startup-candidate",
  ],
  ["grok", "/workspace/example/.grok/rules", "rules", "startup-candidate"],
])("%s documents %s with its kind and timing", (harness, path, kind, load) => {
  expect(sources(harness).find((s) => s.path === path)).toMatchObject({
    harnesses: [harness],
    kind,
    load,
    project_ids: ["w1"],
    agent_ids: ["p1"],
  });
  expect(sources(harness).every((s) => s.description.length > 0)).toBe(true);
});

test("nested agents use their own cwd within the owning host and keep sharing", () => {
  const path = `${project.path}/src`;
  const result = memorySources(
    [project],
    [
      { id: "a", project_id: project.id, path, harness: "opencode" },
      {
        id: "b",
        project_id: project.id,
        path: project.path,
        harness: "opencode",
      },
      { id: "c", project_id: project.id, path, harness: "letta" },
    ],
    {
      ...env,
      contexts: {
        ...env.contexts,
        [path]: { path, root: project.path, memory_root: project.path },
      },
    },
  );
  expect(result.find((s) => s.path === `${path}/AGENTS.md`)?.agent_ids).toEqual(
    ["a"],
  );
  expect(
    result.find((s) => s.path === `${project.path}/AGENTS.md`)?.agent_ids,
  ).toEqual(["a", "b"]);
  expect(result.every((s) => !s.agent_ids.includes("c"))).toBe(true);
});
