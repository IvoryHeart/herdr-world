import { describe, expect, test } from "bun:test";
import { createFocusService } from "./focus";

const MINUTE = 60_000;

function fixture(saved: unknown = undefined) {
  const clock = { at: 1_000_000, now: () => clock.at };
  const timers: { run(): void; at: number; cancelled: boolean }[] = [];
  const scheduler = {
    schedule(run: () => void, delay: number) {
      const timer = { run, at: clock.at + delay, cancelled: false };
      timers.push(timer);
      return { cancel: () => void (timer.cancelled = true) };
    },
  };
  const writes: unknown[] = [];
  const published: number[] = [];
  let failSave = false;
  let ids = 0;
  const focus = createFocusService({
    clock,
    scheduler,
    load: async () => saved,
    save: async (state) => {
      if (failSave) throw new Error("disk full");
      writes.push(structuredClone(state));
    },
    publish: (revision) => published.push(revision),
    id: () => `focus-${++ids}`,
  });
  /** Move the clock and run every timer due by then. */
  const advance = async (ms: number) => {
    clock.at += ms;
    for (const timer of [...timers])
      if (!timer.cancelled && timer.at <= clock.at) {
        timer.cancelled = true;
        timer.run();
      }
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    clock,
    focus,
    writes,
    published,
    advance,
    timers,
    failSaves: (on = true) => void (failSave = on),
  };
}

