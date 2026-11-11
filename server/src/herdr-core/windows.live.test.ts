import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
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
import {
  type CoreConnectionProfile,
  ConnectionProfileStore,
  validateCoreConnectionProfile,
} from "../connections/profiles";
import { silentLogger } from "../utils/logger";
import { createCoreConnections } from "./connections";
import type { CoreObservation } from "./observations";
import { connectUnixStream } from "./stream";
import { FakeCore } from "./testing/fake-core";
import {
  decodeWindowsCommand,
  FakeWindowsHost,
  transparencyPayloads,
} from "./testing/fake-windows-host";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";
import { localCoreTransport } from "./transport";
import {
  windowsCoreProbeScript,
  windowsCoreRelayScript,
  windowsSshCoreTransport,
} from "./windows";

// The fixed scripts run in real PowerShell. Opt in with
// HERDR_WORLD_PWSH=<pwsh 7 binary>; HERDR_CORE_BIN=<official herdr-core binary>
// adds a real core. Linux only, under scratch HOME/TMPDIR/XDG directories.
//
// On Linux, .NET's named pipe `name` is the Unix socket
// `$TMPDIR/CoreFxPipe_name`, so the relay opens real pipes. Three Windows
// facts cannot run here and are only parsed: the owner/ACL check (function
// T, replaced by a no-op below), the read past core's mandatory lock on the
// lock file's first byte, and the pipe listing (it fails here, so Connect
// decides, as the script intends wherever listing fails).
const pwsh =
  process.env.HERDR_WORLD_PWSH && process.platform === "linux"
    ? process.env.HERDR_WORLD_PWSH
    : null;
const coreBin = scratchCoreBinary();
const live = pwsh ? test : test.skip;
const withCore = pwsh && coreBin ? test : test.skip;

const roots: string[] = [];
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function until(predicate: () => boolean, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(10);
  }
}

const PIPE = "herdr-core-example-default.sock";
const TRUST = /^function T\(\$p\)\{.*\}$/m;

/** The script with only the Windows ACL check removed. */
function onLinux(script: string): string {
  expect(script).toMatch(TRUST);
  return script.replace(TRUST, "function T($p){}");
}

/** A scratch "Windows" account: pwsh sees this HOME, TMPDIR and state home. */
function account() {
  const root = mkdtempSync(join(tmpdir(), "hcw-ps-"));
  roots.push(root);
  const dirs = {
    root,
    home: join(root, "home"),
    temp: join(root, "t"),
    stateHome: join(root, "state"),
  };
  for (const dir of [dirs.home, dirs.temp, dirs.stateHome])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: dirs.home,
    TMPDIR: `${dirs.temp}/`,
    XDG_STATE_HOME: dirs.stateHome,
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  };
  const lockPath = join(dirs.stateHome, "herdr-core", "default", "core.lock");
  const writeLock = (content: string | null) => {
    rmSync(lockPath, { force: true });
    if (content === null) return;
    mkdirSync(join(lockPath, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(lockPath, content);
  };
  const pipePath = (name: string) => join(dirs.temp, `CoreFxPipe_${name}`);
  const run = (command: string) =>
    spawn(
      pwsh!,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(onLinux(decodeWindowsCommand(command)), "utf16le").toString(
          "base64",
        ),
      ],
      { stdio: "pipe", env, cwd: dirs.home },
    );
  const readRemote = async (argv: string[]) => {
    const child = run(argv.at(-1)!);
    child.stdin.end();
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (b) => chunks.push(b));
    child.stderr.on("data", (b) => errors.push(b));
    const code = await new Promise<number>((resolve) =>
      child.once("close", (c) => resolve(c ?? -1)),
    );
    return {
      code,
      stdout: Buffer.concat(chunks).toString("utf8"),
      stderr: Buffer.concat(errors).toString("utf8"),
    };
  };
  const relays: ReturnType<typeof run>[] = [];
  const spawnRelay = (argv: string[]) => {
    const child = run(argv.at(-1)!);
    relays.push(child);
    return child;
  };
  cleanups.push(() => {
    for (const child of relays)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
  });
  const transport = (profile: CoreConnectionProfile) => {
    const directory = mkdtempSync(join(root, "rt-"));
    return windowsSshCoreTransport(profile, {
      readRemote,
      spawnRelay,
      createConfig: () => ({
        socketPath: join(directory, "c.sock"),
        clientSocketPath: join(directory, "r.sock"),
        ownedRuntimeDirectory: directory,
        hasExplicitSocketPath: false,
        hasExplicitClientSocketPath: false,
      }),
    });
  };
  return { ...dirs, writeLock, pipePath, readRemote, relays, transport };
}

