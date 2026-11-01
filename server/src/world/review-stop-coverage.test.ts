import { afterEach, expect, test } from "bun:test";
import {
  DESK_IDLE_WINDOW_MS,
  deskMetadataBytes,
  parseDeskState,
} from "../../../shared/deskState";
import { deskIdentity } from "../../../web/src/world/useDeskState";
import { reviewPane, reviewStopFixture } from "./testing/review-stop-fixture";

const fixtures: Awaited<ReturnType<typeof reviewStopFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function fixture() {
  const f = await reviewStopFixture();
  fixtures.push(f);
  return f;
}

for (const status of ["done", "idle", "blocked"])
  test(`first observed ${status} has a review identity without inventing a transition time`, async () => {
    const f = await fixture();
    f.setPanes([{ ...reviewPane(), agent_status: status }]);
    await f.observe();
    const record = f.browsers[0]!.get().records[0];
    expect(record?.observed_stop_id).toBeString();
    expect(record?.stopped_at).toBeNull();
    const stop = f.stop();
    expect(await f.review()).toBe(true);
    for (const browser of f.browsers)
      expect(browser.get().records[0]?.reviewed_stop).toBe(stop);
    await f.observe();
    expect(f.stop()).toBe(stop);
    expect(f.failures).toEqual([]);
  });

for (const reviewed of [false, true])
  test(`aged stop survives SQLite expiry and restart (reviewed before expiry: ${reviewed})`, async () => {
    const f = await fixture();
    f.setPanes([
      { ...reviewPane(), agent_status: "working", state_change_seq: 1 },
    ]);
    await f.observe();
    f.setPanes([reviewPane()]);
    await f.observe();
    const stop = f.stop();
    if (reviewed) expect(await f.review()).toBe(true);
    f.advance(DESK_IDLE_WINDOW_MS + 1);
    await f.refresh();
    expect(f.browsers[0]!.get().records[0]?.stopped_at).toBeNull();
    expect(f.stop()).toBe(stop);
    await f.restart();
    expect(f.registries.desk.list().records).toEqual([]);
    await f.observe();
    expect(f.stop()).toBe(stop);
    expect(await f.review()).toBe(true);
    expect(await f.review()).toBe(true);
    expect(f.failures).toEqual([]);
  });

test("a known session missing on restart never lends its review to an unknown agent", async () => {
  const f = await fixture();
  f.setPanes([
    { ...reviewPane(), agent_status: "working", state_change_seq: 1 },
  ]);
  await f.observe();
  f.setPanes([reviewPane()]);
  await f.observe();
  expect(await f.review()).toBe(true);
  const saved = f.storage.terminalMarks.list();
  await f.restart();
  f.setPanes([{ ...reviewPane(), agent_session: null }]);
  await f.observe();
  expect(
    f.registries.desk
      .list()
      .records.some((record) => record.reviewed_stop !== null),
  ).toBe(false);
  expect(f.storage.terminalMarks.list()).toEqual(
    expect.arrayContaining(
      saved.map((row) => ({
        ...row,
        binding: { ...row.binding, state: "unresolved" },
      })),
    ),
  );
  expect(f.registries.desk.list().records[0]?.observed_stop_id).toBeString();
});

test("unknown-session restart must not fabricate continuity for a saved review", async () => {
  const f = await fixture();
  f.setPanes([{ ...reviewPane(), agent_session: null }]);
  await f.observe();
  // Use the real RPC even on the old baseline that omitted first-observation stops.
  await f.client.call("world.desk.review", {
    ...deskIdentity(f.leaf()),
    stop_id: f.stop(),
    reviewed: true,
  });
  await f.restart();
  await f.observe();
  expect(
    f.registries.desk
      .list()
      .records.some((record) => record.reviewed_stop !== null),
  ).toBe(false);
  expect(f.storage.terminalMarks.list()).toHaveLength(2);
});

test("a verified known session carries the exact stop and acknowledgement across World restart", async () => {
  const f = await fixture();
  await f.observe();
  const stop = f.stop();
  expect(await f.review()).toBe(true);
  await f.restart();
  await f.observe();
  expect(f.stop()).toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.connection_generation).toBe(2);
  f.setPanes([{ ...reviewPane(), state_change_seq: 5 }]);
  await f.observe();
  expect(f.stop()).not.toBe(stop);
});

for (const before of [null, reviewPane().agent_session])
  test(`${before ? "known replacement" : "null-to-known"} never lends a preceding review to the new session`, async () => {
    const f = await fixture();
    f.setPanes([{ ...reviewPane(), agent_session: before }]);
    await f.observe();
    const stop = f.stop();
    expect(await f.review()).toBe(true);
    f.setPanes([reviewPane(0, "replacement")]);
    await f.observe();
    expect(f.stop()).not.toBe(stop);
    expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBeNull();
    expect(
      f.storage.terminalMarks
        .list()
        .some((row) => row.body.reviewed_stop === stop),
    ).toBe(true);
  });

