import { expect, test } from "bun:test";
import { townQuestion, townChoices, townScreenLines } from "./townChat";
import { TownScaleRuntime } from "./townScaleRuntime";

const order = <T extends { number: number }, K>(items: T[], id: (t: T) => K) =>
  [...items].sort((a, b) => a.number - b.number).map(id);

test("the scale scene's hosts rename, close and reorder rooms and desks", async () => {
  const scene = new TownScaleRuntime();
  let changes = 0;
  scene.subscribe(() => changes++);
  const atlas = () => scene.get()[0]!.snapshot!;
  const client = scene.client("scene-atlas")!;
  expect(scene.client("local")).toBeNull();
  const rooms = () =>
    order(atlas().workspaces, (workspace) => workspace.workspace_id);
  expect(rooms().slice(0, 3)).toEqual([
    "atlas-orbit",
    "atlas-harbor",
    "atlas-lantern",
  ]);

  await client.call("workspace.rename", {
    workspace_id: "atlas-orbit",
    label: "orbit two",
  });
  expect(
    atlas().workspaces.find((w) => w.workspace_id === "atlas-orbit")?.label,
  ).toBe("orbit two");

  // Herdr inserts before the room at insert_index, counted before removal.
  await client.call("workspace.move", {
    workspace_id: "atlas-harbor",
    insert_index: 0,
  });
  expect(rooms().slice(0, 3)).toEqual([
    "atlas-harbor",
    "atlas-orbit",
    "atlas-lantern",
  ]);
  await client.call("workspace.move", {
    workspace_id: "atlas-harbor",
    insert_index: 3,
  });
  expect(rooms().slice(0, 3)).toEqual([
    "atlas-orbit",
    "atlas-lantern",
    "atlas-harbor",
  ]);

  await client.call("workspace.close", { workspace_id: "atlas-lantern" });
  expect(rooms()).not.toContain("atlas-lantern");
  expect(atlas().tabs.some((tab) => tab.workspace_id === "atlas-lantern")).toBe(
    false,
  );
  // The rooms after it close up: Herdr's numbers stay 1…n.
  expect(order(atlas().workspaces, (w) => w.number)).toEqual(
    atlas().workspaces.map((_, index) => index + 1),
  );

  const desks = () =>
    order(
      atlas().tabs.filter((tab) => tab.workspace_id === "atlas-orbit"),
      (tab) => tab.tab_id,
    );
  await client.call("tab.move", { tab_id: "atlas-orbit-t2", insert_index: 0 });
  expect(desks().slice(0, 3)).toEqual([
    "atlas-orbit-t2",
    "atlas-orbit-t0",
    "atlas-orbit-t1",
  ]);
  expect(changes).toBe(5);
  await expect(client.call("pane.close", {})).rejects.toThrow(
    "synthetic hosts cannot pane.close",
  );
});

test("an asking scene agent shows answers; an answer finishes its turn for review", async () => {
  let now = 1_000_000_000;
  const scene = new TownScaleRuntime(() => now, 5);
  const desk = await scene.deskClient.call("world.desk.get");
  // Every finished agent has a stop to review.
  const done = scene
    .get()
    .flatMap((host) => host.snapshot!.panes)
    .filter((pane) => pane.agent_status === "done");
  expect((desk as { records: unknown[] }).records).toHaveLength(done.length);

  const asking = scene
    .get()
    .flatMap((host) =>
      host.snapshot!.panes.map((pane) => ({ host: host.connectionId, pane })),
    )
    .find(({ pane }) => pane.task_summary?.startsWith("Asks:"))!;
  const client = scene.client(asking.host)!;
  const read = (await client.call("pane.read", {
    pane_id: asking.pane.pane_id,
  })) as { read: { text: string } };
  const lines = townScreenLines(read.read.text, 12);
  expect(townChoices(lines).map((choice) => choice.label)).toEqual([
    "Yes",
    "Yes, and don't ask again",
    "No, tell the agent what to do",
  ]);
  expect(townQuestion(townScreenLines(read.read.text), true).question).toEqual([
    "Allow running the migration?",
  ]);
  const latest = (await client.call("agent_conversation.latest", {
    pane_id: asking.pane.pane_id,
  })) as { status: string; latest: { text: string } };
  expect(latest.status).toBe("ok");
  expect(latest.latest.text).toContain("May I run the migration?");

  const pushes: unknown[] = [];
  scene.deskClient.onControl((control) => pushes.push(control));
  const status = () =>
    scene
      .get()
      .flatMap((host) => host.snapshot!.panes)
      .find((pane) => pane.pane_id === asking.pane.pane_id)?.agent_status;
  await client.call("pane.send_input", {
    pane_id: asking.pane.pane_id,
    text: "1",
    keys: [],
  });
  expect(status()).toBe("working");
  now += 4_000;
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Herdr reports the finished turn as idle; the service saw its stop.
  expect(status()).toBe("idle");
  expect(pushes).toEqual([{ type: "world_desk_changed" }]);
  const after = (await scene.deskClient.call("world.desk.get")) as {
    records: { terminal_id: string; stopped_at: number; reviewed_stop: null }[];
  };
  const stop = after.records.find(
    (record) => record.terminal_id === asking.pane.terminal_id,
  )!;
  expect(stop.stopped_at).toBe(now);

  const reviewed = (await scene.deskClient.call("world.desk.review", {
    ...stop,
    stop_id: "stop-1",
    reviewed: true,
  })) as { records: { terminal_id: string; reviewed_stop: string | null }[] };
  expect(
    reviewed.records.find(
      (record) => record.terminal_id === asking.pane.terminal_id,
    )?.reviewed_stop,
  ).toBe("stop-1");
});
