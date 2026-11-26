import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { AgentMemoryLink } from "../memory/AgentMemoryLink";
import { afterEach, expect, test } from "bun:test";
import type { MemoryCatalog } from "../../../../shared/memory";
import {
  publishMemoryHosts,
  requestMemoryCatalog,
  setMemoryClientForTests,
  memoryClientOver,
} from "../memory/memoryClient";
import { libraryAvailable, memoryHostsOf } from "../memory/memoryTargets";
import {
  requestArtefactShelf,
  setArtefactShelfClientForTests,
} from "../memory/artefactShelfClient";
import { artefactFixtureShelf } from "../memory/artefactFixture";
import type { WorldObject } from "../worldObject";
import { townLibraryCounts, townLibrarySignText } from "./TownLibrary";

afterEach(() => {
  setMemoryClientForTests(null);
  setArtefactShelfClientForTests(null);
});

const host = (id: string) => ({
  connection_id: id,
  connection_generation: 1,
  label: id,
  names: {},
});

const catalog = (files: number, stale: number): MemoryCatalog =>
  ({
    observed_at: 1,
    projects: [],
    agents: [],
    sources: [{ id: "s", agent_ids: ["a", "b"] }],
    entries: Array.from({ length: files }, (_, i) => ({
      source_id: "s",
      path: `${i}.md`,
      stale: i < stale,
    })),
  }) as unknown as MemoryCatalog;

test("the sign counts files, stale files and shared shelves over its hosts", async () => {
  expect(townLibrarySignText(townLibraryCounts())).toBe("no host");
  setMemoryClientForTests(
    memoryClientOver(async (_, params) => {
      if (params.connection_id === "down") throw new Error("unavailable: gone");
      return params.connection_id === "a" ? catalog(3, 1) : catalog(1, 0);
    }),
  );
  publishMemoryHosts([host("a"), host("b"), host("down")]);
  expect(townLibrarySignText(townLibraryCounts())).toBe("…");
  await Promise.all(
    ["a", "b", "down"].map((id) => requestMemoryCatalog(host(id))),
  );
  expect(townLibrarySignText(townLibraryCounts())).toBe(
    "4 files · 1 stale · 2 shared",
  );
  setArtefactShelfClientForTests({
    list: async (target) =>
      target.connection_id === "down"
        ? Promise.reject(new Error("unavailable: gone"))
        : artefactFixtureShelf(target, 0),
    read: async () => Promise.reject(new Error("unused")),
  });
  await Promise.all(
    ["a", "b", "down"].map((id) => requestArtefactShelf(host(id))),
  );
  expect(townLibrarySignText(townLibraryCounts())).toBe(
    "4 files · 1 stale · 2 shared · 10 made",
  );
  publishMemoryHosts([host("down")]);
  await requestMemoryCatalog(host("down"), { force: true });
  expect(townLibrarySignText(townLibraryCounts())).toBe("unavailable");
});

test("the Library reads live hosts only, at their current generation, with World's names, marking those without memory", () => {
  const world = {
    hosts: [
      {
        connectionId: "c1",
        connection: { generation: 3 },
        label: "Laptop",
        stale: false,
        actionable: true,
      },
      {
        connectionId: "c2",
        connection: { generation: 1 },
        label: "Old",
        stale: true,
        actionable: true,
      },
      {
        connectionId: "c3",
        connection: { generation: 2 },
        label: "Core",
        stale: false,
        actionable: false,
        coreControl: true,
      },
      {
        connectionId: "c4",
        connection: { generation: 1 },
        label: "Waiting",
        stale: false,
        actionable: false,
      },
      {
        connectionId: "c5",
        connection: { generation: 4 },
        label: "Quiet",
        stale: false,
        actionable: true,
      },
    ],
    leaves: [
      {
        connectionId: "c1",
        kind: "agent",
        actionable: true,
        pane: { pane_id: "p1", agent: "opencode" },
        terminalId: "t1",
        workspaceId: "w1",
        spaceLabel: "web-app",
        agentName: "builder",
        label: "pane 1",
      },
      {
        connectionId: "c3",
        kind: "agent",
        coreControl: true,
        pane: { agent: "codex" },
        terminalId: "t9",
        workspaceId: "w9",
        spaceLabel: "notes",
        agentName: "helper",
        label: "pane 9",
      },
    ],
  } as unknown as WorldObject;
  expect(memoryHostsOf(world)).toEqual([
    {
      connection_id: "c1",
      connection_generation: 3,
      label: "Laptop",
      names: { p1: "builder" },
      rooms: { w1: "web-app" },
    },
    {
      connection_id: "c3",
      connection_generation: 2,
      label: "Core",
      names: { t9: "helper" },
      rooms: { w9: "notes" },
    },
    {
      connection_id: "c5",
      connection_generation: 4,
      label: "Quiet",
      names: {},
      rooms: {},
      memory: false,
    },
  ]);
});

test("unsupported-only hosts offer no Library, sign or agent entry until agents made something", async () => {
  const world = {
    hosts: [
      {
        connectionId: "only",
        connection: { generation: 7 },
        label: "Example",
        actionable: true,
      },
    ],
    leaves: [
      {
        kind: "agent",
        connectionId: "only",
        actionable: true,
        pane: { pane_id: "p1", agent: "letta" },
      },
    ],
  } as unknown as WorldObject;
  publishMemoryHosts(memoryHostsOf(world));
  expect(townLibraryCounts()).toEqual({ status: "none" });
  expect(libraryAvailable(world)).toBe(false);
  expect(
    renderToStaticMarkup(
      createElement(AgentMemoryLink, {
        connectionId: "only",
        agentId: "p1",
        harness: "letta",
      }),
    ),
  ).toBe("");
  expect(
    renderToStaticMarkup(
      createElement(AgentMemoryLink, {
        connectionId: "only",
        agentId: "p1",
        harness: "opencode",
      }),
    ),
  ).toContain("Memory");
});

test("a host whose agents have all stopped keeps its Library and counts only what they made", async () => {
  // No agents at all: every one on the host has stopped.
  const world = {
    hosts: [
      {
        connectionId: "quiet",
        connection: { generation: 2 },
        label: "Example",
        actionable: true,
      },
      {
        connectionId: "empty",
        connection: { generation: 1 },
        label: "Nothing made",
        actionable: true,
      },
    ],
    leaves: [],
  } as unknown as WorldObject;
  let catalogReads = 0;
  setMemoryClientForTests(
    memoryClientOver(async () => {
      catalogReads += 1;
      return catalog(1, 0);
    }),
  );
  setArtefactShelfClientForTests({
    list: async (target) =>
      target.connection_id === "empty"
        ? { ...artefactFixtureShelf(target, 0, true), artefacts: [] }
        : artefactFixtureShelf(target, 0, true),
    read: async () => Promise.reject(new Error("unused")),
  });
  publishMemoryHosts(memoryHostsOf(world));
  expect(townLibraryCounts()).toEqual({ status: "none" });
  expect(libraryAvailable(world, { connectionId: "quiet" })).toBe(false);
  await Promise.all(
    memoryHostsOf(world).map((one) => requestArtefactShelf(one)),
  );
  const counts = townLibraryCounts();
  expect(counts).toMatchObject({ status: "ready", made: 5, memory: false });
  expect(townLibrarySignText(counts)).toBe("5 made");
  expect(libraryAvailable(world)).toBe(true);
  expect(libraryAvailable(world, { connectionId: "quiet" })).toBe(true);
  expect(libraryAvailable(world, { connectionId: "empty" })).toBe(false);
  expect(catalogReads).toBe(0);
});