describe("focus session", () => {
  test("start holds, its time ends it as expired, and each change is saved then published", async () => {
    const f = fixture();
    await f.focus.start();
    expect(f.focus.held()).toBe(false);
    const started = await f.focus.begin(45);
    expect(started.session).toEqual({
      id: "focus-1",
      started_at: 1_000_000,
      ends_at: 1_000_000 + 45 * MINUTE,
    });
    expect(f.focus.held()).toBe(true);
    expect(f.published).toEqual([1]);
    expect(f.writes).toHaveLength(1);
    // Timers are re-armed at most a minute ahead.
    await f.advance(44 * MINUTE + 59_000);
    expect(f.focus.held()).toBe(true);
    expect(f.focus.get().session?.id).toBe("focus-1");
    await f.advance(1_000);
    expect(f.focus.held()).toBe(false);
    expect(f.focus.get()).toMatchObject({
      revision: 2,
      session: null,
      last: {
        id: "focus-1",
        ended_at: 1_000_000 + 45 * MINUTE,
        reason: "expired",
      },
    });
    expect(f.published).toEqual([1, 2]);
  });

  test("held follows the clock even when the timer is late", async () => {
    const f = fixture();
    await f.focus.start();
    await f.focus.begin(1);
    f.clock.at += MINUTE; // no timer has run yet
    expect(f.focus.held()).toBe(false);
  });

  test("End now ends it for everyone; ending twice changes nothing", async () => {
    const f = fixture();
    await f.focus.start();
    await f.focus.begin(null);
    await f.advance(10 * MINUTE);
    expect(f.focus.held()).toBe(true);
    const ended = await f.focus.end();
    expect(ended.session).toBeNull();
    expect(ended.last).toMatchObject({
      id: "focus-1",
      started_at: 1_000_000,
      ends_at: null,
      ended_at: 1_000_000 + 10 * MINUTE,
      reason: "ended",
    });
    const again = await f.focus.end();
    expect(again.revision).toBe(ended.revision);
    expect(f.published).toEqual([1, 2]);
  });

  test("starting again while focused keeps the start and sets a new end", async () => {
    const f = fixture();
    await f.focus.start();
    await f.focus.begin(25);
    await f.advance(5 * MINUTE);
    const longer = await f.focus.begin(90);
    expect(longer.session).toEqual({
      id: "focus-1",
      started_at: 1_000_000,
      ends_at: 1_000_000 + 5 * MINUTE + 90 * MINUTE,
    });
  });

  test("a failed save refuses the change and keeps the old state", async () => {
    const f = fixture();
    await f.focus.start();
    f.failSaves();
    await expect(f.focus.begin(25)).rejects.toThrow("disk full");
    expect(f.focus.held()).toBe(false);
    expect(f.focus.get().revision).toBe(0);
    expect(f.published).toEqual([]);
  });

  test("an expiry whose save fails is retried, backing off, until it is kept", async () => {
    const f = fixture();
    await f.focus.start();
    await f.focus.begin(1);
    f.failSaves();
    await f.advance(MINUTE);
    // Nothing changed, but notifications are no longer held.
    expect(f.focus.held()).toBe(false);
    expect(f.focus.get()).toMatchObject({ revision: 1, last: null });
    await f.advance(1_000);
    await f.advance(1_999);
    expect(f.focus.get().revision).toBe(1);
    expect(f.published).toEqual([1]);
    // Storage recovers; the next retry (2 s after the second failure) ends it.
    f.failSaves(false);
    await f.advance(1);
    expect(f.focus.get()).toMatchObject({
      revision: 2,
      session: null,
      last: { id: "focus-1", reason: "expired", ended_at: 1_000_000 + MINUTE },
    });
    expect(f.published).toEqual([1, 2]);
    expect(f.timers.filter((timer) => !timer.cancelled)).toEqual([]);
  });

  test("retries wait at most a minute and stop once the session is ended", async () => {
    const f = fixture();
    await f.focus.start();
    await f.focus.begin(1);
    f.failSaves();
    await f.advance(MINUTE);
    for (let i = 0; i < 8; i++) await f.advance(MINUTE);
    const pending = f.timers.filter((timer) => !timer.cancelled);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.at - f.clock.at).toBeLessThanOrEqual(MINUTE);
    f.failSaves(false);
    await f.focus.end();
    expect(f.focus.get().last).toMatchObject({ reason: "expired" });
    expect(f.timers.filter((timer) => !timer.cancelled)).toEqual([]);
  });

  test("lengths outside 1–720 whole minutes are refused", async () => {
    const f = fixture();
    await f.focus.start();
    expect(() => f.focus.begin(0)).toThrow();
    expect(() => f.focus.begin(721)).toThrow();
    expect(() => f.focus.begin(2.5)).toThrow();
    expect(() => f.focus.begin("45")).toThrow();
  });

  test("a restart restores a running session and its end timer", async () => {
    const f = fixture({
      revision: 4,
      session: { id: "s", started_at: 900_000, ends_at: 1_000_000 + MINUTE },
      last: null,
    });
    await f.focus.start();
    expect(f.focus.held()).toBe(true);
    expect(f.focus.get().revision).toBe(4);
    await f.advance(MINUTE);
    expect(f.focus.get()).toMatchObject({
      revision: 5,
      session: null,
      last: { id: "s", reason: "expired", ended_at: 1_000_000 + MINUTE },
    });
  });

  test("a session that ran out while the service was down ends at its own time", async () => {
    const f = fixture({
      revision: 2,
      session: { id: "s", started_at: 100_000, ends_at: 500_000 },
      last: null,
    });
    await f.focus.start();
    expect(f.focus.held()).toBe(false);
    expect(f.focus.get()).toMatchObject({
      revision: 3,
      session: null,
      last: { id: "s", ended_at: 500_000, reason: "expired" },
    });
  });

  test("a malformed saved value starts idle", async () => {
    const f = fixture({ revision: "x", session: 3 });
    await f.focus.start();
    expect(f.focus.get()).toMatchObject({
      revision: 0,
      session: null,
      last: null,
    });
  });

  test("stop cancels the end timer and refuses later changes", async () => {
    const f = fixture();
    await f.focus.start();
    await f.focus.begin(1);
    f.focus.stop();
    expect(f.timers.every((timer) => timer.cancelled)).toBe(true);
    await expect(f.focus.end()).rejects.toThrow();
  });
});
