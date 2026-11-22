import { expect, test } from "bun:test";
import { WORLD_AGENT_LAUNCH_EVENT } from "../agentProfiles";
import { WORLD_MEMORY_EVENT } from "../memory/memoryEvents";
import type { WorldObject } from "../worldObject";
import { boardHubActions, boardLaunchSpace } from "./BoardHub";

const space = (id: string, extra = {}) => ({
  id,
  kind: "space",
  nativeId: `w-${id}`,
  connectionId: "local",
  generation: 4,
  label: id,
  actionable: true,
  stale: false,
  capabilities: { launcher: true },
  ...extra,
});
const leaf = (
  id: string,
  parentId: string,
  agentName?: string,
  extra = {},
) => ({
  id,
  kind: "agent",
  parentId,
  connectionId: "local",
  terminalId: `t-${id}`,
  nativeId: `t-${id}`,
  workspaceId: `w-${parentId}`,
  pane: { agent: "codex", pane_id: `t-${id}` },
  actionable: true,
  label: `pane ${id}`,
  agentName,
  stale: false,
  capabilities: { openSpaces: true },
  ...extra,
});

function board(
  options: {
    selectedId?: string | null;
    holder?: { connection_id: string; terminal_id: string } | null;
    hostReady?: boolean;
    spaces?: ReturnType<typeof space>[];
    leaves?: ReturnType<typeof leaf>[];
  } = {},
) {
  const spaces = options.spaces ?? [space("api"), space("docs")];
  const leaves = options.leaves ?? [
    leaf("a", "api", "firstmate"),
    leaf("b", "docs", "lead"),
  ];
  const world = {
    hosts: [
      {
        connectionId: "local",
        actionable: options.hostReady ?? true,
        stale: false,
      },
    ],
    leaves,
    nodeById: new Map(
      [...spaces, ...leaves].map((node) => [node.id, node] as const),
    ),
  } as unknown as WorldObject;
  const calls: unknown[][] = [];
  const actions = boardHubActions({
    world,
    selectedId: options.selectedId ?? null,
    holder:
      options.holder === undefined
        ? { connection_id: "local", terminal_id: "t-a" }
        : options.holder,
    openChat: (id) => calls.push(["chat", id]),
    onOpenSummary: () => calls.push(["summary"]),
    onNewWorkspace: () => calls.push(["workspace"]),
    toast: (kind, text) => calls.push(["toast", kind, text]),
  });
  const action = (id: string) => actions.find((entry) => entry.id === id)!;
  return { world, actions, action, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Run `body` with a window that records launcher requests. */
function launches(body: () => void, event = WORLD_AGENT_LAUNCH_EVENT) {
  const had = "window" in globalThis;
  const previous = (globalThis as { window?: unknown }).window;
  const target = new EventTarget();
  const seen: unknown[] = [];
  target.addEventListener(event, (fired) =>
    seen.push((fired as CustomEvent).detail),
  );
  (globalThis as { window?: unknown }).window = target;
  try {
    body();
  } finally {
    if (had) (globalThis as { window?: unknown }).window = previous;
    else delete (globalThis as { window?: unknown }).window;
  }
  return seen;
}

test("the hub offers the town center's actions, New agent first", () => {
  const { actions, action } = board();
  expect(actions.map((entry) => entry.id)).toEqual([
    "launch",
    "master",
    "needs-you",
    "summary",
    "profiles",
    "apartments",
    "library",
    "workspace",
  ]);
  expect(action("launch").primary).toBe(true);
  expect(action("master").detail).toBeUndefined();
  expect(action("workspace").disabled).toBe(false);
});

test("a new agent starts in the selected card's workspace, else the launcher asks", () => {
  const selected = board({ selectedId: "b" });
  expect(selected.action("launch").detail).toBe("in docs");
  expect(launches(() => selected.action("launch").run())).toEqual([
    {
      connectionId: "local",
      generation: 4,
      workspaceId: "w-docs",
      workspaceLabel: "docs",
      // As from the town center: the agent arrives there in Town.
      from: "center",
    },
  ]);
  const none = board();
  expect(none.action("launch").detail).toBeUndefined();
  expect(launches(() => none.action("launch").run())).toEqual([
    { from: "center" },
  ]);
});

test("only a workspace that can launch now is the launch target", () => {
  const world = board({
    spaces: [space("api", { stale: true }), space("docs")],
  }).world;
  expect(boardLaunchSpace(world, "a")).toBeNull();
  expect(boardLaunchSpace(world, "docs")?.id).toBe("docs");
  expect(boardLaunchSpace(world, null)).toBeNull();
  expect(boardLaunchSpace(world, "missing")).toBeNull();
  const closed = board({
    spaces: [space("api", { capabilities: { launcher: false } })],
  }).world;
  expect(boardLaunchSpace(closed, "api")).toBeNull();
});

test("Town master opens the role holder's chat, with no name fallback", async () => {
  const named = board();
  named.action("master").run();
  await settle();
  expect(named.calls).toEqual([["chat", "a"]]);

  const holder = board({
    holder: { connection_id: "local", terminal_id: "t-b" },
  });
  holder.action("master").run();
  await settle();
  expect(holder.calls).toEqual([["chat", "b"]]);
});

test("a missing or unopenable Town master says so; none set offers a choice", async () => {
  const missing = board({
    holder: { connection_id: "local", terminal_id: "t-absent" },
  });
  missing.action("master").run();
  await settle();
  expect(missing.calls).toEqual([
    ["toast", "error", "The Town master isn't in Town now"],
  ]);
  const stale = board({
    leaves: [leaf("a", "api", "firstmate", { stale: true })],
  });
  stale.action("master").run();
  await settle();
  expect(stale.calls).toEqual([
    ["toast", "error", "firstmate can't be opened now"],
  ]);
  expect(board({ holder: null }).action("master").detail).toBe("Choose one");
});

test("New workspace opens workspace creation, or says why it cannot", () => {
  const ready = board();
  ready.action("workspace").run();
  expect(ready.calls).toEqual([["workspace"]]);
  const offline = board({ hostReady: false });
  expect(offline.action("workspace").disabled).toBe(true);
  expect(offline.action("workspace").detail).toBe("No host is ready");
});

test("Summary takes you to Town's summary", () => {
  const { action, calls } = board();
  expect(action("summary").label).toBe("Summary");
  expect(action("summary").detail).toBe("in Town");
  action("summary").run();
  expect(calls).toEqual([["summary"]]);
});

test("the Library opens on the selected agent or workspace, else everything", () => {
  const leaves = [
    leaf("a", "api", "firstmate", {
      nativeId: "p-a",
      pane: { pane_id: "p-a", agent: "codex" },
    }),
    leaf("b", "docs", "lead"),
  ];
  const agent = board({ selectedId: "a", leaves });
  expect(agent.action("library").detail).toBe("for firstmate");
  expect(
    launches(() => agent.action("library").run(), WORLD_MEMORY_EVENT),
  ).toEqual([{ connectionId: "local", agentId: "p-a" }]);
  const room = board({ selectedId: "docs", leaves });
  expect(
    launches(() => room.action("library").run(), WORLD_MEMORY_EVENT),
  ).toEqual([{ connectionId: "local", workspaceId: "w-docs" }]);
  const none = board({ leaves });
  expect(none.action("library").detail).toBeUndefined();
  expect(
    launches(() => none.action("library").run(), WORLD_MEMORY_EVENT),
  ).toEqual([{}]);
});

test("a selected unsupported agent or empty project has no Library action", () => {
  const leaves = [
    leaf("a", "api", "helper", { pane: { agent: "letta", pane_id: "t-a" } }),
    leaf("b", "docs", "builder"),
  ];
  expect(
    board({ selectedId: "a", leaves }).actions.some((a) => a.id === "library"),
  ).toBe(false);
  expect(
    board({ selectedId: "api", leaves }).actions.some(
      (a) => a.id === "library",
    ),
  ).toBe(false);
  expect(
    board({ selectedId: "docs", leaves }).actions.some(
      (a) => a.id === "library",
    ),
  ).toBe(true);
  expect(
    board({ leaves: [leaves[0]!] }).actions.some((a) => a.id === "library"),
  ).toBe(false);
});
