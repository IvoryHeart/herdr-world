import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConnectionHttpRoute } from "../connections/http-routing";
import type { CoreConnectionProfile } from "../connections/profiles";
import type { CoreUploads } from "./runtime";
import { coreUploadsForProfile, handleCoreUploadRequest } from "./uploads";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const profile = (
  fields: Partial<CoreConnectionProfile> = {},
): CoreConnectionProfile => ({
  id: "box",
  label: "box",
  type: "local",
  runtime: "herdr-core",
  core_session: "default",
  core_state_dir: "/tmp/example-core",
  auto_connect: false,
  ...fields,
});

/** One core connection's registry, at generation 3 unless replaced. */
function registry(uploads: CoreUploads | null) {
  let current = true;
  return {
    retire: () => {
      current = false;
    },
    registry: {
      defaultId: () => "box",
      has: (id: string) => id === "box",
      readyRuntimeLease: (id: string) =>
        id === "box"
          ? {
              connectionId: "box",
              generation: 3,
              runtime: { uploads },
              isCurrent: () => current,
            }
          : null,
    },
  };
}

function request(path: string, body: Uint8Array<ArrayBuffer>, headers = {}) {
  const url = new URL(`http://localhost${path}`);
  const route = parseConnectionHttpRoute(url.pathname, "POST");
  if (!route || route.kind !== "connection") throw new Error("not a route");
  const generation = url.searchParams.get("connection_generation");
  return {
    route,
    url,
    requestedGeneration: generation === null ? undefined : Number(generation),
    req: new Request(url, { method: "POST", headers, body }),
  };
}

async function localUploads() {
  const root = await mkdtemp(join(tmpdir(), "hcw-up-"));
  roots.push(root);
  const uploads = coreUploadsForProfile(profile(), {
    signal: new AbortController().signal,
    onCleanupError: () => {},
    tempRoot: () => root,
  });
  if (!uploads) throw new Error("local cores take uploads");
  return { root, uploads };
}

test("an image for a local core agent is staged on this machine for its generation", async () => {
  const { root, uploads } = await localUploads();
  const { registry: reg } = registry(uploads);
  const response = await handleCoreUploadRequest({
    registry: reg,
    ...request(
      "/api/connections/box/upload-image?connection_generation=3",
      new Uint8Array([137, 80, 78, 71]),
      { "x-image-ext": "png" },
    ),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Herdr-Connection-Id")).toBe("box");
  expect(response.headers.get("X-Herdr-Connection-Generation")).toBe("3");
  const body = (await response.json()) as { path: string; remote: boolean };
  expect(body.remote).toBe(false);
  expect(body.path.startsWith(root)).toBe(true);
  expect([...(await readFile(body.path))]).toEqual([137, 80, 78, 71]);
  uploads.stop();
});

test("a file upload names its file; a stale generation or retired runtime is refused", async () => {
  const { uploads } = await localUploads();
  const conn = registry(uploads);
  const ok = await handleCoreUploadRequest({
    registry: conn.registry,
    ...request(
      "/api/connections/box/terminal-upload?filename=notes.txt&connection_generation=3",
      new TextEncoder().encode("hello"),
    ),
  });
  expect(ok.status).toBe(200);
  const { path } = (await ok.json()) as { path: string };
  expect(path.endsWith("notes.txt")).toBe(true);
  expect(await readFile(path, "utf8")).toBe("hello");

  const stale = await handleCoreUploadRequest({
    registry: conn.registry,
    ...request(
      "/api/connections/box/upload-image?connection_generation=2",
      new Uint8Array([1]),
    ),
  });
  expect(stale.status).toBe(409);

  conn.retire();
  const retired = await handleCoreUploadRequest({
    registry: conn.registry,
    ...request(
      "/api/connections/box/upload-image?connection_generation=3",
      new Uint8Array([1]),
    ),
  });
  expect(retired.status).toBe(409);
  uploads.stop();
});

test("a Windows core takes no uploads, and other connection routes are not offered", async () => {
  expect(
    coreUploadsForProfile(
      profile({
        type: "ssh",
        ssh_destination: "agent@example.invalid",
        remote_platform: "windows",
      }),
      { signal: new AbortController().signal, onCleanupError: () => {} },
    ),
  ).toBeNull();
  const none = await handleCoreUploadRequest({
    registry: registry(null).registry,
    ...request(
      "/api/connections/box/upload-image?connection_generation=3",
      new Uint8Array([1]),
    ),
  });
  expect(none.status).toBe(501);
  const { uploads } = await localUploads();
  const url = new URL(
    "http://localhost/api/connections/box/file/upload?connection_generation=3",
  );
  const route = parseConnectionHttpRoute(url.pathname, "POST");
  if (!route || route.kind !== "connection") throw new Error("route");
  const other = await handleCoreUploadRequest({
    registry: registry(uploads).registry,
    route,
    url,
    requestedGeneration: 3,
    req: new Request(url, { method: "POST", body: "x" }),
  });
  expect(other.status).toBe(501);
});
