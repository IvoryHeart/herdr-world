import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
import { CoreUnavailableError } from "./client";
import { createCoreConnections } from "./connections";
import { CoreEndpointRefusedError } from "./endpoint";
import type { CoreObservation } from "./observations";
import { connectUnixStream } from "./stream";
import { FakeCore } from "./testing/fake-core";
import {
  decodeWindowsCommand,
  FakeWindowsHost,
  transparencyPayloads,
} from "./testing/fake-windows-host";
import { coreTransportForProfile } from "./transport";
import {
  WINDOWS_COMMAND_LIMIT,
  WindowsCoreExit,
  windowsCoreCommand,
  windowsCoreEndpointResult,
  windowsCoreProbeScript,
  windowsCoreRelayScript,
  windowsSshCoreTransport,
} from "./windows";

const roots: string[] = [];
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function until(predicate: () => boolean, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

const PIPE = "herdr-core-example-default.sock";

function windowsProfile(
  patch: Partial<CoreConnectionProfile> = {},
): CoreConnectionProfile {
  return validateCoreConnectionProfile({
    id: "win-core",
    label: "Windows core",
    type: "ssh",
    runtime: "herdr-core",
    ssh_destination: "dev@windows.example",
    remote_platform: "windows",
    core_session: "default",
    core_state_dir: "",
    auto_connect: true,
    ...patch,
  });
}

function host(profile = windowsProfile()) {
  const root = mkdtempSync(join(tmpdir(), "hcw-win-"));
  roots.push(root);
  const windows = new FakeWindowsHost(root, profile);
  cleanups.push(() => {
    for (const child of windows.running()) child.kill("SIGKILL");
  });
  const transport = () => {
    const directory = mkdtempSync(join(root, "rt-"));
    return windowsSshCoreTransport(profile, {
      readRemote: windows.readRemote,
      spawnRelay: windows.spawnRelay,
      createConfig: () => ({
        socketPath: join(directory, "control.sock"),
        clientSocketPath: join(directory, "render.sock"),
        ownedRuntimeDirectory: directory,
        hasExplicitSocketPath: false,
        hasExplicitClientSocketPath: false,
      }),
    });
  };
  return { root, windows, transport };
}

function world(h: ReturnType<typeof host>) {
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    transportFor: () => h.transport(),
  });
  const store = new ConnectionProfileStore({
    path: join(h.root, "connections.json"),
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
      retry: { baseDelayMs: 5, maxDelayMs: 20, random: () => 0 },
    });
  cleanups.push(async () => {
    service.stopSupervision();
    await core.stop();
  });
  const observed = () =>
    core.observations.get("win-core") as CoreObservation | null;
  return { core, service, observed };
}

function fakeCore() {
  const core = new FakeCore({ heartbeatMs: 60_000 });
  cleanups.push(() => core.kill());
  return core;
}

