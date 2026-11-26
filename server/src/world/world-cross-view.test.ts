import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import { runWorldCommand } from "../cli/world";
import type { CliContext } from "../cli/command";
import { createGuiSettingsStore } from "../config/gui-settings";
import { composeWorldPublication } from "../service/world-commands";
import { BoardStore } from "./board-store";
import { parseObservationBase } from "./observation-v1";
import { WorldSnapshotService } from "./snapshot";
import { createWorldCli } from "./world-cli";
import { WorldLedger } from "./world-ledger";
import type {
  GroupingProfile,
  HostGrouping,
} from "../../../shared/hostGrouping";
import type { ConnectionSummary } from "../../../web/src/api";
import {
  hostGroupOf,
  hostGroupRows,
  worldHosts,
} from "../../../web/src/worldHosts";
import {
  groupBoardZones,
  projectBoard,
} from "../../../web/src/world/board/boardModel";
import { otherHostSummaries } from "../../../web/src/world/deskOtherHostsModel";
import { projectWorldOffice } from "../../../web/src/world/herdrOfficeProjection";
import { navigatorHostGroups } from "../../../web/src/world/navigatorGroups";
import { WorldRuntimeStore } from "../../../web/src/world/runtimeStore";
import {
  createTownBuildings,
  townBuildingOf,
} from "../../../web/src/world/town/townBuildings";
import { projectWorldTree } from "../../../web/src/world/treeProjection";
import { buildWorldObject } from "../../../web/src/world/worldObject";

// One World, every view (openspec world-one-object, task 2.2). The service
// publishes one snapshot; two browsers' replicas adopt it; Town, Desk, Board,
// the navigator (Spaces), the Hosts control and `herdr-world ls` each show
// the same facts. Facts so far: 1. grouping.
//
// The machine: this computer's Herdr seen through two connections of one
// socket (a startup default and a saved profile), a second Herdr on another
// socket, and an SSH host. Each fact runs through the service composition
// (world-commands.ts), the browser's decoder and store (runtimeStore.ts) and
// each view's own projection; nothing below derives a fact itself.

const SOCKET = {
  control_socket_path: "/run/herdr-fixture/herdr.sock",
  client_socket_path: "/run/herdr-fixture/herdr-client.sock",
};
const catalogue: (GroupingProfile & ConnectionSummary)[] = [
  ["tui-default", "Studio", "startup-default", SOCKET],
  ["tui-profile", "Studio", "local-profile", SOCKET],
  [
    "second",
    "Second Herdr",
    "local-profile",
    {
      control_socket_path: "/run/herdr-fixture/second.sock",
      client_socket_path: "/run/herdr-fixture/second-client.sock",
    },
  ],
].map(([id, label, source, sockets]) => ({
  id: id as string,
  label: label as string,
  source: source as string,
  is_default: id === "tui-default",
  state: "ready" as const,
  generation: 1,
  type: "local",
  ...(sockets as typeof SOCKET),
}));
catalogue.push({
  id: "remote",
  label: "Remote",
  source: "ssh-profile",
  is_default: false,
  state: "ready",
  generation: 1,
  type: "ssh",
  ssh_destination: "dev.example.test",
  remote_control_socket_path: SOCKET.control_socket_path,
  remote_client_socket_path: SOCKET.client_socket_path,
});

