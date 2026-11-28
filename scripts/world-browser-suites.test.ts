import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertWebBrowserInventory,
  assertWorldBrowserInventory,
  browserWorkflowIgnorePattern,
  webBrowserSuites,
  selectWorldBrowserShard,
  worldBrowserIgnorePattern,
  worldBrowserShards,
  worldBrowserSuites,
  worldLatencyTrendSuites,
  worldRuntimeSuites,
  includesBrowserSuites,
  includesSharedChromeSuites,
  discoverWorldBrowserSuites,
} from "./world-browser-suites";

test("World selections and unknown selectors take the browser slot", () => {
  const plain = "scripts/world-browser-suites.test.ts";
  expect(includesBrowserSuites([])).toBe(true);
  expect(includesBrowserSuites([worldLatencyTrendSuites[0]!])).toBe(true);
  expect(includesBrowserSuites(["./web/src/world"])).toBe(true);
  expect(includesBrowserSuites(["--timeout", "30000"])).toBe(true);
  expect(includesBrowserSuites(["ProductionContexts"])).toBe(true);
  expect(includesBrowserSuites([plain])).toBe(false);
  expect(includesBrowserSuites([plain, "-t", "name"])).toBe(false);
  expect(includesBrowserSuites([plain, "--timeout", "30000"])).toBe(false);
  expect(includesBrowserSuites([plain, "--timeout=30000"])).toBe(false);
  expect(
    includesBrowserSuites([worldLatencyTrendSuites[0]!, "-t", "name"]),
  ).toBe(true);
});

test("only selections of suites that use it start the run's shared Chrome", () => {
  expect(includesSharedChromeSuites([])).toBe(true);
  expect(includesSharedChromeSuites(["web/src/world/town"])).toBe(true);
  expect(
    includesSharedChromeSuites(["web/src/world/town/TownCanvas.test.ts"]),
  ).toBe(true);
  expect(includesSharedChromeSuites(["web/src/uiScale.test.ts"])).toBe(true);
  expect(
    includesSharedChromeSuites(["scripts/world-browser-suites.test.ts"]),
  ).toBe(false);
  // A file outside the repository's suites selects none of them.
  expect(includesSharedChromeSuites(["/nonexistent/probe.test.ts"])).toBe(
    false,
  );
  expect(includesSharedChromeSuites([], tmpdir())).toBe(false);
});

