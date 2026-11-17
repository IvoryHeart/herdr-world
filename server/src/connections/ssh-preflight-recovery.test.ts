import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSshTunnelManager } from "../bridge/ssh-tunnel";
import { runProcess } from "../utils/process-utils";
import { ConnectionManager, type ConnectionRuntime } from "./manager";
import {
  ConnectionProfileService,
  connectionIdentityForProfile,
  type ManagedConnectionProfile,
} from "./profile-service";
import {
  ConnectionProfileStore,
  type LocalConnectionProfile,
  type SshConnectionProfile,
} from "./profiles";

type Timer = { callback(): void; delayMs: number; cancelled: boolean };
type Runtime = ConnectionRuntime & { stops: number };
type Outcome = { code: number; stderr?: string; stdout?: string } | Error;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(condition: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("preflight fixture deadline");
    await Bun.sleep(1);
  }
}

/** Real remoteHome/runProcess code, synthetic child output; never invokes SSH. */
async function fixture(
  outcome: (attempt: number) => Outcome,
  held?: ReturnType<typeof deferred>,
) {
  const root = mkdtempSync(join(tmpdir(), "ssh-preflight-recovery-"));
  const local: LocalConnectionProfile = {
    id: "healthy",
    label: "Synthetic healthy sibling",
    type: "local",
    control_socket_path: "/synthetic/control.sock",
    client_socket_path: "/synthetic/render.sock",
    auto_connect: true,
  };
  const remote: SshConnectionProfile = {
    id: "remote",
    label: "Synthetic remote",
    type: "ssh",
    ssh_destination: "preflight.example.test",
    remote_control_socket_path: "",
    remote_client_socket_path: "",
    auto_connect: true,
  };
  const registry = {
    version: 2 as const,
    default_connection_id: local.id,
    profiles: [local, remote],
  };
  const store = new ConnectionProfileStore({
    path: join(root, "profiles.json"),
  });
  await store.save(registry);
  const manager = new ConnectionManager<Runtime>(local.id);
  const timers: Timer[] = [];
  const runtimes = new Map<string, Runtime[]>();
  const started = deferred();
  let attempts = 0;
  let forwards = 0;
  const service = new ConnectionProfileService({
    manager,
    store,
    bootstrap: {
      defaultConnectionId: local.id,
      explicitStartupOverride: false,
      persistedRegistry: registry,
      registrations: registry.profiles.map((profile) => ({
        profile,
        readOnly: false,
      })),
    },
    createRuntime: (profile: ManagedConnectionProfile) => () => {
      const identity = connectionIdentityForProfile(profile);
      const exited = deferred();
      const tunnel =
        profile.type === "ssh"
          ? createSshTunnelManager({
              connectionId: profile.id,
              config: {
                sshHost: profile.ssh_destination,
                socketPath: "/synthetic/local-control.sock",
                clientSocketPath: "/synthetic/local-render.sock",
                hasExplicitSocketPath: false,
                hasExplicitClientSocketPath: false,
              },
              runProcess: async (argv) => {
                expect(argv[0]).toBe("ssh");
                expect(argv.at(-1)).toBe('printf %s "$HOME"');
                expect(argv).toContain(profile.ssh_destination);
                const attempt = ++attempts;
                started.resolve();
                if (held) await held.promise;
                const result = outcome(attempt);
                if (result instanceof Error) throw result;
                // Exercise the same subprocess exit boundary as real SSH,
                // without using a user's host/config, network or executable.
                return runProcess([
                  process.execPath,
                  "-e",
                  `process.stdout.write(${JSON.stringify(result.stdout ?? "/synthetic/remote")}); process.stderr.write(${JSON.stringify(result.stderr ?? "")}); process.exit(${result.code});`,
                ]);
              },
              dependencies: {
                platform: "linux",
                exists: () => true,
                remove: () => {},
                spawn: () => {
                  forwards++;
                  return {
                    exited: exited.promise.then(() => 0),
                    kill: () => exited.resolve(),
                  };
                },
              },
            })
          : null;
      const runtime: Runtime = {
        identity,
        stops: 0,
        async startTransport() {
          await tunnel?.startAutoSshTunnel();
        },
        startBackground() {},
        async stop() {
          runtime.stops++;
          await tunnel?.cleanupAutoSshTunnel();
        },
      };
      const previous = runtimes.get(profile.id) ?? [];
      previous.push(runtime);
      runtimes.set(profile.id, previous);
      return runtime;
    },
    retry: {
      baseDelayMs: 10,
      maxDelayMs: 40,
      random: () => 0,
      schedule: (callback, delayMs) => {
        const timer = { callback, delayMs, cancelled: false };
        timers.push(timer);
        return { cancel: () => (timer.cancelled = true) };
      },
    },
  });
  return {
    service,
    manager,
    timers,
    runtimes,
    started,
    attempts: () => attempts,
    forwards: () => forwards,
    async close() {
      held?.resolve();
      service.stopSupervision();
      await manager.stopAll();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("real HOME preflight failures retry beyond six attempts then recover without replacing a sibling", async () => {
  const f = await fixture((attempt) =>
    attempt <= 8
      ? { code: 255, stderr: "ssh: connect: Connection timed out" }
      : { code: 0 },
  );
  try {
    await f.service.startConfigured();
    const healthy = f.manager.readyRuntimeLease("healthy")!;
    expect(f.timers).toHaveLength(1);
    for (let index = 0; index < 8; index++) {
      expect(f.manager.status("remote").state).toBe("reconnecting");
      f.timers[index]!.callback();
      await waitUntil(
        () =>
          f.timers.length > index + 1 ||
          f.manager.status("remote").state === "ready",
      );
    }
    expect(f.attempts()).toBe(9);
    expect(f.forwards()).toBe(1);
    expect(f.manager.status("remote").state).toBe("ready");
    expect(f.timers.slice(0, 8).map((timer) => timer.delayMs)).toEqual([
      5, 10, 20, 20, 20, 20, 20, 20,
    ]);
    expect(healthy.isCurrent()).toBe(true);
    expect(f.manager.currentRuntime("healthy")).toBe(healthy.runtime);
    expect(f.runtimes.get("healthy")).toHaveLength(1);
    expect(
      f.runtimes
        .get("remote")!
        .slice(0, 8)
        .every((x) => x.stops === 1),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

test.each([
  ["authentication", { code: 255, stderr: "Permission denied (publickey)." }],
  ["host-key", { code: 255, stderr: "Host key verification failed." }],
  ["unknown-exit", { code: 7, stderr: "Connection timed out" }],
  ["invalid-home", { code: 0, stdout: "relative-path" }],
  ["unclassified", new Error("ssh exited 255: Connection timed out")],
] as const)(
  "preflight %s failures do not acquire automatic retry",
  async (_, result) => {
    const f = await fixture(() => result);
    try {
      await f.service.startConfigured();
      expect(f.manager.status("remote").state).toBe("error");
      expect(f.timers).toHaveLength(0);
      expect(f.attempts()).toBe(1);
      expect(f.forwards()).toBe(0);
      expect(f.manager.readyRuntimeLease("healthy")?.isCurrent()).toBe(true);
    } finally {
      await f.close();
    }
  },
);

test.each(["disconnect", "remove"] as const)(
  "%s cancels queued preflight recovery and ignores a late timer",
  async (action) => {
    const f = await fixture(() => ({
      code: 255,
      stderr: "Connection timed out",
    }));
    try {
      await f.service.startConfigured();
      const healthy = f.manager.readyRuntimeLease("healthy")!;
      expect(f.timers).toHaveLength(1);
      await f.service[action]("remote");
      expect(f.timers[0]!.cancelled).toBe(true);
      f.timers[0]!.callback();
      await Bun.sleep(0);
      expect(f.attempts()).toBe(1);
      expect(f.forwards()).toBe(0);
      expect(healthy.isCurrent()).toBe(true);
      if (action === "remove") expect(f.manager.has("remote")).toBe(false);
      else expect(f.manager.status("remote").state).toBe("disconnected");
    } finally {
      await f.close();
    }
  },
);

test.each(["disconnect", "remove"] as const)(
  "%s retires an in-flight HOME result without restarting or touching a sibling",
  async (action) => {
    const held = deferred();
    const f = await fixture(
      () => ({ code: 255, stderr: "Connection timed out" }),
      held,
    );
    try {
      const starting = f.service.startConfigured();
      await f.started.promise;
      await waitUntil(() => f.manager.status("healthy").state === "ready");
      const healthy = f.manager.readyRuntimeLease("healthy")!;
      const stopping = f.service[action]("remote");
      await waitUntil(() => f.manager.status("remote").state === "stopping");
      const retiredGeneration = f.manager.status("remote").generation;
      held.resolve();
      await Promise.all([starting, stopping]);
      expect(f.timers).toHaveLength(0);
      expect(f.forwards()).toBe(0);
      expect(healthy.isCurrent()).toBe(true);
      if (action === "remove") expect(f.manager.has("remote")).toBe(false);
      else {
        expect(f.manager.status("remote").state).toBe("disconnected");
        expect(f.manager.status("remote").generation).toBe(retiredGeneration);
      }
    } finally {
      await f.close();
    }
  },
);
