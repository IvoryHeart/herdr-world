import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldLedger, type WorldLedgerStorage } from "./world-storage";
import type { OutboxEffect } from "./world-protocol";

const roots: string[] = [];
const opened: WorldLedgerStorage[] = [];
const ports = {
  clock: { now: () => 1000, monotonic: () => performance.now() },
  scheduler: {
    schedule(callback: () => void, delayMs: number) {
      const timer = setTimeout(callback, delayMs);
      return { cancel: () => clearTimeout(timer) };
    },
  },
};
const paths = () => {
  const root = mkdtempSync(join(tmpdir(), "world-sqlite-"));
  roots.push(root);
  return {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
};
const open = async (target = paths()) => {
  const storage = await openWorldLedger(target, ports);
  opened.push(storage);
  return storage;
};
const ask = (id: string) => ({
  id,
  at: 1000,
  actor: { label: "Synthetic agent", verified: false },
  question: "Ship the fixture?",
  options: ["Yes", "No"],
  owner_only: true,
});
const effect = (id: string): OutboxEffect[] => [
  {
    kind: "ask.created",
    recovery: "repeatable",
    record_id: id,
    target: { connection_id: "studio" },
  },
];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((storage) => storage.close()));
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("committed answers survive reopen without an unconsumed pane-send backlog", async () => {
  const target = paths();
  const first = await open(target);
  await first.ledger.update(
    (doc) => doc.asks.push(ask("q-test")),
    effect("q-test"),
  );
  await first.ledger.update((doc) => {
    doc.asks[0]!.answer = { text: "Yes", at: 1001, by: "owner" };
  });
  await first.close();
  const second = await open(target);
  expect(second.ledger.ask("q-test")?.answer?.text).toBe("Yes");
  expect(
    (await second.outbox.forRecord("q-test")).map((entry) => [
      entry.kind,
      entry.state,
    ]),
  ).toEqual([["ask.created", "cancelled"]]);
  expect(await second.outbox.list()).toEqual([]);
  const info = await second.inspect();
  expect(info).toMatchObject({
    journal_mode: "wal",
    synchronous: 2,
    locking_mode: "exclusive",
    integrity: "ok",
  });
  console.info(
    "Storage runtime",
    JSON.stringify({ platform: process.platform, arch: process.arch, ...info }),
  );
});

test("one worker owns a database; independent roots and close/reopen share nothing", async () => {
  const target = paths();
  const first = await open(target);
  await expect(openWorldLedger(target, ports)).rejects.toThrow(
    /locked|writer/i,
  );
  const other = await open();
  await first.ledger.update((doc) => doc.asks.push(ask("q-owned")));
  expect(other.ledger.get().asks).toEqual([]);
  await first.close();
  expect((await open(target)).ledger.get().asks).toHaveLength(1);
});

test("import is exact, hash-backed and idempotent; changed legacy input only merges missing IDs", async () => {
  const target = paths();
  const original = JSON.stringify({
    version: 1,
    revision: 7,
    asks: [
      {
        ...ask("q-import"),
        delivery: {
          notification: {
            state: "delivered",
            reason: "Legacy annotation is not dispatch evidence",
          },
        },
      },
    ],
    changes: [],
    results: [],
  });
  writeFileSync(target.ledger, original);
  const first = await open(target);
  const backup = `${target.ledger}.${createHash("sha256").update(original).digest("hex")}.sqlite-import.bak`;
  expect(readFileSync(backup, "utf8")).toBe(original);
  expect(first.ledger.get().revision).toBe(8);
  expect(first.ledger.ask("q-import")?.delivery).toBeUndefined();
  expect(await first.outbox.list()).toEqual([]);
  await first.ledger.update((doc) => {
    doc.asks[0]!.answer = { text: "Recorded", at: 1001, by: "owner" };
  });
  await first.close();
  const unchanged = await open(target);
  expect(unchanged.ledger.get().revision).toBe(9);
  await unchanged.close();
  writeFileSync(
    target.ledger,
    JSON.stringify({
      version: 1,
      revision: 10,
      asks: [ask("q-import"), ask("q-legacy-new")],
      changes: [],
      results: [],
    }),
  );
  const merged = await open(target);
  expect(merged.ledger.ask("q-import")?.answer?.text).toBe("Recorded");
  expect(merged.ledger.ask("q-legacy-new")).toBeDefined();
  expect(merged.ledger.get().revision).toBe(11);
  expect(await merged.outbox.list()).toEqual([]);
  expect(
    readdirSync(roots.at(-1)!).filter((name) =>
      name.endsWith(".sqlite-import.bak"),
    ),
  ).toHaveLength(2);
});

