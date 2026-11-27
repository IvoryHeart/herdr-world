import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
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
import { CoreClient, type CoreWatchSink } from "./client";
import {
  type FloatShellPush,
  FloatShellService,
  floatShellName,
} from "./float-shell";
import { createCoreConnections } from "./connections";
import { resolveLocalCoreEndpoint } from "./endpoint";
import { CoreMirror } from "./mirror";
import { type CoreObservation, CoreObservationStore } from "./observations";
import {
  type CoreConnectionRuntime,
  createCoreConnectionRuntime,
} from "./runtime";
import { desktopPane } from "./testing/desktop-pane";
import { type CoreTerminalPush, CoreTerminalWatches } from "./watches";
import { FrameDecoder, FrameKind } from "./wire";
import { connectUnixStream } from "./stream";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";
import { localCoreTransport } from "./transport";
import { worldRuntimeRegistry } from "../world/runtime-registry";
import { WorldSnapshotService } from "../world/snapshot";
import type { TaskEvent } from "../notifications/task-events";
import { handleCoreSharedRpc } from "../rpc/core-shared";
import { coreAgentStatus } from "./topology";
import { memoryCoreTopologyPort } from "../storage/core-topology";
import { createCoreRoom, launchCore } from "./operations";
import { moveCore } from "./town-move";

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

/**
 * Core 0.1.21 (upstream #199) stopped an observer from sizing a terminal: an
 * observer alone leaves it at the size it had. Not a pin: every release runs
 * the same test; this names the rule each one is held to.
 */
function keepsObservedSize(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version
    .split(/[-+]/)[0]!
    .split(".")
    .map(Number);
  return major > 0 || minor > 1 || (minor === 1 && patch >= 21);
}

function worldFor(stateDir: string, pushed: TaskEvent[] = []) {
  const root = mkdtempSync(join(tmpdir(), "hcw-world-"));
  roots.push(root);
  const topology = memoryCoreTopologyPort();
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    topology: () => topology,
    transportFor: () => localCoreTransport(stateDir),
    push: (task, isCurrent) => {
      if (isCurrent()) pushed.push(task);
    },
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
  return { service, core, profile, observation, topology };
}

