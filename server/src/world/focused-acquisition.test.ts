import { expect, test } from "bun:test";
import { FocusedAcquisition, type FocusedOwner } from "./focused-acquisition";
import type { Scheduler } from "../service/ports";

const alpha = { connection_id: "alpha", connection_generation: 1 };
const beta = { connection_id: "beta", connection_generation: 2 };
const methods = ["workspace.list", "tab.list", "pane.list", "agent.list"];

function fixture() {
  let now = 0;
  const jobs = new Set<{ callback: () => void; at: number }>();
  const scheduler: Scheduler = {
    schedule(callback, delay) {
      const job = { callback, at: now + delay };
      jobs.add(job);
      return { cancel: () => jobs.delete(job) };
    },
  };
  const hosts = new Map([
    ["alpha", { generation: 1, revision: 0, scroll: 0, activity: 100 }],
    ["beta", { generation: 2, revision: 0, scroll: 0, activity: 100 }],
  ]);
  const reads: string[] = [];
  const notices: {
    socket: string;
    control: FocusedOwner & { type: string };
  }[] = [];
  let pending: Promise<void> | undefined;
  let failure = false;
  const lists = (id: string) => {
    const host = hosts.get(id)!;
    return {
      "workspace.list": { workspaces: [{ id, git: host.revision }] },
      "tab.list": { tabs: [] },
      "pane.list": { panes: [{ pane_id: "p", scroll: host.scroll }] },
      "agent.list": {
        agents: [{ pane_id: "p", last_activity_at: host.activity }],
      },
    };
  };
  const acquisition = new FocusedAcquisition<string>({
    scheduler,
    lease(owner) {
      const host = hosts.get(owner.connection_id);
      if (!host || host.generation !== owner.connection_generation) return null;
      const generation = host.generation;
      return {
        isCurrent: () => host.generation === generation,
        async read() {
          reads.push(owner.connection_id);
          const result = lists(owner.connection_id);
          await pending;
          if (failure) throw new Error("synthetic read failure");
          return result;
        },
      };
    },
    send(socket, control) {
      notices.push({ socket, control });
      return true;
    },
  });
  return {
    acquisition,
    hosts,
    reads,
    notices,
    jobs,
    lists,
    block(value: Promise<void> | undefined) {
      pending = value;
    },
    fail(value: boolean) {
      failure = value;
    },
    record(socket: string, owner = alpha, marked = true) {
      for (const method of methods)
        acquisition.recordReply(
          socket,
          owner,
          method,
          lists(owner.connection_id)[method as keyof ReturnType<typeof lists>],
          marked,
        );
    },
    async tick() {
      now += 5000;
      for (const job of [...jobs]) {
        if (job.at > now || !jobs.delete(job)) continue;
        await job.callback();
      }
    },
  };
}

test("two sockets share two host reads; comparisons use each socket's marked replies", async () => {
  const f = fixture();
  f.record("one");
  f.record("two");
  f.acquisition.declare("one", { owners: [alpha, beta] });
  f.acquisition.declare("two", { owners: [alpha] });
  await f.tick();
  expect(f.reads).toEqual(["alpha", "beta"]);
  expect(f.notices.map((n) => [n.socket, n.control.connection_id])).toEqual([
    ["one", "beta"],
  ]);
  f.notices.length = 0;
  f.hosts.get("alpha")!.revision++;
  f.record("one"); // One browser already received the event's re-list.
  f.record("two", alpha, false); // A dialog's reply cannot hide the change.
  await f.tick();
  expect(f.notices.map((n) => n.socket)).toEqual(["two"]);
  await f.tick();
  expect(f.notices).toHaveLength(1); // One notice per unseen observation.
  f.record("two");
  await f.tick();
  expect(f.notices).toHaveLength(1);
  f.acquisition.stop();
});

test("activity and output-only scroll changes do not cause focused notices", async () => {
  const f = fixture();
  f.record("one");
  f.acquisition.declare("one", { owners: [alpha] });
  f.hosts.get("alpha")!.scroll++;
  f.hosts.get("alpha")!.activity++;
  await f.tick();
  expect(f.notices).toEqual([]);
  f.acquisition.stop();
});

test("a re-list of an intervening state cannot suppress a later identical change", async () => {
  const f = fixture();
  f.record("one");
  f.acquisition.declare("one", { owners: [alpha] });
  f.hosts.get("alpha")!.revision = 1;
  await f.tick();
  expect(f.notices).toHaveLength(1);
  f.hosts.get("alpha")!.revision = 0;
  f.record("one");
  f.hosts.get("alpha")!.revision = 1;
  await f.tick();
  expect(f.notices).toHaveLength(2);
  f.acquisition.stop();
});

