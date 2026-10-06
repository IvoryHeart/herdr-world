import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertWorldBrowserInventory,
  selectWorldBrowserShard,
  worldBrowserIgnorePattern,
  worldBrowserShards,
  worldBrowserSuites,
} from "./world-browser-suites";

test("eight shards partition the complete World browser inventory without omissions or duplicates", async () => {
  await assertWorldBrowserInventory();
  const selected = worldBrowserShards.flatMap((_, index) =>
    selectWorldBrowserShard(`${index + 1}/8`),
  );
  expect(selected).toEqual(worldBrowserSuites);
  expect(new Set(selected).size).toBe(selected.length);
  expect(selectWorldBrowserShard()).toEqual(worldBrowserSuites);
  const ignore = new Bun.Glob(worldBrowserIgnorePattern);
  for (const path of selected) expect(ignore.match(path)).toBe(true);
  for (const path of [
    "web/src/uiScale.test.ts",
    "web/src/world/runtimeStore.test.ts",
    "server/src/workspace/html-preview.browser.test.ts",
  ])
    expect(ignore.match(path)).toBe(false);
});

test("invalid shard requests fail instead of silently skipping tests", () => {
  for (const shard of ["0/8", "9/8", "1/7", "bad", "1/8/2"])
    expect(() => selectWorldBrowserShard(shard)).toThrow();
});

test("Bun excludes registered World browsers while retaining upstream and World unit tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-exclusion-"));
  try {
    const passing =
      'import { test } from "bun:test"; test("retained", () => {});';
    await Bun.write(join(root, "web/src/uiScale.test.ts"), passing);
    await Bun.write(join(root, "web/src/world/runtimeStore.test.ts"), passing);
    await Bun.write(
      join(root, "web/src/world/HostsFilter.test.ts"),
      'import { test } from "bun:test"; test("sharded separately", () => { throw new Error("World suite ran twice"); });',
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        `--path-ignore-patterns=${worldBrowserIgnorePattern}`,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(stdout + stderr).toContain("2 pass");
    expect(stdout + stderr).not.toContain("World suite ran twice");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unassigned World browser suite fails inventory validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-inventory-"));
  try {
    await mkdir(join(root, "web/src/world"), { recursive: true });
    for (const path of worldBrowserSuites)
      await Bun.write(join(root, path), "// @world-browser-suite\n");
    await assertWorldBrowserInventory(root);
    await Bun.write(
      join(root, "web/src/world/Unassigned.test.ts"),
      "// @world-browser-suite\n",
    );
    await expect(assertWorldBrowserInventory(root)).rejects.toThrow(
      "unassigned=web/src/world/Unassigned.test.ts",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
