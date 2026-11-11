import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreUnavailableError } from "./client";
import {
  CoreEndpointRefusedError,
  defaultCoreStateDir,
  remoteCoreEndpointCommand,
  remoteCoreEndpointResult,
  resolveLocalCoreEndpoint,
} from "./endpoint";
import { FakeCore } from "./testing/fake-core";

const roots: string[] = [];
const cores: Array<[FakeCore, string]> = [];
afterEach(() => {
  for (const [core, socket] of cores.splice(0)) core.kill(socket);
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function root() {
  const dir = mkdtempSync(join(tmpdir(), "hcw-e-"));
  roots.push(dir);
  return dir;
}
async function serving(dir: string) {
  const core = new FakeCore();
  const socket = await core.listen(join(dir, "state"), join(dir, "run"));
  cores.push([core, socket]);
  return socket;
}

describe("local endpoint", () => {
  test("re-reads core.lock on every connect and follows a moved socket", async () => {
    const dir = root();
    const first = await serving(dir);
    expect(resolveLocalCoreEndpoint(join(dir, "state"))).toBe(first);
    const [core] = cores[0]!;
    core.kill(first);
    core.revive();
    const moved = await core.listen(join(dir, "state"), join(dir, "run2"));
    cores[0] = [core, moved];
    expect(resolveLocalCoreEndpoint(join(dir, "state"))).toBe(moved);
  });

  test("no lock, or a lock naming a gone socket, is unavailable (never a reason to start)", async () => {
    const dir = root();
    expect(() => resolveLocalCoreEndpoint(join(dir, "nothing"))).toThrow(
      CoreUnavailableError,
    );
    const socket = await serving(dir);
    const [core] = cores[0]!;
    core.kill(socket);
    expect(() => resolveLocalCoreEndpoint(join(dir, "state"))).toThrow(
      "not running",
    );
  });

  test("refuses a socket directory others can enter, and a symlinked lock", async () => {
    const dir = root();
    await serving(dir);
    chmodSync(join(dir, "run"), 0o755);
    expect(() => resolveLocalCoreEndpoint(join(dir, "state"))).toThrow(
      CoreEndpointRefusedError,
    );
    chmodSync(join(dir, "run"), 0o700);
    const linked = join(dir, "linked");
    mkdirSync(linked);
    symlinkSync(join(dir, "state", "core.lock"), join(linked, "core.lock"));
    expect(() => resolveLocalCoreEndpoint(linked)).toThrow(
      "not a regular file",
    );
    writeFileSync(join(dir, "state", "core.lock"), "relative/path.sock");
    expect(() => resolveLocalCoreEndpoint(join(dir, "state"))).toThrow(
      "does not name a socket",
    );
  });

  test("the default state directory follows XDG_STATE_HOME, then ~/.local/state", () => {
    expect(
      defaultCoreStateDir("default", { XDG_STATE_HOME: "/x/state" }, "/h"),
    ).toBe("/x/state/herdr-core/default");
    expect(defaultCoreStateDir("work", {}, "/h")).toBe(
      "/h/.local/state/herdr-core/work",
    );
  });
});

describe("remote endpoint over SSH", () => {
  const run = async (command: string, env: Record<string, string>) => {
    const proc = Bun.spawn(["sh", "-c", command], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return { code, stdout };
  };

  test("the remote command reads the lock and checks the directory with cat/ls/id only", async () => {
    const dir = root();
    const socket = await serving(join(dir, "s"));
    const env = {
      PATH: "/usr/bin:/bin",
      HOME: join(dir, "home"),
      XDG_STATE_HOME: join(dir, "s"),
    };
    // `<state home>/herdr-core/<session>/core.lock`, as on the remote host.
    mkdirSync(join(dir, "s", "herdr-core", "default"), { recursive: true });
    writeFileSync(join(dir, "s", "herdr-core", "default", "core.lock"), socket);
    const command = remoteCoreEndpointCommand("default", "");
    expect(command).not.toMatch(/\bhc\b|herdr-core |connect|server/);
    const ok = await run(command, env);
    expect(remoteCoreEndpointResult(ok.code, ok.stdout)).toBe(socket);
    // An explicit state directory is quoted, not interpolated.
    const explicit = await run(
      remoteCoreEndpointCommand("default", join(dir, "s", "state")),
      env,
    );
    expect(remoteCoreEndpointResult(explicit.code, explicit.stdout)).toBe(
      socket,
    );

    chmodSync(join(dir, "s", "run"), 0o750);
    const open = await run(command, env);
    expect(() => remoteCoreEndpointResult(open.code, open.stdout)).toThrow(
      CoreEndpointRefusedError,
    );
    chmodSync(join(dir, "s", "run"), 0o700);
    const [core] = cores[0]!;
    core.kill(socket);
    const gone = await run(command, env);
    expect(() => remoteCoreEndpointResult(gone.code, gone.stdout)).toThrow(
      "not running on the host",
    );
    const never = await run(remoteCoreEndpointCommand("other", ""), env);
    expect(() => remoteCoreEndpointResult(never.code, never.stdout)).toThrow(
      "no herdr-core has run",
    );
  });

  test("a session name cannot inject shell", () => {
    for (const bad of ["a;b", "$(x)", "../x", "a b", ""])
      expect(() => remoteCoreEndpointCommand(bad, "")).toThrow(
        "invalid core session",
      );
    expect(remoteCoreEndpointCommand("x", "/tmp/a'b")).toContain(
      "'/tmp/a'\\''b/core.lock'",
    );
  });
});