/** What each runtime reports: the shared socket's two views report alike. */
const rooms: Record<string, string[]> = {
  "tui-default": ["Web", "Docs"],
  "tui-profile": ["Web", "Docs"],
  second: ["Lab"],
  remote: ["Api"],
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "world-cross-view-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function service() {
  /** Connections that answer, with their runtime generation. */
  const live = new Map(catalogue.map(({ id }) => [id, 1]));
  let now = 1_000;
  const snapshots = new WorldSnapshotService({
    list: () =>
      catalogue.map(({ id, label, source, is_default }) => ({
        id,
        label,
        source,
        is_default,
        state: live.has(id) ? ("ready" as const) : ("error" as const),
        generation: live.get(id) ?? 1,
      })),
    readyRuntimeLease: (id: string) => {
      const generation = live.get(id);
      if (generation === undefined) return null;
      const workspaces = rooms[id]!.map((label, index) => ({
        workspace_id: `w${index + 1}`,
        label,
      }));
      return {
        connectionId: id,
        generation,
        isCurrent: () => live.get(id) === generation,
        runtime: herdrRuntimeFixture({
          async call(method: string) {
            if (method === "workspace.list") return { workspaces };
            if (method === "tab.list")
              return {
                tabs: workspaces.map(({ workspace_id }) => ({
                  workspace_id,
                  tab_id: `${workspace_id}:t1`,
                  label: "desk",
                })),
              };
            if (method === "pane.list")
              return {
                panes: workspaces.map(({ workspace_id }) => ({
                  workspace_id,
                  tab_id: `${workspace_id}:t1`,
                  pane_id: `${workspace_id}:p1`,
                  terminal_id: `${id}-${workspace_id}`,
                  agent: "claude",
                  agent_status: "idle",
                })),
              };
            return { agents: [] };
          },
        }),
      };
    },
  } as never);
  const ledger = new WorldLedger(join(root, "ledger.json"), {
    persist: false,
    now: () => now,
  });
  const settings = createGuiSettingsStore(join(root, "settings.json"));
  const notices: number[] = [];
  const world = composeWorldPublication({
    now: () => (now += 1),
    connectionManager: { has: () => false } as never,
    core: () => undefined,
    snapshots: snapshots as never,
    ledger: () => ledger,
    invalidate: () => {},
    log: () => {},
    settings,
    broadcast: (line) =>
      notices.push(JSON.parse(line).control.revision as number),
    profiles: () => ({ list: () => catalogue, coreList: () => [] }),
  });
  const cli = createWorldCli({
    board: new BoardStore(join(root, "board.json")),
    ledger,
    hosts: () => [],
    defaultConnectionId: () => "tui-default",
    snapshot: () => snapshots.snapshot(),
    publishBoard: () => {},
    publishLedger: () => {},
    now: () => now,
  });
  return {
    snapshots,
    /** One `world.snapshot` reply, as the service sends it. */
    async reply(params?: unknown) {
      return snapshots.observation.reply(
        await snapshots.snapshot(params),
        parseObservationBase(params),
      );
    },
    ledger,
    notices,
    world,
    /** `herdr-world <args>` as the CLI prints it, JSON or human. */
    async cli(args: string[]) {
      const out: string[] = [];
      const context = {
        version: "0.0.0-test",
        runtime: { env: {} },
        log: (line: string) => out.push(line),
        error: (line: string) => out.push(line),
      } as unknown as CliContext;
      await runWorldCommand(
        args[0]!,
        args.slice(1),
        context,
        (command, params) =>
          cli.handle({ command, params: params ?? {}, caller: {} }, null),
        true,
      );
      return out.join("\n");
    },
    /** The host stops answering, or answers again under a new generation. */
    offline(id: string) {
      live.delete(id);
      snapshots.invalidate(id);
    },
    reconnect(id: string, generation: number) {
      live.set(id, generation);
      snapshots.invalidate(id);
    },
  };
}

/** A browser: its own replica of World, fed by the service's replies. */
function browser(reply: (params?: unknown) => Promise<unknown>) {
  return new WorldRuntimeStore(
    {
      call: (_method, params) => reply(params),
      onControl: () => () => {},
      onStatus: () => () => {},
    },
    async () => {},
  );
}

type Partition = [group: string, connections: string[]][];
const byKey = (a: TownBuilding, b: TownBuilding) => a[0].localeCompare(b[0]);
type TownBuilding = [group: string, keyedBy: string, connections: string[]];
const townBuilding = (
  group: string,
  keyedBy: string,
  ids: string[],
): TownBuilding => [group, keyedBy, [...ids].sort()];