describe("herdr-core on Windows SSH hosts: the fixed scripts", () => {
  test("the probe reads core.lock and the relay opens a pipe: neither runs a program", () => {
    const probe = windowsCoreProbeScript("default", "");
    const relay = windowsCoreRelayScript(PIPE);
    for (const script of [probe, relay]) {
      // No CLI (hc connect / server status start a core), no process, no eval.
      expect(script).not.toMatch(
        /\bhc\b|herdr-core\.exe|Start-Process|Invoke-Expression|\biex\b|Invoke-Command|\.Invoke\(|-Command|cmd\b/i,
      );
      expect(script).not.toMatch(/(^|[^-])&(?!&)/);
      // The host reads stdin as pipeline objects when a script names $input.
      expect(script).not.toMatch(/\$input\b/i);
      // Windows PowerShell 5.1: none of PowerShell 7's operators.
      expect(script).not.toMatch(/&&|\|\||\?\?|\?\./);
      expect(script).toContain("TokenImpersonationLevel]::Identification");
      expect(script).toContain("GetAccessControl()");
    }
    expect(probe).toContain("[IO.Path]::Combine($d,'core.lock')");
    expect(probe).toContain("$env:XDG_STATE_HOME");
    expect(probe).toContain("$env:LOCALAPPDATA");
    expect(relay).toContain("$p=C 'herdr-core-example-default.sock'");
    expect(relay).toContain("[Console]::OpenStandardInput()");
  });

  test("inputs cannot inject, and every command fits cmd.exe", () => {
    expect(() => windowsCoreProbeScript("default';exit 0;'", "")).toThrow(
      "session",
    );
    expect(() => windowsCoreRelayScript("x';exit 0;'")).toThrow(
      CoreEndpointRefusedError,
    );
    expect(() => windowsCoreRelayScript("..\\other")).toThrow(
      CoreEndpointRefusedError,
    );
    // PowerShell ends '…' at curly quotes too: the directory travels as base64.
    const odd = "C:\\Users\\O\u2019Brien';exit 0;\u2018\\state";
    const script = windowsCoreProbeScript("default", odd);
    expect(script).not.toContain("Brien");
    expect(script).toContain(
      `FromBase64String('${Buffer.from(odd).toString("base64")}')`,
    );
    const longest = windowsCoreCommand(
      windowsCoreProbeScript("s".repeat(64), `C:\\${"d".repeat(257)}`),
    );
    expect(longest.length).toBeLessThanOrEqual(WINDOWS_COMMAND_LIMIT);
    expect(
      decodeWindowsCommand(windowsCoreCommand(windowsCoreRelayScript(PIPE))),
    ).toBe(windowsCoreRelayScript(PIPE));
  });

  test("exit codes map like the Unix lock command's", () => {
    const map = (code: number, stdout = "", stderr = "") => {
      try {
        return windowsCoreEndpointResult({ code, stdout, stderr });
      } catch (error) {
        return error as Error;
      }
    };
    expect(map(0, `banner\r\nherdr-core-pipe:${PIPE}\r\n`)).toBe(PIPE);
    expect(map(0, "")).toBeInstanceOf(CoreEndpointRefusedError);
    expect(map(0, "herdr-core-pipe:a b")).toBeInstanceOf(
      CoreEndpointRefusedError,
    );
    const absent = map(WindowsCoreExit.noLock) as Error;
    expect(absent).toBeInstanceOf(CoreUnavailableError);
    expect(absent.message).toContain("no herdr-core has run");
    expect(map(WindowsCoreExit.notRunning)).toMatchObject({
      message: "herdr-core is not running on the Windows host",
      retryable: true,
    });
    for (const code of [
      WindowsCoreExit.badLock,
      WindowsCoreExit.accessDenied,
      WindowsCoreExit.untrusted,
    ])
      expect(map(code)).toMatchObject({ retryable: false });
    expect((map(WindowsCoreExit.accessDenied) as Error).message).toContain(
      "elevated",
    );
    expect(
      map(1, "", "'powershell.exe' is not recognized as an internal command"),
    ).toMatchObject({
      retryable: false,
      message: expect.stringContaining("PowerShell"),
    });
    expect(map(255, "", "ssh: connect to host")).toMatchObject({
      retryable: true,
    });
  });

  test("Windows core profiles: SSH only, with a Windows state directory", () => {
    const profile = windowsProfile({
      core_state_dir: String.raw`C:\Users\dev\AppData\Local\herdr-core\default`,
    });
    expect(profile.remote_platform).toBe("windows");
    for (const dir of [
      "/home/dev/state",
      "C:",
      "C:\\a\\..\\b",
      "\\\\server\\share",
    ])
      expect(() => windowsProfile({ core_state_dir: dir })).toThrow(
        "Windows directory",
      );
    expect(() =>
      validateCoreConnectionProfile({
        id: "c",
        label: "c",
        type: "local",
        runtime: "herdr-core",
        remote_platform: "windows",
        core_session: "default",
        core_state_dir: "",
        auto_connect: true,
      }),
    ).toThrow();
    expect(() => windowsProfile({ remote_platform: "linux" as never })).toThrow(
      "remote_platform",
    );
    expect(() =>
      coreTransportForProfile(profile, { connectionId: "c" }),
    ).not.toThrow();
  });
});

describe("herdr-core on Windows SSH hosts: the relay", () => {
  test("live through the relay, stale after kill -9, then the same terminals", async () => {
    const h = host();
    const core = fakeCore();
    await h.windows.serve(core, PIPE);
    const agent = core.create({
      name: "agent",
      argv: ["claude"],
      reported: true,
      status: { state: "working" },
    });
    core.create({ name: "shell" });
    const w = world(h);
    await expect(w.service.create(windowsProfile())).resolves.toMatchObject({
      id: "win-core",
      state: "ready",
    });
    expect(w.observed()).toMatchObject({
      state: "live",
      core: { id: core.coreId },
      counts: { live: 2 },
    });
    const before = w.observed()!.terminals.map((t) => [t.address, t.name]);
    // One probe, then one relay with its own SSH connection and no TTY.
    expect(h.windows.probes).toHaveLength(1);
    expect(h.windows.relays).toHaveLength(1);
    const relay = h.windows.relays[0]!;
    expect(relay).not.toContain("-S");
    expect(relay.join(" ")).toContain("RequestTTY=no");
    expect(relay.join(" ")).toContain("BatchMode=yes");
    expect(relay.at(-2)).toBe("dev@windows.example");

    h.windows.kill(core, PIPE);
    await until(() => w.core.manager.status("win-core").state !== "ready");
    expect(w.observed()).toMatchObject({ state: "stale" });
    expect(w.observed()!.terminals.map((t) => [t.address, t.name])).toEqual(
      before,
    );
    // The relay ends with the pipe; nothing is left running.
    await until(() => h.windows.running().length === 0);

    core.revive();
    await h.windows.serve(core, PIPE);
    await until(() => w.core.manager.status("win-core").state === "ready");
    expect(w.observed()!.state).toBe("live");
    expect(w.observed()!.terminals.map((t) => [t.address, t.name])).toEqual(
      before,
    );
    expect(
      w.observed()!.terminals.find((t) => t.address === agent)?.status,
    ).toBe("working");
    // Every connect read the lock first.
    expect(h.windows.probes.length).toBeGreaterThanOrEqual(
      h.windows.relays.length,
    );
    expect(h.windows.relays.length).toBeGreaterThanOrEqual(2);
  });

  test("a stopped core is not running and nothing starts", async () => {
    const h = host();
    const core = fakeCore();
    await h.windows.serve(core, PIPE);
    h.windows.kill(core, PIPE);
    const w = world(h);
    await w.service.create(windowsProfile());
    await until(() => h.windows.probes.length >= 2);
    expect(["reconnecting", "error"]).toContain(
      w.core.manager.status("win-core").state,
    );
    expect(w.core.manager.status("win-core").error?.message).toBe(
      "herdr-core is not running on the Windows host",
    );
    // Only the probe ran: no relay, so no pipe was ever opened.
    expect(h.windows.relays).toHaveLength(0);
    expect(h.windows.pipes.size).toBe(0);
    expect(core.isRunning).toBe(false);

    // A host where core never ran says so.
    const fresh = host();
    const v = world(fresh);
    await v.service.create(windowsProfile());
    expect(v.core.manager.status("win-core").error?.message).toContain(
      "no herdr-core has run",
    );
  });

  test("each connect re-reads the lock and follows core to a new pipe", async () => {
    const h = host();
    const first = fakeCore();
    await h.windows.serve(first, PIPE);
    first.create({ name: "agent" });
    const w = world(h);
    await w.service.create(windowsProfile());
    expect(w.core.manager.status("win-core").state).toBe("ready");
    h.windows.kill(first, PIPE);
    const moved = "herdr-core-example-moved.sock";
    const second = new FakeCore({
      heartbeatMs: 60_000,
      coreId: "c0ffee0000000002",
    });
    cleanups.push(() => second.kill());
    await h.windows.serve(second, moved);
    await until(
      () =>
        w.core.manager.status("win-core").state === "ready" &&
        w.observed()?.core?.id === "c0ffee0000000002",
    );
    const last = decodeWindowsCommand(h.windows.relays.at(-1)!.at(-1)!);
    expect(last).toBe(windowsCoreRelayScript(moved));
  });

  test("a pipe another account owns, or this login cannot open, is refused and not retried", async () => {
    for (const [patch, message] of [
      [{ owner: "other" as const }, "another account"],
      [{ denied: true }, "elevated"],
    ] as const) {
      const h = host();
      const core = fakeCore();
      await h.windows.serve(core, PIPE);
      Object.assign(h.windows.pipes.get(PIPE)!, patch);
      const w = world(h);
      await w.service.create(windowsProfile());
      expect(w.core.manager.status("win-core").error?.message).toContain(
        message,
      );
      expect(
        w.service.willRetry("win-core", new CoreEndpointRefusedError(message)),
      ).toBe(false);
      expect(h.windows.relays).toHaveLength(0);
      expect(h.windows.probes).toHaveLength(1);
    }
  });

  test("bytes cross the relay untouched both ways, including win32-input-mode", async () => {
    const h = host();
    const socket = join(h.root, "pipes", PIPE);
    const received: Uint8Array[] = [];
    const { toWorld, toCore } = transparencyPayloads();
    const server = Bun.listen({
      unix: socket,
      socket: {
        open(sock) {
          (sock as unknown as { pending: Buffer }).pending =
            Buffer.from(toWorld);
          const pending = (sock as unknown as { pending: Buffer }).pending;
          const written = sock.write(pending);
          (sock as unknown as { pending: Buffer }).pending =
            pending.subarray(written);
        },
        drain(sock) {
          const pending = (sock as unknown as { pending: Buffer }).pending;
          const written = sock.write(pending);
          (sock as unknown as { pending: Buffer }).pending =
            pending.subarray(written);
        },
        data(_sock, bytes) {
          received.push(new Uint8Array(bytes));
        },
      },
    });
    cleanups.push(() => server.stop(true));
    h.windows.pipes.set(PIPE, { socket, owner: "user", denied: false });
    h.windows.lock = `\\\\.\\pipe\\${PIPE}`;
    const transport = h.transport();
    const abort = new AbortController();
    const local = await transport.open(abort.signal);
    const stream = await connectUnixStream(local);
    const got: Uint8Array[] = [];
    let ended = false;
    stream.onData((bytes) => got.push(bytes));
    stream.onClose(() => {
      ended = true;
    });
    for (let at = 0; at < toCore.length; at += 7_777)
      stream.write(toCore.subarray(at, at + 7_777));
    await until(
      () =>
        Buffer.concat(got).length >= toWorld.length &&
        Buffer.concat(received).length >= toCore.length,
      10_000,
    );
    expect(Buffer.concat(got).equals(toWorld)).toBe(true);
    expect(Buffer.concat(received).equals(toCore)).toBe(true);

    // World closing ends the relay and removes the local socket.
    expect(h.windows.running()).toHaveLength(1);
    await transport.close();
    await until(() => ended && h.windows.running().length === 0);
    expect(existsSync(local)).toBe(false);
  });

  test("the local socket serves one connection, then only its relay", async () => {
    const h = host();
    const core = fakeCore();
    await h.windows.serve(core, PIPE);
    const transport = h.transport();
    cleanups.push(() => transport.close());
    const local = await transport.open(new AbortController().signal);
    const first = await connectUnixStream(local);
    cleanups.push(() => first.close());
    await until(() => h.windows.relays.length === 1);
    await expect(connectUnixStream(local)).rejects.toBeDefined();
    expect(h.windows.relays).toHaveLength(1);
    await expect(transport.open(new AbortController().signal)).rejects.toThrow(
      "used",
    );
  });
});
