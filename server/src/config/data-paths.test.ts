import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertSafeDataPath,
  dataRoot,
  defaultDataFile,
  publishDataFile,
} from "./data-paths";

const roots: string[] = [];

function home() {
  const root = mkdtempSync(join(tmpdir(), "herdr-world-data-"));
  roots.push(root);
  return root;
}

function write(path: string, value: string, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, value, { mode });
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("fresh Unix and Windows data roots use only the World namespace", () => {
  const root = home();
  expect(dataRoot(root, "linux")).toBe(join(root, ".config", "herdr-world"));
  expect(dataRoot(root, "win32", join(root, "custom"))).toBe(
    join(root, "custom", "herdr-world"),
  );
  expect(dataRoot(root, "win32", undefined)).toBe(
    join(root, "AppData", "Roaming", "herdr-world"),
  );
  expect(defaultDataFile("settings.json", root, "linux")).toBe(
    join(root, ".config", "herdr-world", "settings.json"),
  );
});

test("existing settings from another product are left untouched and unread", () => {
  const root = home();
  const upstream = join(root, ".config", "roamgate", "settings.json");
  const legacy = join(root, ".config", "herdr-gui", "settings.json");
  write(upstream, '{"source":"upstream"}');
  write(legacy, '{"source":"legacy"}');

  const target = defaultDataFile("settings.json", root, "linux");
  expect(target).toBe(join(root, ".config", "herdr-world", "settings.json"));
  expect(existsSync(target)).toBeFalse();
  expect(readFileSync(upstream, "utf8")).toContain("upstream");
  expect(readFileSync(legacy, "utf8")).toContain("legacy");
});

test("safe publication is complete and never overwrites a winner", () => {
  const root = home();
  const target = join(root, ".config", "herdr-world", "settings.json");
  publishDataFile(target, "first");
  publishDataFile(target, "second");
  expect(readFileSync(target, "utf8")).toBe("first");
  expect(readdirSync(dirname(target))).toEqual(["settings.json"]);
});

test("data path validation rejects product and file symlinks", () => {
  const root = home();
  const other = join(root, "other");
  mkdirSync(other);
  const product = join(root, ".config", "herdr-world");
  mkdirSync(dirname(product), { recursive: true });
  symlinkSync(other, product);
  expect(() => assertSafeDataPath(join(product, "settings.json"))).toThrow(
    "symlink",
  );

  rmSync(product);
  mkdirSync(product);
  const secret = join(root, "secret");
  write(secret, "secret");
  symlinkSync(secret, join(product, "settings.json"));
  expect(() => assertSafeDataPath(join(product, "settings.json"))).toThrow(
    "symlink",
  );
});
