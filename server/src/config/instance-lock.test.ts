import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

test("takes over a lock a crashed startup left unreadable", () => {
  const root = folder();
  mkdirSync(root, { recursive: true });
  const path = join(root, "instance.lock");
  writeFileSync(path, "");
  acquireInstanceLock(root, 8788, () => true);
  expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(process.pid);
});

test("two starts taking over a dead holder's lock take turns", () => {
  const root = folder();
  mkdirSync(root, { recursive: true });
  const path = join(root, "instance.lock");
  writeFileSync(path, JSON.stringify({ pid: 424242, port: 8787 }));
  // A second start runs while this one checks the dead holder: it must
  // wait for the check, not remove the lock this start is about to take.
  let second: ReturnType<typeof Bun.spawnSync> | undefined;
  acquireInstanceLock(root, 8788, () => {
    second = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `import { acquireInstanceLock } from ${JSON.stringify(join(import.meta.dir, "instance-lock.ts"))};
           acquireInstanceLock(${JSON.stringify(root)}, 8789, () => false, 300);
           console.log("took it");`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    return false;
  });
  expect(second?.exitCode).not.toBe(0);
  expect(String(second?.stdout)).not.toContain("took it");
  expect(String(second?.stderr)).toContain("another World is starting");
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    pid: process.pid,
    port: 8788,
  });
});
