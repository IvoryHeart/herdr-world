import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defaultGuiSettings } from "../config/gui-settings";
import { createCoreHostRuntime } from "../herdr-core/host-runtime";
import { coreWorld } from "../herdr-core/testing/core-world";
import { parseConnectionHttpRoute } from "../connections/http-routing";
import type { CoreRpcServices } from "../rpc/core";
import { handleCoreFileHttpRequest } from "./core-files-http";
const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});
test("core HTTP downloads, uploads and deletes stay on the original generation", async () => {
  const w = await coreWorld();
  worlds.push(w);
  await w.connect();
  const folder = join(w.root, "repo");
  mkdirSync(folder);
  writeFileSync(join(folder, "readme.txt"), "core file");
  w.fake.create({
    cwd: folder,
    foreground: { pid: 42000, name: "sh", cwd: folder },
  });
  await w.settle();
  const lease = w.lease();
  const core = {
    manager: w.core.manager,
    hostRuntime: () =>
      createCoreHostRuntime({
        lease,
        host: null,
        readSettings: async () => defaultGuiSettings(),
      }),
  } as unknown as CoreRpcServices;
  const call = async (
    endpoint: string,
    path: string,
    init?: RequestInit,
    generation = lease.generation,
  ) => {
    const url = new URL(
      `http://world.example.invalid/api/connections/box/${endpoint.replace("-", "/")}?workspace_id=hc%3Aunplaced&path=${encodeURIComponent(path)}&connection_generation=${generation}`,
    );
    if (endpoint === "file-upload") {
      url.searchParams.set("filename", "upload.txt");
      url.searchParams.set("directory", "");
    }
    const route = parseConnectionHttpRoute(url.pathname, init?.method ?? "GET");
    if (!route || route.kind !== "connection")
      throw new Error(JSON.stringify(route));
    return handleCoreFileHttpRequest(core, route, url, new Request(url, init));
  };
  const downloaded = await call("file-download", "readme.txt");
  expect(downloaded.status).toBe(200);
  expect(await downloaded.text()).toBe("core file");
  const uploaded = await call("file-upload", "", {
    method: "POST",
    body: "upload",
  });
  expect(uploaded.status).toBe(200);
  expect(existsSync(join(folder, "upload.txt"))).toBe(true);
  const stale = await call(
    "file-delete",
    "upload.txt",
    { method: "POST" },
    lease.generation + 1,
  );
  expect(stale.status).toBe(409);
  expect(existsSync(join(folder, "upload.txt"))).toBe(true);
  const removed = await call("file-delete", "upload.txt", { method: "POST" });
  expect(removed.status).toBe(200);
  expect(existsSync(join(folder, "upload.txt"))).toBe(false);
  expect(w.fake.calls.filter((c) => c.method.startsWith("file."))).toEqual([]);
});
