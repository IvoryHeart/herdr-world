import { Database } from "bun:sqlite";
import { writeSync } from "node:fs";
import { join } from "node:path";
import { openWorldLedger } from "../world-storage";
import { openWorldWriter } from "../world-writer";
import type { LedgerWrite, StorageRequest } from "../world-protocol";

const [root, mode] = process.argv.slice(2);
if (!root || !mode) throw new Error("fixture requires root and mode");
const database = join(root, "world.sqlite");
const legacy = join(root, "ledger.json");
const stopAt = (stage: string): never => {
  writeSync(1, `${stage}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error("crash guard unexpectedly resumed");
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
if (mode === "worker-ack") {
  const storage = await openWorldLedger({ database, ledger: legacy }, ports);
  await storage.ledger.update(
    (doc) =>
      doc.asks.push(
        {
          id: "q-ack",
          at: 1000,
          actor: { label: "Synthetic agent", verified: false },
          question: "Continue?",
          options: [],
          owner_only: true,
        },
        {
          id: "q-owner",
          at: 1000,
          actor: { label: "Fixture", verified: false },
          question: "Owner alert?",
          options: [],
          owner_only: true,
        },
      ),
    [
      {
        kind: "ask.created",
        recovery: "repeatable",
        record_id: "q-owner",
        target: { connection_id: "studio" },
      },
    ],
  );
  await storage.ledger.update(
    (doc) => {
      doc.asks[0]!.answer = { text: "Acknowledged", by: "owner", at: 1001 };
    },
    [
      {
        kind: "synthetic.answer",
        recovery: "opaque",
        record_id: "q-ack",
        target: {
          adapter: "synthetic",
          connection_id: "studio",
          kind: "agent-session",
          native_id: "synthetic-session",
          evidence: {
            terminal_id: "synthetic-terminal",
            session_fingerprint: "synthetic-session-fingerprint",
          },
        },
      },
    ],
  );
  stopAt("ack");
} else if (mode === "worker-drain") {
  const storage = await openWorldLedger({ database, ledger: legacy }, ports);
  const updates = Array.from({ length: 33 }, (_, index) =>
    storage.ledger.update((doc) =>
      doc.asks.push({
        id: `q-drain-${index}`,
        at: 1000,
        actor: { label: "Synthetic agent", verified: false },
        question: "Drain?",
        options: [],
        owner_only: true,
      }),
    ),
  );
  await storage.close();
  await Promise.all(updates);
  writeSync(1, "drained\n");
} else {
  const writer = openWorldWriter(database, legacy, 1000);
  const request = (request: StorageRequest) =>
    writer.batch([{ ticket: 1, request }], 1000)[0]!;
  if (mode === "before-commit" || mode === "after-commit") {
    const write: LedgerWrite = {
      at: 1000,
      revision: writer.read().document.revision,
      effects: [
        {
          kind: "synthetic.answer",
          recovery: "opaque",
          record_id: "q-interrupted",
          target: null,
        },
      ],
      asks: {
        put: [
          {
            id: "q-interrupted",
            at: 1000,
            actor: { label: "Synthetic agent", verified: false },
            question: "Atomic?",
            options: [],
            owner_only: true,
            answer: { text: "Yes", at: 1001, by: "owner" },
          },
        ],
        remove: [],
      },
      changes: { put: [], remove: [] },
      results: { put: [], remove: [] },
    };
    writer.batch(
      [{ ticket: 1, request: { type: "write", write } }],
      1000,
      (stage) => {
        if (stage === mode) stopAt(stage);
      },
    );
  } else {
    const entries = request({ type: "outbox" }).result as {
      id: string;
      kind: string;
    }[];
    const entry = entries.find(
      (entry) =>
        entry.kind ===
        (mode.startsWith("answer") ? "synthetic.answer" : "ask.created"),
    )!;
    const claimed = request({ type: "claim", id: entry.id }).result as {
      attempt: number;
    };
    if (mode.endsWith("before-effect")) stopAt(mode);
    const receiver = new Database(join(root, "receiver.sqlite"));
    receiver.exec(
      "PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY)",
    );
    receiver.query("INSERT OR IGNORE INTO receipts VALUES(?)").run(entry.id);
    receiver.close();
    if (mode.endsWith("after-effect")) stopAt(mode);
    request({
      type: "finish",
      id: entry.id,
      attempt: claimed.attempt,
      state: "delivered",
      reason: "Synthetic receiver committed the operation ID",
    });
    stopAt(mode);
  }
  writer.close();
}
