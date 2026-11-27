import { appLayoutFixture } from "./testing/app-layout.fixture";
import { until } from "./testing/core-world";
import { moveCore } from "./town-move";
import { createCoreRoom, launchCore } from "./operations";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import type { RpcServices } from "../rpc/context";
import type { ServerWebSocket } from "bun";
import { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { createLegacyRoutingLogger } from "../connections/protocol";
import { afterEach, expect, test } from "bun:test";
import { coreWorld } from "./testing/core-world";
import { bridge } from "../../../web/src/api";
import {
  projectWorldOffice,
  TOWN_PRESENTATION_BOUNDS,
} from "../../../web/src/world/herdrOfficeProjection";
import type { WorldRuntimeConnection } from "../../../web/src/world/runtimeStore";
import { buildWorldObject } from "../../../web/src/world/worldObject";
import {
  requestAgentMove,
  requestDeskMove,
} from "../../../web/src/world/town/townMoves";

const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
const connection = bridge.connection;
const call = bridge.call;
afterEach(async () => {
  bridge.connection = connection;
  bridge.call = call;
  for (const world of worlds.splice(0)) await world.dispose();
});

test("Town moves core agents between desks and rooms through placement labels", async () => {
  const core = await coreWorld();
  worlds.push(core);
  for (const [space, tab] of [
    ["source", "a"],
    ["source", "b"],
    ["target", "c"],
  ]) {
    const address = core.fake.create({
      argv: ["claude"],
      labels: {
        "herdr.space": space!,
        "herdr.tab": tab!,
        where: `${space} / ${tab}`,
      },
    });
    core.fake.report(address, { state: "working", app: "claude" });
  }
  core.fake.setAppLayout(
    appLayoutFixture(
      {
        id: "source",
        name: "source",
        tabs: [
          { id: "a", name: "a" },
          { id: "b", name: "b" },
        ],
      },
      { id: "target", name: "target", tabs: [{ id: "c", name: "c" }] },
    ),
  );
  await core.connect();
  const rows = await core.rows();
  const lease = core.lease();
  const world = buildWorldObject(
    [
      {
        connectionId: "box",
        label: "Core",
        source: "saved-profile",
        runtime: "herdr-core",
        isDefault: true,
        state: "ready",
        generation: lease.generation,
        snapshotGeneration: lease.generation,
        stale: false,
        actionable: true,
        snapshot: {
          ...rows,
          agents: [],
        } as unknown as WorldRuntimeConnection["snapshot"],
      },
    ],
    "box",
  );
  const office = projectWorldOffice(world, 1, null, TOWN_PRESENTATION_BOUNDS);
  const source = office.paneRoster.find(
    ({ device }) => device.paneRef.nativeId === "t1",
  )!.device;
  const desk = (address: string) =>
    office.deskRoster.find(({ desk }) =>
      desk.paneDevices.some((device) => device.paneRef.nativeId === address),
    )!.desk;
  const target = desk("t3");
  expect(source.coreOpen).toBe(true);
  expect(desk("t1").coreOpen).toBe(true);
  const requests: string[] = [];
  bridge.connection = ((id: string) => {
    requests.push(id);
    throw new Error("Core must never acquire a TUI move client");
  }) as typeof bridge.connection;
  bridge.call = async (method, params) => {
    const response = Promise.withResolvers<unknown>();
    const socket = {} as ServerWebSocket<unknown>;
    const dispatch = createRpcDispatcher(
      {
        clients: new Set([socket]),
        connectionManager: new ConnectionManager<LegacyConnectionRuntime>(
          "tui",
        ),
        coreControl: { manager: core.core.manager, topology: core.topology },
        publishWorldInvalidation() {},
        markRpcError() {},
        snapshotAdmission: { acknowledge: () => false },
        safeSend(_socket: unknown, payload: string) {
          const message = JSON.parse(payload);
          if (message.error) response.reject(new Error(message.error.message));
          else response.resolve(message.result);
          return true;
        },
      } as unknown as RpcServices,
      createLegacyRoutingLogger({ log() {} }),
    );
    await dispatch(socket, JSON.stringify({ id: "move", method, params }));
    return response.promise;
  };
  const before = core.fake.calls.length;
  for (const outcome of [
    await requestAgentMove(source, desk("t2"), false),
    await requestAgentMove(source, target, false),
  ]) {
    expect(outcome).toMatchObject({
      status: "moved",
    });
  }
  expect(requests).toEqual([]);
  await core.settle();
  const after = await core.rows();
  expect(after.panes.find((p) => p.pane_id === "t1")).toMatchObject({
    workspace_id: rows.panes.find((p) => p.pane_id === "t3")!.workspace_id,
    tab_id: target.tabRef.nativeId,
  });
  const writes = core.fake.calls
    .slice(before)
    .filter((c) => c.method === "terminal.label");
  expect(writes).toHaveLength(2);
  expect(core.fake.terminal("t1")?.labels).toMatchObject({
    "herdr.space": "target",
    "herdr.tab": "c",
    where: "target / c",
  });
  // Move the whole multi-agent desk back into the source room.
  expect(
    await requestDeskMove(
      target,
      office.rooms.find((r) => r.key === desk("t2").roomKey)!,
      false,
    ),
  ).toMatchObject({ status: "moved" });
  await core.settle();
  const moved = await core.rows();
  const one = moved.panes.find((p) => p.pane_id === "t1")!;
  const three = moved.panes.find((p) => p.pane_id === "t3")!;
  expect(one.workspace_id).toBe(
    rows.panes.find((p) => p.pane_id === "t2")!.workspace_id,
  );
  expect(one.tab_id).toBe(three.tab_id);
  expect(
    core.fake.calls.some((c) =>
      ["terminal.run", "terminal.kill"].includes(c.method),
    ),
  ).toBe(false);
});

async function fixture(options: Parameters<typeof coreWorld>[0] = {}) {
  const w = await coreWorld(options);
  worlds.push(w);
  for (const [space, tab] of [
    ["one", "a"],
    ["one", "a"],
    ["two", "b"],
  ]) {
    w.fake.create({
      argv: ["claude"],
      labels: {
        "herdr.space": space!,
        "herdr.tab": tab!,
        where: `${space} / ${tab}`,
        "herdr.seen": "7",
        "herdr.pinned": "1",
        "herdr-world.summary": "Keep this",
      },
    });
  }
  await w.connect();
  return w;
}
const tabFor = async (
  w: Awaited<ReturnType<typeof coreWorld>>,
  address: string,
) => String((await w.rows()).panes.find((p) => p.pane_id === address)!.tab_id);

test("two desks moved into Crew keep one space ID and distinct tab IDs", async () => {
  const w = await fixture();
  w.fake.setAppLayout(appLayoutFixture({ id: "crew", name: "Crew" }));
  await w.settle();
  await until(() => w.lease().runtime.core.mirror.appLayoutCurrent);
  w.fake.create({
    labels: {
      "herdr.space": "crew",
      "herdr.tab": "crew-anchor",
      where: "Crew / Anchor",
    },
  });
  await w.settle();
  const before = w.fake.calls.length;
  for (const address of ["t1", "t3"]) {
    expect(
      await moveCore(w.lease(), w.topology, {
        kind: "desk",
        tab_id: await tabFor(w, address),
        workspace_id: "hc:space:crew",
      }),
    ).toMatchObject({ status: "moved" });
  }
  const moved = ["t1", "t2", "t3"].map((a) => w.fake.terminal(a)!);
  expect(moved[0]!.labels!["herdr.tab"]).toBe(moved[1]!.labels!["herdr.tab"]);
  expect(moved[0]!.labels!["herdr.tab"]).not.toBe(
    moved[2]!.labels!["herdr.tab"],
  );
  for (const record of moved) {
    expect(structuredClone(record.labels)).toMatchObject({
      "herdr.space": "crew",
      "herdr.tab": expect.stringMatching(/^world-b[0-9a-f]{12}$/),
      "herdr.seen": "7",
      "herdr.pinned": "1",
      "herdr-world.summary": "Keep this",
      where: expect.stringMatching(/^Crew \/ /),
    });
  }
  expect(
    w.fake.calls
      .slice(before)
      .some((c) =>
        ["terminal.run", "terminal.kill", "doc.set"].includes(c.method),
      ),
  ).toBe(false);
});

test("World-started agents and shells move between World rooms, app spaces and existing app desks", async () => {
  const w = await fixture();
  const lease = w.lease();
  const room = await createCoreRoom(lease, w.topology, "Workshop");
  const launch = async (kind: string | null) => {
    const result = await launchCore(
      lease,
      {
        workspaceId: room.workspace_id,
        kind,
        label: kind ?? "Shell",
        text: "",
      },
      {
        topology: w.topology,
        resolveExecutable: async () => "/opt/example/bin/claude",
      },
    );
    if (!("terminal_id" in result)) throw new Error("launch failed");
    return result.terminal_id;
  };
  const agent = await launch("claude");
  const shell = await launch(null);
  await w.settle();
  expect(
    await moveCore(lease, w.topology, {
      kind: "pane",
      pane_id: agent,
      tab_id: await tabFor(w, shell),
    }),
  ).toMatchObject({ status: "moved" });
  expect(await tabFor(w, agent)).toBe(await tabFor(w, shell));
  const moved = await moveCore(lease, w.topology, {
    kind: "desk",
    tab_id: await tabFor(w, shell),
    workspace_id: "hc:space:two",
  });
  expect(moved).toMatchObject({
    status: "moved",
    workspace_id: "hc:space:two",
  });
  expect(await tabFor(w, agent)).toBe(await tabFor(w, shell));
  // Moving back onto an app-owned tab must remove World's old override.
  expect(
    await moveCore(lease, w.topology, {
      kind: "pane",
      pane_id: agent,
      tab_id: await tabFor(w, "t3"),
    }),
  ).toMatchObject({ status: "moved" });
  expect(await tabFor(w, agent)).toBe(await tabFor(w, "t3"));
  expect(
    w.topology
      .get(lease.runtime.core.epoch!.coreId)
      .rooms.flatMap((r) => r.tabs)
      .flatMap((t) => t.terminals),
  ).not.toContain(agent);
  expect(w.fake.terminal(agent)!.state).toBe("live");
});

test("a whole core desk moves all its terminals and preserves their identities and other labels", async () => {
  const w = await fixture();
  const original = ["t1", "t2"].map((a) =>
    structuredClone(w.fake.terminal(a)!),
  );
  const room = await createCoreRoom(w.lease(), w.topology, "Studio");
  const result = await moveCore(w.lease(), w.topology, {
    kind: "desk",
    tab_id: await tabFor(w, "t1"),
    workspace_id: room.workspace_id,
  });
  expect(result).toMatchObject({
    status: "moved",
    workspace_id: room.workspace_id,
  });
  const after = await w.rows();
  for (const record of original) {
    expect(
      after.panes.find((p) => p.pane_id === record.address)?.workspace_id,
    ).toBe(room.workspace_id);
    expect(w.fake.terminal(record.address)).toMatchObject({
      pid: record.pid,
      argv: record.argv,
      state: "live",
      labels: {
        "herdr.seen": "7",
        "herdr.pinned": "1",
        "herdr-world.summary": "Keep this",
      },
    });
  }
  expect(await tabFor(w, "t1")).toBe(await tabFor(w, "t2"));
  expect(
    w.fake.calls.filter((c) => c.method === "terminal.label"),
  ).toHaveLength(2);
});

test("core moves refuse stale leases, missing destinations and unavailable labels before writing", async () => {
  const w = await fixture();
  const lease = w.lease();
  const request = {
    kind: "pane" as const,
    pane_id: "t1",
    tab_id: await tabFor(w, "t3"),
  };
  expect(
    await moveCore({ ...lease, isCurrent: () => false }, w.topology, request),
  ).toMatchObject({ status: "refused", reason: "stale" });
  expect(
    await moveCore(lease, w.topology, { ...request, tab_id: "gone" }),
  ).toMatchObject({ status: "refused", reason: "not_found" });
  const offers = lease.runtime.offers;
  lease.runtime.offers = () => false;
  try {
    expect(await moveCore(lease, w.topology, request)).toMatchObject({
      status: "refused",
      message: expect.stringContaining("terminal.label"),
    });
  } finally {
    lease.runtime.offers = offers;
  }
  expect(
    w.fake.calls.filter((c) => c.method === "terminal.label"),
  ).toHaveLength(0);
});

test("a replaced source during a desk move stops later writes and reports a partial result", async () => {
  const w = await fixture();
  const room = await createCoreRoom(w.lease(), w.topology, "Studio");
  w.fake.onCall = (method) => {
    if (method === "terminal.label")
      w.fake.replaceWithShell("t2", { reusePid: true });
  };
  const result = await moveCore(w.lease(), w.topology, {
    kind: "desk",
    tab_id: await tabFor(w, "t1"),
    workspace_id: room.workspace_id,
  });
  expect(result).toMatchObject({
    status: "failed",
    rolled_back: false,
    topology_known: false,
  });
  expect(
    w.fake.calls.filter((c) => c.method === "terminal.label"),
  ).toHaveLength(1);
  expect(
    (await w.rows()).panes.find((p) => p.pane_id === "t1")?.workspace_id,
  ).toBe(room.workspace_id);
});

test("a lost label reply stays uncertain and is never retried", async () => {
  const w = await fixture();
  w.fake.dropNextWriteReply = true;
  w.fake.onCall = (method) => {
    if (method === "terminal.label")
      queueMicrotask(() => w.fake.kill(w.socket));
  };
  const result = await moveCore(w.lease(), w.topology, {
    kind: "pane",
    pane_id: "t1",
    tab_id: await tabFor(w, "t3"),
  });
  expect(result).toMatchObject({
    status: "failed",
    rolled_back: false,
    topology_known: false,
  });
  expect(
    w.fake.calls.filter((c) => c.method === "terminal.label"),
  ).toHaveLength(1);
});

for (const placed of [false, true])
  test(`moving a parent alone leaves its inherited child at the source (${placed ? "app" : "main"})`, async () => {
    const w = await coreWorld();
    worlds.push(w);
    const labels: Record<string, string> = placed
      ? { "herdr.space": "one", "herdr.tab": "a", where: "one / a" }
      : {};
    const parent = w.fake.create({ argv: ["claude"], labels });
    const child = w.fake.create({ argv: ["claude"], parent });
    const target = w.fake.create({
      argv: ["claude"],
      labels: { "herdr.space": "two", "herdr.tab": "b", where: "two / b" },
    });
    await w.connect();
    const sourceRoom = (await w.rows()).panes.find(
      (p) => p.pane_id === child,
    )!.workspace_id;
    expect(
      await moveCore(w.lease(), w.topology, {
        kind: "pane",
        pane_id: parent,
        tab_id: await tabFor(w, target),
      }),
    ).toMatchObject({ status: "moved" });
    expect(
      (await w.rows()).panes.find((p) => p.pane_id === child)!.workspace_id,
    ).toBe(sourceRoom);
    expect(await tabFor(w, child)).not.toBe(await tabFor(w, parent));
  });

for (const retireAt of ["queue", "publication"] as const)
  test(`a core move retains its original authority at ${retireAt}`, async () => {
    const w = await fixture();
    const lease = w.lease();
    let current = true;
    const retiringLease = {
      ...lease,
      isCurrent: () => current && lease.isCurrent(),
    };
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const label = lease.runtime.label;
    lease.runtime.label = async (fence, labels) => {
      await label(fence, labels);
      entered.resolve();
      await release.promise;
    };
    const room = await createCoreRoom(lease, w.topology, "Studio");
    const request = {
      kind: "desk" as const,
      tab_id: await tabFor(w, "t1"),
      workspace_id: room.workspace_id,
    };
    const first = moveCore(
      retireAt === "publication" ? retiringLease : lease,
      w.topology,
      request,
    );
    await entered.promise;
    const queued =
      retireAt === "queue"
        ? moveCore(retiringLease, w.topology, request)
        : null;
    current = false;
    release.resolve();
    const result = await first;
    if (retireAt === "queue") {
      expect(result.status).toBe("moved");
      expect(await queued).toMatchObject({
        status: "refused",
        reason: "stale",
      });
      expect(
        w.fake.calls.filter((c) => c.method === "terminal.label"),
      ).toHaveLength(2);
    } else {
      expect(result).toMatchObject({
        status: "failed",
        rolled_back: false,
        topology_known: false,
      });
      expect(
        w.fake.calls.filter((c) => c.method === "terminal.label"),
      ).toHaveLength(1);
      expect(
        w.topology
          .get(lease.runtime.core.epoch!.coreId)
          .rooms.find((r) => r.id !== "main")?.tabs,
      ).toEqual([]);
    }
    lease.runtime.label = label;
  });

test("moving a World-started parent does not carry its inherited child to the new desk", async () => {
  const w = await fixture();
  const room = await createCoreRoom(w.lease(), w.topology, "Studio");
  const started = await launchCore(
    w.lease(),
    { workspaceId: room.workspace_id, kind: "claude", label: "Lead", text: "" },
    {
      topology: w.topology,
      resolveExecutable: async () => "/opt/example/bin/claude",
    },
  );
  if (!("terminal_id" in started)) throw new Error("launch failed");
  const child = w.fake.create({
    argv: ["claude"],
    parent: started.terminal_id,
  });
  await w.settle();
  expect(
    await moveCore(w.lease(), w.topology, {
      kind: "pane",
      pane_id: started.terminal_id,
      tab_id: await tabFor(w, "t3"),
    }),
  ).toMatchObject({ status: "moved" });
  expect(
    (await w.rows()).panes.find((p) => p.pane_id === child)!.workspace_id,
  ).toBe(room.workspace_id);
});
