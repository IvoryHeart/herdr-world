import { afterEach, expect, test } from "bun:test";
import type { Pane, Tab, Workspace } from "../types";
import {
  OFFICE_PRESENTATION_BOUNDS,
  prepareWorldOffice,
  projectWorldOffice,
} from "./herdrOfficeProjection";
import type { OfficeAgent } from "./officeProjectionTypes";
import type { WorldRuntimeConnection } from "./runtimeStore";
import {
  buildWorldObject,
  type WorldLeafObject,
  type WorldObject,
  type WorldObjectNode,
} from "./worldObject";

const STATUSES = ["working", "idle", "blocked", "done", "unknown"];

/** A small deterministic PRNG, so a failing seed can be replayed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function host(
  id: string,
  workspaceCount: number,
  tabsFor: (workspace: string) => Tab[],
  panesFor: (workspace: string, tabs: Tab[]) => Pane[],
): WorldRuntimeConnection {
  const workspaces = Array.from(
    { length: workspaceCount },
    (_, index): Workspace => ({
      workspace_id: `${id}-w${index}`,
      number: index + 1,
      label: `Room ${index + 1}`,
      focused: index === 0,
      pane_count: 0,
      tab_count: 0,
      agent_status: "unknown",
    }),
  );
  const tabs = workspaces.flatMap((workspace) =>
    tabsFor(workspace.workspace_id),
  );
  const panes = workspaces.flatMap((workspace) =>
    panesFor(
      workspace.workspace_id,
      tabs.filter((tab) => tab.workspace_id === workspace.workspace_id),
    ),
  );
  return {
    connectionId: id,
    label: id,
    source: "saved-profile",
    isDefault: true,
    state: "ready",
    generation: 7,
    snapshotGeneration: 7,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
}

/** Rooms of random shape: empty tabs, panes of unlisted tabs, mixed agents. */
function randomWorld(seed: number): WorldObject {
  const next = random(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)]!;
  const connection = host(
    `host-${seed}`,
    1 + Math.floor(next() * 3),
    (workspace) =>
      Array.from({ length: Math.floor(next() * 9) }, (_, index) => ({
        tab_id: `${workspace}-t${Math.floor(next() * 12)}-${index}`,
        workspace_id: workspace,
        number: index + 1,
        label: next() < 0.2 ? "" : `Tab ${index + 1}`,
        focused: index === 0,
        pane_count: Math.floor(next() * 5),
        agent_status: pick(STATUSES),
      })),
    (workspace, tabs) =>
      Array.from({ length: Math.floor(next() * 30) }, (_, index) => ({
        pane_id: `${workspace}-p${Math.floor(next() * 1000)}-${index}`,
        terminal_id: `${workspace}-term-${index}`,
        workspace_id: workspace,
        tab_id:
          tabs.length && next() < 0.9
            ? pick(tabs).tab_id
            : `${workspace}-unlisted`,
        focused: next() < 0.2,
        ...(next() < 0.7 ? { agent: pick(["codex", "claude"]) } : {}),
        agent_status: pick(STATUSES),
        revision: 1,
      })),
  );
  return withAppearance(buildWorldObject([connection]), next);
}

