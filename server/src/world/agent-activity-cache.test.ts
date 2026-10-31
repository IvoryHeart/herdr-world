import { expect, test } from "bun:test";
import { AgentActivityCache } from "./agent-activity-cache";

const owner = { connection_id: "alpha", connection_generation: 1 };
const agent = (time = 100, session = "synthetic-session") => ({
  pane_id: "pane",
  terminal_id: "terminal",
  agent: "codex",
  agent_session: { kind: "id", value: session },
  last_activity_at: time,
});

function fixture() {
  let now = 0,
    reads = 0,
    held = true,
    current = true;
  const pushes: unknown[] = [];
  const cache = new AgentActivityCache({
    clock: { now: () => now, monotonic: () => now },
    active: () => held,
    changed: (_owner, entries) => pushes.push(entries),
  });
  return {
    cache,
    pushes,
    get reads() {
      return reads;
    },
    time(value: number) {
      now = value;
    },
    release() {
      held = false;
      cache.clear(owner);
    },
    hold() {
      held = true;
    },
    retire() {
      current = false;
    },
    read(
      time = 100,
      force = false,
      pending?: Promise<void>,
      session = "synthetic-session",
    ) {
      const raw = {
        agents: [
          {
            ...agent(time, session),
            last_activity_at: undefined,
            agent_status: "working",
          },
        ],
        extra: "preserved",
      };
      return cache.enrich(
        owner,
        raw,
        async () => {
          reads++;
          await pending;
          return { ...raw, agents: [agent(time, session)] };
        },
        () => current,
        force,
      );
    },
  };
}

test("activity readings are shared, fresh replies retain live fields, and only changed maps push", async () => {
  const f = fixture();
  expect(f.pushes).toEqual([]);
  const pending = Promise.withResolvers<void>();
  const one = f.read(100, false, pending.promise);
  const two = f.read(100, false, pending.promise);
  expect(f.reads).toBe(1);
  pending.resolve();
  await Promise.all([one, two]);
  expect(f.pushes).toHaveLength(1);
  f.time(4999);
  expect(await f.read(200)).toMatchObject({
    extra: "preserved",
    agents: [{ last_activity_at: 100, agent_status: "working" }],
  });
  expect(f.reads).toBe(1);
  f.time(5001);
  await f.read(100);
  expect(f.reads).toBe(2);
  expect(f.pushes).toHaveLength(1);
  await f.read(200, true);
  expect(f.pushes).toHaveLength(2);
});

test("a fresh cache cannot lend a timestamp to another agent session", async () => {
  const f = fixture();
  await f.read(100);
  const result = await f.read(200, false, undefined, "replacement-session");
  expect(result.agents[0].last_activity_at).toBeUndefined();
  expect(f.reads).toBe(1);
});

test("release and retirement suppress a pending reading; reacquisition waits then reads anew", async () => {
  for (const retire of [false, true]) {
    const f = fixture();
    const pending = Promise.withResolvers<void>();
    const reading = f.read(100, false, pending.promise);
    if (retire) f.retire();
    else f.release();
    pending.resolve();
    await reading;
    expect(f.pushes).toEqual([]);
  }
  const f = fixture();
  const pending = Promise.withResolvers<void>();
  const old = f.read(100, false, pending.promise);
  f.release();
  f.hold();
  const next = f.read(200);
  expect(f.reads).toBe(1);
  pending.resolve();
  await Promise.all([old, next]);
  expect(f.reads).toBe(2);
  expect(f.pushes).toHaveLength(1);
  expect(f.pushes[0]).toMatchObject([{ last_activity_at: 200 }]);
});

test("a failed reading publishes nothing and can be retried without a stuck pending slot", async () => {
  const f = fixture();
  const raw = { agents: [agent()] };
  await expect(
    f.cache.enrich(
      owner,
      raw,
      async () => {
        throw new Error("synthetic stat failure");
      },
      () => true,
    ),
  ).rejects.toThrow("synthetic stat failure");
  expect(f.pushes).toEqual([]);
  await f.read(100);
  expect(f.pushes).toHaveLength(1);
});
