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
import {
  type FloatShellPush,
  FloatShellService,
  floatShellName,
} from "./float-shell";
import type { CoreConnectionRuntime } from "./runtime";
import { createCoreConnections } from "./connections";
import { resolveLocalCoreEndpoint } from "./endpoint";
import { CoreMirror } from "./mirror";
import type { CoreObservation } from "./observations";
import { connectUnixStream } from "./stream";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";
import { localCoreTransport } from "./transport";
import { worldRuntimeRegistry } from "../world/runtime-registry";
import { WorldSnapshotService } from "../world/snapshot";
import type { TaskEvent } from "../notifications/task-events";
import { handleCoreSharedRpc } from "../rpc/core-shared";
import { coreAgentStatus } from "./topology";

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

function worldFor(stateDir: string, pushed: TaskEvent[] = []) {
  const root = mkdtempSync(join(tmpdir(), "hcw-world-"));
  roots.push(root);
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
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
    "core agents reach World's read model with core's status and the app's rooms",
    async () => {
      const core = new ScratchCore(bin!);
      scratch.push(core);
      await core.start();
      const msg = Buffer.from("Which branch?").toString("base64");
      // OSC 7501 as a harness hook writes it: a blocked Claude Code asking.
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
        "sh",
        "-c",
        `printf '\\033]7501;state=blocked:kind=question:app=claude-code:msg=${msg}\\033\\\\'; exec sleep 600`,
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
          services: { coreConnections: w.core.manager },
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
