import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dismissItem,
  listItems,
  openOwnerStore,
  putItem,
  resolveItem,
} from "./owner-items";

const root = mkdtempSync(join(tmpdir(), "owner-inbox-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const ready = {
  source: "crew" as const,
  key: "ready:7:head",
  reason: "READY #7: test change",
  pr: 7,
  target: { kind: "url" as const, value: "https://example.com/pull/7" },
};

test("durable deduplication, newest first, dismissal and cause recurrence", () => {
  const path = join(root, "items.sqlite");
  let db = openOwnerStore(path);
  const first = putItem(db, ready, 10);
  putItem(db, { ...ready, source: "dispatch", key: "stuck:8", pr: 8 }, 20);
  putItem(db, ready, 30);
  db.close();
  db = openOwnerStore(path);
  expect(listItems(db).map((item) => item.createdAt)).toEqual([20, 10]);
  expect(dismissItem(db, first.id, 40)).toBe(true);
  putItem(db, ready, 50);
  expect(listItems(db)).toHaveLength(1);
  resolveItem(db, "crew", ready.key, 60);
  putItem(db, ready, 70);
  expect(listItems(db).map((item) => item.createdAt)).toEqual([70, 20]);
  db.close();
});

test("resolved and dismissed items never await a nudge", () => {
  const db = openOwnerStore(":memory:");
  const item = putItem(db, ready, 10);
  expect(item.notifiedAt).toBeNull();
  dismissItem(db, item.id, 20);
  expect(listItems(db)).toEqual([]);
  resolveItem(db, "crew", ready.key, 30);
  expect(listItems(db, true)[0]!.resolvedAt).toBe(30);
  db.close();
});

test("producer namespaces cannot clear each other's causes", () => {
  const db = openOwnerStore(":memory:");
  putItem(db, ready, 1);
  putItem(db, { ...ready, source: "dispatch" }, 2);
  resolveItem(db, "dispatch", ready.key, 3);
  expect(listItems(db).map((entry) => entry.source)).toEqual(["crew"]);
  db.close();
});