test("case shards cover the complete World browser file inventory", async () => {
  await assertWorldBrowserInventory();
  const selected = [
    ...new Set(
      worldBrowserShards.flatMap((_, index) =>
        selectWorldBrowserShard(`${index + 1}/${worldBrowserShards.length}`),
      ),
    ),
  ].sort();
  expect(selected).toEqual([...worldBrowserSuites].sort());
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

test("trend and runtime suites are ordinary sharded World suites", () => {
  for (const path of [...worldLatencyTrendSuites, ...worldRuntimeSuites])
    expect(worldBrowserSuites).toContain(path);
  for (const path of worldLatencyTrendSuites)
    expect(worldRuntimeSuites).toContain(path);
  expect(() => selectWorldBrowserShard("latency")).toThrow();
});

test("invalid shard requests fail instead of silently skipping tests", () => {
  for (const shard of [
    `0/${worldBrowserShards.length}`,
    `${worldBrowserShards.length + 1}/${worldBrowserShards.length}`,
    "1/8",
    "bad",
    "1/18/2",
  ])
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

test("World suites are discovered without timing entries; stale weights add no suites", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-inventory-"));
  try {
    for (const [path, source] of [
      ["New.browser.test.ts", "// @world-browser-suite\n"],
      ["nested/Legacy.test.tsx", 'const args = ["--headless"];\n'],
      ["Measured.test.ts", "const chrome = Bun.env.CHROME_BIN;\n"],
      [
        "Shared.test.ts",
        'import { openChromePage } from "../testing/sharedChrome";\n',
      ],
      ["Light.test.ts", "// @world-browser-suite\n"],
      ["Unit.test.ts", "export const unit = true;\n"],
      ["Ignored.browser.tsx", "// @world-browser-suite\n"],
    ])
      await Bun.write(join(root, "web/src/world", path!), source!);
    const suites = discoverWorldBrowserSuites(root);
    expect(suites).toEqual([
      "web/src/world/Light.test.ts",
      "web/src/world/Measured.test.ts",
      "web/src/world/New.browser.test.ts",
      "web/src/world/Shared.test.ts",
      "web/src/world/nested/Legacy.test.tsx",
    ]);
    await assertWorldBrowserInventory(root, suites);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository validation leaves out every suite the browser workflow runs, and nothing else", async () => {
  await assertWebBrowserInventory();
  const ignore = new Bun.Glob(browserWorkflowIgnorePattern);
  for (const path of [...worldBrowserSuites, ...webBrowserSuites])
    expect(ignore.match(path)).toBe(true);
  for (const path of [
    "web/src/world/runtimeStore.test.ts",
    "web/src/store.test.ts",
    "server/src/workspace/html-preview.test.ts",
  ])
    expect(ignore.match(path)).toBe(false);
});

test("Bun skips only the registered path, not an ordinary test with the same name elsewhere", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-exclusion-"));
  try {
    const passing =
      'import { test } from "bun:test"; test("retained", () => {});';
    const excluded =
      'import { test } from "bun:test"; test("excluded", () => { throw new Error("browser suite ran in validation"); });';
    for (const path of [
      "web/src/uiScale.test.ts",
      "server/src/workspace/html-preview.browser.test.ts",
      "web/src/world/HostsFilter.test.ts",
    ])
      await Bun.write(join(root, path), excluded);
    for (const path of [
      "web/src/components/uiScale.test.ts",
      "server/src/html-preview.browser.test.ts",
      "web/src/HostsFilter.test.ts",
    ])
      await Bun.write(join(root, path), passing);
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        `--path-ignore-patterns=${browserWorkflowIgnorePattern}`,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(stdout + stderr).toContain("3 pass");
    expect(stdout + stderr).not.toContain("browser suite ran in validation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unassigned web browser suite fails inventory validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "web-inventory-"));
  try {
    for (const path of webBrowserSuites)
      await Bun.write(join(root, path), "const chrome = Bun.env.CHROME_BIN;\n");
    await Bun.write(
      join(root, "web/src/world/Sharded.test.ts"),
      "// @world-browser-suite\n",
    );
    await assertWebBrowserInventory(root);
    await Bun.write(
      join(root, "server/src/Unassigned.test.ts"),
      'const args = ["--headless"];\n',
    );
    await expect(assertWebBrowserInventory(root)).rejects.toThrow(
      "unassigned=server/src/Unassigned.test.ts",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a run that includes a Chrome-driven suite is recognised for the browser slot", async () => {
  const { includesBrowserSuites } = await import("./world-browser-suites");
  expect(includesBrowserSuites([])).toBe(true);
  expect(includesBrowserSuites(["web/src/uiScale.test.ts"])).toBe(true);
  expect(includesBrowserSuites(["uiScale.test.ts"])).toBe(true);
  expect(includesBrowserSuites(["web/src/world"])).toBe(true);
  expect(includesBrowserSuites(["web/src/world/"])).toBe(true);
  expect(includesBrowserSuites(["scripts/check-lock.test.ts"])).toBe(false);
  expect(includesBrowserSuites(["server/src/http"])).toBe(false);
  expect(includesBrowserSuites(["./web/src/uiScale.test.ts"])).toBe(true);
  expect(
    includesBrowserSuites([join(process.cwd(), "web/src/uiScale.test.ts")]),
  ).toBe(true);
  expect(includesBrowserSuites(["./web/src/world"])).toBe(true);
  expect(includesBrowserSuites(["."])).toBe(true);
  expect(includesBrowserSuites(["uiScale"])).toBe(true);
  expect(includesBrowserSuites(["--timeout", "30000"])).toBe(true);
  expect(
    includesBrowserSuites([
      "--test-name-pattern",
      "scripts/check-lock.test.ts",
    ]),
  ).toBe(true);
  expect(includesBrowserSuites(["./scripts/check-lock.test.ts"])).toBe(false);
});
