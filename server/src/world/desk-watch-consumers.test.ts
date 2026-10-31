import { expect, test } from "bun:test";
import { DeskWatchClient } from "../../../web/src/world/deskWatchClient";
import { DeskWatches } from "./desk-watches";
import type {
  DeskDeclaration,
  DeskReadNotice,
  DeskReadTarget,
} from "../../../shared/deskAcquisition";

const target = {
  connection_id: "alpha",
  connection_generation: 1,
  pane_id: "pane-a",
  session: "a".repeat(64),
};
function fixture() {
  let now = 0,
    reads = 0;
  const jobs = new Set<{ at: number; callback: () => void }>();
  const ports = new Map<string, ReturnType<typeof client>>();
  const generations = new Map([["alpha", 1]]);
  const watches = new DeskWatches<string>({
    scheduler: {
      schedule(callback, ms) {
        const job = { at: now + ms, callback };
        jobs.add(job);
        return { cancel: () => jobs.delete(job) };
      },
    },
    lease(target) {
      return generations.get(target.connection_id) !==
        target.connection_generation
        ? null
        : {
            isCurrent: () =>
              generations.get(target.connection_id) ===
              target.connection_generation,
            async read() {
              reads++;
              return {
                result: {
                  text: "screen",
                  turn: { turn_id: "turn-a" },
                  agent_session_fingerprint: target.session,
                },
              };
            },
          };
    },
    send(socket, frame) {
      ports.get(socket)?.emit(frame);
      return true;
    },
  });
  function client(socket: string, enabled = true) {
    let visible = true,
      epoch = 0,
      capability = enabled;
    const changes = new Set<() => void>(),
      listeners = new Set<(frame: unknown) => void>();
    const calls: DeskDeclaration[] = [],
      frames: DeskReadNotice[] = [];
    const waiters: {
      predicate: (value: DeskDeclaration) => boolean;
      resolve(): void;
    }[] = [];
    const browser = new DeskWatchClient({
      enabled: () => capability,
      visible: () => visible,
      epoch: () => epoch,
      async declare(value) {
        calls.push(value);
        watches.declare(socket, value);
        for (const waiter of [...waiters])
          if (waiter.predicate(value)) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve();
          }
        return { ok: true };
      },
      changed(callback) {
        changes.add(callback);
        return () => changes.delete(callback);
      },
      reads(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      retry(callback) {
        const job = { at: now + 5000, callback };
        jobs.add(job);
        return { cancel: () => jobs.delete(job) };
      },
    });
    const stopMode = browser.subscribe(() => {});
    const current = (value: DeskReadTarget) =>
      generations.get(value.connection_id) === value.connection_generation;
    const value = {
      browser,
      calls,
      frames,
      current,
      receive: (frame: DeskReadNotice) => frames.push(frame),
      emit(frame: unknown) {
        for (const listener of listeners) listener(frame);
      },
      next(predicate: (value: DeskDeclaration) => boolean) {
        const ready = Promise.withResolvers<void>();
        waiters.push({ predicate, resolve: ready.resolve });
        return ready.promise;
      },
      hide(value: boolean) {
        visible = !value;
        for (const change of changes) change();
      },
      restart(value: boolean) {
        watches.release(socket);
        epoch++;
        capability = value;
        for (const change of changes) change();
      },
      dispose() {
        stopMode();
      },
    };
    ports.set(socket, value);
    return value;
  }
  return {
    client,
    watches,
    generations,
    jobs,
    get reads() {
      return reads;
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

test("two browser consumers declare the union and share real service reads without direct pane/turn calls", async () => {
  const f = fixture(),
    one = f.client("one"),
    two = f.client("two");
  const screenOne = {},
    receiptOne = {},
    screenTwo = {},
    receiptTwo = {};
  const first = one.next(
      (d) => d.screens.length === 1 && d.receipts.length === 1,
    ),
    second = two.next((d) => d.screens.length === 1 && d.receipts.length === 1);
  one.browser.watch(screenOne, "screen", [target], one.receive, one.current);
  one.browser.watch(
    receiptOne,
    "receipt",
    [{ ...target, trigger: "a" }],
    one.receive,
    one.current,
  );
  two.browser.watch(screenTwo, "screen", [target], two.receive, two.current);
  two.browser.watch(
    receiptTwo,
    "receipt",
    [{ ...target, trigger: "b" }],
    two.receive,
    two.current,
  );
  await Promise.all([first, second]);
  expect(one.frames).toEqual([]);
  expect(two.frames).toEqual([]);
  await f.tick();
  expect(f.reads).toBe(2);
  expect(one.frames.find((r) => r.kind === "receipt")!.trigger).toBe("a");
  expect(two.frames.find((r) => r.kind === "receipt")!.trigger).toBe("b");
  await f.tick(20000);
  expect(one.frames).toHaveLength(2);
  expect(two.frames).toHaveLength(2);
  const changed = one.next((d) => d.receipts[0]?.trigger === "c");
  one.browser.watch(
    receiptOne,
    "receipt",
    [{ ...target, trigger: "c" }],
    one.receive,
    one.current,
  );
  await changed;
  await f.tick();
  expect(one.frames.slice(-1)[0]!.trigger).toBe("c");
  expect(two.frames).toHaveLength(2);
  const hidden = two.next(
    (d) => d.screens.length === 0 && d.receipts.length === 0,
  );
  two.hide(true);
  await hidden;
  one.dispose();
  one.browser.release(screenOne);
  const released = one.next((d) => !d.screens.length && !d.receipts.length);
  one.browser.release(receiptOne);
  await released;
  const before = f.reads;
  await f.tick(20000);
  expect(f.reads).toBe(before);
  two.browser.release(screenTwo);
  two.browser.release(receiptTwo);
  two.dispose();
  f.watches.stop();
});

test("capability absence/removal, visibility, sessions and ready-generation admission gate shared reads", async () => {
  const f = fixture(),
    one = f.client("one", false),
    owner = {};
  one.browser.watch(owner, "screen", [target], one.receive, one.current);
  expect(one.calls).toEqual([]);
  const declared = one.next((d) => d.screens.length === 1);
  one.restart(true);
  await declared;
  await f.tick();
  expect(one.frames).toHaveLength(1);
  const latest = one.frames[0]!;
  one.emit({ ...latest, connection_generation: 9 });
  one.emit({ ...latest, session: "b".repeat(64) });
  one.emit({ ...latest, type: "other" });
  expect(one.frames).toHaveLength(1);
  const hidden = one.next((d) => !d.screens.length);
  one.hide(true);
  await hidden;
  one.emit(latest);
  expect(one.frames).toHaveLength(1);
  const shown = one.next((d) => d.screens.length === 1);
  one.hide(false);
  await shown;
  await f.tick();
  expect(one.frames).toHaveLength(2);
  const before = one.calls.length;
  one.restart(false);
  one.emit(latest);
  expect(one.frames).toHaveLength(2);
  expect(one.calls).toHaveLength(before);
  one.browser.release(owner);
  one.dispose();
  f.watches.stop();
});