/** Some leaves carry a saved appearance status, as worldWithAppearance adds. */
function withAppearance(world: WorldObject, next: () => number): WorldObject {
  const leaves = world.leaves.map(
    (leaf): WorldLeafObject =>
      next() < 0.3 ? { ...leaf, appearance: { status: `s${leaf.id}` } } : leaf,
  );
  const leafById = new Map(leaves.map((leaf) => [leaf.id, leaf]));
  const spaces = world.spaces.map((space) => ({
    ...space,
    children: space.children.map((leaf) => leafById.get(leaf.id)!),
  }));
  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const hosts = world.hosts.map((item) => ({
    ...item,
    spaces: item.spaces.map((space) => spaceById.get(space.id)!),
  }));
  const nodes: WorldObjectNode[] = [...hosts, ...spaces, ...leaves];
  return {
    ...world,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}

// The desk fields room indexing derives, defined as before indexing: a scan
// of the room's panes and agents per desk.
function compareDeskCandidates(left: OfficeAgent, right: OfficeAgent) {
  const order = (status: string) =>
    status === "working" ? 0 : status === "unknown" ? 1 : 2;
  return (
    order(left.semanticStatus) - order(right.semanticStatus) ||
    Number(right.focused) - Number(left.focused) ||
    left.key.localeCompare(right.key)
  );
}

function expectDesksAsScanned(world: WorldObject) {
  const projection = projectWorldOffice(world, 1);
  for (const space of world.spaces) {
    const desks = projection.deskRoster
      .map(({ desk }) => desk)
      .filter((desk) => desk.roomKey === space.id);
    const agents = projection.roster
      .filter((entry) => entry.roomKey === space.id)
      .map(({ agent }) => agent);
    expect(desks.map((desk) => desk.tabRef.nativeId)).toEqual(
      space.tabs.map((tab) => tab.tab_id),
    );
    space.tabs.forEach((tab, index) => {
      const desk = desks[index]!;
      const leaves = space.children.filter(({ tabId }) => tabId === tab.tab_id);
      const devices = [...leaves]
        .sort((left, right) => left.nativeId.localeCompare(right.nativeId))
        .slice(0, OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk);
      const observed = Math.max(tab.pane_count, leaves.length);
      const candidates = agents
        .filter(
          (agent) => agent.destination === "room" && agent.deskKey === desk.key,
        )
        .sort(compareDeskCandidates);
      expect({
        terminalSelectionKeys: desk.terminalSelectionKeys,
        appearanceStatus: desk.appearanceStatus,
        observedPaneCount: desk.observedPaneCount,
        devices: desk.paneDevices.map(({ nodeId }) => nodeId),
        omittedPaneCount: desk.omittedPaneCount,
        occupantAgentKey: desk.occupantAgentKey,
        completionAgentKeys: desk.completionAgentKeys,
      }).toEqual({
        terminalSelectionKeys: leaves.map(({ id }) => id).sort(),
        appearanceStatus: leaves[0]?.appearance?.status,
        observedPaneCount: observed,
        devices: devices.map(({ id }) => id),
        omittedPaneCount: Math.max(0, observed - devices.length),
        occupantAgentKey: candidates[0]?.key,
        completionAgentKeys: agents
          .filter(
            (agent) =>
              agent.semanticStatus === "done" && agent.deskKey === desk.key,
          )
          .map(({ key }) => key)
          .sort(),
      });
    });
  }
}

test("indexed rooms derive every desk as a per-desk scan does", async () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    // Projected in render, then prepared in the background: both paths.
    const world = randomWorld(seed);
    expectDesksAsScanned(world);
    const prepared = randomWorld(seed);
    await prepareWorldOffice(
      prepared,
      () => true,
      async () => {},
    );
    expectDesksAsScanned(prepared);
  }
});

function oneRoom(desks: number, panesPerDesk: number) {
  return buildWorldObject([
    host(
      "large",
      1,
      (workspace) =>
        Array.from({ length: desks }, (_, index) => ({
          tab_id: `${workspace}-t${index}`,
          workspace_id: workspace,
          number: index + 1,
          label: `Tab ${index + 1}`,
          focused: index === 0,
          pane_count: panesPerDesk,
          agent_status: "working",
        })),
      (workspace, tabs) =>
        tabs.flatMap((tab, index) =>
          Array.from({ length: panesPerDesk }, (_, pane) => ({
            pane_id: `${tab.tab_id}-p${pane}`,
            terminal_id: `${tab.tab_id}-term${pane}`,
            workspace_id: workspace,
            tab_id: tab.tab_id,
            focused: pane === 0,
            agent: "codex",
            agent_status: STATUSES[(index + pane) % STATUSES.length]!,
            revision: 1,
          })),
        ),
    ),
  ]);
}

test("one room of 1,440 desks reads each pane a bounded number of times", () => {
  const world = oneRoom(1440, 1);
  const space = world.spaces[0]!;
  let reads = 0;
  // Counts every element read of the room's panes, however it is scanned.
  const children = new Proxy(space.children, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const counted = { ...space, children };
  projectWorldOffice(
    {
      ...world,
      spaces: [counted],
      hosts: [{ ...world.hosts[0]!, spaces: [counted] }],
    },
    1,
  );
  // Indexing reads each pane a few times; a scan per desk would read
  // 1,440 × 1,440.
  expect(reads).toBeLessThanOrEqual(4 * space.children.length);
});

const realNow = performance.now.bind(performance);
afterEach(() => {
  performance.now = realNow;
});

test("preparing one large room yields inside it, not only between rooms", async () => {
  const world = oneRoom(1440, 1);
  // Each reading of the clock takes 1 ms, so a 6 ms slice spans few desks.
  let now = 0;
  performance.now = () => (now += 1);
  let yields = 0;
  await prepareWorldOffice(
    world,
    () => true,
    async () => {
      yields += 1;
    },
  );
  // Checked between rooms alone, one room yields only once it is complete.
  expect(yields).toBeGreaterThan(100);
});
