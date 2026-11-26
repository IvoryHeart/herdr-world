import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { TERMINAL_COLOR_HEX } from "./terminalColor";
import { townScaleConnections } from "./town/townScaleScene";
import { townLandmarkResults } from "./town/townSearch";
import { spacesCoreChoice, spacesCoreLeaf } from "./spacesCore";
import { SpacesCoreTerminal } from "./SpacesCoreTerminal";
import {
  coreSpacesLeaf,
  openWorldFind,
  openWorldFindHere,
  WORLD_COMMAND_FINDS,
  withWorldViews,
  worldFindGroup,
  worldFindHereReason,
  worldFindOpenReason,
  worldFoundTarget,
  worldViewGroup,
  type WorldFindHereDeps,
  type WorldFindOpenDeps,
} from "./worldCommandBox";
import { buildWorldObject } from "./worldObject";
import { worldObjectForHosts } from "./worldFilters";
import { worldNodeForWorkspaceSurfaceSelection } from "./worldInspectorSelection";
import { worldSearchResults } from "./worldSearch";

const scene = townScaleConnections();
const world = buildWorldObject(scene, scene[0]!.connectionId);

const none = { open: () => {} };

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};
const escapeHtml = (text: string) =>
  text.replace(/[&"<>]/g, (char) => HTML_ESCAPES[char]!);

/** A copy of a scene host on another connection, in another state. */
function variant(
  index: number,
  id: string,
  change: Partial<WorldRuntimeConnection>,
): WorldRuntimeConnection {
  const base = townScaleConnections()[index]!;
  return { ...base, connectionId: id, label: id, ...change };
}

/** A herdr-core host on this machine: its panes have core's own addresses. */
function coreHost(): WorldRuntimeConnection {
  const base = variant(2, "core-local", { runtime: "herdr-core" });
  const panes = base.snapshot!.panes.map((pane, index) => ({
    ...pane,
    pane_id: `t${index + 1}`,
  }));
  return { ...base, snapshot: { ...base.snapshot!, panes } };
}

describe("the command box finds what the views' search finds", () => {
  test("an empty search or no match finds nothing", () => {
    expect(worldFindGroup(world, "  ", none)).toBeNull();
    expect(worldFindGroup(world, "no-such-place-anywhere", none)).toBeNull();
  });

  test("names first, at most a page, and choosing opens the node", () => {
    const chosen: string[] = [];
    const group = worldFindGroup(world, "harbor", {
      open: (node) => chosen.push(node.id),
    })!;
    const results = worldSearchResults(world, "harbor");
    expect(results.length).toBeGreaterThan(WORLD_COMMAND_FINDS);
    expect(group.heading).toBe("In World");
    // A page of finds; the box pages through the rest.
    expect(group.actions).toHaveLength(WORLD_COMMAND_FINDS);
    expect(group.page).toEqual({
      from: 0,
      size: WORLD_COMMAND_FINDS,
      total: results.length,
    });
    // The next page holds the matches after it, ending with the last one.
    const lastFrom =
      Math.floor((results.length - 1) / WORLD_COMMAND_FINDS) *
      WORLD_COMMAND_FINDS;
    const last = worldFindGroup(world, "harbor", none, lastFrom)!;
    expect(last.page!.from).toBe(lastFrom);
    expect(last.actions[last.actions.length - 1]!.key).toBe(
      `world-find-${results[results.length - 1]!.id}`,
    );
    // A page past the end, as after a narrower search, is the last page.
    expect(worldFindGroup(world, "harbor", none, 10_000)!.page!.from).toBe(
      lastFrom,
    );
    const [room] = group.actions;
    expect(room!.title).toBe("harbor");
    expect(room!.detail).toBe("Room · atlas");
    expect(room!.score).toBe(0.95);
    // The rest match by place: below names, above summaries.
    expect(group.actions[1]!.score).toBe(0.8);
    room!.run();
    expect(chosen).toEqual([results[0]!.nodeId]);
    // Without a view to go to it in, choosing opens it: no second action.
    expect(room!.secondary).toBeUndefined();
  });

  test("an agent shows its icon in its tab's colour, its place, mark and runtime", () => {
    const colored: string[] = [];
    const group = worldFindGroup(world, "harbor migration", {
      ...none,
      colorOf: (leaf) => {
        colored.push(leaf.id);
        return "teal";
      },
    })!;
    const agent = group.actions[0]!;
    const icon = agent.icon as ReactElement<{
      className: string;
      style: Record<string, string>;
    }>;
    expect(icon.props.className).toBe("world-find-icon");
    expect(icon.props.style["--world-find-color"]).toBe(
      TERMINAL_COLOR_HEX.teal,
    );
    expect(colored).toHaveLength(1);
    expect(agent.detail).toMatch(
      /^Agent · Needs you · atlas › harbor › \w+ · .*migration/,
    );
    expect(agent.score).toBe(0.6);
    const trailing = renderToStaticMarkup(<>{agent.trailing}</>);
    expect(trailing).toContain('aria-label="Herdr TUI"');
    expect(trailing).toContain("Needs you");
  });

  test("choosing goes to the find in the current view; the second action opens it there", () => {
    const went: string[] = [];
    const opened: string[] = [];
    const handlers = {
      open: (node: { id: string }) => opened.push(node.id),
      go: { run: (result: { nodeId: string }) => went.push(result.nodeId) },
      opensHere: true,
      opensNote: "Opens its window here",
    };
    const room = worldFindGroup(world, "harbor", handlers)!.actions[0]!;
    room.run();
    expect(went).toEqual([worldSearchResults(world, "harbor")[0]!.nodeId]);
    expect(opened).toEqual([]);
    // A room opens its Inspector; an agent or terminal opens its terminal;
    // nothing outside Spaces says it goes to Spaces (#1356).
    expect(room.secondary?.label).toBe("Open Inspector");
    room.secondary!.run();
    expect(opened).toEqual([went[0]]);
    expect(room.detail).not.toContain("Opens its window here");
    const agent = worldFindGroup(world, "harbor migration", handlers)!
      .actions[0]!;
    expect(agent.secondary?.label).toBe("Open terminal");
    // A host has no window beside the view, so it has no second action.
    const host = worldFindGroup(
      world,
      world.hosts[0]!.hostLabel,
      handlers,
    )!.actions.find(
      (action) => action.key === `world-find-${world.hosts[0]!.id}`,
    );
    expect(host).toBeDefined();
    expect(host!.secondary).toBeUndefined();
    // In Spaces a room still opens there.
    const spaces = worldFindGroup(world, "harbor", {
      ...handlers,
      opensHere: false,
    })!.actions[0]!;
    expect(spaces.secondary?.label).toBe("Open in Spaces");
  });

  test("the view says when choosing a find leaves the box open", () => {
    let shown = "";
    const handlers = {
      open: () => {},
      go: {
        stays: (result: { id: string }) => shown !== result.id,
        run: (result: { id: string }) => {
          shown = result.id;
        },
      },
    };
    const room = worldFindGroup(world, "harbor", handlers)!.actions[0]!;
    const stay = room.stay as () => boolean;
    expect(stay()).toBe(true);
    room.run();
    expect(stay()).toBe(false);
    // A view that says nothing closes the box as each find is chosen.
    const plain = worldFindGroup(world, "harbor", {
      open: () => {},
      go: { run: () => {} },
    })!.actions[0]!;
    expect(plain.stay).toBeUndefined();
  });

  test("a view's own result goes there and has nothing to open", () => {
    const went: string[] = [];
    const group = worldFindGroup(world, "warehouse", {
      open: () => {
        throw new Error("a landmark is never opened");
      },
      go: { run: (result) => went.push(result.id) },
      extra: townLandmarkResults,
    })!;
    const found = group.actions[0]!;
    expect(found.title).toContain("Warehouse");
    expect(found.secondary).toBeUndefined();
    expect(found.trailing).toBeUndefined();
    found.run();
    expect(went).toEqual([townLandmarkResults("warehouse")[0]!.id]);
  });

  test("finds every connected host's agents whatever Hosts shows; goes only to what the view shows", () => {
    const [shownHost, otherHost] = world.hosts;
    const shownWorld = worldObjectForHosts(world, [shownHost!.connectionId]);
    const other = world.leaves.find(
      (leaf) =>
        leaf.kind === "agent" && leaf.connectionId === otherHost!.connectionId,
    )!;
    expect(shownWorld.nodeById.has(other.id)).toBe(false);
    const went: string[] = [];
    const opened: string[] = [];
    const handlers = {
      open: (node: { id: string }) => opened.push(node.id),
      go: {
        shows: (node: { id: string }) => shownWorld.nodeById.has(node.id),
        run: (result: { nodeId: string }) => went.push(result.nodeId),
      },
      opensHere: true,
      opensNote: "Opens its window here",
    };
    const group = worldFindGroup(
      world,
      `${other.label} ${other.hostLabel}`,
      handlers,
    )!;
    const found = group.actions.find(
      (action) => action.key === `world-find-${other.id}`,
    )!;
    // The view hides its host: choosing opens it, and the row says so.
    expect(found.detail).toMatch(/ · Opens its window here$/);
    expect(found.secondary).toBeUndefined();
    found.run();
    expect(opened).toEqual([other.id]);
    expect(went).toEqual([]);
    const shown = shownWorld.leaves.find((leaf) => leaf.kind === "agent")!;
    const shownFind = worldFindGroup(
      world,
      shown.label,
      handlers,
    )!.actions.find((action) => action.key === `world-find-${shown.id}`)!;
    expect(shownFind.secondary?.label).toBe("Open terminal");
    shownFind.run();
    expect(went).toEqual([shown.id]);
  });

  test("finds agents by their harness's full name", () => {
    const agents = (search: string) =>
      new Set(
        worldSearchResults(world, search)
          .filter((result) => result.kind === "agent")
          .map((result) => result.nodeId),
      );
    const claude = world.leaves.filter(
      (leaf) => leaf.kind === "agent" && leaf.pane.agent === "claude",
    );
    expect(claude.length).toBeGreaterThan(0);
    expect(agents("Claude Code")).toEqual(
      new Set(claude.map((leaf) => leaf.id)),
    );
  });

  test("finds agents by harness, status and runtime", () => {
    const words = (search: string) =>
      worldSearchResults(world, search).filter(
        (result) => result.kind === "agent",
      );
    const agents = world.leaves.filter((leaf) => leaf.kind === "agent");
    const blocked = agents.filter((leaf) => leaf.status === "blocked");
    expect(blocked.length).toBeGreaterThan(0);
    expect(words("needs you").length).toBeGreaterThanOrEqual(blocked.length);
    for (const result of words("needs you"))
      expect(blocked.some((leaf) => leaf.id === result.nodeId)).toBe(true);
    const codex = agents.filter(
      (leaf) => leaf.kind === "agent" && leaf.pane.agent === "codex",
    );
    expect(codex.length).toBeGreaterThan(0);
    expect(new Set(words("codex").map((result) => result.nodeId))).toEqual(
      new Set(codex.map((leaf) => leaf.id)),
    );
    const mixed = [...scene, coreHost()];
    const both = buildWorldObject(mixed, scene[0]!.connectionId);
    const core = worldSearchResults(both, "herdr-core").filter(
      (result) => result.kind === "agent",
    );
    expect(core.length).toBeGreaterThan(0);
    for (const result of core)
      expect(both.nodeById.get(result.nodeId)?.connectionId).toBe("core-local");
    const group = worldFindGroup(both, "herdr-core", none)!;
    expect(renderToStaticMarkup(<>{group.actions[0]!.trailing}</>)).toContain(
      'aria-label="herdr-core"',
    );
  });

  test("finds among 300 agents within 100 ms a keystroke", () => {
    const many = [
      ...scene,
      ...scene.map((connection) => ({
        ...connection,
        connectionId: `${connection.connectionId}-2`,
        label: `${connection.label}-2`,
      })),
    ];
    const large = buildWorldObject(many, many[0]!.connectionId);
    expect(
      large.leaves.filter((leaf) => leaf.kind === "agent").length,
    ).toBeGreaterThanOrEqual(300);
    const typed = "harbor migration";
    for (let end = 1; end <= typed.length; end++) {
      const started = performance.now();
      worldFindGroup(large, typed.slice(0, end), none);
      expect(performance.now() - started).toBeLessThan(100);
    }
  });
});

describe("opening a find", () => {
  const mixed = [
    ...scene,
    variant(0, "lost", { state: "disconnected", stale: true }),
    variant(1, "returning", { state: "reconnecting" }),
    coreHost(),
  ];
  const all = buildWorldObject(mixed, scene[0]!.connectionId);
  const agentOn = (connectionId: string) =>
    all.leaves.find(
      (leaf) => leaf.kind === "agent" && leaf.connectionId === connectionId,
    )!;

  function deps(spacesFound = true) {
    const calls: string[] = [];
    const notes: string[] = [];
    const value: WorldFindOpenDeps = {
      activateSpacesTarget: async (target) => {
        calls.push(
          `spaces ${target.connectionId} ${target.workspaceId} ${target.paneId}`,
        );
        return spacesFound;
      },
      activateHost: async (node) => {
        calls.push(`host ${node.connectionId}`);
      },
      goToSpaces: () => calls.push("go spaces"),
      openCoreInSpaces: (leaf) => {
        calls.push(
          `core ${leaf.connectionId} ${leaf.generation} ${leaf.nativeId}`,
        );
        return true;
      },
      notify: (message, detail) => notes.push(`${message}: ${detail}`),
    };
    return { calls, notes, value };
  }

  test("a Herdr agent on a host Spaces doesn't show opens there, its pane selected", async () => {
    const agent = agentOn(scene[1]!.connectionId);
    expect(agent.hostState).toBe("ready-inactive");
    const target = worldFoundTarget(agent);
    expect(target).toMatchObject({
      connectionId: agent.connectionId,
      runtimeGeneration: agent.generation,
      workspaceId: agent.workspaceId,
      paneId: agent.nativeId,
    });
    const { calls, notes, value } = deps();
    expect(await openWorldFind(agent, value)).toBe(true);
    expect(calls).toEqual([
      `spaces ${agent.connectionId} ${agent.workspaceId} ${agent.nativeId}`,
      "go spaces",
    ]);
    expect(notes).toEqual([]);
  });

  test("a room opens in Spaces with no pane, a host becomes Spaces' host", async () => {
    const room = all.spaces.find(
      (space) => space.connectionId === scene[2]!.connectionId,
    )!;
    const first = deps();
    expect(await openWorldFind(room, first.value)).toBe(true);
    expect(first.calls).toEqual([
      `spaces ${room.connectionId} ${room.nativeId} null`,
      "go spaces",
    ]);
    const host = all.hosts.find(
      (item) => item.connectionId === scene[2]!.connectionId,
    )!;
    const second = deps();
    expect(await openWorldFind(host, second.value)).toBe(true);
    expect(second.calls).toEqual([`host ${host.connectionId}`, "go spaces"]);
  });

  test("a pane that moved away says so", async () => {
    const agent = agentOn(scene[0]!.connectionId);
    const { notes, value } = deps(false);
    expect(await openWorldFind(agent, value)).toBe(false);
    expect(notes).toEqual([
      `Can't open ${agent.label}: ${agent.label} is no longer where World last saw it.`,
    ]);
  });

  test("an agent on an offline or reconnecting host is listed, marked, and says why", async () => {
    const lost = agentOn("lost");
    expect(worldFindOpenReason(lost)).toBe(
      "lost is offline. World shows what it last saw there.",
    );
    const returning = agentOn("returning");
    expect(worldFindOpenReason(returning)).toBe(
      "returning is reconnecting. Try again when it is back.",
    );
    const { calls, notes, value } = deps();
    expect(await openWorldFind(lost, value)).toBe(false);
    expect(calls).toEqual([]);
    expect(notes).toEqual([
      `Can't open ${lost.label}: lost is offline. World shows what it last saw there.`,
    ]);
    // Found by its machine's name too, so two agents of one name are told apart.
    const group = worldFindGroup(all, `${lost.label} lost`, none)!;
    const found = group.actions.find(
      (action) => action.key === `world-find-${lost.id}`,
    );
    expect(found?.detail).toContain("Offline");
  });

  test("a herdr-core agent opens in Spaces on its own connection, as a Herdr one does", async () => {
    const agent = agentOn("core-local");
    expect(agent.watch).toBeDefined();
    expect(agent.capabilities.openSpaces).toBe(false);
    expect(worldFindOpenReason(agent)).toBeNull();
    const { calls, notes, value } = deps();
    expect(await openWorldFind(agent, value)).toBe(true);
    expect(calls).toEqual([
      `core core-local ${agent.generation} ${agent.nativeId}`,
      "go spaces",
    ]);
    expect(notes).toEqual([]);
    const host = all.hosts.find((item) => item.connectionId === "core-local")!;
    expect(worldFindOpenReason(host)).toMatch(/runs herdr-core/);
  });

  test("a herdr-core room opens its terminal in Spaces, an agent first", async () => {
    const room = all.spaces.find(
      (space) => space.connectionId === "core-local",
    )!;
    const leaf = coreSpacesLeaf(room)!;
    expect(room.children).toContain(leaf);
    expect(
      leaf.focused ||
        leaf.kind === "agent" ||
        room.children.every((child) => child.kind !== "agent"),
    ).toBe(true);
    const { calls, value } = deps();
    expect(await openWorldFind(room, value)).toBe(true);
    expect(calls).toEqual([
      `core core-local ${leaf.generation} ${leaf.nativeId}`,
      "go spaces",
    ]);
    // A room with no terminal open says so and opens nothing.
    const empty = { ...room, children: [] };
    expect(worldFindOpenReason(empty)).toBe(
      `${room.label} has no terminal open.`,
    );
    const second = deps();
    expect(await openWorldFind(empty, second.value)).toBe(false);
    expect(second.calls).toEqual([]);
  });

  // Cmd+K outside Spaces opens a find's window in the view it was opened in,
  // never changing the view (#1356): Herdr TUI and herdr-core alike.
  function here(found = true) {
    const calls: string[] = [];
    const notes: string[] = [];
    const value: WorldFindHereDeps = {
      openWindow: async (target, opens) => {
        calls.push(
          `window ${target.connectionId} ${target.runtimeGeneration} ${target.workspaceId} ${target.paneId} ${opens}`,
        );
        return found;
      },
      notify: (message, detail) => notes.push(`${message}: ${detail}`),
    };
    return { calls, notes, value };
  }

  test("in the current view a Herdr agent opens its terminal window there, on the host Spaces shows or another", async () => {
    for (const agent of [
      agentOn(scene[0]!.connectionId),
      agentOn(scene[1]!.connectionId),
    ]) {
      expect(worldFindHereReason(agent)).toBeNull();
      const { calls, notes, value } = here();
      expect(await openWorldFindHere(agent, value)).toBe(true);
      expect(calls).toEqual([
        `window ${agent.connectionId} ${agent.generation} ${agent.workspaceId} ${agent.nativeId} terminal`,
      ]);
      expect(notes).toEqual([]);
    }
  });

  test("in the current view a herdr-core agent opens its terminal window there", async () => {
    const agent = agentOn("core-local");
    expect(agent.capabilities.openTerminal).toBe(false);
    expect(worldFindHereReason(agent)).toBeNull();
    const { calls, notes, value } = here();
    expect(await openWorldFindHere(agent, value)).toBe(true);
    expect(calls).toEqual([
      `window core-local ${agent.generation} ${agent.workspaceId} ${agent.nativeId} terminal`,
    ]);
    expect(notes).toEqual([]);
    // The window's admission finds it by this target, on its own generation.
    expect(
      worldNodeForWorkspaceSurfaceSelection(all, {
        connectionId: "core-local",
        runtimeGeneration: agent.generation,
        workspaceId: agent.workspaceId,
        paneId: agent.nativeId,
        view: "terminal",
      })?.id,
    ).toBe(agent.id);
  });

  test("in the current view a room opens its Inspector; a host says it has no window", async () => {
    const room = all.spaces.find(
      (space) => space.connectionId === scene[2]!.connectionId,
    )!;
    const first = here();
    expect(await openWorldFindHere(room, first.value)).toBe(true);
    expect(first.calls).toEqual([
      `window ${room.connectionId} ${room.generation} ${room.nativeId} null null`,
    ]);
    const host = all.hosts.find(
      (item) => item.connectionId === scene[2]!.connectionId,
    )!;
    const second = here();
    expect(await openWorldFindHere(host, second.value)).toBe(false);
    expect(second.calls).toEqual([]);
    expect(second.notes).toEqual([
      `Can't open ${host.label}: ${host.hostLabel} is a host, so it has no window. Find one of its agents or rooms to open it.`,
    ]);
  });

  test("in the current view an offline, reconnecting or moved agent says why and opens nothing", async () => {
    for (const [agent, why] of [
      [agentOn("lost"), "lost is offline. World shows what it last saw there."],
      [
        agentOn("returning"),
        "returning is reconnecting. Try again when it is back.",
      ],
    ] as const) {
      const { calls, notes, value } = here();
      expect(await openWorldFindHere(agent, value)).toBe(false);
      expect(calls).toEqual([]);
      expect(notes).toEqual([`Can't open ${agent.label}: ${why}`]);
    }
    const agent = agentOn(scene[0]!.connectionId);
    const moved = here(false);
    expect(await openWorldFindHere(agent, moved.value)).toBe(false);
    expect(moved.notes).toEqual([
      `Can't open ${agent.label}: ${agent.label} is no longer where World last saw it.`,
    ]);
    // A herdr-core terminal World only watches from another machine.
    const remote = { ...agentOn("core-local"), watch: undefined };
    expect(worldFindHereReason(remote)).toBe(
      "World only watches this herdr-core terminal from another machine, so it can't open it here.",
    );
  });

  test("Spaces shows a core terminal only on the generation it was opened on", () => {
    const agent = agentOn("core-local");
    const choice = spacesCoreChoice(agent);
    expect(spacesCoreLeaf(all, choice)?.id).toBe(agent.id);
    // A reconnected core is a new generation: Spaces does not follow it.
    expect(
      spacesCoreLeaf(all, { ...choice, generation: choice.generation + 1 }),
    ).toBeUndefined();
    // Never another connection's node of the same id.
    expect(
      spacesCoreLeaf(all, { ...choice, connectionId: "elsewhere" }),
    ).toBeUndefined();
    // Nor a Herdr TUI pane.
    const herdr = agentOn(scene[0]!.connectionId);
    expect(spacesCoreLeaf(all, spacesCoreChoice(herdr))).toBeUndefined();
  });

  test("Spaces' terminal area shows the core agent's watch under its bar", () => {
    const agent = agentOn("core-local");
    const choice = spacesCoreChoice(agent);
    // The watch reads the page's visibility and theme as it renders.
    const page = globalThis as { document?: unknown };
    const before = page.document;
    page.document = {
      visibilityState: "visible",
      documentElement: { dataset: {} },
    };
    let html: string;
    try {
      html = renderToStaticMarkup(
        <SpacesCoreTerminal world={all} choice={choice} onClose={() => {}} />,
      );
    } finally {
      page.document = before;
    }
    expect(html).toContain(`data-spaces-core="${escapeHtml(agent.id)}"`);
    expect(html).toContain(escapeHtml(agent.label));
    expect(html).toContain(escapeHtml(agent.hostLabel));
    expect(html).toContain("herdr-core");
    expect(html).toContain('aria-label="Close herdr-core terminal"');
    // The same watched terminal World's window shows.
    expect(html).toContain('class="core-watch"');
    // On a reconnected core it says so instead of following it.
    const gone = renderToStaticMarkup(
      <SpacesCoreTerminal
        world={all}
        choice={{ ...choice, generation: choice.generation + 1 }}
        onClose={() => {}}
      />,
    );
    expect(gone).not.toContain('class="core-watch"');
    expect(gone).toContain("no longer where World last saw it");
  });

  test("World's window admits a live herdr-core agent and room it is sent", () => {
    // As the shell hands a found target to World's window.
    const surface = (node: Parameters<typeof worldFoundTarget>[0]) => {
      const { paneId, ...target } = worldFoundTarget(node);
      return { ...target, ...(paneId ? { paneId } : {}) };
    };
    // Core nodes are never actionable; the window opens them as core resources.
    const agent = agentOn("core-local");
    expect(agent.actionable).toBe(false);
    expect(worldNodeForWorkspaceSurfaceSelection(all, surface(agent))?.id).toBe(
      agent.id,
    );
    const room = all.spaces.find(
      (space) => space.connectionId === "core-local",
    )!;
    expect(worldFindOpenReason(room)).toBeNull();
    expect(worldNodeForWorkspaceSurfaceSelection(all, surface(room))?.id).toBe(
      room.id,
    );
    // A stale host's node is still refused.
    const lost = agentOn("lost");
    expect(
      worldNodeForWorkspaceSurfaceSelection(all, surface(lost)),
    ).toBeNull();
  });
});

describe("the command box's views", () => {
  test("goes to every view but the current one", () => {
    const went: string[] = [];
    const group = worldViewGroup("town", (view) => went.push(view));
    expect(group.actions.map((action) => action.title)).toEqual([
      "Go to Board",
      "Go to Desk",
      "Go to Code",
      "Go to Spaces",
    ]);
    group.actions[0]!.run();
    expect(went).toEqual(["board"]);
  });

  test("join the view's actions, never replacing an empty set", () => {
    const empty = { captureKey: null, groups: [] };
    expect(withWorldViews(empty, "town", () => {})).toBe(empty);
    const actions = {
      captureKey: null,
      groups: [{ heading: "Create", actions: [] }],
    };
    expect(
      withWorldViews(actions, "board", () => {}).groups.map(
        (group) => group.heading,
      ),
    ).toEqual(["Create", "Views"]);
  });
});
