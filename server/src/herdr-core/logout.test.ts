import { describe, expect, test } from "bun:test";
import {
  type CoreObservation,
  CoreObservationStore,
  logoutStop,
} from "./observations";
import { createCoreConnectionRuntime } from "./runtime";
import { memoryStreamPair } from "./stream";
import { until } from "./testing/core-world";
import { FakeCore } from "./testing/fake-core";

// Core 0.1.21 reports, in `hello` and `server.status`, whether the host ends
// its programs once the last login closes (systemd lingering off) and the
// account `loginctl enable-linger` would fix. Values are from core's schema.

describe("reading core's logout facts", () => {
  test("only an explicit false warns, with the account core names", () => {
    expect(
      logoutStop({
        keeps_running_after_logout: false,
        logout_linger_user: "example",
      }),
    ).toEqual({ linger_user: "example" });
    expect(logoutStop({ keeps_running_after_logout: false })).toEqual({
      linger_user: null,
    });
    // Kept, unknown (core's first check pending, not Linux, infinite stop
    // delay) or an older core without the fields: nothing to say.
    for (const status of [
      { keeps_running_after_logout: true, logout_linger_user: "example" },
      { keeps_running_after_logout: null, logout_linger_user: null },
      {},
      null,
      { keeps_running_after_logout: "false" },
      { keeps_running_after_logout: 0 },
    ])
      expect(logoutStop(status)).toBeNull();
  });

  test("an account name that could hide what a pasted command does is dropped", () => {
    for (const user of [
      "",
      42,
      "a\nb",
      "a\u001b[2Jb",
      "a\u007fb",
      "a\u0085b",
      "safe‮gnp.exe",
      "x".repeat(257),
    ])
      expect(
        logoutStop({
          keeps_running_after_logout: false,
          logout_linger_user: user,
        }),
      ).toEqual({ linger_user: null });
    // Quoting, not refusal, handles shell characters (see the web helper).
    expect(
      logoutStop({
        keeps_running_after_logout: false,
        logout_linger_user: "o'brien; rm",
      }),
    ).toEqual({ linger_user: "o'brien; rm" });
  });
});

async function runtimeOn(fake: FakeCore) {
  const published: CoreObservation[] = [];
  const observations = new CoreObservationStore((id) => {
    const latest = observations.get(id);
    if (latest) published.push(latest);
  });
  const runtime = createCoreConnectionRuntime({
    identity: { id: "core", label: "core", source: "test" },
    context: { generation: 1, isCurrent: () => true, reportError: () => {} },
    transport: { open: async () => "memory", close: async () => {} },
    connect: async () => {
      const [server, world] = memoryStreamPair();
      fake.accept(server);
      return world;
    },
    observations,
    onFailure: () => {},
    livenessIntervalMs: 5,
    publishDelayMs: 1,
  });
  await runtime.startTransport();
  await runtime.startBackground();
  return {
    runtime,
    latest: () => observations.get("core")!,
    published,
  };
}

const polls = (fake: FakeCore) =>
  fake.calls.filter((c) => c.method === "server.status").length;

/** Core has answered `n` more liveness polls, each a chance to publish. */
const pollsAfter = (fake: FakeCore, n: number) => {
  const target = polls(fake) + n;
  return until(() => polls(fake) >= target);
};

describe("a core connection's logout warning", () => {
  test("follows core's background check: unknown, then stops at logout, then fixed", async () => {
    const fake = new FakeCore({ heartbeatMs: 60_000, version: "0.1.21" });
    fake.revive();
    // Core starts with its check pending: both fields null.
    fake.logout = {
      keeps_running_after_logout: null,
      logout_linger_user: null,
    };
    const w = await runtimeOn(fake);
    expect(w.latest().stops_at_logout).toBeNull();
    // The check finishes: lingering is off for this account.
    fake.logout = {
      keeps_running_after_logout: false,
      logout_linger_user: "example",
    };
    await until(() => w.latest().stops_at_logout !== null);
    expect(w.latest()).toMatchObject({
      state: "live",
      stops_at_logout: { linger_user: "example" },
    });
    // Unchanged facts publish nothing more.
    const count = w.published.length;
    await pollsAfter(fake, 3);
    expect(w.published.length).toBe(count);
    // An administrator enables lingering: the warning clears by itself.
    fake.logout = {
      keeps_running_after_logout: true,
      logout_linger_user: "example",
    };
    await until(() => w.latest().stops_at_logout === null);
    await w.runtime.stop();
  });

  test("is read at connect, and an older core without the fields shows nothing", async () => {
    const lingering = new FakeCore({ heartbeatMs: 60_000, version: "0.1.21" });
    lingering.revive();
    lingering.logout = {
      keeps_running_after_logout: false,
      logout_linger_user: null,
    };
    const first = await runtimeOn(lingering);
    // The first observation already carries it: no poll needed.
    expect(first.published[0]?.stops_at_logout).toEqual({ linger_user: null });
    await first.runtime.stop();

    const older = new FakeCore({ heartbeatMs: 60_000 });
    older.revive();
    const second = await runtimeOn(older);
    await pollsAfter(older, 2);
    expect(second.latest().stops_at_logout).toBeNull();
    await second.runtime.stop();
  });

  test("a stopped connection keeps its last facts and stops reading", async () => {
    const fake = new FakeCore({ heartbeatMs: 60_000, version: "0.1.21" });
    fake.revive();
    fake.logout = {
      keeps_running_after_logout: false,
      logout_linger_user: "example",
    };
    const w = await runtimeOn(fake);
    await w.runtime.stop();
    expect(w.latest()).toMatchObject({
      state: "stale",
      stops_at_logout: { linger_user: "example" },
    });
    fake.logout = null;
    // A second connection's polls show the cycles the stopped one would have had.
    const probe = await runtimeOn(fake);
    await pollsAfter(fake, 3);
    await probe.runtime.stop();
    expect(w.latest()).toMatchObject({
      state: "stale",
      stops_at_logout: { linger_user: "example" },
    });
  });
});