test("Town's blocked-to-idle finish advances its current stop without a native sequence", async () => {
  const f = await fixture();
  f.setPanes([
    { ...reviewPane(), state_change_seq: undefined, agent_status: "blocked" },
  ]);
  await f.observe();
  const stop = f.stop();
  expect(await f.review()).toBe(true);
  f.setPanes([
    { ...reviewPane(), state_change_seq: undefined, agent_status: "idle" },
  ]);
  await f.observe();
  expect(f.stop()).not.toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.stopped_at).toBeNumber();
});

test("a known fingerprint returning after unknown ownership does not recover the old review", async () => {
  const f = await fixture();
  await f.observe();
  const stop = f.stop();
  expect(await f.review()).toBe(true);
  f.setPanes([{ ...reviewPane(), agent_session: null }]);
  await f.observe();
  f.setPanes([reviewPane()]);
  await f.observe();
  expect(f.stop()).not.toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBeNull();
  expect(
    f.storage.terminalMarks
      .list()
      .some((row) => row.body.reviewed_stop === stop),
  ).toBe(true);
});

test("550 current stops survive while only the oldest history beyond 500 is evicted", async () => {
  const f = await fixture();
  f.setPanes(Array.from({ length: 550 }, (_, i) => reviewPane(i)));
  await f.observe();
  expect(f.failures).toEqual([]);
  expect(f.registries.desk.list().records).toHaveLength(550);
  expect(parseDeskState(f.registries.desk.list())).not.toBeNull();
  const stop = f.stop();
  expect(await f.review()).toBe(true);
  await f.observe();
  expect(f.stop()).toBe(stop);
  expect(f.browsers[1]!.get().records[0]?.reviewed_stop).toBe(stop);
  expect(f.storage.terminalMarks.list()).toHaveLength(550);
  expect(deskMetadataBytes(f.storage.terminalMarks.list())).toBeLessThan(
    768 * 1024,
  );
  await f.restart();
  await f.observe();
  expect(f.stop()).toBe(stop);
  expect(f.browsers[0]!.get().records[0]?.reviewed_stop).toBe(stop);
  const oldIds = f.storage.terminalMarks.list().map((row) => row.id);
  f.setPanes(
    Array.from({ length: 550 }, (_, i) => reviewPane(i, `replacement-${i}`)),
  );
  await f.observe();
  expect(f.failures).toEqual([]);
  expect(f.registries.desk.list().records).toHaveLength(550);
  const rows = f.storage.terminalMarks.list();
  expect(rows.filter((row) => row.binding.state === "ended")).toHaveLength(500);
  expect(oldIds.filter((id) => !rows.some((row) => row.id === id))).toEqual(
    oldIds.slice(0, 50),
  );
  expect(rows.filter((row) => row.binding.state !== "ended")).toHaveLength(550);
}, 60_000);

test("SQLite refuses an over-budget review without evicting any current stop or acknowledging it", async () => {
  const f = await fixture();
  f.setPanes(Array.from({ length: 100 }, (_, i) => reviewPane(i)));
  await f.observe();
  let refused = false;
  let reason: unknown;
  for (let index = 0; index < 100; index++) {
    try {
      await f.client.call("world.desk.review", {
        ...deskIdentity(f.leaf(index)),
        reviewed: true,
        stop_id: "x".repeat(8192),
      });
    } catch (error) {
      refused = true;
      reason = error;
      break;
    }
  }
  expect(refused).toBe(true);
  expect(String(reason)).toContain("Desk capacity exceeded:");
  await f.refresh();
  expect(f.storage.terminalMarks.list()).toHaveLength(100);
  expect(f.registries.desk.list().records).toHaveLength(100);
  expect((await f.storage.inspect()).integrity).toBe("ok");
}, 30_000);

test("an oversized observation is a labelled refusal, with no partial current projection", async () => {
  const f = await fixture();
  f.setPanes(
    Array.from({ length: 1000 }, (_, i) => ({
      ...reviewPane(i),
      terminal_id: `terminal-${i}-` + "t".repeat(490),
    })),
  );
  await f.marks.observe(
    "alpha",
    1,
    Array.from({ length: 1000 }, (_, i) => ({
      ...reviewPane(i),
      terminal_id: `terminal-${i}-` + "t".repeat(490),
    })),
    1001,
  );
  expect(f.failures).toEqual([]);
  await expect(f.client.call("world.desk.get")).rejects.toThrow(
    "Desk capacity exceeded:",
  );
  expect(f.registries.desk.list().records).toEqual([]);
  expect(f.storage.terminalMarks.list()).toEqual([]);
  f.setPanes([reviewPane()]);
  await f.observe();
  expect(f.registries.desk.list().records).toHaveLength(1);
  expect(f.browsers[0]!.get().verified).toBe(true);
}, 30_000);
