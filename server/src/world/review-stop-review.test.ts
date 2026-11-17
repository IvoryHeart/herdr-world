import { afterEach, expect, test } from "bun:test";
import {
  DESK_METADATA_MAX_BYTES,
  deskMetadataBytes,
} from "../../../shared/deskState";
import { deskIdentity } from "../../../web/src/world/useDeskState";
import { terminalMarkInput } from "../storage/testing/terminal-mark-input";
import { WorldSnapshotService } from "./snapshot";
import { reviewPane, reviewStopFixture } from "./testing/review-stop-fixture";

const fixtures: Awaited<ReturnType<typeof reviewStopFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
async function fixture() {
  const f = await reviewStopFixture();
  fixtures.push(f);
  return f;
}

test("re-entering recovery protects all 501 known current captures until fresh classification", async () => {
  const f = await fixture();
  const panes = Array.from({ length: 501 }, (_, i) => reviewPane(i));
  f.setPanes(panes);
  await f.observe();
  const stop = f.stop();
  expect(await f.review()).toBe(true);
  const saved = f.storage.terminalMarks.list();
  f.marks.retire("alpha", 1, false, true);
  await f.marks.expire();
  expect(f.storage.terminalMarks.list()).toEqual(saved);
  expect(f.registries.desk.list().records).toEqual([]);
  await f.observe();
  expect(f.stop()).toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBe(stop);
  expect(f.failures).toEqual([]);
}, 30_000);

test("unknown ownership durably ends a preceding known review before World restart", async () => {
  const f = await fixture();
  await f.observe();
  const stop = f.stop();
  expect(await f.review()).toBe(true);
  f.setPanes([{ ...reviewPane(), agent_session: null }]);
  await f.observe();
  expect(f.stop()).not.toBe(stop);
  expect(
    f.storage.terminalMarks
      .list()
      .find((row) => row.body.reviewed_stop === stop)?.binding.state,
  ).toBe("ended");
  await f.restart();
  f.setPanes([reviewPane()]);
  await f.observe();
  expect(f.stop()).not.toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBeNull();
  expect(
    f.storage.terminalMarks
      .list()
      .some(
        (row) =>
          row.body.reviewed_stop === stop && row.binding.state === "ended",
      ),
  ).toBe(true);
});

async function fullDeskFixture() {
  const f = await fixture();
  const panes = Array.from({ length: 100 }, (_, i) => reviewPane(i));
  f.setPanes(panes);
  await f.observe();
  // Match the writer's canonical unresolved binding representation exactly.
  const bytes = () =>
    deskMetadataBytes(
      f.storage.terminalMarks.list().map((row) => ({
        ...row,
        binding: {
          ...row.binding,
          state: row.binding.state === "ended" ? "ended" : "unresolved",
        },
      })),
    );
  const length =
    Math.floor((DESK_METADATA_MAX_BYTES - bytes()) / panes.length) + 2;
  const mark = (index: number, size: number) =>
    f.client.call("world.desk.review", {
      ...deskIdentity(f.leaf(index)),
      reviewed: true,
      stop_id: "x".repeat(size),
    });
  for (let i = 0; i < panes.length; i++) await mark(i, length);
  const row = f.storage.terminalMarks.list()[0]!,
    input = terminalMarkInput("desk");
  const target = {
    adapter: row.binding.adapter,
    instance: row.binding.instance,
    kind: row.binding.kind,
    native_id: row.binding.native_id,
    evidence: row.binding.evidence,
  };
  await f.storage.terminalMarks.put({
    ...input,
    id: row.id,
    revision: row.revision,
    body: {
      ...row.body,
      reviewed_stop: "x".repeat(length + DESK_METADATA_MAX_BYTES - bytes()),
    },
    target,
    event: {
      type: "listing",
      fence: input.current,
      complete: true,
      entities: [
        {
          native_id: target.native_id,
          terminals: target.evidence.terminals,
          session: target.evidence.session,
        },
      ],
    },
  });
  expect(bytes()).toBe(DESK_METADATA_MAX_BYTES);
  return { f, panes };
}

test("a capacity-refused multi-stop observation changes no durable current row", async () => {
  const { f, panes } = await fullDeskFixture();
  const saved = f.storage.terminalMarks.list(),
    wire = f.registries.desk.list();
  await f.marks.observe(
    "alpha",
    1,
    panes.map((pane, i) => ({
      ...pane,
      state_change_seq: i === 0 ? 5 : i === 1 ? 10 : 4,
    })),
    1002,
  );
  await expect(f.client.call("world.desk.get")).rejects.toThrow(
    "Desk capacity exceeded:",
  );
  expect(f.storage.terminalMarks.list()).toEqual(saved);
  expect(f.registries.desk.list()).toEqual(wire);
  expect(f.failures).toEqual([]);
}, 30_000);

