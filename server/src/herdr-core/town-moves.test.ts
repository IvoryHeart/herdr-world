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
  requestDeskReorder,
} from "../../../web/src/world/town/townMoves";

const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
const connection = bridge.connection;
afterEach(async () => {
  bridge.connection = connection;
  for (const world of worlds.splice(0)) await world.dispose();
});

test("Town moves from real core provider rows refuse without writing or falling back to TUI", async () => {
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
  const room = office.rooms.find((room) => room.key === target.roomKey)!;
  expect(source.coreOpen).toBe(true);
  expect(desk("t1").coreOpen).toBe(true);
  const requests: string[] = [];
  bridge.connection = ((id: string) => {
    requests.push(id);
    throw new Error("Core must never acquire a TUI move client");
  }) as typeof bridge.connection;
  const before = core.fake.calls.length;
  for (const outcome of [
    await requestAgentMove(source, desk("t2"), false),
    await requestAgentMove(source, target, false),
    await requestDeskMove(desk("t1"), room, false),
    await requestDeskReorder(desk("t1"), desk("t2")),
  ]) {
    expect(outcome).toMatchObject({
      status: "refused",
      reason: "unsupported",
      message: expect.stringContaining("not supported for herdr-core"),
    });
  }
  expect(requests).toEqual([]);
  expect(core.fake.calls.slice(before)).toEqual([]);
  expect(await core.rows()).toEqual(rows);
});
