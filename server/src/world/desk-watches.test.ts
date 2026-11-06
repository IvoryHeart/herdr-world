import { expect, test } from "bun:test";
import { DeskWatches } from "./desk-watches";
import type {
  DeskReadNotice,
  DeskReadTarget,
} from "../../../shared/deskAcquisition";

const alpha = {
  connection_id: "alpha",
  connection_generation: 1,
  pane_id: "pane-a",
  session: "a".repeat(64),
};
const beta = {
  connection_id: "beta",
  connection_generation: 2,
  pane_id: "pane-b",
  session: "b".repeat(64),
};
const receipt = (target = alpha, trigger = "stopped-a") => ({
  ...target,
  trigger,
});
function fixture() {
  let now = 0,
    value = 1,
    error = false;
  const jobs = new Set<{ at: number; callback: () => void }>();
  const generations = new Map([
    ["alpha", 1],
    ["beta", 2],
  ]);
  const reads: { kind: string; target: DeskReadTarget }[] = [];
  const notices: { socket: string; frame: DeskReadNotice }[] = [];
  let pending: Promise<void> | undefined;
  const watches = new DeskWatches<string>({
    scheduler: {
      schedule(callback, ms) {
        const job = { at: now + ms, callback };
        jobs.add(job);
        return { cancel: () => jobs.delete(job) };
      },
    },
    lease(target) {
      const generation = generations.get(target.connection_id);
      return generation !== target.connection_generation
        ? null
        : {
            isCurrent: () =>
              generations.get(target.connection_id) === generation,
            async read(kind, target) {
              reads.push({ kind, target });
              const result = { value };
              if (target.connection_id === "alpha") await pending;
              if (error) throw new Error("synthetic read failure");
              return { result };
            },
          };
    },
    send(socket, frame) {
      notices.push({ socket, frame });
      return true;
    },
  });
  return {
    watches,
    jobs,
    generations,
    reads,
    notices,
    value(next: number) {
      value = next;
    },
    fail(next: boolean) {
      error = next;
    },
    block(next?: Promise<void>) {
      pending = next;
    },
    async tick(ms = 0) {
      now += ms;
      await Promise.all(
        [...jobs]
          .filter((job) => job.at <= now)
          .map(async (job) => {
            if (jobs.delete(job)) await job.callback();
          }),
      );
    },
  };
}

test("two sockets share each pane read, unchanged successes are suppressed, and last release stops work", async () => {
  const f = fixture();
  f.watches.declare("one", { screens: [alpha], receipts: [receipt()] });
  f.watches.declare("two", { screens: [alpha], receipts: [receipt()] });
  expect(f.notices).toEqual([]);
  await f.tick();
  expect(f.reads.map((r) => r.kind).sort()).toEqual(["receipt", "screen"]);
  expect(f.notices).toHaveLength(4);
  await f.tick(4000);
  expect(f.reads).toHaveLength(3);
  expect(f.notices).toHaveLength(4);
  f.watches.release("one");
  f.value(2);
  await f.tick(16000);
  expect(f.notices.slice(4).every((n) => n.socket === "two")).toBeTrue();
  f.watches.release("two");
  const count = f.reads.length;
  await f.tick(20000);
  expect(f.reads).toHaveLength(count);
  expect(f.jobs.size).toBe(0);
});

test("captured triggers are per holder, late joins get null, and new stops receive identical receipts", async () => {
  const f = fixture(),
    pending = Promise.withResolvers<void>();
  f.block(pending.promise);
  f.watches.declare("one", { screens: [], receipts: [receipt(alpha, "a")] });
  const reading = f.tick();
  expect(f.reads).toHaveLength(1);
  f.watches.declare("two", { screens: [], receipts: [receipt(alpha, "b")] });
  f.watches.declare("one", { screens: [], receipts: [receipt(alpha, "c")] });
  pending.resolve();
  await reading;
  expect(f.notices.map((n) => [n.socket, n.frame.trigger])).toEqual([
    ["one", "a"],
    ["two", null],
  ]);
  f.block();
  await f.tick();
  expect(f.reads).toHaveLength(2);
  expect(f.notices.slice(2).map((n) => [n.socket, n.frame.trigger])).toEqual([
    ["one", "c"],
    ["two", "b"],
  ]);
  await f.tick(20000);
  expect(f.notices).toHaveLength(4);
  f.watches.stop();
});

test("every failure is delivered with each holder's captured trigger and success resets its failure count", async () => {
  const f = fixture();
  f.fail(true);
  f.watches.declare("one", { screens: [], receipts: [receipt(alpha, "a")] });
  f.watches.declare("two", { screens: [], receipts: [receipt(alpha, "b")] });
  await f.tick();
  await f.tick(20000);
  expect(
    f.notices.map((n) => [n.socket, n.frame.trigger, n.frame.failures]),
  ).toEqual([
    ["one", "a", 1],
    ["two", "b", 1],
    ["one", "a", 2],
    ["two", "b", 2],
  ]);
  f.watches.declare("one", { screens: [], receipts: [receipt(alpha, "c")] });
  await f.tick();
  expect(
    f.notices
      .slice(-2)
      .map((n) => [n.socket, n.frame.trigger, n.frame.failures]),
  ).toEqual([
    ["one", "c", 1],
    ["two", "b", 3],
  ]);
  f.fail(false);
  await f.tick(20000);
  f.fail(true);
  await f.tick(20000);
  expect(f.notices.slice(-2).map((n) => n.frame.failures)).toEqual([1, 1]);
  f.watches.stop();
});