test("every list participates, including session and enriched workspace fields", async () => {
  for (const method of methods) {
    const f = fixture();
    f.record("one");
    // A socket with an older focused reply must still learn the current list.
    f.acquisition.recordReply(
      "one",
      alpha,
      method,
      { synthetic_previous: true },
      true,
    );
    f.acquisition.declare("one", { owners: [alpha] });
    await f.tick();
    expect(f.notices.map((n) => n.socket)).toEqual(["one"]);
    f.acquisition.stop();
  }
});

test("malformed declarations are atomic, unknown owners ignored, duplicates counted once", async () => {
  const f = fixture();
  f.acquisition.declare("one", {
    owners: [alpha, alpha, { ...beta, connection_generation: 99 }],
  });
  for (const owners of [
    null,
    {},
    Array(65).fill(alpha),
    [alpha, null],
    [{ ...alpha, connection_generation: -1 }],
    [{ ...alpha, connection_id: "../bad" }],
  ])
    expect(() => f.acquisition.declare("one", { owners })).toThrow();
  await f.tick();
  expect(f.reads).toEqual(["alpha"]);
  f.acquisition.declare("one", { owners: [] });
  await f.tick();
  expect(f.reads).toEqual(["alpha"]);
  f.acquisition.stop();
});

test("interest transitions exhaustively preserve the union of visible socket owners", async () => {
  // Every length-three trace over two sockets, two owners, hide, close and bump.
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
        const f = fixture();
        const expected = new Map<string, string[]>();
        for (const action of [a, b, c]) {
          const [socket, target] = action.split("-");
          if (action === "bump") {
            f.hosts.get("alpha")!.generation++;
            f.acquisition.reconcile();
            for (const [s, ids] of expected)
              expected.set(
                s,
                ids.filter((id) => id !== "alpha"),
              );
          } else if (target === "close") {
            f.acquisition.release(socket!);
            expected.delete(socket!);
          } else {
            const owners =
              target === "hide"
                ? []
                : [
                    target === "alpha"
                      ? {
                          ...alpha,
                          connection_generation:
                            f.hosts.get("alpha")!.generation,
                        }
                      : beta,
                  ];
            f.acquisition.declare(socket!, { owners });
            expected.set(
              socket!,
              owners.map((o) => o.connection_id),
            );
          }
          f.reads.length = 0;
          await f.tick();
          expect([...f.reads].sort()).toEqual(
            [...new Set([...expected.values()].flat())].sort(),
          );
        }
        f.acquisition.stop();
        expect(f.jobs.size).toBe(0);
      }
});

test("last release and reacquisition fence a pending read without overlap", async () => {
  const f = fixture();
  const pending = Promise.withResolvers<void>();
  f.block(pending.promise);
  f.acquisition.declare("one", { owners: [alpha] });
  const reading = f.tick();
  expect(f.reads).toEqual(["alpha"]);
  f.acquisition.release("one");
  f.acquisition.declare("two", { owners: [alpha] });
  await f.tick();
  expect(f.reads).toHaveLength(1);
  pending.resolve();
  await reading;
  expect(f.notices).toEqual([]);
  f.block(undefined);
  await f.tick();
  expect(f.reads).toHaveLength(2);
  expect(f.notices.map((n) => n.socket)).toEqual(["two"]);
  f.acquisition.stop();
});

test("retirement and stop fence in-flight results; read failures retry next period", async () => {
  for (const action of ["retire", "stop", "release"]) {
    const f = fixture();
    const pending = Promise.withResolvers<void>();
    f.block(pending.promise);
    f.acquisition.declare("one", { owners: [alpha] });
    const reading = f.tick();
    if (action === "retire") {
      f.hosts.get("alpha")!.generation++;
      f.acquisition.reconcile();
    }
    if (action === "stop") f.acquisition.stop();
    if (action === "release") f.acquisition.release("one");
    pending.resolve();
    await reading;
    expect(f.notices).toEqual([]);
    expect(f.jobs.size).toBe(0);
  }
  const f = fixture();
  f.acquisition.declare("one", { owners: [alpha] });
  f.fail(true);
  await f.tick();
  expect(f.notices).toEqual([]);
  f.fail(false);
  await f.tick();
  expect(f.notices.map((n) => n.socket)).toEqual(["one"]);
  f.acquisition.stop();
});
