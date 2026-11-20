import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openWorldLedger,
  type WorldLedgerStorage,
} from "../storage/world-storage";
import { BoardStore } from "./board-store";
import { handleWorldAsk } from "./world-cli-asks";
import { createWorldCliService } from "./world-cli-service";
import type { WorldCliDeps } from "./world-cli";
import type { CliActor } from "./world-ledger";

const roots: string[] = [];
const opened: WorldLedgerStorage[] = [];
const actor: CliActor = {
  label: "Synthetic asker",
  verified: true,
  connection_id: "synthetic-core",
  terminal_id: "t1",
  pane_id: "t1",
  connection_generation: 1,
  agent_session_fingerprint: "before",
};
const ports = {
  clock: { now: () => 1000, monotonic: () => performance.now() },
  scheduler: {
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(callback, delay);
      return { cancel: () => clearTimeout(timer) };
    },
  },
};
afterEach(async () => {
  for (const storage of opened.splice(0)) await storage.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "question-backlog-"));
  roots.push(root);
  const paths = {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
  const storage = await openWorldLedger(paths, ports);
  opened.push(storage);
  const deps: WorldCliDeps = {
    ledger: storage.ledger,
    board: new BoardStore(join(root, "board.json")),
    hosts: () => [],
    defaultConnectionId: () => "synthetic-tui",
    snapshot: async () => ({ revision: 1, observed_at: 1, connections: [] }),
    publishBoard() {},
    publishLedger() {},
  };
  const seed = (count: number) =>
    storage.ledger.update(
      (doc) => {
        doc.asks = Array.from({ length: count }, (_, i) => ({
          id: `q-${i}`,
          actor,
          at: 1,
          question: `Task ${i}?`,
          key: `task:${i}`,
          options: [],
          owner_only: true,
        }));
      },
      Array.from({ length: count }, (_, i) => ({
        kind: "ask.created",
        record_id: `q-${i}`,
        recovery: "repeatable" as const,
        target: { connection_id: "synthetic-tui" },
      })),
    );
  return { storage, deps, seed, paths };
}

test("SQLite cap races admit one remaining slot, refuse quietly, then admit after closure", async () => {
  const { storage, deps, seed } = await fixture();
  await seed(19);
  const arrived = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let captures = 0;
  deps.captureRecipient = async () => {
    if (++captures === 2) arrived.resolve();
    await release.promise;
    return undefined;
  };
  const request = () =>
    handleWorldAsk(deps, "ask", { question: "New task?" }, actor, () => 2).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, value: error.code }),
    );
  const pending = [request(), request()];
  await arrived.promise;
  release.resolve();
  const replies = await Promise.all(pending);
  expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
  expect(replies.find((reply) => !reply.ok)?.value).toBe("question_cap");
  expect(storage.ledger.openAsks().asks).toHaveLength(20);
  const effects = (await storage.outbox.list()).length;
  for (let attempt = 0; attempt < 21; attempt++)
    expect((await request()).value).toBe("question_cap");
  expect((await storage.outbox.list()).length).toBe(effects);
  await handleWorldAsk(
    deps,
    "ask withdraw",
    { id: "q-0" },
    { ...actor, connection_generation: 3, agent_session_fingerprint: "after" },
    () => 3,
  );
  expect((await request()).ok).toBe(true);
  expect(storage.ledger.openAsks().asks).toHaveLength(20);
});

test("the owner RPC atomically closes a restarted asker's persisted backlog and cancels alerts", async () => {
  const { storage, deps, seed, paths } = await fixture();
  await seed(20);
  await storage.ledger.update((doc) => {
    doc.asks[10]!.actor = {
      ...actor,
      connection_generation: 3,
      agent_session_fingerprint: "after",
    };
    doc.asks.push({
      ...doc.asks[0]!,
      id: "q-other",
      actor: { ...actor, terminal_id: "t2" },
    });
  });
  await storage.close();
  const reopened = await openWorldLedger(paths, ports);
  opened.push(reopened);
  const broadcasts: string[] = [];
  const service = createWorldCliService({
    ledger: () => reopened.ledger,
    board: () => deps.board as BoardStore,
    connections: () => ({
      list: () => [],
      readyRuntimeLease: () => null,
      defaultId: () => null,
    }),
    snapshots: () => null,
    now: () => 3,
    townMoveQueues: new Map(),
    publishBoard() {},
    broadcast: (line) => broadcasts.push(line),
  });
  const revision = reopened.ledger.get().revision;
  expect(
    await service.rpc("world.ask.dismiss", { id: "q-0", all_from_asker: true }),
  ).toMatchObject({ asks: [{ id: "q-other" }] });
  expect(reopened.ledger.get().revision).toBe(revision + 1);
  expect(
    reopened.ledger.get().asks.filter((ask) => ask.dismissed),
  ).toHaveLength(20);
  expect(broadcasts.at(-1)).toContain('"asks":true');
  for (let i = 0; i < 20; i++)
    expect((await reopened.outbox.forRecord(`q-${i}`))[0]?.state).toBe(
      "cancelled",
    );
  await expect(
    Promise.resolve().then(() =>
      service.rpc("world.ask.answer", { id: "q-0", answer: "Yes" }),
    ),
  ).rejects.toThrow("dismissed");
});