/** Each view's groups, by connection, read off what the view renders. */
function views(replica: WorldRuntimeStore) {
  const state = replica.get();
  const grouping = state.hostGrouping!;
  const world = buildWorldObject(state.connections);
  const groupOf = hostGroupOf(grouping);
  const partition = (
    entries: { key: string; ids: readonly string[] }[],
  ): Partition => entries.map(({ key, ids }) => [key, [...ids]]);

  const office = projectWorldOffice(world, 0);
  const town = createTownBuildings()(office, grouping);
  const hostOf = new Map(office.hosts.map((host) => [host.key, host]));
  // Town places buildings by their saved spots, so each building is
  // compared by its group, the runtime that keys it and who stands in it.
  const buildings = new Map<string, Set<string>>();
  for (const room of town.rooms)
    buildings.set(
      townBuildingOf(room),
      (buildings.get(townBuildingOf(room)) ?? new Set()).add(
        room.workspaceRef.connectionId,
      ),
    );
  return {
    grouping,
    town: [...buildings]
      .map(([building, ids]) =>
        townBuilding(
          groupOf(hostOf.get(building)!.connectionId)!.key,
          hostOf.get(building)!.connectionId,
          [...ids],
        ),
      )
      .sort(byKey),
    /** Town's rooms: their own connection, never the anchor's. */
    townRooms: town.rooms.map(
      (room) => `${room.workspaceRef.connectionId}:${room.displayLabel}`,
    ),
    board: partition(
      groupBoardZones(projectBoard(world), groupOf).zones.map((zone) => ({
        key: zone.key,
        ids: zone.hosts.map((host) => host.connectionId),
      })),
    ),
    navigator: partition(
      navigatorHostGroups(projectWorldTree(world).hosts, groupOf).map(
        (group) => ({
          key: group.key,
          ids: group.members.map(({ source }) => source.connectionId),
        }),
      ),
    ),
    desk: partition(
      otherHostSummaries(world, { ...world, hosts: [] }, groupOf).map(
        (host) => ({
          key: host.key,
          ids: host.connectionIds,
        }),
      ),
    ),
    hosts: partition(
      hostGroupRows(worldHosts({ connections: catalogue }), grouping),
    ),
  };
}

/** The published groups, by connection (all, or those a view shows). */
function published(grouping: HostGrouping, shows?: readonly string[]) {
  return grouping.groups.flatMap(({ key, members }): Partition => {
    const ids = members
      .map((member) => member.connection_id)
      .filter((id) => !shows || shows.includes(id));
    return ids.length ? [[key, ids]] : [];
  });
}

/** Every view shows World's groups: the same members, order and keys. */
function expectAgreement(replica: WorldRuntimeStore) {
  const seen = views(replica);
  const all = published(seen.grouping);
  expect(seen.hosts).toEqual(all);
  const held = replica.get().connections.map((each) => each.connectionId);
  expect(seen.board).toEqual(published(seen.grouping, held));
  expect(seen.navigator).toEqual(published(seen.grouping, held));
  // Desk lists hosts with agents World can show; a down host's are kept.
  expect(seen.desk).toEqual(published(seen.grouping, held));
  // Town shows one view per endpoint, the one World publishes as shown,
  // standing in its anchor's place.
  const standIn = new Map(
    seen.grouping.endpoints.map(({ anchor, shown }) => [anchor, shown]),
  );
  const hidden = seen.grouping.endpoints.flatMap(({ views, anchor }) =>
    views.filter((view) => view !== anchor),
  );
  expect(seen.town).toEqual(
    published(
      seen.grouping,
      held.filter((id) => !hidden.includes(id)),
    )
      .map(([key, ids]) => {
        const shown = ids.map((id) => standIn.get(id) ?? id);
        return townBuilding(key, shown[0]!, shown);
      })
      .sort(byKey),
  );
  return seen;
}

