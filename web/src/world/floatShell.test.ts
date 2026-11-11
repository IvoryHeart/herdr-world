import { afterEach, expect, test } from "bun:test";
import {
  canOpenRoomShell,
  coreAuthorityFrom,
  floatShellTarget,
  type HerdrFloatRoute,
  hideFloatShell,
  openRoomShell,
} from "./floatShell";
import type { WorldRuntimeConnection } from "./runtimeStore";

// The TUI path goes through the same qualified plugin toggle as Ctrl+Alt+F;
// what matters here is which runtime gets which equivalent, with what context.
const calls: unknown[] = [];
const route: HerdrFloatRoute = {
  watchPopups: async (connectionId, generation) => {
    calls.push({ connectionId, generation, method: "terminal.watch_popup" });
  },
  toggle: async (connectionId, generation, args) => {
    calls.push({ connectionId, generation, toggle: args });
  },
};

type Leaf = Parameters<typeof openRoomShell>[0];

function leaf(extra: Partial<Leaf> = {}): Leaf {
  return {
    connectionId: "studio",
    generation: 4,
    label: "reviewer",
    workspaceId: "w1",
    stale: false,
    actionable: true,
    pane: {
      pane_id: "p1",
      terminal_id: "term-1",
      workspace_id: "w1",
      cwd: "/srv/example/app",
      foreground_cwd: "/srv/example/app/web",
    },
    ...extra,
  } as unknown as Leaf;
}

afterEach(() => {
  calls.length = 0;
  hideFloatShell();
});

test("a core agent opens World's float shell for its room, with no TUI call", async () => {
  await openRoomShell(
    leaf({
      runtime: "herdr-core",
      actionable: false,
      viewOnly: "View only",
      workspaceId: "hc:space:s1",
      pane: { pane_id: "t3", terminal_id: "t3", workspace_id: "hc:space:s1" },
    } as Partial<Leaf>),
    route,
  );
  expect(floatShellTarget()).toEqual({
    connectionId: "studio",
    generation: 4,
    terminalId: "t3",
    room: "hc:space:s1",
    label: "reviewer",
  });
  expect(calls).toEqual([]);
});

test("a TUI agent toggles Herdr Float in its own Space and folder, on its own host", async () => {
  await openRoomShell(leaf(), route);
  expect(floatShellTarget()).toBeNull();
  expect(calls).toEqual([
    { connectionId: "studio", generation: 4, method: "terminal.watch_popup" },
    {
      connectionId: "studio",
      generation: 4,
      toggle: { workspace_id: "w1", focused_pane_cwd: "/srv/example/app/web" },
    },
  ]);
});

test("offline agents offer no shell; live core agents do although view-only", () => {
  expect(canOpenRoomShell(leaf())).toBe(true);
  expect(canOpenRoomShell(leaf({ stale: true }))).toBe(false);
  expect(canOpenRoomShell(leaf({ actionable: false }))).toBe(false);
  expect(
    canOpenRoomShell(
      leaf({ actionable: false, runtime: "herdr-core" } as Partial<Leaf>),
    ),
  ).toBe(true);
  expect(canOpenRoomShell(null)).toBe(false);
});

test("Open again takes a core connection's current generation, only while it is ready", () => {
  const connections = [
    {
      connectionId: "core",
      runtime: "herdr-core",
      state: "ready",
      generation: 7,
      stale: false,
    },
    { connectionId: "tui", state: "ready", generation: 3, stale: false },
    {
      connectionId: "down",
      runtime: "herdr-core",
      state: "reconnecting",
      generation: 9,
      stale: true,
    },
    {
      connectionId: "cached",
      runtime: "herdr-core",
      state: "ready",
      generation: 2,
      stale: true,
    },
  ] as unknown as WorldRuntimeConnection[];
  const authority = coreAuthorityFrom({ get: () => ({ connections }) });
  expect(authority("core")).toBe(7);
  expect(authority("tui")).toBeNull();
  expect(authority("down")).toBeNull();
  expect(authority("cached")).toBeNull();
  expect(authority("gone")).toBeNull();
});