test("one host serializes each read kind while another host and the other kind progress", async () => {
  const f = fixture(),
    pending = Promise.withResolvers<void>();
  f.block(pending.promise);
  f.watches.declare("one", {
    screens: [alpha, { ...alpha, pane_id: "other" }, beta],
    receipts: [receipt(beta)],
  });
  const reading = f.tick();
  expect(
    f.reads.filter((r) => r.target.connection_id === "alpha"),
  ).toHaveLength(1);
  expect(f.reads.filter((r) => r.target.connection_id === "beta")).toHaveLength(
    2,
  );
  f.watches.declare("one", { screens: [beta], receipts: [receipt(beta)] });
  pending.resolve();
  await reading;
  expect(f.notices.every((n) => n.frame.connection_id === "beta")).toBeTrue();
  expect(
    f.reads.filter((r) => r.target.connection_id === "alpha"),
  ).toHaveLength(1);
  f.watches.stop();
});

test("release/reacquire and generation retirement fence pending results and retain physical admission", async () => {
  const f = fixture(),
    pending = Promise.withResolvers<void>();
  f.block(pending.promise);
  f.watches.declare("one", { screens: [alpha], receipts: [] });
  const reading = f.tick();
  f.watches.release("one");
  f.watches.declare("two", { screens: [alpha], receipts: [] });
  await f.tick();
  expect(f.reads).toHaveLength(1);
  pending.resolve();
  await reading;
  expect(f.notices).toEqual([]);
  f.block();
  await f.tick();
  expect(f.notices.map((n) => n.socket)).toEqual(["two"]);
  f.generations.set("alpha", 3);
  f.watches.reconcile();
  await f.tick(20000);
  expect(f.reads).toHaveLength(2);
  expect(f.jobs.size).toBe(0);
  f.watches.stop();
});

test("whole declarations are validated atomically, bounded and deduplicated; unknown owners do not acquire", async () => {
  const f = fixture();
  f.watches.declare("one", {
    screens: [alpha, alpha, { ...beta, connection_generation: 99 }],
    receipts: [],
  });
  for (const value of [
    null,
    {},
    { screens: [null], receipts: [] },
    { screens: Array(17).fill(alpha), receipts: [] },
    { screens: [], receipts: Array(41).fill(receipt()) },
    { screens: [], receipts: [receipt(alpha, "x".repeat(4097))] },
    { screens: [{ ...alpha, session: "bad" }], receipts: [] },
  ])
    expect(() => f.watches.declare("one", value)).toThrow();
  await f.tick();
  expect(f.reads).toHaveLength(1);
  f.watches.declare("one", { screens: [], receipts: [] });
  await f.tick(20000);
  expect(f.reads).toHaveLength(1);
  f.watches.stop();
});

test("all length-three two-socket/two-owner traces read the union of current screen interest", async () => {
  const actions = [
    "one-alpha",
    "one-beta",
    "two-alpha",
    "two-beta",
    "one-hide",
    "two-close",
    "bump",
  ];
  for (const a of actions)
    for (const b of actions)
      for (const c of actions) {
        const f = fixture(),
          expected = new Map<string, string[]>();
        for (const action of [a, b, c]) {
          if (action === "bump") {
            f.generations.set("alpha", f.generations.get("alpha")! + 1);
            f.watches.reconcile();
            for (const [socket, ids] of expected)
              expected.set(
                socket,
                ids.filter((id) => id !== "alpha"),
              );
          } else {
            const [socket, target] = action.split("-");
            if (target === "close") {
              f.watches.release(socket!);
              expected.delete(socket!);
            } else {
              const screens =
                target === "hide"
                  ? []
                  : [
                      target === "alpha"
                        ? {
                            ...alpha,
                            connection_generation: f.generations.get("alpha")!,
                          }
                        : beta,
                    ];
              f.watches.declare(socket!, { screens, receipts: [] });
              expected.set(
                socket!,
                screens.map((t) => t.connection_id),
              );
            }
          }
          f.reads.length = 0;
          await f.tick(4000);
          expect(f.reads.map((r) => r.target.connection_id).sort()).toEqual(
            [...new Set([...expected.values()].flat())].sort(),
          );
        }
        f.watches.stop();
        expect(f.jobs.size).toBe(0);
      }
});

test("retirement and stop suppress results already in flight", async () => {
  for (const stop of [true, false]) {
    const f = fixture(),
      pending = Promise.withResolvers<void>();
    f.block(pending.promise);
    f.watches.declare("one", { screens: [alpha], receipts: [] });
    const reading = f.tick();
    if (stop) f.watches.stop();
    else {
      f.generations.set("alpha", 3);
      f.watches.reconcile();
    }
    pending.resolve();
    await reading;
    expect(f.notices).toEqual([]);
    expect(f.jobs.size).toBe(0);
    f.watches.stop();
  }
});

test("a session-fenced native read drains and a later declaration can acquire again", async () => {
  const jobs = new Set<() => void>(),
    notices: DeskReadNotice[] = [];
  let retired = true,
    reads = 0;
  const watches = new DeskWatches<string>({
    scheduler: {
      schedule(callback) {
        jobs.add(callback);
        return { cancel: () => jobs.delete(callback) };
      },
    },
    lease: () => ({
      isCurrent: () => true,
      async read() {
        reads++;
        return retired ? { retired: true } : { result: { text: "new" } };
      },
    }),
    send(_socket, frame) {
      notices.push(frame);
      return true;
    },
  });
  const tick = async () => {
    for (const job of [...jobs]) if (jobs.delete(job)) await job();
  };
  watches.declare("one", { screens: [alpha], receipts: [] });
  await tick();
  expect(notices).toEqual([]);
  expect(jobs.size).toBe(0);
  retired = false;
  watches.declare("one", { screens: [alpha], receipts: [] });
  await tick();
  expect(reads).toBe(2);
  expect(notices).toHaveLength(1);
  watches.stop();
  expect(jobs.size).toBe(0);
});