const windowsProfile = (): CoreConnectionProfile =>
  validateCoreConnectionProfile({
    id: "win-core",
    label: "Windows core",
    type: "ssh",
    runtime: "herdr-core",
    ssh_destination: "dev@windows.example",
    remote_platform: "windows",
    core_session: "default",
    core_state_dir: "",
    auto_connect: true,
  });

function world(
  root: string,
  transports: Record<string, (profile: CoreConnectionProfile) => unknown>,
) {
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    transportFor: (profile) => transports[profile.id]!(profile) as never,
  });
  const store = new ConnectionProfileStore({
    path: join(root, `connections-${roots.length}.json`),
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
  cleanups.push(async () => {
    service.stopSupervision();
    await core.stop();
  });
  const observed = (id: string) =>
    core.observations.get(id) as CoreObservation | null;
  return { core, service, observed };
}

describe("herdr-core on Windows SSH hosts: the scripts in real PowerShell", () => {
  live(
    "both scripts parse with no errors, unmodified",
    async () => {
      for (const script of [
        windowsCoreProbeScript("default", ""),
        windowsCoreProbeScript("default", "C:\\Users\\O\u2019Brien\\state"),
        windowsCoreRelayScript(PIPE),
      ]) {
        const check = `$e=$null;[void][Management.Automation.Language.Parser]::ParseInput([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(script).toString("base64")}')),[ref]$null,[ref]$e);[Console]::Out.Write($e.Count)`;
        const child = spawn(pwsh!, [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          check,
        ]);
        let out = "";
        child.stdout.on("data", (b) => {
          out += b;
        });
        await new Promise((resolve) => child.once("close", resolve));
        expect(out).toBe("0");
      }
    },
    60_000,
  );

  live(
    "the probe answers as the fake Windows host does, state by state",
    async () => {
      const a = account();
      const fake = new FakeWindowsHost(a.root, windowsProfile());
      const core = new FakeCore({ heartbeatMs: 60_000 });
      cleanups.push(() => core.kill());
      const socket = await core.listen(
        join(a.root, "unused"),
        join(a.root, "run"),
        "s.sock",
      );
      symlinkSync(socket, a.pipePath(PIPE));
      const states: Array<[string, string | null]> = [
        ["no lock", null],
        ["an empty lock (core starting)", ""],
        ["a lock naming no pipe", "/run/user/example/herdr-core.sock"],
        ["a remote pipe", `\\\\server\\pipe\\${PIPE}`],
        ["an oversized lock", `\\\\.\\pipe\\${"x".repeat(5000)}`],
        ["a pipe nobody serves", "\\\\.\\pipe\\herdr-core-example-gone.sock"],
        ["the serving pipe", `\\\\.\\pipe\\${PIPE}`],
        ["the serving pipe and a newline", `\\\\.\\pipe\\${PIPE}\n`],
      ];
      fake.pipes.set(PIPE, { socket, owner: "user", denied: false });
      const probe = [
        "ssh",
        "--",
        "dev@windows.example",
        `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(windowsCoreProbeScript("default", ""), "utf16le").toString("base64")}`,
      ];
      for (const [label, lock] of states) {
        a.writeLock(lock);
        fake.lock = lock;
        const real = await a.readRemote(probe);
        const expected = fake.probe();
        expect({ label, code: real.code }).toEqual({
          label,
          code: expected.code,
        });
        expect(real.stdout.replace(/\r\n/g, "\n")).toBe(
          expected.stdout.replace(/\r\n/g, "\n"),
        );
      }
      // An explicit directory reaches PowerShell intact, curly quote and all.
      const odd = join(a.root, "O\u2019Brien’s état");
      mkdirSync(odd, { mode: 0o700 });
      writeFileSync(join(odd, "core.lock"), `\\\\.\\pipe\\${PIPE}`);
      const explicit = await a.readRemote([
        "ssh",
        "--",
        "dev@windows.example",
        `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(windowsCoreProbeScript("default", odd), "utf16le").toString("base64")}`,
      ]);
      expect(explicit).toMatchObject({
        code: 0,
        stdout: `herdr-core-pipe:${PIPE}\n`,
      });
    },
    120_000,
  );

  live(
    "the relay copies every byte both ways and ends with either side",
    async () => {
      const a = account();
      const received: Uint8Array[] = [];
      const { toWorld, toCore } = transparencyPayloads();
      let closedByRelay = false;
      const server = Bun.listen({
        unix: a.pipePath(PIPE),
        socket: {
          open(sock) {
            const state = sock as unknown as { pending: Buffer };
            state.pending = toWorld.subarray(sock.write(toWorld));
          },
          drain(sock) {
            const state = sock as unknown as { pending: Buffer };
            state.pending = state.pending.subarray(sock.write(state.pending));
          },
          data(_sock, bytes) {
            received.push(new Uint8Array(bytes));
          },
          close() {
            closedByRelay = true;
          },
        },
      });
      cleanups.push(() => server.stop(true));
      a.writeLock(`\\\\.\\pipe\\${PIPE}`);
      const transport = a.transport(windowsProfile());
      const local = await transport.open(new AbortController().signal);
      const stream = await connectUnixStream(local);
      const got: Uint8Array[] = [];
      stream.onData((bytes) => got.push(bytes));
      for (let at = 0; at < toCore.length; at += 7_777)
        stream.write(toCore.subarray(at, at + 7_777));
      await until(
        () =>
          Buffer.concat(got).length >= toWorld.length &&
          Buffer.concat(received).length >= toCore.length,
      );
      expect(Buffer.concat(got).equals(toWorld)).toBe(true);
      expect(Buffer.concat(received).equals(toCore)).toBe(true);
      // World ending: the relay closes the pipe and exits.
      stream.close();
      await until(() => closedByRelay);
      await until(() => a.relays.every((child) => child.exitCode !== null));
      expect(a.relays.map((child) => child.exitCode)).toEqual([0]);
      await transport.close();
      expect(existsSync(local)).toBe(false);
    },
    60_000,
  );

  live(
    "World through real PowerShell: live, stale after kill -9, back at the same addresses",
    async () => {
      const a = account();
      const core = new FakeCore({ heartbeatMs: 60_000 });
      cleanups.push(() => core.kill());
      const listen = async () => {
        const socket = await core.listen(
          join(a.root, "unused"),
          join(a.root, "run"),
          "s.sock",
        );
        rmSync(a.pipePath(PIPE), { force: true });
        symlinkSync(socket, a.pipePath(PIPE));
        a.writeLock(`\\\\.\\pipe\\${PIPE}`);
        return socket;
      };
      const socket = await listen();
      core.create({
        name: "agent",
        argv: ["claude"],
        reported: true,
        status: { state: "blocked" },
      });
      const w = world(a.root, { "win-core": a.transport });
      await w.service.create(windowsProfile());
      await until(() => w.observed("win-core")?.state === "live");
      const before = w.observed("win-core")!;
      expect(before.terminals[0]).toMatchObject({
        name: "agent",
        status: "blocked",
      });
      core.kill(socket);
      await until(() => w.observed("win-core")?.state === "stale");
      await until(() => a.relays.every((child) => child.exitCode !== null));
      core.revive();
      await listen();
      await until(
        () =>
          w.core.manager.status("win-core").state === "ready" &&
          w.observed("win-core")?.state === "live",
      );
      expect(
        w.observed("win-core")!.terminals.map((t) => [t.address, t.name]),
      ).toEqual(before.terminals.map((t) => [t.address, t.name]));
    },
    120_000,
  );

  live(
    "measures round trip and throughput through the relay (reported, not asserted)",
    async () => {
      const a = account();
      const echo = Bun.listen({
        unix: a.pipePath(PIPE),
        socket: {
          // An echo that keeps what the socket could not take yet.
          data(sock, bytes) {
            const state = sock as unknown as { pending?: Buffer };
            state.pending = Buffer.concat([
              state.pending ?? Buffer.alloc(0),
              bytes,
            ]);
            state.pending = state.pending.subarray(sock.write(state.pending));
          },
          drain(sock) {
            const state = sock as unknown as { pending?: Buffer };
            if (state.pending?.length)
              state.pending = state.pending.subarray(sock.write(state.pending));
          },
        },
      });
      cleanups.push(() => echo.stop(true));
      a.writeLock(`\\\\.\\pipe\\${PIPE}`);
      const measure = async (path: string) => {
        const stream = await connectUnixStream(path);
        let got = 0;
        stream.onData((bytes) => {
          got += bytes.byteLength;
        });
        const rtt: number[] = [];
        const ping = new Uint8Array(64);
        for (let i = 0; i < 500; i++) {
          const want = got + ping.byteLength;
          const started = performance.now();
          stream.write(ping);
          while (got < want) await Bun.sleep(0);
          rtt.push(performance.now() - started);
        }
        rtt.sort((x, y) => x - y);
        const bulk = new Uint8Array(16 << 20);
        const want = got + bulk.byteLength;
        const started = performance.now();
        for (let at = 0; at < bulk.byteLength; at += 65_536)
          stream.write(bulk.subarray(at, at + 65_536));
        await until(() => got >= want, 60_000);
        const seconds = (performance.now() - started) / 1000;
        stream.close();
        return {
          p50_ms: Number(rtt[250]!.toFixed(3)),
          p99_ms: Number(rtt[495]!.toFixed(3)),
          echo_mib_s: Number((16 / seconds).toFixed(1)),
        };
      };
      const direct = await measure(a.pipePath(PIPE));
      const transport = a.transport(windowsProfile());
      const relayed = await measure(
        await transport.open(new AbortController().signal),
      );
      await transport.close();
      console.log("windows relay measurement", { direct, relayed });
      expect(relayed.echo_mib_s).toBeGreaterThan(0);
    },
    120_000,
  );

  withCore(
    "a real herdr-core through the real relay matches a direct connection, and a stopped core stays stopped",
    async () => {
      const a = account();
      const core = new ScratchCore(coreBin!);
      cleanups.push(() => core.dispose());
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
      const socket = readFileSync(join(core.stateDir, "core.lock"), "utf8");
      symlinkSync(socket, a.pipePath(PIPE));
      a.writeLock(`\\\\.\\pipe\\${PIPE}`);
      const w = world(a.root, {
        "win-core": a.transport,
        direct: () => localCoreTransport(core.stateDir),
      });
      await w.service.create(windowsProfile());
      await w.service.create({
        id: "direct",
        label: "Direct",
        type: "local",
        runtime: "herdr-core",
        core_session: "default",
        core_state_dir: core.stateDir,
        auto_connect: true,
      });
      const same = () => {
        const relayed = w.observed("win-core");
        const direct = w.observed("direct");
        return (
          relayed?.state === "live" &&
          direct?.state === "live" &&
          relayed.counts.live === 2 &&
          JSON.stringify(relayed.terminals) === JSON.stringify(direct.terminals)
        );
      };
      await until(same);
      const relayed = w.observed("win-core")!;
      expect(relayed.core).toEqual(w.observed("direct")!.core);
      expect(relayed.unknown_events).toEqual([]);
      expect(relayed.terminals.find((t) => t.name === "agent")?.status).toBe(
        "working",
      );

      // kill -9: holders start a new core on the same socket; both return.
      const old = core.killCore();
      await until(() => w.observed("win-core")?.state === "stale");
      await until(() => same() && w.observed("win-core")?.core?.pid !== old);

      // Stopped: everything ends; World retries and starts nothing.
      for (const pid of core.pids()) process.kill(pid, "SIGKILL");
      await until(() => core.pids().length === 0);
      await until(() => w.observed("win-core")?.state === "stale");
      const relays = a.relays.length;
      // The probe's Connect waits up to 5 s for an absent pipe.
      await until(
        () =>
          w.core.manager.status("win-core").error?.message ===
          "herdr-core is not running on the Windows host",
      );
      expect(core.pids()).toEqual([]);
      expect(w.core.manager.status("win-core").state).not.toBe("ready");
      // No relay ran while core was stopped: only probes.
      expect(a.relays.length).toBe(relays);
    },
    120_000,
  );
});
