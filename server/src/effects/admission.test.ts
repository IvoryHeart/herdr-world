import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectFixture, OWNER } from "./testing/fixture";
import { EffectExecutionStopped } from "./runner";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function fixture(options: Parameters<typeof effectFixture>[2] = {}) {
  const root = mkdtempSync(join(tmpdir(), "effect-admission-"));
  const f = effectFixture(root, "opaque", options);
  cleanups.push(async () => {
    await f.close();
    rmSync(root, { recursive: true, force: true });
  });
  return f;
}
test("an unresolved binding waits across a same-generation restart and never expires by age", async () => {
  const f = fixture();
  f.set("binding", "unresolved");
  expect((await f.runner.run(f.id))?.state).toBe("pending");
  f.advance(1000 * 60 * 60 * 24 * 365);
  expect((await f.runner.run(f.id))?.state).toBe("pending");
  expect(f.applied()).toHaveLength(0);
  f.set("binding", "attached");
  f.advance(1000 * 60 * 60 * 24 * 366);
  const delivered = await f.runner.run(f.id);
  expect(delivered?.state).toBe("delivered");
  expect(delivered?.targets[0]?.fence.generation).toBe(1);
  expect(delivered?.contract?.authorization.creation_generation).toBe(999);
});
for (const state of ["ended", "unconfirmed"])
  test(`${state} before dispatch is not sent; after dispatch it is uncertain`, async () => {
    const before = fixture();
    before.set("binding", state);
    expect(await before.runner.run(before.id)).toMatchObject({
      state: "refused",
      not_sent: true,
    });
    const after = fixture({
      checkpoint: (phase) => {
        if (phase === "dispatching") throw new EffectExecutionStopped();
      },
    });
    await expect(after.runner.run(after.id)).rejects.toBeInstanceOf(
      EffectExecutionStopped,
    );
    after.set("binding", state);
    expect((await after.store.get(after.id))?.ever_dispatched).toBe(true);
    // Even an explicit owner retry must not turn an earlier possible send into not-sent.
    const fence = (await after.store.get(after.id))!.attempt_fence!;
    await after.store.transition({
      action: "finish",
      id: after.id,
      fence,
      state: "uncertain",
      reason: "Interrupted at the boundary",
    });
    await after.store.transition({
      action: "decide",
      id: after.id,
      attempt: fence.attempt,
      actor: OWNER,
      reason: "Owner approved possible duplicate",
    });
    after.advance(1_000_000);
    expect(await after.runner.run(after.id)).toMatchObject({
      state: "uncertain",
      not_sent: false,
    });
  });

for (const revoke of [false, true])
  test(`${revoke ? "revocation" : "cancellation"} after the marker prevents the native send`, async () => {
    const f: ReturnType<typeof fixture> = fixture({
      checkpoint: async (phase, entry) => {
        if (phase !== "dispatching") return;
        if (revoke) f.set("authorized", "0");
        else
          await f.store.transition({
            action: "cancel",
            id: entry.id,
            actor: OWNER,
            reason: "Owner cancelled before native submission",
          });
      },
    });
    expect((await f.runner.run(f.id))?.state).toBe("uncertain");
    expect(f.applied()).toHaveLength(0);
    expect((await f.store.get(f.id))?.not_sent).toBe(false);
  });

test("claims are compare-and-set and every later transition uses the full attempt fence", async () => {
  const f = fixture();
  const [one, two] = await Promise.all([
    f.store.transition({
      action: "claim",
      id: f.id,
      incarnation: f.incarnation,
    }),
    f.store.transition({
      action: "claim",
      id: f.id,
      incarnation: f.incarnation,
    }),
  ]);
  expect([one, two].filter(Boolean)).toHaveLength(1);
  const entry = (one ?? two)!;
  expect(
    await f.store.transition({
      action: "finish",
      id: f.id,
      fence: { service_incarnation: "retired-service", attempt: entry.attempt },
      state: "delivered",
      reason: "Stale completion",
    }),
  ).toBeNull();
  expect((await f.store.get(f.id))?.claimed).toBe(true);
});

test("P8: early and backwards wakes rearm within 60 seconds; sleep across a deadline dispatches once", async () => {
  const f = fixture();
  await f.store.transition({
    action: "defer",
    id: f.id,
    due_at: 181_000,
    reason: "Durable future deadline",
  });
  await f.runner.wake();
  expect([...f.jobs.values()]).toEqual([60_000]);
  f.advance(-10_000);
  await f.runner.wake();
  expect([...f.jobs.values()]).toEqual([60_000]);
  f.advance(180_999);
  await f.runner.wake();
  expect([...f.jobs.values()]).toEqual([1]);
  expect(f.read("calls")).toBe("0");
  f.advance(1_000_000);
  await f.runner.wake();
  await f.runner.wake();
  expect(f.read("calls")).toBe("1");
  expect(f.jobs.size).toBe(0);
});
