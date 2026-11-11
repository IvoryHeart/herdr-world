import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
} from "../connections/profile-service";
import { ConnectionProfileStore } from "../connections/profiles";
import { silentLogger } from "../utils/logger";
import { CoreClient } from "./client";
import { createCoreConnections } from "./connections";
import { resolveLocalCoreEndpoint } from "./endpoint";
import { CoreMirror } from "./mirror";
import type { CoreObservation } from "./observations";
import { connectUnixStream } from "./stream";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";
import { localCoreTransport } from "./transport";

// Opt in with HERDR_CORE_BIN=<official herdr-core binary>. Linux only; every
// process runs under scratch HOME/XDG directories and is killed afterwards.
const bin = scratchCoreBinary();
const live = bin ? test : test.skip;
const scratch: ScratchCore[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const core of scratch.splice(0)) await core.dispose();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function until(predicate: () => boolean, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(10);
  }
}

function worldFor(stateDir: string) {
  const root = mkdtempSync(join(tmpdir(), "hcw-world-"));
  roots.push(root);
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    transportFor: () => localCoreTransport(stateDir),
  });
  const store = new ConnectionProfileStore({
    path: join(root, "connections.json"),
  });
  const service: ConnectionProfileService<ConnectionRuntime, never> =
    new ConnectionProfileService({
      manager: new ConnectionManager<ConnectionRuntime>("startup-default"),
      core: core.support as never,
      store,
      bootstrap: loadConnectionProfileBootstrap({
        store,
        startupProfile: {
          id: "startup-default",
          label: "Default",
          type: "local",
          control_socket_path: "/synthetic/herdr.sock",
          client_socket_path: "/synthetic/herdr-client.sock",
          auto_connect: false,
        },
        explicitStartupOverride: false,
      }),
      createRuntime: () => () => ({
        identity: {
          id: "startup-default",
          label: "Default",
          source: "startup-config",
        },
        startTransport: async () => {},
        startBackground: () => {},
        stop: async () => {},
      }),
      retry: { baseDelayMs: 20, maxDelayMs: 200, random: () => 0 },
    });
  const profile = {
    id: "core",
    label: "Scratch core",
    type: "local",
    runtime: "herdr-core",
    core_session: "default",
    core_state_dir: stateDir,
    auto_connect: true,
  };
  const observation = () =>
    core.observations.get("core") as CoreObservation | null;
  return { service, core, profile, observation };
}

