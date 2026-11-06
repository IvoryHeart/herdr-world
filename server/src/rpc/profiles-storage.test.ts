import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import { openStorage } from "../service/storage";
import { systemClock, systemScheduler } from "../service/ports";
import { handleWorldRpc } from "./world";
import type { BridgeRpcContext } from "./context";
import type { ProfilesDocument } from "../agent/profile-store";

test("the real profiles RPC replies and publishes only after its storage-port commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "profiles-rpc-"));
  const storage = await openStorage(
    resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    { clock: systemClock, scheduler: systemScheduler },
  );
  try {
    const profiles = storage.profiles(),
      replies: Record<string, unknown>[] = [],
      published: number[] = [],
      errors: string[] = [];
    const rpc = {
      id: "synthetic-request",
      method: "world.profiles.save",
      params: {
        profile: { ...profiles.profile("builder")!, role: "Committed via RPC" },
      },
      sendReply: (message: Record<string, unknown>) => {
        replies.push(message);
        return true;
      },
      sendError: (_context: string, error: unknown) =>
        errors.push(String(error)),
      services: {
        profiles: () => profiles,
        terminalSettings: () => ({ get: () => profiles.get() }),
        publishProfilesChanged: (revision: number) => published.push(revision),
      },
    } as unknown as BridgeRpcContext;
    const pending = handleWorldRpc(rpc);
    expect(replies).toEqual([]);
    expect(published).toEqual([]);
    await pending;
    expect(errors).toEqual([]);
    const document = replies[0]!.result as ProfilesDocument;
    expect(
      document.profiles.find((profile) => profile.id === "builder")?.role,
    ).toBe("Committed via RPC");
    expect(published).toEqual([document.revision]);
    const before = profiles.get();
    await handleWorldRpc({
      ...rpc,
      params: {
        profile: {
          ...profiles.profile("builder")!,
          chime: before.chimes.timbres.town_master,
        },
      },
    });
    expect(errors).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(profiles.get()).toEqual(before);
  } finally {
    await storage.close();
    rmSync(root, { recursive: true, force: true });
  }
});