test("malformed retired JSON stays untouched and can be repaired without blocking current state", async () => {
  const target = paths();
  writeFileSync(target.ledger, "malformed retired file");
  const first = await open(target);
  await first.ledger.update((doc) => doc.asks.push(ask("q-current")));
  await first.close();
  expect(readFileSync(target.ledger, "utf8")).toBe("malformed retired file");
  writeFileSync(
    target.ledger,
    JSON.stringify({
      version: 1,
      revision: 1,
      asks: [ask("q-repaired")],
      changes: [],
      results: [],
    }),
  );
  const repaired = await open(target);
  expect(repaired.ledger.get().asks.map((row) => row.id)).toEqual([
    "q-current",
    "q-repaired",
  ]);
});

test("interrupted owner dispatch is visible uncertain with a persisted retry deadline", async () => {
  const target = paths();
  const first = await open(target);
  await first.ledger.update(
    (doc) => doc.asks.push(ask("q-interrupted")),
    effect("q-interrupted"),
  );
  const entry = (await first.outbox.list())[0]!;
  expect((await first.outbox.claim(entry.id))?.state).toBe("dispatching");
  await first.close();
  const second = await open(target);
  const recovered = (await second.outbox.list())[0]!;
  expect(recovered.state).toBe("uncertain");
  expect(recovered.due_at).toBe(31_000);
  expect(
    second.ledger.ask("q-interrupted")?.delivery?.notification?.state,
  ).toBe("uncertain");
  expect(await second.outbox.claim(entry.id)).toBeNull();
});

test("a rejected mutation leaves later writes usable; results declare no alerts", async () => {
  const storage = await open();
  await expect(
    storage.ledger.update(() => {
      throw new Error("fixture refusal");
    }),
  ).rejects.toThrow("fixture refusal");
  await storage.ledger.update((doc) =>
    doc.results.push({
      id: "r-result",
      at: 1000,
      actor: { label: "Fixture", verified: false },
      task: "fixture",
      status: "done",
      summary: "Done",
    }),
  );
  expect(storage.ledger.get().revision).toBe(1);
  expect(await storage.outbox.list()).toEqual([]);
});

test("a declared intent without a domain edit is still committed", async () => {
  const storage = await open();
  await storage.ledger.update(() => {}, [
    {
      kind: "synthetic.intent",
      recovery: "opaque",
      record_id: "intent-fixture",
      target: null,
    },
  ]);
  expect(storage.ledger.get().revision).toBe(1);
  expect(await storage.outbox.forRecord("intent-fixture")).toMatchObject([
    { kind: "synthetic.intent", state: "pending" },
  ]);
});

test("a cursor from before close/reopen always resets, even at an in-range sequence", async () => {
  const target = paths();
  const first = await open(target);
  await first.ledger.update((doc) => doc.asks.push(ask("q-cursor")));
  const page = await first.replay(null);
  await first.close();
  const second = await open(target);
  const resumed = await second.replay({
    incarnation: page.incarnation,
    seq: page.watermark,
  });
  expect(resumed.reset).toBe(true);
  expect(resumed.incarnation).not.toBe(page.incarnation);
  expect(await second.ledger.nextId("q")).toMatch(
    /^q-[0123456789abcdefghjkmnpqrstvwxyz]{8}$/,
  );
});
