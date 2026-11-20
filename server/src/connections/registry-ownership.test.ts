import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionProfileStore } from "./profiles";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "registry-ownership-"));
  roots.push(root);
  chmodSync(root, 0o700);
  const path = join(root, "connections.json");
  return {
    root,
    path,
    lock: `${path}.ownership.sqlite`,
    store: new ConnectionProfileStore({ path }),
  };
}

test("same-process service ownership lasts until storage close and remains registry-specific", async () => {
  const f = fixture();
  await f.store.acquireServiceOwnership();
  const next = new ConnectionProfileStore({ path: f.path });
  await expect(next.withOwnership(async () => {})).rejects.toThrow("busy");
  const other = fixture();
  await other.store.withOwnership(async () => {});
  await f.store.close();
  await next.withOwnership(async () => {});
  await expect(f.store.acquireServiceOwnership()).rejects.toThrow("closed");
  await next.withOwnership(async () => {});
});
for (const kind of [
  "symlink",
  "hardlink",
  "directory",
  "public-file",
] as const) {
  test(`unsafe ${kind} ownership refuses before reading or writing a registry`, async () => {
    if (
      process.platform === "win32" &&
      (kind === "symlink" || kind === "public-file")
    )
      return;
    const f = fixture();
    const target = join(f.root, "target");
    writeFileSync(target, "", { mode: 0o600 });
    if (kind === "symlink") symlinkSync(target, f.lock);
    else if (kind === "hardlink") linkSync(target, f.lock);
    else if (kind === "directory") mkdirSync(f.lock);
    else {
      writeFileSync(f.lock, "", { mode: 0o644 });
      chmodSync(f.lock, 0o644);
    }
    let entered = false;
    await expect(
      f.store.withOwnership(async () => {
        entered = true;
      }),
    ).rejects.toThrow("ownership");
    expect(entered).toBe(false);
  });
}
