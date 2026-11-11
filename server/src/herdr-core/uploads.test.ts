import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGuiSettings } from "../config/gui-settings";
import { parseConnectionHttpRoute } from "../connections/http-routing";
import type { CoreRpcServices } from "../rpc/core";
import { handleCoreFileHttpRequest } from "../service/core-files-http";
import { type CoreHostRuntime, createCoreHostRuntime } from "./host-runtime";
import { coreWorld, until } from "./testing/core-world";
import { createCoreUploads } from "./uploads";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A connected local core whose uploads stage in a scratch directory. */
async function uploadWorld(host: { windows: boolean } | null = null) {
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

test("a Windows core host takes no uploads", async () => {
  expect(
    createCoreUploads(
      { destination: "agent@example.invalid", windows: true },
      { signal: new AbortController().signal },
    ),
  ).toBeNull();
  const { w, post } = await uploadWorld({ windows: true });
  const refused = await post(
    `/api/connections/box/upload-image?connection_generation=${w.lease().generation}`,
    new Uint8Array([1]),
  );
  expect(refused.status).toBe(501);
  expect(((await refused.json()) as { error: string }).error).toContain(
    "Unix SSH host",
  );
});
