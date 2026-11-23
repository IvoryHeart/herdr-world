import { expect, test } from "bun:test";
import { memoryApartmentsPort } from "../storage/apartments";
import { createApartmentsService } from "../features/apartments/service";

const NOW = 1_800_000_000_000;
const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/**
 * A core agent's rows carry no session; the service asks the session Chat
 * knows (a process record, a linked Codex session) while the agent lives.
 */
test("a core agent's session Chat knows is the one its resident keeps", async () => {
  const asked: string[] = [];
  const lease = {};
  const none = {
    has: () => false,
    list: () => [],
    readyRuntimeLease: () => null,
  };
  const service = createApartmentsService({
    port: memoryApartmentsPort([], () => NOW),
    now: () => NOW,
    tui: () => none,
    core: () => ({
      manager: {
        has: (id) => id === "core",
        list: () => [{ id: "core", label: "core host" }],
        readyRuntimeLease: () => lease,
      },
      hostRuntime: () => ({
        agentSessionFiles: {} as never,
        agentSessions: () => ({
          knownSession: async (address, agent) => {
            asked.push(`${address}:${agent}`);
            return { id: SESSION, holder: "1:70" };
          },
        }),
      }),
    }),
    publish: () => {},
    log: () => {},
  });
  const pane = { pane_id: "t1", terminal_id: "t1", agent: "claude" };
  service.fresh(() => {})("core", 1, [pane], NOW - 1000, [], {});
  service.complete(() => {})("core", 1, []);
  await service.apartments.settled();
  expect(asked).toEqual(["t1:claude"]);
  expect(service.apartments.list().residents[0]).toMatchObject({
    runtime: "herdr-core",
    connection_label: "core host",
    session_id: SESSION,
  });
});

/**
 * A live agent's look, the way Town draws it: the avatar chosen for its pane,
 * else its profile's look; and its table's colour, else its room's.
 */
test("a resident keeps its avatar, its profile and its table's colour", async () => {
  const { STARTER_PROFILES } = await import("../../../shared/agentProfile");
  const { appearanceKey } = await import("../../../shared/appearance");
  const { defaultRoomColorFor } = await import("../../../shared/terminalColor");
  const look = (id: string) =>
    STARTER_PROFILES.find((profile) => profile.id === id)!.look;
  const target = {
    connection_id: "local",
    kind: "pane" as const,
    native_id: "p1",
  };
  const service = createApartmentsService({
    port: memoryApartmentsPort([], () => NOW),
    now: () => NOW,
    tui: () => ({
      has: (id) => id === "local",
      list: () => [{ id: "local", label: "This computer" }],
      readyRuntimeLease: () => null,
    }),
    core: () => null,
    board: () => ({
      get: () => ({
        appearance: {
          [appearanceKey(target)]: {
            ...target,
            witness: ["t1"],
            avatar: "designer",
          },
        },
        layout: { colors: { "local:tab1": "pink" } },
      }),
    }),
    profiles: () => ({
      profile: (id) => STARTER_PROFILES.find((profile) => profile.id === id),
    }),
    publish: () => {},
    log: () => {},
  });
  const launched = (pane: string, terminal: string, tab: string) => ({
    pane_id: pane,
    terminal_id: terminal,
    workspace_id: "w1",
    tab_id: tab,
    agent: "claude",
    tokens: {
      world_terminal: terminal,
      world_profile: "builder",
      world_profile_name: "Builder",
    },
  });
  const panes = [
    // An avatar chosen for it, on a table with its own colour.
    launched("p1", "t1", "tab1"),
    // Its profile's look, on its room's default colour.
    launched("p2", "t2", "tab2"),
    // Started by hand: neither (Town draws it from its key).
    {
      pane_id: "p3",
      terminal_id: "t3",
      workspace_id: "w1",
      tab_id: "tab3",
      agent: "codex",
    },
  ];
  const topology = { workspaces: [{ workspace_id: "w1", label: "alpha" }] };
  service.fresh(() => {})("local", 1, panes, NOW - 1000, [], topology);
  service.complete(() => {})("local", 1, []);
  await service.apartments.settled();
  const kept = Object.fromEntries(
    service.apartments
      .list()
      .residents.map((resident) => [resident.terminal_id, resident.appearance]),
  );
  expect(kept).toEqual({
    t1: { profile_id: "builder", look: look("designer"), color: "pink" },
    t2: {
      profile_id: "builder",
      look: look("builder"),
      color: defaultRoomColorFor("local:w1"),
    },
    t3: {
      profile_id: null,
      look: null,
      color: defaultRoomColorFor("local:w1"),
    },
  });
});

/**
 * A spawned agent on a table without its own colour shows its parent's
 * table colour in Town (withInheritedColors); its resident keeps that one,
 * not its room's, whether the parent is named by its token or a saved claim.
 */
test("a spawned resident keeps the colour it inherited from its parent", async () => {
  const room = (terminal: string, tab: string, tokens?: object) => ({
    pane_id: `p-${terminal}`,
    terminal_id: terminal,
    workspace_id: "w1",
    tab_id: tab,
    agent: "claude",
    ...(tokens ? { tokens } : {}),
  });
  const service = createApartmentsService({
    port: memoryApartmentsPort([], () => NOW),
    now: () => NOW,
    tui: () => ({
      has: (id) => id === "local",
      list: () => [{ id: "local", label: "This computer" }],
      readyRuntimeLease: () => null,
    }),
    core: () => null,
    board: () => ({
      get: () => ({
        layout: { colors: { "local:w1": "pink", "local:tab1": "teal" } },
        relations: {
          spawns: [
            {
              child: { connection_id: "local", terminal_id: "t3" },
              parent: { connection_id: "local", terminal_id: "t1" },
              source: "test",
              generation: 1,
              observed_at: NOW - 5000,
            },
          ],
          groups: [],
        },
      }),
    }),
    publish: () => {},
    log: () => {},
  });
  const panes = [
    room("t1", "tab1"),
    // Named by its spawn token.
    room("t2", "tab2", { spawned_by_terminal: "t1" }),
    // Named by Board's saved claim only.
    room("t3", "tab3"),
    // Not spawned: its room's colour.
    room("t4", "tab4"),
  ];
  const topology = { workspaces: [{ workspace_id: "w1", label: "alpha" }] };
  service.fresh(() => {})("local", 1, panes, NOW - 1000, [], topology);
  service.complete(() => {})("local", 1, []);
  await service.apartments.settled();
  const colors = Object.fromEntries(
    service.apartments
      .list()
      .residents.map((resident) => [
        resident.terminal_id,
        resident.appearance?.color,
      ]),
  );
  expect(colors).toEqual({ t1: "teal", t2: "teal", t3: "teal", t4: "pink" });
});