test("a near-capacity observation applies shrinking current updates before growth", async () => {
  const { f, panes } = await fullDeskFixture();
  const next = panes.map((pane, i) => ({
    ...pane,
    agent_status: i > 0 && i <= 5 ? "working" : "done",
    state_change_seq: i === 0 ? 10 : i <= 5 ? 5 : 4,
  }));
  await f.marks.observe("alpha", 1, next, 1002);
  expect(f.failures).toEqual([]);
  await expect(f.client.call("world.desk.get")).resolves.toBeDefined();
  const rows = f.storage.terminalMarks.list();
  expect(rows).toHaveLength(100);
  expect(
    rows.find((row) => row.binding.evidence.terminals[0] === "terminal-0")?.body
      .stateChangeSeq,
  ).toBe(10);
  expect(
    rows.find((row) => row.binding.evidence.terminals[0] === "terminal-1")?.body
      .observed_stop_id,
  ).toBeNull();
}, 30_000);

test("malformed snapshot native identity refuses the complete observation without fatal callback or absence proof", async () => {
  const f = await fixture();
  await f.observe();
  expect(await f.review()).toBe(true);
  const saved = f.storage.terminalMarks.list(),
    wire = f.registries.desk.list();
  const panes = [
    reviewPane(1),
    { ...reviewPane(2), pane_id: "p".repeat(1025) },
  ].map((pane) => ({
    ...pane,
    workspace_id: "synthetic-workspace",
    tab_id: "synthetic-tab",
  }));
  f.setPanes(panes);
  let observed: Promise<unknown> | undefined;
  const runtime = {
    herdr: {
      async call(method: string) {
        if (method === "workspace.list")
          return { workspaces: [{ workspace_id: "synthetic-workspace" }] };
        if (method === "tab.list")
          return {
            tabs: [
              { workspace_id: "synthetic-workspace", tab_id: "synthetic-tab" },
            ],
          };
        return method === "pane.list" ? { panes } : { agents: [] };
      },
    },
  };
  const snapshots = new WorldSnapshotService(
    {
      list: () => [
        {
          id: "alpha",
          label: "Synthetic",
          source: "saved-profile",
          is_default: true,
          state: "ready",
          generation: 1,
        },
      ],
      readyRuntimeLease: (connectionId) => ({
        connectionId,
        generation: 1,
        runtime,
        isCurrent: () => true,
      }),
    },
    () => 1002,
    undefined,
    undefined,
    undefined,
    (connection, generation, admitted, at, agents) => {
      observed = f.marks.observe(connection, generation, admitted, at, agents);
    },
  );
  expect(
    (await snapshots.snapshot()).connections[0]?.snapshot?.panes,
  ).toHaveLength(2);
  await observed;
  expect(f.failures).toEqual([]);
  expect(f.storage.terminalMarks.list()).toEqual(saved);
  expect(f.registries.desk.list()).toEqual(wire);
  await expect(f.client.call("world.desk.get")).rejects.toThrow(
    "Terminal mark observation refused:",
  );
  f.setPanes([reviewPane()]);
  await f.observe();
  expect(f.browsers[0]!.get().verified).toBe(true);
  expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBe(
    saved[0]!.body.reviewed_stop ?? null,
  );
});

test("a malformed retired-runtime observation cannot poison the current Desk", async () => {
  const f = await fixture();
  await f.observe();
  f.retire();
  await f.marks.observe(
    "alpha",
    1,
    [{ ...reviewPane(), pane_id: "p".repeat(1025) }],
    1002,
  );
  expect(f.failures).toEqual([]);
  await expect(f.client.call("world.desk.get")).resolves.toBeDefined();
});

test("an older unknown observation cannot durably end a newer accepted known review", async () => {
  const f = await fixture();
  await f.observe();
  const stop = f.stop();
  expect(await f.review()).toBe(true);
  const saved = f.storage.terminalMarks.list();
  await f.marks.observe(
    "alpha",
    1,
    [{ ...reviewPane(), agent_session: null }],
    1000,
  );
  expect(f.storage.terminalMarks.list()).toEqual(saved);
  await f.observe();
  expect(f.stop()).toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBe(stop);
});
