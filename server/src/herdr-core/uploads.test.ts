import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultGuiSettings } from "../config/gui-settings";
import { parseConnectionHttpRoute } from "../connections/http-routing";
import type { CoreRpcServices } from "../rpc/core";
import { handleCoreFileHttpRequest } from "../service/core-files-http";
import { type CoreHostRuntime, createCoreHostRuntime } from "./host-runtime";
import { coreWorld, until } from "./testing/core-world";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A connected local core whose uploads stage in a scratch directory. */
async function uploadWorld(
  host: { destination?: string; windows: boolean } | null = null,
) {
  const w = await coreWorld();
  const staged = mkdtempSync(join(tmpdir(), "hcw-up-"));
  cleanups.push(
    () => w.dispose(),
    () => rmSync(staged, { recursive: true, force: true }),
  );
  await w.connect();
  // The production host runtime, with only its staging root redirected.
  const runtimes = new WeakMap<object, CoreHostRuntime>();
  const core = {
    manager: w.core.manager,
    hostRuntime: (lease: Parameters<CoreRpcServices["hostRuntime"]>[0]) => {
      let runtime = runtimes.get(lease.runtime);
      if (!runtime || runtime.generation !== lease.generation) {
        runtime = createCoreHostRuntime({
          lease,
          host,
          readSettings: async () => defaultGuiSettings(),
          uploadTempRoot: () => staged,
        });
        runtimes.set(lease.runtime, runtime);
      }
      return runtime;
    },
  } as unknown as CoreRpcServices;
  const post = async (
    path: string,
    body: Uint8Array<ArrayBuffer>,
    headers: Record<string, string> = {},
  ) => {
    const url = new URL(`http://world.example.invalid${path}`);
    const route = parseConnectionHttpRoute(url.pathname, "POST");
    if (!route || route.kind !== "connection") throw new Error("not a route");
    return handleCoreFileHttpRequest(
      core,
      route,
      url,
      new Request(url, { method: "POST", headers, body }),
    );
  };
  return { w, staged, post };
}

test("an image for a local core agent is staged on this computer for its generation", async () => {
  const { w, staged, post } = await uploadWorld();
  const { generation } = w.lease();
  const response = await post(
    `/api/connections/box/upload-image?connection_generation=${generation}`,
    new Uint8Array([137, 80, 78, 71]),
    { "x-image-ext": "png" },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Herdr-Connection-Id")).toBe("box");
  expect(response.headers.get("X-Herdr-Connection-Generation")).toBe(
    String(generation),
  );
  const body = (await response.json()) as { path: string; remote: boolean };
  expect(body.remote).toBe(false);
  expect(body.path.startsWith(staged)).toBe(true);
  expect([...readFileSync(body.path)]).toEqual([137, 80, 78, 71]);
  // Core is never asked to move files.
  expect(w.fake.calls.filter((c) => c.method.startsWith("file."))).toEqual([]);
});

test("a file upload names its file; a stale generation or lost core is refused", async () => {
  const { w, post } = await uploadWorld();
  const lease = w.lease();
  const ok = await post(
    `/api/connections/box/terminal-upload?filename=notes.txt&connection_generation=${lease.generation}`,
    new TextEncoder().encode("hello"),
  );
  expect(ok.status).toBe(200);
  const { path } = (await ok.json()) as { path: string };
  expect(path.endsWith("notes.txt")).toBe(true);
  expect(readFileSync(path, "utf8")).toBe("hello");

  const stale = await post(
    `/api/connections/box/upload-image?connection_generation=${lease.generation + 1}`,
    new Uint8Array([1]),
  );
  expect(stale.status).toBe(409);

  w.fake.kill(w.socket);
  await until(() => !lease.isCurrent());
  const lost = await post(
    `/api/connections/box/upload-image?connection_generation=${lease.generation}`,
    new Uint8Array([1]),
  );
  expect(lost.status).toBe(503);
});

test("a Windows SSH core host stages uploads there through Windows PowerShell", async () => {
  const sent = join(mkdtempSync(join(tmpdir(), "hcw-win-")), "stdin");
  cleanups.push(() => rmSync(dirname(sent), { recursive: true, force: true }));
  const staged =
    "C:\\Users\\agent\\AppData\\Local\\Temp\\herdr-world-uploads-S-1-5-21-1-2-3-1001\\upload-abc123def45\\img.png";
  const argvs: string[][] = [];
  const originalSpawn = Bun.spawn;
  type SpawnOptions = NonNullable<Parameters<typeof Bun.spawn>[1]>;
  // ssh to the Windows host, faked: it keeps what it is sent and prints
  // where the PowerShell script would have staged it.
  const spawn = spyOn(Bun, "spawn").mockImplementation(((
    command: string[],
    options: SpawnOptions,
  ) => {
    argvs.push(command);
    const upload = options.stdin !== "ignore";
    return originalSpawn(
      [
        process.execPath,
        "-e",
        upload
          ? `await Bun.write(${JSON.stringify(sent)}, await new Response(Bun.stdin.stream()).arrayBuffer()); process.stdout.write(${JSON.stringify(staged)})`
          : "",
      ],
      options,
    );
  }) as typeof Bun.spawn);
  cleanups.push(() => spawn.mockRestore());
  const { w, post } = await uploadWorld({
    destination: "agent@example.invalid",
    windows: true,
  });
  const response = await post(
    `/api/connections/box/upload-image?connection_generation=${w.lease().generation}`,
    new Uint8Array([137, 80, 78, 71]),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    path: staged,
    text: "C:/Users/agent/AppData/Local/Temp/herdr-world-uploads-S-1-5-21-1-2-3-1001/upload-abc123def45/img.png",
    remote: true,
  });
  expect([...readFileSync(sent)]).toEqual([137, 80, 78, 71]);
  await until(() => argvs.length === 2);
  // The sweep and the upload are both one fixed PowerShell command over ssh;
  // nothing runs through sh.
  const remote = argvs.map((argv) => argv[argv.length - 1]!);
  expect(argvs.every((argv) => argv[0] === "ssh")).toBe(true);
  expect(argvs.some((argv) => argv.includes("agent@example.invalid"))).toBe(
    true,
  );
  for (const line of remote) {
    expect(line).toMatch(
      /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
    );
    expect(line).not.toContain("sh -c");
  }
  expect(w.fake.calls.filter((c) => c.method.startsWith("file."))).toEqual([]);
});
