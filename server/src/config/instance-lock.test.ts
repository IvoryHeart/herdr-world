import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock } from "./instance-lock";

const roots: string[] = [];

function folder() {
  const root = join(mkdtempSync(join(tmpdir(), "instance-lock-")), "data");
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(join(root, ".."), { recursive: true, force: true });
});

test("names its holder and releases only its own lock", () => {
  const root = folder();
  const release = acquireInstanceLock(root, 8790);
  const path = join(root, "instance.lock");
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    pid: process.pid,
    port: 8790,
  });
  writeFileSync(path, JSON.stringify({ pid: process.pid + 1, port: 1 }));
  release();
  expect(existsSync(path)).toBeTrue();
});

test("refuses a folder a live World holds", () => {
  const root = folder();
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "instance.lock"),
    JSON.stringify({ pid: 424242, port: 8787 }),
  );
  expect(() => acquireInstanceLock(root, 8788, () => true)).toThrow(
    "is in use by World (pid 424242, port 8787); give this instance its own folder with HERDR_WORLD_DATA_DIR",
  );
});

test("takes over the lock of a World that is gone, or its own after a restart", () => {
  const root = folder();
  mkdirSync(root, { recursive: true });
  const path = join(root, "instance.lock");
  writeFileSync(path, JSON.stringify({ pid: 424242, port: 8787 }));
  acquireInstanceLock(root, 8788, () => false);
  expect(JSON.parse(readFileSync(path, "utf8")).port).toBe(8788);
  acquireInstanceLock(root, 8789, () => true);
  expect(JSON.parse(readFileSync(path, "utf8")).port).toBe(8789);
});

test("waits out a startup that has not written its holder yet", () => {
  const root = folder();
  mkdirSync(root, { recursive: true });
  const path = join(root, "instance.lock");
  writeFileSync(path, "");
  expect(() => acquireInstanceLock(root, 8788, () => true)).toThrow(
    "another World is starting",
  );
  const old = new Date(Date.now() - 60_000);
  utimesSync(path, old, old);
  acquireInstanceLock(root, 8788, () => true);
  expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
});
