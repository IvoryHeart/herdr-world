import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scheduler } from "../service/ports";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
} from "./manager";
import {
  ConnectionProbeError,
  ConnectionProfileService,
  connectionIdentityForProfile,
} from "./profile-service";
import {
  ConnectionProfileStore,
  type LocalConnectionProfile,
} from "./profiles";

type Timer = { callback(): void; delayMs: number; cancelled: boolean };
const missing = () => new Error("ENOENT: connect synthetic control socket");

async function fixture(outcome: (attempt: number) => Error | undefined) {
  const root = mkdtempSync(join(tmpdir(), "local-recovery-"));
  const profile: LocalConnectionProfile = {
    id: "local",
    label: "Synthetic local",
    type: "local",
    auto_connect: true,
    control_socket_path: join(root, "control.sock"),
    client_socket_path: join(root, "render.sock"),
  };
  const sibling = { ...profile, id: "sibling", label: "Synthetic sibling" };
  const registry = {
    version: 2 as const,
    default_connection_id: "sibling",
    profiles: [profile, sibling],
  };
  const store = new ConnectionProfileStore({
    path: join(root, "profiles.json"),
  });
  await store.save(registry);
  const ready = Promise.withResolvers<void>();
  const manager = new ConnectionManager<ConnectionRuntime>(
    "sibling",
    (status) => {
      if (status.id === "local" && status.state === "ready") ready.resolve();
    },
  );
  const timers: Timer[] = [];
  let scheduled = Promise.withResolvers<void>();
  const scheduler: Scheduler = {
    schedule(callback, delayMs) {
      const timer = { callback, delayMs, cancelled: false };
      timers.push(timer);
      scheduled.resolve();
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
  };
  let attempts = 0;
  let context: ConnectionRuntimeContext;
  let stop = async () => {};
  const service = new ConnectionProfileService({
    manager,
    store,
    bootstrap: {
      defaultConnectionId: "sibling",
      explicitStartupOverride: false,
      persistedRegistry: registry,
      registrations: registry.profiles.map((profile) => ({
        profile,
        readOnly: false,
      })),
    },
    createRuntime: (owner) => (current) => ({
      identity: connectionIdentityForProfile(owner),
      async startTransport() {
        if (owner.id !== "local") return;
        context = current;
        const error = outcome(++attempts);
        if (error) throw error;
      },
      startBackground() {},
      async stop() {
        if (owner.id === "local") await stop();
      },
    }),
    retry: {
      baseDelayMs: 100,
      maxDelayMs: 400,
      random: () => 1,
      schedule: (callback, delayMs) => scheduler.schedule(callback, delayMs),
    },
  });
  return {
    service,
    manager,
    timers,
    ready: ready.promise,
    profile,
    attempts: () => attempts,
    fail(error: Error, cleanup = async () => {}) {
      stop = cleanup;
      const reconnecting = service.willRetry("local", error);
      expect(reconnecting).toBeTrue();
      context!.reportError(error, { reconnecting });
      service.runtimeFailed("local", error);
    },
    async retry() {
      scheduled = Promise.withResolvers<void>();
      timers.at(-1)!.callback();
      await scheduled.promise;
    },
    async close() {
      service.stopSupervision();
      await manager.stopAll();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("late local availability recovers with capped backoff and a fresh generation", async () => {
  const f = await fixture((attempt) => (attempt < 9 ? missing() : undefined));
  try {
    await f.service.startConfigured();
    expect(f.timers.map((timer) => timer.delayMs)).toEqual([100]);
    expect(f.manager.status("local").state).toBe("reconnecting");
    expect(f.manager.readyRuntimeLease("local")).toBeNull();
    const failedGeneration = f.manager.status("local").generation;
    const sibling = f.manager.readyRuntimeLease("sibling")!;
    for (let index = 0; index < 7; index++) await f.retry();
    expect(f.timers.map((timer) => timer.delayMs)).toEqual([
      100, 200, 400, 400, 400, 400, 400, 400,
    ]);
    f.timers.at(-1)!.callback();
    await f.ready;
    expect(f.attempts()).toBe(9);
    expect(f.manager.status("local").generation).toBeGreaterThan(
      failedGeneration,
    );
    expect(f.manager.readyRuntimeLease("local")!.isCurrent()).toBeTrue();
    expect(sibling.isCurrent()).toBeTrue();
  } finally {
    await f.close();
  }
});

test.each([
  new Error("ECONNREFUSED: synthetic socket"),
  Object.assign(new Error("synthetic reset"), { code: "ECONNRESET" }),
  new Error("ETIMEDOUT: synthetic socket"),
  new Error("EPIPE: synthetic socket"),
  new Error("timeout: ping"),
  new Error("connection closed before response: ping"),
  new ConnectionProbeError(
    "timed out waiting for Herdr protocol 22 handshake",
    true,
  ),
])(
  "classified local transport error enters recovery: %s",
  async (transient) => {
    const f = await fixture(() => transient);
    try {
      await f.service.startConfigured();
      expect(f.timers).toHaveLength(1);
      expect(f.manager.status("local").state).toBe("reconnecting");
    } finally {
      await f.close();
    }
  },
);

test.each([
  "disconnect",
  "remove",
  "replace",
  "shutdown",
  "generation",
] as const)(
  "late local retry cannot revive a profile after %s",
  async (action) => {
    const f = await fixture(missing);
    try {
      await f.service.startConfigured();
      expect(f.timers).toHaveLength(1);
      const timer = f.timers[0];
      if (action === "disconnect") await f.service.disconnect("local");
      if (action === "remove") await f.service.remove("local");
      if (action === "replace") {
        await f.service.disconnect("local");
        await f.service.update("local", {
          ...f.profile,
          auto_connect: false,
          label: "Replacement",
        });
      }
      if (action === "shutdown") f.service.stopSupervision();
      if (action === "generation") await f.manager.stop("local");
      timer.callback(); // Simulate an already-delivered callback after cancellation.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(f.attempts()).toBe(1);
    } finally {
      await f.close();
    }
  },
);

test("explicit local Reconnect supersedes a queued retry", async () => {
  const f = await fixture((attempt) => (attempt === 1 ? missing() : undefined));
  try {
    await f.service.startConfigured();
    expect(f.timers).toHaveLength(1);
    const timer = f.timers[0];
    await f.service.connect("local");
    const lease = f.manager.readyRuntimeLease("local")!;
    timer.callback();
    expect(f.attempts()).toBe(2);
    expect(timer.cancelled).toBeTrue();
    expect(lease.isCurrent()).toBeTrue();
  } finally {
    await f.close();
  }
});

test.each([
  new Error("EACCES: permission denied"),
  new Error("EPERM: forbidden"),
  new Error("bad JSON from Herdr"),
  new Error("arbitrary timeout text"),
  new ConnectionProbeError("unsupported protocol", false),
])(
  "local recovery stops on a permanent or unclassified next failure: %s",
  async (permanent) => {
    const f = await fixture((attempt) =>
      attempt === 1 ? missing() : permanent,
    );
    try {
      await f.service.startConfigured();
      expect(f.timers).toHaveLength(1);
      // Explicit connect awaits the second attempt and keeps the same classifier.
      await expect(f.service.connect("local")).rejects.toThrow(
        permanent.message,
      );
      expect(f.manager.status("local").state).toBe("error");
      expect(f.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
    } finally {
      await f.close();
    }
  },
);

test("disconnect cancels a fired local retry while failed-runtime cleanup is held", async () => {
  const f = await fixture(() => undefined);
  const cleanup = Promise.withResolvers<void>();
  try {
    await f.service.startConfigured();
    const lease = f.manager.readyRuntimeLease("local")!;
    f.fail(missing(), () => cleanup.promise);
    expect(f.timers).toHaveLength(1);
    expect(lease.isCurrent()).toBeFalse();
    f.timers[0].callback();
    const disconnected = f.service.disconnect("local");
    cleanup.resolve();
    await disconnected;
    expect(f.attempts()).toBe(1);
    expect(f.manager.status("local").state).toBe("disconnected");
  } finally {
    cleanup.resolve();
    await f.close();
  }
});
