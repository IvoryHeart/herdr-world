import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertSafeDataPath,
  dataRoot,
  defaultDataFile,
  publishDataFile,
  replaceDataFile,
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
  expect(dataRoot(root, "linux", undefined, {})).toBe(
    join(root, ".config", "herdr-world"),
  );
  expect(dataRoot(root, "win32", join(root, "custom"), {})).toBe(
    join(root, "custom", "herdr-world"),
  );
  expect(dataRoot(root, "win32", undefined, {})).toBe(
    join(root, "AppData", "Roaming", "herdr-world"),
  );
  expect(defaultDataFile("settings.json", root, "linux", undefined, {})).toBe(
    join(root, ".config", "herdr-world", "settings.json"),
  );
});

test("HERDR_WORLD_DATA_DIR gives an instance its own folder", () => {
  const root = home();
  const own = { HERDR_WORLD_DATA_DIR: join(root, "dev", "..", "dev-data") };
  expect(dataRoot(root, "linux", undefined, own)).toBe(join(root, "dev-data"));
  expect(dataRoot(root, "win32", undefined, own)).toBe(join(root, "dev-data"));
  expect(defaultDataFile("auth-token", root, "linux", undefined, own)).toBe(
    join(root, "dev-data", "auth-token"),
  );
  expect(dataRoot(root, "linux", undefined, { HERDR_WORLD_DATA_DIR: "" })).toBe(
    join(root, ".config", "herdr-world"),
  );
});

test("tests never default to the user's data folder, nor do their children", async () => {
  const own = join(tmpdir(), "herdr-world-data");
  expect(dataRoot()).toBe(own);
  const script = `import { dataRoot } from ${JSON.stringify(join(import.meta.dir, "data-paths.ts"))}; console.log(dataRoot());`;
  // Spawned without an explicit environment, as a test may start a server.
  const sync = Bun.spawnSync([process.execPath, "-e", script]);
  expect(sync.stdout.toString().trim()).toBe(own);
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", script],
    stdout: "pipe",
  });
  expect((await new Response(child.stdout).text()).trim()).toBe(own);
});

test("existing settings from another product are left untouched and unread", () => {
  const root = home();
  const upstream = join(root, ".config", "roamgate", "settings.json");
  const legacy = join(root, ".config", "herdr-gui", "settings.json");
  write(upstream, '{"source":"upstream"}');
  write(legacy, '{"source":"legacy"}');

  const target = defaultDataFile("settings.json", root, "linux", undefined, {});
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

test("replacement overwrites atomically with private permissions", () => {
  const root = home();
  const target = join(root, "herdr-world", "herdr-world.env");
  publishDataFile(target, "first", 0o644);
  replaceDataFile(target, "second");
  expect(readFileSync(target, "utf8")).toBe("second");
  expect(readdirSync(dirname(target))).toEqual(["herdr-world.env"]);
  if (process.platform !== "win32")
    expect(statSync(target).mode & 0o777).toBe(0o600);
  const link = join(root, "herdr-world", "link.env");
  symlinkSync(target, link);
  expect(() => replaceDataFile(link, "third")).toThrow("symlink");
  expect(readFileSync(target, "utf8")).toBe("second");
});

test("follows a symlinked user config root but not World's own links", async () => {
  if (process.platform === "win32") return;
  const root = home();
  const dotfiles = join(root, "dotfiles", "config");
  mkdirSync(dotfiles, { recursive: true });
  symlinkSync(dotfiles, join(root, ".config"));
  const script = `
    import { defaultAuthTokenPath, loadOrCreateAuthToken } from ${JSON.stringify(join(import.meta.dir, "auth-token.ts"))};
    import { defaultDataFile } from ${JSON.stringify(join(import.meta.dir, "data-paths.ts"))};
    console.log(loadOrCreateAuthToken(defaultAuthTokenPath()));
    defaultDataFile("settings.json");
  `;
  const run = async () => {
    const child = Bun.spawn([process.execPath, "-e", script], {
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        HERDR_WORLD_DATA_DIR: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { stdout: stdout.trim(), stderr, code: await child.exited };
  };
  const first = await run();
  expect(first.stderr).toBe("");
  expect(first.code).toBe(0);
  expect(
    readFileSync(join(dotfiles, "herdr-world", "auth-token"), "utf8"),
  ).toBe(`${first.stdout}\n`);

  rmSync(join(dotfiles, "herdr-world"), { recursive: true });
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(dotfiles, "herdr-world"));
  const linked = await run();
  expect(linked.code).not.toBe(0);
  expect(linked.stderr).toContain("data path contains a symlink");
});