describe("herdr-core live (real release binary)", () => {
  live(
    "connected; kill -9 goes stale; the same agents return at the same addresses",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      await core.hc(
        "run",
        "--bg",
        "--keep",
        "--name",
        "agent",
        "--",
        "sh",
        "-c",
        "printf '\\033]7501;state=working\\033\\\\'; exec sleep 600",
      );
      await core.hc("run", "--bg", "--name", "shell", "--", "sh");
      const w = worldFor(core.stateDir);
      await w.service.create(w.profile);
      await until(() => w.observation()?.counts.live === 2);
      const before = w.observation()!;
      expect(before.state).toBe("live");
      expect(before.terminals.find((t) => t.name === "agent")?.status).toBe(
        "working",
      );

      const oldCore = core.killCore();
      await until(() => w.observation()?.state === "stale");
      // Holders keep programs and start a new core; World reconnects on its own.
      await until(
        () =>
          w.core.manager.status("core").state === "ready" &&
          w.observation()?.state === "live",
      );
      const after = w.observation()!;
      expect(after.core?.pid).not.toBe(oldCore);
      expect(after.core?.id).toBe(before.core?.id);
      // Drift flag: every event type this core sent is one World models.
      expect(after.unknown_events).toEqual([]);
      expect(after.terminals.map((t) => [t.address, t.name])).toEqual(
        before.terminals.map((t) => [t.address, t.name]),
      );
      w.service.stopSupervision();
      await w.core.manager.stopAll();
    },
    60_000,
  );

  live(
    "with no core running, World starts nothing",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      const lock = join(core.stateDir, "core.lock");
      // Stop every scratch process: the lock remains, naming a dead socket.
      for (const pid of core.pids()) process.kill(pid, "SIGKILL");
      await until(() => core.pids().length === 0);
      const sockets = readdirSync(join(core.root, "run", "herdr-core")).sort();
      const w = worldFor(core.stateDir);
      await w.service.create(w.profile);
      await Bun.sleep(500);
      expect(["reconnecting", "error"]).toContain(
        w.core.manager.status("core").state,
      );
      expect(core.pids()).toEqual([]);
      expect(existsSync(lock)).toBe(true);
      // kill -9 leaves the dead socket file; nothing new appeared beside it.
      expect(readdirSync(join(core.root, "run", "herdr-core")).sort()).toEqual(
        sockets,
      );
      expect(w.core.manager.status("core").error?.message).toContain(
        "not running",
      );
      w.service.stopSupervision();
      await w.core.manager.stopAll();
    },
    60_000,
  );

  live(
    "an oversized label's suppressed missed is caught by the heartbeat",
    async () => {
      const core = new ScratchCore(bin!, { heartbeatMs: 200 });
      scratch.push(core);
      await core.start();
      await core.hc("run", "--bg", "--name", "big", "--", "sh");
      const client = await CoreClient.open(
        await connectUnixStream(resolveLocalCoreEndpoint(core.stateDir)),
      );
      const mirror = new CoreMirror();
      await client.subscribe({
        baseline: (s, t) => {
          mirror.baseline(s, t);
        },
        line: (l) => {
          mirror.apply(l);
        },
        end: () => {},
      });
      const raw = await connectUnixStream(
        resolveLocalCoreEndpoint(core.stateDir),
      );
      raw.write(
        new TextEncoder().encode(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.label", params: { terminal: "t1", labels: { huge: "x".repeat(5 << 20) } } })}\n`,
        ),
      );
      await until(() => !mirror.actionable, 5_000);
      expect(mirror.retired).toBe("heartbeat-jump");
      expect(mirror.terminal("t1")?.labels).toEqual({});
      raw.close();
      client.close();
    },
    60_000,
  );

  live(
    "observing never resizes and reads never type; latency and throughput",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      await core.hc("run", "--bg", "--name", "watched", "--", "sh");
      const sizeOf = async () =>
        JSON.parse(await core.hc("get", "watched", "--json"));
      const before = await sizeOf();
      const client = await CoreClient.open(
        await connectUnixStream(resolveLocalCoreEndpoint(core.stateDir)),
      );
      const mirror = new CoreMirror();
      const applied = new Map<number, number>();
      await client.subscribe({
        baseline: (s, t) => {
          mirror.baseline(s, t);
        },
        line: (l) => {
          if (mirror.apply(l) === "applied")
            applied.set((l.params as { seq: number }).seq, performance.now());
        },
        end: () => {},
      });
      for (let i = 0; i < 5; i++) await client.readScreen("t1");
      await Bun.sleep(300);
      const after = await sizeOf();
      expect([after.cols, after.rows]).toEqual([before.cols, before.rows]);
      expect(after.turn).toBe(before.turn);

      // A separate plain-mode writer (test only) changes labels; World observes.
      let replies = "";
      const writer = await connectUnixStream(
        resolveLocalCoreEndpoint(core.stateDir),
      );
      writer.onData((d) => {
        replies += new TextDecoder().decode(d);
      });
      let id = 0;
      const label = (n: number) =>
        writer.write(
          new TextEncoder().encode(
            `${JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "terminal.label", params: { terminal: "t1", labels: { n: String(n) } } })}\n`,
          ),
        );
      // Paced: one write at a time, measured from write to applied in the mirror.
      const latencies: number[] = [];
      for (let i = 0; i < 200; i++) {
        const seq = mirror.cursor + 1;
        const at = performance.now();
        label(i);
        await until(() => applied.has(seq), 2_000).catch(() => undefined);
        await new Promise<void>((resolve) => {
          const poll = () =>
            applied.has(seq) ? resolve() : setImmediate(poll);
          poll();
        });
        latencies.push(applied.get(seq)! - at);
      }
      latencies.sort((a, b) => a - b);
      const p = (q: number) =>
        latencies[
          Math.min(latencies.length - 1, Math.floor(q * latencies.length))
        ]!;
      // Burst: stream throughput through framing, UTF-8 assembly and the mirror.
      const total = 2000;
      const start = performance.now();
      for (let i = 0; i < total; i++) label(1000 + i);
      await until(
        () => mirror.terminal("t1")?.labels.n === String(1000 + total - 1),
        20_000,
      );
      const elapsed = performance.now() - start;
      console.log(
        `herdr-core ${client.hello.version}: paced write-to-mirror p50 ${p(0.5).toFixed(2)} ms, p99 ${p(0.99).toFixed(2)} ms (n=200); burst ${total} events in ${elapsed.toFixed(0)} ms (${(total / (elapsed / 1000)).toFixed(0)}/s)`,
      );
      expect(mirror.actionable).toBe(true);
      void replies;
      writer.close();
      client.close();
    },
    60_000,
  );
});
