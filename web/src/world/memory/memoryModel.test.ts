import { afterAll, beforeAll, expect, test } from "bun:test";
import type { MemoryCatalog } from "../../../../shared/memory";
import {
  MEMORY_FIXTURE_AGENT_NAMES as NAMES,
  MEMORY_FIXTURE_TARGET,
  memoryFixtureClient,
  setMemoryFixtureForTests,
} from "./memoryFixture";
import {
  agentLoad,
  ALL_READERS,
  formatAge,
  formatBytes,
  libraryWings,
  memorySummary,
  newEntryName,
  readerRows,
  sharingList,
  sharingText,
  shortPath,
} from "./memoryModel";

let catalog: MemoryCatalog;
beforeAll(async () => {
  setMemoryFixtureForTests(true);
  catalog = await memoryFixtureClient().list(MEMORY_FIXTURE_TARGET);
});

afterAll(() => setMemoryFixtureForTests(undefined));

const source = (id: string) => catalog.sources.find((s) => s.id === id)!;

test("readers: everything, then each project with its agents by name", () => {
  const rows = readerRows(catalog, NAMES);
  expect(rows.map((row) => row.label)).toEqual([
    "Everything",
    "web-app",
    "docs-site",
    "opencode-app",
  ]);
  expect(rows[0]!.files).toBe(catalog.entries.length);
  expect(rows[0]!.detail).toBe("3 projects, 4 agents");
  expect(rows[1]!.agents!.map((a) => [a.label, a.detail])).toEqual([
    ["web-builder", "Claude"],
    ["web-reviewer", "Codex"],
  ]);
  // Old notes count as stale for whoever reads them.
  expect(rows[1]!.stale).toBe(3);
  // An agent without a name World knows reads as its harness and ID.
  expect(readerRows(catalog)[1]!.agents![0]!.label).toBe("Claude p1");
});

test("shells read nothing and stay off the readers list", () => {
  const withShell: MemoryCatalog = {
    ...catalog,
    agents: [
      ...catalog.agents,
      { id: "t9", project_id: "w1", harness: null, path: "/workspace/web-app" },
    ],
  };
  const web = readerRows(withShell, NAMES)[1]!;
  expect(web.agents!.map((a) => a.reader)).not.toContainEqual({
    kind: "agent",
    id: "t9",
  });
  expect(readerRows(withShell)[0]!.detail).toBe("3 projects, 4 agents");
});

test("wings go yours, projects, agents; instructions first, the index first", () => {
  const wings = libraryWings(catalog, ALL_READERS);
  expect(wings.map((w) => w.title)).toEqual(["Yours", "Projects", "Agents"]);
  const projects = wings[1]!.shelves.map((s) => s.source.kind);
  expect(projects).toEqual(
    [...projects].sort(
      (a, b) =>
        ["instructions", "rules", "memory"].indexOf(a) -
        ["instructions", "rules", "memory"].indexOf(b),
    ),
  );
  const memory = wings[1]!.shelves.find(
    (s) => s.source.id === "fx-web-memory",
  )!;
  expect(memory.entries.map((e) => e.path)).toEqual([
    "MEMORY.md",
    "release.md",
    "testing.md",
  ]);
  expect(memory.bytes).toBe(memory.entries.reduce((n, e) => n + e.size, 0));
});

test("a reader sees only the shelves it reads", () => {
  const docs = libraryWings(catalog, { kind: "agent", id: "p3" });
  const ids = docs.flatMap((w) => w.shelves.map((s) => s.source.id));
  expect(ids.sort()).toEqual([
    "fx-claude-user",
    "fx-docs-agents",
    "fx-docs-memory",
  ]);
  const web = libraryWings(catalog, { kind: "project", id: "w1" });
  expect(web.flatMap((w) => w.shelves).length).toBe(8);
});

test("an agent's load: start, when needed and skipped by its harness", () => {
  const load = agentLoad(catalog, "p1")!;
  const paths = (list: { path: string }[]) => list.map((e) => e.path).sort();
  // AGENTS.md is hidden by CLAUDE.md for Claude; an empty rule is skipped.
  expect(paths(load.startup)).toEqual([
    "CLAUDE.md",
    "CLAUDE.md",
    "MEMORY.md",
    "style.md",
  ]);
  expect(paths(load.onDemand)).toEqual(["release.md", "testing.md"]);
  expect(paths(load.skipped)).toEqual(["AGENTS.md", "empty-rule.md"]);
  expect(load.startupBytes).toBe(load.startup.reduce((n, e) => n + e.size, 0));
  // Codex reads the same AGENTS.md at start.
  expect(paths(agentLoad(catalog, "p2")!.startup)).toEqual([
    "AGENTS.md",
    "AGENTS.md",
  ]);
  expect(agentLoad(catalog, "nobody")).toBeNull();
});

