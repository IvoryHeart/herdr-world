import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/*
 * The Town scene model's headless boundary (town/scene/). Its whole module
 * graph stays free of frameworks, renderers, stores and clock adapters, and
 * the lint rule that guards its source files rejects each way in.
 */

const root = join(import.meta.dir, "../../../..");
const scene = "web/src/world/town/scene";

/** Browser adapters the scene must never reach, even transitively. */
const ADAPTERS = [
  "web/src/world/worldSources.ts",
  "web/src/world/town/townBrowserClock.ts",
  "web/src/world/town/townRenderer.ts",
  "web/src/world/town/pixiSystemTicker.ts",
  "web/src/world/worldFrameScheduler.ts",
  "web/src/store.ts",
  "web/src/api.ts",
];

/** The scene model's modules; each is bundled on its own. */
const ENTRIES = [
  "townScene.ts",
  "townSceneCamera.ts",
  "townInteraction.ts",
  "townSceneBake.ts",
  "townSceneActors.ts",
  "townSceneDiff.ts",
  "townHud.ts",
];

test("the scene model's module graph has no framework, renderer or adapter", async () => {
  for (const entry of ENTRIES) {
    const build = await Bun.build({
      entrypoints: [join(root, scene, entry)],
      root,
      target: "browser",
      sourcemap: "external",
    });
    expect(build.success).toBe(true);
    const map = build.outputs.find((output) => output.path.endsWith(".map"));
    const sources = (JSON.parse(await map!.text()) as { sources: string[] })
      .sources;
    const files = sources.map((source) => relative(root, join(root, source)));
    // Sanity: the source map lists the module itself.
    expect(files).toContain(`${scene}/${entry}`);
    const outside = files.filter(
      (file) =>
        file.includes("node_modules") ||
        file.endsWith(".tsx") ||
        ADAPTERS.includes(file) ||
        !(file.startsWith("shared/") || file.startsWith("web/src/world/")),
    );
    expect({ entry, outside }).toEqual({ entry, outside: [] });
  }
});

/** Each probe line must be rejected by the scene's lint rule. */
const REJECTED = [
  'import { useState } from "react";',
  'import { Application } from "pixi.js";',
  'import { townBrowserClock } from "../townBrowserClock";',
  'import { performance as perf } from "node:perf_hooks";',
  'import { useWorldSources } from "../../worldSources";',
  "export const a = Date.now();",
  "export const b = new Date();",
  "export const c = performance.now();",
  "export const d = setTimeout(() => {}, 1);",
  "export const e = requestAnimationFrame(() => {});",
  "export const f = Math.random();",
  "export const g = window.innerWidth;",
  "export const h = document.body;",
  "export const i = globalThis.performance;",
  "export const j = self.location;",
  "queueMicrotask(() => {});",
];

async function lint(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "town-scene-lint-"));
  try {
    await copyFile(join(root, ".oxlintrc.json"), join(dir, ".oxlintrc.json"));
    await mkdir(join(dir, scene), { recursive: true });
    for (const [name, text] of Object.entries(files))
      await writeFile(join(dir, scene, name), text);
    const run = Bun.spawnSync(
      [
        join(root, "node_modules/.bin/oxlint"),
        "-c",
        ".oxlintrc.json",
        "--format",
        "unix",
        scene,
      ],
      { cwd: dir },
    );
    return run.stdout.toString();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const restrictedLines = (output: string, file: string) =>
  new Set(
    output
      .split("\n")
      .filter(
        (line) => line.includes(`${file}:`) && /no-restricted-/.test(line),
      )
      .map((line) => Number(line.split(":")[1])),
  );

test("the scene lint rule rejects every way to reach a clock, the DOM or an adapter", async () => {
  const probe = REJECTED.join("\n") + "\n";
  const output = await lint({
    "probe.ts": probe,
    "probe.tsx": probe,
    "clean.ts": [
      'import { townShapeKey } from "../townLayout";',
      'import type { TownClock } from "./ports";',
      "export const at = (clock: TownClock) => clock.now();",
      "export const key = townShapeKey;",
    ].join("\n"),
  });
  const every = new Set(REJECTED.map((_, index) => index + 1));
  expect(restrictedLines(output, "probe.ts")).toEqual(every);
  expect(restrictedLines(output, "probe.tsx")).toEqual(every);
  expect(restrictedLines(output, "clean.ts")).toEqual(new Set());
});