test("grouping: one snapshot, every view and the CLI show the same groups", async () => {
  const world = service();
  const first = browser(world.reply);
  await first.refresh();
  const machine = expectAgreement(first);
  expect(published(machine.grouping)).toEqual([
    ["local", ["tui-default", "second", "tui-profile"]],
    ["ssh:dev.example.test", ["remote"]],
  ]);
  // The shared socket shows once in Town: its anchor, the first writable view.
  expect(machine.grouping.endpoints).toEqual([
    {
      views: ["tui-default", "tui-profile"],
      anchor: "tui-default",
      shown: "tui-default",
    },
  ]);
  expect(machine.townRooms).toEqual([
    "tui-default:Web",
    "tui-default:Docs",
    "remote:Api",
    "second:Lab",
  ]);
  // `herdr-world ls` lists the same groups, JSON and human.
  const listed = JSON.parse(await world.cli(["ls", "--json"])).result;
  expect(listed.grouping).toBe("machine");
  expect(
    listed.groups.map(
      (group: { key: string; runtimes: { connection_id: string }[] }) => [
        group.key,
        group.runtimes.map((runtime) => runtime.connection_id),
      ],
    ),
  ).toEqual(published(machine.grouping));
  expect(await world.cli(["ls"])).toStartWith(
    "Group runtimes: one per machine\nStudio\n",
  );

  // An explicit change is one World command: one revision, one history entry.
  const before = first.get().revision;
  const record = await world.world.settingCommands.submit({
    id: "cmd-1",
    entity: { kind: "setting", key: "runtimeGrouping" },
    field: "value",
    expected: "machine",
    value: "runtime",
  });
  expect(record).toMatchObject({
    state: "stored",
    before: null,
    observed: "runtime",
  });
  expect(world.notices.at(-1)).toBeGreaterThan(before);
  // A second browser opens after the change; the first follows the notice.
  const second = browser(world.reply);
  await Promise.all([first.refresh(), second.refresh()]);
  for (const replica of [first, second]) {
    const seen = expectAgreement(replica);
    expect(seen.grouping.grouping).toBe("runtime");
    expect(seen.board.map(([key]) => key)).toEqual([
      "runtime:tui-default",
      "runtime:remote",
      "runtime:second",
      "runtime:tui-profile",
    ]);
  }
  expect(views(first)).toEqual(views(second));
  expect(await world.cli(["ls"])).toStartWith(
    "Group runtimes: one per runtime\nStudio\n",
  );
  const history = JSON.parse(await world.cli(["history", "--json"])).result;
  expect(
    history.map((change: { summary: string; world_command: unknown }) => [
      change.summary,
      change.world_command,
    ]),
  ).toEqual([
    [
      "Group runtimes unset → by runtime",
      expect.objectContaining({
        expected: "machine",
        value: "runtime",
        before: null,
        observed: "runtime",
        state: "stored",
      }),
    ],
  ]);
});

test("grouping: offline and stale hosts, a reconnect and a late reply change no group and record nothing", async () => {
  const world = service();
  const replica = browser(world.reply);
  await replica.refresh();
  const groups = published(replica.get().hostGrouping!);

  // The anchor goes down: Town shows the live view of its socket in its
  // place, the other views keep both connections, and the groups stand.
  world.offline("tui-default");
  // A reply taken now arrives after a newer one (a late reply).
  const late = (await world.reply()) as { revision: number };
  world.offline("remote");
  await replica.refresh();
  const down = expectAgreement(replica);
  expect(published(down.grouping)).toEqual(groups);
  expect(down.grouping.endpoints[0]).toMatchObject({
    anchor: "tui-default",
    shown: "tui-profile",
  });
  // A takeover never changes a room's own connection.
  expect(down.townRooms.filter((room) => room.endsWith(":Web"))).toEqual([
    "tui-profile:Web",
  ]);
  const newer = replica.get().revision;
  expect(late.revision).toBeLessThan(newer);
  const replies = [await world.reply(), late];
  const ordered = browser(async () => replies.shift());
  await ordered.refresh();
  await ordered.refresh();
  expect(replies).toEqual([]);
  expect(ordered.get().revision).toBe(newer);
  expect(views(ordered)).toEqual(views(replica));

  // Both reconnect under new generations: the anchor shows again.
  world.reconnect("tui-default", 2);
  world.reconnect("remote", 2);
  await replica.refresh();
  const back = expectAgreement(replica);
  expect(published(back.grouping)).toEqual(groups);
  expect(back.grouping.endpoints[0]!.shown).toBe("tui-default");
  expect(back.townRooms.filter((room) => room.endsWith(":Web"))).toEqual([
    "tui-default:Web",
  ]);
  // Regrouping from topology is not a command: no history.
  expect(world.ledger.get().changes).toEqual([]);
});