describe("herdr-core live (real release binary)", () => {
  live(
    "World launches two tabs in one app space and moves them with the same label contract",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      const w = worldFor(core.stateDir);
      try {
        await w.service.create(w.profile);
        await until(() => w.core.manager.status("core").state === "ready");
        const lease = w.core.manager.readyRuntimeLease("core")!;
        const room = await createCoreRoom(lease, w.topology, "Crew");
        const started = [];
        for (const label of ["First", "Second"]) {
          const result = await launchCore(
            lease,
            {
              workspaceId: room.workspace_id,
              kind: "codex",
              label,
              args: ["600"],
              text: "",
            },
            // A harmless stand-in, with no harness credentials or user config.
            {
              topology: w.topology,
              resolveExecutable: async () => "/bin/sleep",
            },
          );
          if (!("terminal_id" in result)) throw new Error("launch failed");
          const record = JSON.parse(
            await core.hc("get", "--json", result.terminal_id),
          );
          expect(structuredClone(record.labels)).toEqual({
            "herdr.space": `world-${room.workspace_id.slice("hc:room:".length)}`,
            "herdr.tab": expect.stringMatching(/^world-b[0-9a-f]{12}$/),
            "herdr.seen": "0",
            where: `Crew / ${label}`,
          });
          expect(record.keep).toBe(true);
          started.push({ result, record });
        }
        expect(
          new Set(started.map(({ record }) => record.labels["herdr.tab"])).size,
        ).toBe(2);
        const target = await createCoreRoom(lease, w.topology, "Workshop");
        for (const { result, record } of started) {
          expect(
            await moveCore(lease, w.topology, {
              kind: "desk",
              tab_id: result.tab_id,
              workspace_id: target.workspace_id,
            }),
          ).toMatchObject({ status: "moved" });
          const moved = JSON.parse(
            await core.hc("get", "--json", result.terminal_id),
          );
          expect(structuredClone(moved.labels)).toMatchObject({
            "herdr.space": `world-${target.workspace_id.slice("hc:room:".length)}`,
            "herdr.tab": expect.stringMatching(/^world-b[0-9a-f]{12}$/),
            "herdr.seen": "0",
            where: expect.stringMatching(/^Workshop \/ /),
          });
          expect(moved.pid).toBe(record.pid);
          expect(moved.argv).toEqual(record.argv);
        }
        const listing = JSON.parse(await core.hc("ls", "--json"));
        const terminals = await Promise.all(
          listing.terminals.map(async (t: { address: string }) =>
            JSON.parse(await core.hc("get", "--json", t.address)),
          ),
        );
        expect(terminals).toHaveLength(2);
        expect(
          new Set(
            terminals.map(
              (t: { labels: Record<string, string> }) =>
                t.labels["herdr.space"],
            ),
          ).size,
        ).toBe(1);
        expect(
          new Set(
            terminals.map(
              (t: { labels: Record<string, string> }) => t.labels["herdr.tab"],
            ),
          ).size,
        ).toBe(2);
      } finally {
        w.service.stopSupervision();
        await w.core.stop();
        w.topology.close();
      }
    },
    30_000,
  );

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

  test.skipIf(!bin || !Bun.which("cc"))(
    "core agents reach World's read model with core's status and the app's rooms",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      const msg = Buffer.from("Which branch?").toString("base64");
      // A native Claude stand-in keeps the reporter in the foreground. Plain
      // sleep leaves a departed Claude's report, which World correctly idles.
      const claude = join(core.root, "claude");
      const compile = Bun.spawnSync(["cc", "-x", "c", "-", "-o", claude], {
        stdin: Buffer.from(`#include <stdio.h>
#include <unistd.h>
int main(void) {
  printf("\\033]7501;state=blocked:kind=question:app=claude-code:msg=${msg}\\033\\\\");
  fflush(stdout);
  pause();
  return 0;
}`),
      });
      expect(compile.exitCode).toBe(0);
      await core.hc(
        "run",
        "--bg",
        "--keep",
        "--name",
        "reviewer",
        "--label",
        "herdr.space=s1",
        "--label",
        "herdr.tab=c1",
        "--label",
        "where=web / review",
        "--",
        claude,
      );
      // A turn that ends while World watches, then a plain shell.
      await core.hc(
        "run",
        "--bg",
        "--keep",
        "--name",
        "scout",
        "--",
        "sh",
        "-c",
        "sleep 1; printf '\\033]7501;state=working:app=gemini\\033\\\\'; sleep 0.3; printf '\\033]7501;state=idle:app=gemini\\033\\\\'; exec sleep 600",
      );
      await core.hc("run", "--bg", "--name", "shell", "--", "sh");
      const w = worldFor(core.stateDir);
      const registry = worldRuntimeRegistry(
        new ConnectionManager<never>("startup-default"),
        w.core.manager,
      );
      const snapshots = new WorldSnapshotService(registry);
      await w.service.create(w.profile);
      const rows = async () => {
        snapshots.invalidate("core");
        const result = await snapshots.snapshot();
        return result.connections.find((c) => c.connection_id === "core")
          ?.snapshot;
      };
      let view = await rows();
      const deadline = Date.now() + 10_000;
      while (
        Date.now() < deadline &&
        view?.panes.find((p) => p.agent === "gemini")?.agent_status !== "done"
      ) {
        await Bun.sleep(50);
        view = await rows();
      }
      const byName = new Map(
        view!.agents.map((agent) => [agent.name, agent.pane_id]),
      );
      const pane = (name: string) =>
        view!.panes.find((p) => p.pane_id === byName.get(name));
      expect(pane("reviewer")).toMatchObject({
        agent: "claude",
        agent_status: "blocked",
        blocked_kind: "question",
        status_message: "Which branch?",
        workspace_id: "hc:space:s1",
        runtime: "herdr-core",
      });
      const native = JSON.parse(
        await core.hc("get", "--json", String(byName.get("reviewer"))),
      );
      expect(native.status).toMatchObject({
        state: "blocked",
        kind: "question",
        app: "claude-code",
        msg: "Which branch?",
      });
      expect(
        view!.workspaces.find((s) => s.workspace_id === "hc:space:s1")?.label,
      ).toBe("web");
      // Finished while World watched, no client has marked it seen: done.
      expect(pane("scout")).toMatchObject({
        agent: "gemini",
        agent_status: "done",
      });
      // Another Herdr client looks at it: idle everywhere.
      await core.hc("label", String(byName.get("scout")), "herdr.seen=1");
      const seenBy = Date.now() + 5_000;
      while (Date.now() < seenBy && pane("scout")?.agent_status !== "idle") {
        await Bun.sleep(50);
        view = await rows();
      }
      expect(pane("scout")?.agent_status).toBe("idle");
      expect(view!.panes).toHaveLength(3);
      expect(view!.panes.filter((p) => !p.agent)).toHaveLength(1);
      w.service.stopSupervision();
      await w.core.manager.stopAll();
    },
    60_000,
  );

  live(
    "seen, unread and favourite round-trip with another client; push follows status",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      const pushed: TaskEvent[] = [];
      const w = worldFor(core.stateDir, pushed);
      await w.service.create(w.profile);
      await until(() => w.observation()?.state === "live");
      // A kept agent finishes a turn while World watches and nobody looks.
      const address = (
        await core.hc(
          "run",
          "--bg",
          "--keep",
          "--name",
          "scout",
          "--",
          "sh",
          "-c",
          "sleep 0.3; printf '\\033]7501;state=working:app=gemini\\033\\\\'; sleep 0.3; printf '\\033]7501;state=done:app=gemini\\033\\\\'; exec sleep 600",
        )
      ).match(/\bt\d+\b/)![0];
      const lease = () => w.core.manager.readyRuntimeLease("core")!;
      const record = () => lease().runtime.core.terminal(address);
      await until(() => record()?.turn === 1);
      expect(coreAgentStatus(record()!, 0)).toBe("done");
      await until(() => pushed.length === 1);
      expect(pushed[0]).toMatchObject({ kind: "completed", paneId: address });
      // What another Herdr client reads, from core's own CLI.
      const labels = async () =>
        (
          JSON.parse(await core.hc("get", address, "--json")) as {
            labels?: Record<string, string>;
          }
        ).labels ?? {};
      const call = async (method: string, extra: Record<string, unknown>) => {
        const out: { result?: unknown; error?: unknown } = {};
        await handleCoreSharedRpc({
          id: "1",
          method,
          params: {
            connection_id: "core",
            connection_generation: lease().generation,
            terminal: address,
            ...extra,
          },
          sendReply: (message) => {
            out.result = message.result;
            return true;
          },
          sendError: (_context, error) => {
            out.error = error;
          },
          services: { core: { manager: w.core.manager } },
        });
        return out;
      };
      // World looks: core accepts the write and every client sees idle.
      const started = performance.now();
      expect(await call("world.core.seen", { turn: 1, seen: null })).toEqual({
        result: { written: true },
      });
      await until(() => coreAgentStatus(record()!, 0) === "idle");
      const roundTripMs = performance.now() - started;
      expect(roundTripMs).toBeLessThan(2_000);
      expect(await labels()).toEqual({ "herdr.seen": "1" });
      // A repeat writes nothing.
      expect(await call("world.core.seen", { turn: 1, seen: 1 })).toEqual({
        result: { written: false },
      });
      // Another client marks it unread: World shows done again.
      await core.hc("label", address, "herdr.seen=0");
      await until(() => coreAgentStatus(record()!, 0) === "done");
      // ...and pins it: World shows the favourite; World unpins it.
      await core.hc("label", address, "herdr.pinned=1");
      await until(() => record()?.labels?.["herdr.pinned"] === "1");
      expect(await call("world.core.favourite", { favourite: false })).toEqual({
        result: { written: true },
      });
      await until(() => record()?.labels?.["herdr.pinned"] === undefined);
      expect(await labels()).toEqual({ "herdr.seen": "0" });
      // Core refuses nothing World sends, and World labels nothing else.
      expect(await call("world.core.favourite", { favourite: true })).toEqual({
        result: { written: true },
      });
      expect(await labels()).toEqual({
        "herdr.seen": "0",
        "herdr.pinned": "1",
      });
      // A second agent stops to ask: push says it needs you.
      await core.hc(
        "run",
        "--bg",
        "--keep",
        "--name",
        "asker",
        "--",
        "sh",
        "-c",
        "sleep 0.3; printf '\\033]7501;state=working:app=claude-code\\033\\\\'; sleep 0.3; printf '\\033]7501;state=blocked:kind=question:app=claude-code\\033\\\\'; exec sleep 600",
      );
      await until(() => pushed.length === 2);
      expect(pushed[1]).toMatchObject({ kind: "blocked", agent: "claude" });
      console.log(`core seen round trip: ${roundTripMs.toFixed(1)} ms`);
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

  live(
    "watching follows the desktop pane's grid, never sizes it, and reports what an observer alone did",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      // `cat` echoes anything typed, so input from World would show.
      await core.hc(
        "run",
        "--bg",
        "--name",
        "agent",
        "--",
        "sh",
        "-c",
        "printf 'ready\\r\\n'; exec cat",
      );
      const grid = async (address: string) => {
        const t = JSON.parse(await core.hc("get", address, "--json"));
        return [t.cols, t.rows];
      };
      const pane = await desktopPane(core);
      await pane.attach("t1", 100, 30);
      expect(await grid("t1")).toEqual([100, 30]);

      // World's own client, every outbound frame decoded.
      const outbound: Array<{ channel: number; kind: number }> = [];
      const decoder = new FrameDecoder();
      let framed = false;
      const client = await CoreClient.open(
        await connectUnixStream(resolveLocalCoreEndpoint(core.stateDir)),
        {
          onOutbound: (bytes) => {
            if (!framed) {
              framed = true;
              return;
            }
            for (const f of decoder.push(bytes))
              outbound.push({ channel: f.channel, kind: f.kind });
          },
        },
      );
      const seen: Array<string> = [];
      const text = new TextDecoder();
      let screen = "";
      const sink: CoreWatchSink = {
        resize: (cols, rows) => seen.push(`${cols}x${rows}`),
        data: (bytes) => {
          seen.push("data");
          screen += text.decode(bytes, { stream: true });
        },
        close: (reason) => seen.push(`closed ${reason}`),
      };
      const watch = await client.watch("t1", { cols: 100, rows: 30 }, sink);
      await until(() => seen.includes("data") && screen.includes("ready"));
      // The pane's grid arrives before the first paint, and core keeps it.
      expect(seen[0]).toBe("100x30");
      expect(watch.terminal).toMatchObject({ cols: 100, rows: 30 });
      expect(await grid("t1")).toEqual([100, 30]);

      // The pane resizes: World follows, measured from the pane's RESIZE.
      const at = performance.now();
      pane.resize(80, 24);
      await until(() => seen.includes("80x24"));
      const resizeMs = performance.now() - at;
      await until(() => seen.lastIndexOf("data") > seen.indexOf("80x24"));
      expect(await grid("t1")).toEqual([80, 24]);

      // The same through World's relay and production runtime.
      const root = mkdtempSync(join(tmpdir(), "hcw-watch-"));
      roots.push(root);
      const manager = new ConnectionManager<CoreConnectionRuntime>("");
      manager.register({
        identity: { id: "core", label: "core", source: "local-profile" },
        createRuntime: (context) =>
          createCoreConnectionRuntime({
            identity: { id: "core", label: "core", source: "local-profile" },
            context,
            transport: localCoreTransport(core.stateDir),
            observations: new CoreObservationStore(() => {}),
            onFailure: () => {},
          }),
      });
      await manager.start("core");
      const pushes: CoreTerminalPush[] = [];
      const page = {};
      const watches = new CoreTerminalWatches<object>({
        lease: (id) => (manager.has(id) ? manager.readyRuntimeLease(id) : null),
        send: (_page, push) => {
          pushes.push(push);
          return true;
        },
        buffered: () => 0,
      });
      const lease = () => manager.readyRuntimeLease("core");
      await until(() => lease()?.runtime.core.terminal("t1")?.cols === 80);
      const target = (address: string, stream: string) => ({
        connection_id: "core",
        generation: manager.status("core").generation,
        address,
        stream,
      });
      const opened = await watches.open(page, target("t1", "a"));
      expect(opened).toEqual({
        stream: "a",
        grid: { cols: 80, rows: 24 },
        moved_from: null,
      });
      await until(() => pushes.some((p) => "bytes" in p));
      expect(pushes[0]).toEqual({ stream: "a", grid: { cols: 80, rows: 24 } });
      expect(await grid("t1")).toEqual([80, 24]);

      // The pane closes: core goes headless, and both watches are told first.
      pane.detach();
      await until(
        () =>
          seen.includes("200x120") &&
          pushes.some((p) => "grid" in p && p.grid.cols === 200),
      );
      expect(await grid("t1")).toEqual([200, 120]);

      // Observer alone: an unviewed terminal made at 100x30. Core 0.1.21
      // (upstream #199) leaves it at that size; older cores move it to
      // headless when an observer attaches. World reports whichever core did.
      const plain = await connectUnixStream(
        resolveLocalCoreEndpoint(core.stateDir),
      );
      let replies = "";
      plain.onData((d) => {
        replies += new TextDecoder().decode(d);
      });
      plain.write(
        new TextEncoder().encode(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.run", params: { argv: ["sh", "-c", "exec sleep 600"], name: "fresh", size: { cols: 100, rows: 30 } } })}\n`,
        ),
      );
      await until(() => replies.includes("\n"));
      const fresh = JSON.parse(replies).result.address as string;
      expect(await grid(fresh)).toEqual([100, 30]);
      await until(() => lease()?.runtime.core.terminal(fresh)?.cols === 100);
      const alone = await watches.open(page, target(fresh, "b"));
      const [cols, rows] = await grid(fresh);
      expect(alone.grid).toEqual({ cols, rows });
      expect(pushes.find((p) => p.stream === "b")).toEqual({
        stream: "b",
        grid: { cols, rows },
      });
      if (keepsObservedSize(client.hello.version)) {
        expect({ cols, rows }).toEqual({ cols: 100, rows: 30 });
        expect(alone.moved_from).toBeNull();
      } else {
        // The exception older cores still have: reported, never hidden.
        expect({ cols, rows }).toEqual({ cols: 200, rows: 120 });
        expect(alone.moved_from).toEqual({ cols: 100, rows: 30 });
      }

      // Throughput through the relay: 200,000 lines printed while watched.
      await core.hc(
        "run",
        "--bg",
        "--name",
        "flood",
        "--",
        "sh",
        "-c",
        "sleep 0.5; seq 1 200000; exec sleep 600",
      );
      const floodAddress = JSON.parse(await core.hc("get", "flood", "--json"))
        .address as string;
      await until(
        () => lease()?.runtime.core.terminal(floodAddress)?.state === "live",
      );
      await watches.open(page, target(floodAddress, "c"));
      // Timed from the first live output after the first paint.
      let started: number | null = null;
      let paints = 0;
      let bytes = 0;
      let consumed = 0;
      let tail = "";
      await until(() => {
        for (; consumed < pushes.length; consumed++) {
          const p = pushes[consumed]!;
          if (p.stream !== "c" || !("bytes" in p)) continue;
          const b = Buffer.from(p.bytes, "base64");
          if (++paints === 2) started = performance.now();
          if (paints >= 2) bytes += b.length;
          tail = (tail + b.toString("latin1")).slice(-64);
        }
        return tail.includes("200000");
      }, 30_000);
      const floodMs = performance.now() - (started ?? performance.now());
      console.log(
        `herdr-core ${client.hello.version}: pane resize reached World in ${resizeMs.toFixed(1)} ms; 200,000 printed lines reached the page as ${(bytes / 1024).toFixed(0)} KiB in ${floodMs.toFixed(0)} ms (${(bytes / 1024 / 1024 / (floodMs / 1000)).toFixed(1)} MiB/s)`,
      );
      // Leaving changes nothing: t1 stays headless after its watches end.
      watches.close(page, "a");
      watch.detach();
      await Bun.sleep(200);
      expect(await grid("t1")).toEqual([200, 120]);
      // Nothing World sent typed, resized or focused: RPC on channel 0,
      // CREDIT for what it read, and CLOSE when it left.
      const watchFrames = outbound.filter((f) => f.channel !== 0);
      expect(watchFrames.length).toBeGreaterThan(0);
      expect(
        watchFrames.every(
          (f) => f.kind === FrameKind.CREDIT || f.kind === FrameKind.CLOSE,
        ),
      ).toBe(true);
      expect(
        outbound
          .filter((f) => f.channel === 0)
          .every((f) => f.kind === FrameKind.DATA),
      ).toBe(true);
      // kill -9 of core mid-stream: every open watch is told, none lingers.
      core.killCore();
      await until(() =>
        ["b", "c"].every((stream) =>
          pushes.some((p) => p.stream === stream && "closed" in p),
        ),
      );
      expect(watches.size).toBe(0);
      watches.stop();
      plain.close();
      pane.close();
      client.close();
      await manager.stopAll();
    },
    90_000,
  );

  live(
    "an open Terminal tab holds its fitted size while no app pane leads, swaps without headless, and gives it back on close",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      // `cat` keeps what is typed, once per key, in a scratch file (the
      // screen repaints on every grid change, so it can't count keys).
      const root = mkdtempSync(join(tmpdir(), "hcw-seat-"));
      roots.push(root);
      const typedFile = join(root, "typed");
      await core.hc(
        "run",
        "--bg",
        "--name",
        "agent",
        "--",
        "sh",
        "-c",
        `printf 'ready\\r\\n'; exec cat > '${typedFile}'`,
      );
      const grid = async () => {
        const t = JSON.parse(await core.hc("get", "t1", "--json"));
        return `${t.cols}x${t.rows}`;
      };
      const settles = async (want: string) => {
        const deadline = Date.now() + 10_000;
        while ((await grid()) !== want) {
          if (Date.now() > deadline)
            throw new Error(`grid ${await grid()}, not ${want}`);
          await Bun.sleep(20);
        }
      };
      const manager = new ConnectionManager<CoreConnectionRuntime>("");
      manager.register({
        identity: { id: "core", label: "core", source: "local-profile" },
        createRuntime: (context) =>
          createCoreConnectionRuntime({
            identity: { id: "core", label: "core", source: "local-profile" },
            context,
            transport: localCoreTransport(core.stateDir),
            observations: new CoreObservationStore(() => {}),
            onFailure: () => {},
          }),
      });
      await manager.start("core");
      const pushes: CoreTerminalPush[] = [];
      const page = {};
      const watches = new CoreTerminalWatches<object>({
        lease: (id) => (manager.has(id) ? manager.readyRuntimeLease(id) : null),
        send: (_page, push) => {
          pushes.push(push);
          return true;
        },
        buffered: () => 0,
      });
      await until(
        () =>
          manager.readyRuntimeLease("core")?.runtime.core.terminal("t1")
            ?.state === "live",
      );
      await watches.open(page, {
        connection_id: "core",
        generation: manager.status("core").generation,
        address: "t1",
        stream: "a",
      });
      const announced = () =>
        pushes.flatMap((p) =>
          "grid" in p && !("bytes" in p)
            ? [`${p.grid.cols}x${p.grid.rows}`]
            : [],
        );

      // No app pane: the open tab's seat sizes the terminal (not headless).
      expect(watches.hold(page, { stream: "a", cols: 90, rows: 28 })).toBe(
        true,
      );
      await settles("90x28");
      await until(() => watches.typing(page, "a") === "yes");
      // Resizing the window swaps the seat; core never passes through
      // headless between the two sizes.
      const before = announced().length;
      watches.hold(page, { stream: "a", cols: 100, rows: 32 });
      await settles("100x32");
      await Bun.sleep(300);
      expect(announced().slice(before)).toEqual(["100x32"]);

      // An app pane takes the size; a new fitted size in World never
      // takes it back.
      const pane = await desktopPane(core);
      await pane.attach("t1", 120, 40);
      await settles("120x40");
      watches.hold(page, { stream: "a", cols: 80, rows: 24 });
      await until(() => watches.typing(page, "a") === "yes");
      await Bun.sleep(300);
      expect(await grid()).toBe("120x40");

      // A key typed in World leads by core's rule, arrives once, and the
      // pane retakes the size by resizing.
      const typed = await watches.input(page, {
        stream: "a",
        data: Buffer.from("x").toString("base64"),
        cols: 80,
        rows: 24,
      });
      expect(typed).toEqual({ sent: true });
      await settles("80x24");
      await watches.input(page, {
        stream: "a",
        data: Buffer.from("\r").toString("base64"),
        cols: 80,
        rows: 24,
      });
      await until(
        () => existsSync(typedFile) && readFileSync(typedFile, "utf8") !== "",
      );
      expect(readFileSync(typedFile, "utf8")).toBe("x\n");
      pane.resize(110, 36);
      await settles("110x36");
      // The pane closes: World's open seat holds the size again.
      pane.detach();
      await settles("80x24");

      // Closing the tab gives the size back: core goes headless.
      watches.close(page, "a");
      await settles("200x120");
      watches.stop();
      pane.close();
      await manager.stopAll();
    },
    60_000,
  );

  live(
    "World's float shell: one per room, typed, joined, hidden at core's size, ended; hc lists it unplaced",
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
        "--label",
        "herdr.space=s1",
        "--label",
        "where=web / main",
        "--",
        "sh",
        "-c",
        "printf '\\033]7501;state=idle:app=claude-code\\033\\\\'; exec sleep 600",
      );
      const w = worldFor(core.stateDir);
      await w.service.create(w.profile);
      await until(() => w.observation()?.counts.live === 1);
      const manager = w.core
        .manager as unknown as ConnectionManager<CoreConnectionRuntime>;
      const lease = manager.readyRuntimeLease("core")!;
      const agent = lease.runtime.core.mirror
        .terminals()
        .find((t) => t.name === "agent")!;
      const agentSize = [agent.cols, agent.rows];
      const floats = new FloatShellService({
        lease: (id) => manager.readyRuntimeLease(id),
      });
      const tab = (() => {
        const pushes: FloatShellPush[] = [];
        return {
          pushes,
          send: (push: FloatShellPush) => {
            pushes.push(push);
            return true;
          },
          buffered: () => 0,
          text: () =>
            new TextDecoder().decode(
              Buffer.concat(
                pushes
                  .filter((p) => p.type === "float_output")
                  .map((p) =>
                    Buffer.from((p as { data: string }).data, "base64"),
                  ),
              ),
            ),
        };
      })();
      const request = {
        connectionId: "core",
        generation: lease.generation,
        terminal: agent.address,
        size: { cols: 90, rows: 20 },
      };
      const other = { ...tab, send: () => true };
      const [first, second] = await Promise.all([
        floats.open(tab, request),
        floats.open(other, request),
      ]);
      floats.start(tab, first.stream);
      expect(first.name).toBe(floatShellName("hc:space:s1"));
      expect(first.address).toBe(second.address);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      floats.input(
        tab,
        first.stream,
        new TextEncoder().encode("echo hé-€ $((6*7))\r"),
      );
      await until(() => tab.text().includes("hé-€ 42"));
      // Throughput through core's credit window and World's own credit return.
      const outputBytes = () =>
        tab.pushes.reduce(
          (sum, p) =>
            p.type === "float_output"
              ? sum + Buffer.from(p.data, "base64").length
              : sum,
          0,
        );
      const before = outputBytes();
      const started = performance.now();
      floats.input(
        tab,
        first.stream,
        new TextEncoder().encode("head -c 4000000 /dev/zero | tr '\\0' x\r"),
      );
      await until(() => outputBytes() - before >= 4_000_000, 30_000);
      const seconds = (performance.now() - started) / 1000;
      console.log(
        `herdr-core: float shell stream ${((outputBytes() - before) / seconds / 1e6).toFixed(1)} MB/s (4 MB through a ${90}x${20} view)`,
      );
      // Herdr's own CLI sees World's shell: unplaced, labelled, never a parent.
      const listed = JSON.parse(await core.hc("get", first.address, "--json"));
      expect(listed).toMatchObject({
        name: first.name,
        labels: { "world.float": "hc:space:s1" },
        parent: null,
        rm: true,
      });
      expect(listed.labels["herdr.space"]).toBeUndefined();
      // It never becomes a desk, and the agent's size is never touched.
      const { panes } = await lease.runtime.operations.listTerminals();
      expect((panes ?? []).map((p) => p.terminal_id)).toEqual([agent.address]);
      floats.hide(tab, first.stream);
      floats.release(other);
      await until(() => {
        const t = lease.runtime.core.terminal(first.address);
        return t?.cols === 200 && t?.rows === 120;
      });
      const reopened = await floats.open(tab, request);
      expect(reopened).toMatchObject({
        address: first.address,
        created: false,
      });
      floats.start(tab, reopened.stream);
      await floats.stop(tab, reopened.stream);
      await until(() =>
        tab.pushes.some(
          (p) => p.type === "float_closed" && p.stream === reopened.stream,
        ),
      );
      await until(() => !lease.runtime.core.terminal(first.address));
      const after = lease.runtime.core.terminal(agent.address)!;
      expect([after.cols, after.rows]).toEqual(agentSize);
      w.service.stopSupervision();
      await w.core.manager.stopAll();
    },
    60_000,
  );
});
