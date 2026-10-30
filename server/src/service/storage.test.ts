import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import { systemClock, systemScheduler } from "./ports";
import { openStorage } from "./storage";

const ports = { clock: systemClock, scheduler: systemScheduler };
const note = (text: string) => ({
  op: "note.put" as const,
  note: { id: "note-1", text, color: "yellow" as const, x: 10, y: 20 },
});
const registry = (id: string) => ({
  version: 1 as const,
  default_connection_id: id,
  profiles: [
    {
      id,
      label: id,
      type: "local" as const,
      control_socket_path: "/run/example/herdr.sock",
      client_socket_path: "/run/example/herdr-client.sock",
      auto_connect: false,
    },
  ],
});

test("closed storage refuses every family's writes and keeps its files", async () => {
  const root = mkdtempSync(join(tmpdir(), "world-storage-closed-"));
  const paths = resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
  try {
    const storage = await openStorage(paths, ports);
    await storage.settings.update((s) => ({ ...s, title_suffix: "before" }));
    storage.board().patch([note("before")]);
    storage.ledger().update(() => {});
    const [profile] = storage.profiles().get().profiles;
    storage.profiles().save(profile);
    await storage.connections.save(registry("before"));
    const files = [
      paths.settings,
      paths.board,
      paths.ledger,
      paths.agentProfiles,
      paths.connections,
    ];
    const before = files.map((path) => readFileSync(path, "utf8"));

    await storage.close();
    const closed = "World storage is closed";
    await expect(
      storage.settings.update((s) => ({ ...s, title_suffix: "after" })),
    ).rejects.toThrow(closed);
    expect(() => storage.board().patch([note("after")])).toThrow(closed);
    expect(() => storage.ledger().update(() => {})).toThrow(closed);
    expect(() => storage.profiles().save(profile)).toThrow(closed);
    await expect(storage.connections.save(registry("after"))).rejects.toThrow(
      closed,
    );
    await expect(storage.connections.clear()).rejects.toThrow(closed);
    expect(files.map((path) => readFileSync(path, "utf8"))).toEqual(before);
    // Reads still answer from what was saved.
    expect((await storage.settings.read()).title_suffix).toBe("before");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a family first opened after close refuses writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "world-storage-late-"));
  try {
    const storage = await openStorage(
      resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
      ports,
    );
    await storage.close();
    expect(() => storage.board().patch([note("late")])).toThrow(
      "World storage is closed",
    );
    expect(() => storage.ledger().update(() => {})).toThrow(
      "World storage is closed",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