test("sharing in words and names", () => {
  expect(sharingText(source("fx-claude-user"), catalog, NAMES)).toBe(
    "Shared by 2 agents in 2 projects",
  );
  expect(sharingText(source("fx-web-agents"), catalog, NAMES)).toBe(
    "Shared by 2 agents",
  );
  expect(sharingText(source("fx-web-memory"), catalog, NAMES)).toBe(
    "Only web-builder",
  );
  expect(
    sharingText({ ...source("fx-docs-agents"), agent_ids: [] }, catalog),
  ).toBe("docs-site, no agent yet");
  expect(
    sharingText(
      { ...source("fx-docs-agents"), agent_ids: [], project_ids: [] },
      catalog,
    ),
  ).toBe("No agent reads it now");
  expect(sharingList(source("fx-web-agents"), catalog, NAMES)).toEqual({
    projects: ["web-app"],
    agents: ["web-builder", "web-reviewer"],
  });
});

test("summary counts files, stale files and shared shelves", () => {
  expect(memorySummary(catalog)).toEqual({
    files: catalog.entries.length,
    stale: 3,
    shared: 2,
  });
});

test("new note names: relative Markdown in a folder, never a file shelf", () => {
  const folder = source("fx-web-memory");
  expect(newEntryName(folder, "decisions")).toBe("decisions.md");
  expect(newEntryName(folder, " ./notes/today.md ")).toBe("notes/today.md");
  for (const bad of [
    "",
    "/etc/x.md",
    "../up.md",
    "a//b.md",
    "a\\b.md",
    "a/b/c/d/e.md",
  ])
    expect(newEntryName(folder, bad)).toBeNull();
  expect(newEntryName(source("fx-docs-agents"), "AGENTS.md")).toBeNull();
});

test("sizes, ages and paths read short", () => {
  expect(formatBytes(812)).toBe("812 B");
  expect(formatBytes(4200)).toBe("4.2 KB");
  expect(formatBytes(42_000)).toBe("42 KB");
  expect(formatBytes(1_300_000)).toBe("1.3 MB");
  expect(formatAge(10_000)).toBe("just now");
  expect(formatAge(5 * 60_000)).toBe("5 min ago");
  expect(formatAge(3 * 3600_000)).toBe("3 h ago");
  expect(formatAge(86_400_000)).toBe("1 day ago");
  expect(formatAge(61 * 86_400_000)).toBe("2 months ago");
  expect(shortPath("/a/b/c/d")).toBe("…/c/d");
  expect(shortPath("/a/b")).toBe("/a/b");
});

test("unsupported-only projects and unsupported agents have no reader or zero count", () => {
  const unsupported: MemoryCatalog = {
    ...catalog,
    projects: [
      ...catalog.projects,
      { id: "no-memory", label: "No memory", path: "/workspace/plain" },
    ],
    agents: [
      ...catalog.agents,
      {
        id: "plain",
        project_id: "no-memory",
        harness: "letta",
        path: "/workspace/plain",
      },
    ],
  };
  const rows = readerRows(unsupported);
  expect(
    rows.some(
      (row) => row.reader.kind === "project" && row.reader.id === "no-memory",
    ),
  ).toBe(false);
  expect(
    rows
      .flatMap((row) => row.agents ?? [])
      .some(
        (row) =>
          row.reader.kind === "agent" &&
          ["p4", "plain"].includes(row.reader.id),
      ),
  ).toBe(false);
});

test("OpenCode fixture describes project and user instructions loaded at start", () => {
  const load = agentLoad(catalog, "p5")!;
  expect(load.startup).toHaveLength(2);
  expect(load.onDemand).toEqual([]);
  const sources = catalog.sources.filter((s) => s.agent_ids.includes("p5"));
  expect(sources.map((s) => s.scope).sort()).toEqual(["project", "user"]);
  expect(sources.every((s) => s.description.includes("OpenCode"))).toBe(true);
});
