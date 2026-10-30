import { afterEach, expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import { openWorldClient } from "../storage/world-client";
import { StorageOutcomeUnknown } from "../storage/world-protocol";
import { createWorldService, type WorldService } from "./world-service";
import { openStorage } from "./storage";
import { startTestService, testServerConfig } from "./testing/services";
import { herdrAdapter, systemClock, systemScheduler } from "./ports";

const roots: string[] = [];
const services: WorldService[] = [];
const ports = { clock: systemClock, scheduler: systemScheduler };
const root = () => {
  const path = mkdtempSync(join(tmpdir(), "world-storage-life-"));
  roots.push(path);
  return path;
};
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});

test("root opens independent SQLite families before listening and close releases the same root", async () => {
  const first = root();
  const second = root();
  const create = async (directory: string) => {
    const service = await createWorldService({
      config: testServerConfig(directory),
      paths: resolveDataPaths({ HERDR_WORLD_DATA_DIR: directory }),
      ...ports,
      storage: openStorage,
      adapters: { herdr: herdrAdapter },
      scheduleProcessExit() {},
    });
    services.push(service);
    return service;
  };
  const left = await create(first);
  const right = await create(second);
  expect(left.port).toBeUndefined();
  await left.storage.ledger().update((doc) =>
    doc.asks.push({
      id: "q-left",
      at: 1000,
      actor: { label: "Fixture", verified: false },
      question: "Isolated?",
      options: [],
      owner_only: true,
    }),
  );
  expect(right.storage.ledger().get().asks).toEqual([]);
  await expect(create(first)).rejects.toThrow(/in use|already/i);
  await left.stop();
  expect(existsSync(join(first, "instance.lock"))).toBe(false);
  expect((await create(first)).storage.ledger().ask("q-left")?.question).toBe(
    "Isolated?",
  );
});

test("a real worker termination signals unknown outcomes and releases exclusive ownership on close", async () => {
  const directory = root();
  let worker!: Worker;
  const client = await openWorldClient(
    join(directory, "world.sqlite"),
    join(directory, "legacy.json"),
    ports,
    (url) => (worker = new Worker(url)),
  );
  try {
    await worker.terminate();
    expect(await client.failed).toBeInstanceOf(StorageOutcomeUnknown);
    await expect(client.request({ type: "load" })).rejects.toBeInstanceOf(
      StorageOutcomeUnknown,
    );
  } finally {
    await client.close();
  }
  const reopened = await openWorldClient(
    join(directory, "world.sqlite"),
    join(directory, "legacy.json"),
    ports,
  );
  await reopened.close();
});

test("root fail-stops on storage failure rather than keeping a service with a dead ledger", async () => {
  const directory = root();
  const failure = Promise.withResolvers<Error>();
  const closed = Promise.withResolvers<void>();
  const { service, base } = await startTestService(
    directory,
    {},
    {},
    {
      storage: async (paths, injected) => {
        const storage = await openStorage(paths, injected);
        return {
          ...storage,
          failed: failure.promise,
          async close() {
            await storage.close();
            // Observe after stopService's close continuation releases the lock.
            setImmediate(closed.resolve);
          },
        };
      },
    },
  );
  expect((await fetch(`${base}/api/health`)).status).toBe(401);
  services.push(service);
  failure.resolve(new StorageOutcomeUnknown("Synthetic worker loss"));
  expect(await service.failed).toBeInstanceOf(StorageOutcomeUnknown);
  await closed.promise;
  // Automatic stop keeps the listener fenced until the process exits.
  expect((await fetch(`${base}/api/health`)).status).toBe(503);
  expect(existsSync(join(directory, "instance.lock"))).toBe(false);
  await expect(
    Promise.resolve().then(() => service.storage.ledger().update(() => {})),
  ).rejects.toThrow("closing");
});
