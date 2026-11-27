import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { affected, buildGraph } from "./affected";

// A synthetic repository: a view, its browser suite, an app-wide acceptance
// suite that mounts every view, a unit test, a verification adapter and
// data files that tests read by name.
const files: Record<string, string> = {
  "web/src/world/Board.tsx": 'import { util } from "../util";\n',
  "web/src/util.ts": "export const util = 1;\n",
  "web/src/util.test.ts": 'import { util } from "./util";\n',
  "web/src/__snapshots__/util.test.ts.snap": "snapshot\n",
  "web/src/world/__snapshots__/Board.test.ts.snap": "snapshot\n",
  "web/src/__snapshots__/missing.test.ts.snap": "orphan snapshot\n",
  "scripts/town-golden.browser.test.ts": "export {};\n",
  "web/src/world/testing/town-golden/images/phone.png": "golden\n",
  "scripts/help-check.ts": "export {};\n",
  "scripts/help-check.test.ts": 'import "./help-check";\n',
  "web/public/help/world.help.phone.light.webp": "picture\n",
  "web/src/help/pictures.json": "{}\n",
  "web/src/world/Board.browser.tsx": 'import "./Board";\n',
  "web/src/world/Board.test.ts":
    'const entry = join(import.meta.dir, "Board.browser.tsx");\n',
  "web/src/world/App.tsx": 'import "./Board";\nimport "./Town";\n',
  "web/src/world/App.browser.tsx": 'import "./App";\n',
  "web/src/world/testing/bundles.ts":
    'export type Entry = "App" | "Board";\nexport const build = (e: Entry) => e;\n',
  "web/src/world/App.test.ts":
    'import { build } from "./testing/bundles";\nbuild("App");\n',
  "quint/adapter.ts":
    'import "../web/src/world/Town";\nimport "../server/src/model";\n',
  "server/src/model.ts": "export const model = 1;\n",
  "server/src/index.ts": "export {};\n",
  "web/src/index.ts": "export {};\n",
  "server/src/http/auth-process.test.ts":
    'Bun.spawn([process.execPath, "server/src/index.ts"]);\n',
  "server/package.json": "{}\n",
  "web/package.json": "{}\n",
  "scripts/package.test.ts": 'readFileSync("server/package.json");\n',
  "web/src/world/town/TownCanvas.browser.tsx": "export {};\n",
  "web/src/world/TownCanvas.test.ts": 'build("town/TownCanvas");\n',
  "scripts/orphan.ts": "export const value = 1;\n",
  "scripts/data.test.ts": 'readFileSync("fixtures/expected.json");\n',
  "fixtures/expected.json": "{}\n",
  "web/src/links.browser.tsx": 'import "./world/Town";\n',
  "web/src/uiScale.test.ts": 'const cases = [[390, "links"]];\n',
  "web/src/world/world.css": '@import "./world-responsive.css";\n',
  "web/src/world/world-responsive.css": "a {}\n",
  "web/src/world/Town.tsx": 'import "./world.css";\nexport {};\n',
  "web/src/world/release.ts": "export {};\n",
  "web/vite.config.ts":
    'alias: new URL("./src/world/release.ts", import.meta.url);\n',
  "scripts/release.test.ts": 'readFileSync("CHANGELOG.md");\nread("ci.yml");\n',
  ".github/workflows/ci.yml": "on: push\n",
  "CHANGELOG.md": "# Changes\n",
  "docs/guide.md": "# Guide\n",
  "herdr-plugin.toml": "name = 'x'\n",
  "site/index.html": "<html></html>\n",
  "web/index.html": "<html></html>\n",
};
const root = mkdtempSync(join(tmpdir(), "affected-"));
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
afterAll(() => rmSync(root, { recursive: true, force: true }));
const graph = buildGraph(root, Object.keys(files));
const suites = ["web/src/world/Board.test.ts", "web/src/world/App.test.ts"];
const run = (changed: string[], owns?: (path: string) => boolean) =>
  affected(graph, changed, suites, owns);

describe("scoped pre-push selection", () => {
  test("external snapshots select their exact unit or browser owner", () => {
    expect(run(["web/src/__snapshots__/util.test.ts.snap"])).toEqual({
      full: false,
      unit: ["web/src/util.test.ts"],
      browser: [],
      verification: false,
    });
    expect(run(["web/src/world/__snapshots__/Board.test.ts.snap"])).toEqual({
      full: false,
      unit: [],
      browser: ["web/src/world/Board.test.ts"],
      verification: false,
    });
    expect(run(["web/src/__snapshots__/missing.test.ts.snap"])).toMatchObject({
      full: true,
    });
  });

  test("golden images stay with their advisory comparison; help pictures use the static checker", () => {
    expect(run(["web/src/world/testing/town-golden/images/phone.png"])).toEqual(
      {
        full: false,
        unit: [],
        browser: [],
        verification: false,
      },
    );
    for (const path of [
      "web/public/help/world.help.phone.light.webp",
      "web/src/help/pictures.json",
    ])
      expect(run([path])).toEqual({
        full: false,
        unit: ["scripts/help-check.test.ts"],
        browser: [],
        verification: false,
      });
    expect(
      run([
        "web/src/world/testing/town-golden/images/phone.png",
        "scripts/orphan.ts",
      ]),
    ).toMatchObject({ full: true });
  });

  test("removed snapshots keep their live consumer and missing asset authorities fail closed", () => {
    const snapshot = "web/src/__snapshots__/util.test.ts.snap";
    const after = buildGraph(
      root,
      Object.keys(files).filter((path) => path !== snapshot),
      [snapshot],
    );
    expect(affected(after, [snapshot], suites)).toMatchObject({
      full: false,
      unit: ["web/src/util.test.ts"],
    });
    for (const [asset, owner] of [
      ["web/public/help/world.help.phone.light.webp", "scripts/help-check.ts"],
      [
        "web/src/world/testing/town-golden/images/phone.png",
        "scripts/town-golden.browser.test.ts",
      ],
    ]) {
      const missing = buildGraph(
        root,
        Object.keys(files).filter((path) => path !== owner),
        [owner!],
      );
      expect(affected(missing, [asset!], suites)).toMatchObject({ full: true });
    }
  });

  test("a view change runs the suites nearest to it, not app-wide acceptance", () => {
    expect(run(["web/src/world/Board.tsx"])).toEqual({
      full: false,
      unit: [],
      browser: ["web/src/world/Board.test.ts"],
      verification: false,
    });
  });

  test("a shared helper runs every unit test that reaches it", () => {
    const result = run(["web/src/util.ts"]);
    expect(result.full).toBe(false);
    if (result.full) return;
    expect(result.unit).toEqual(["web/src/util.test.ts"]);
    // Board's suite is nearer than the app-wide one.
    expect(result.browser).toEqual(["web/src/world/Board.test.ts"]);
  });

  test("a file only app-wide acceptance covers runs that suite", () => {
    const result = run(["web/src/world/App.tsx"]);
    expect(result.full ? [] : result.browser).toEqual([
      "web/src/world/App.test.ts",
    ]);
  });

  test("a bundle named only in a type is not a use of it", () => {
    // bundles.ts lists "Board" in a type; App.test.ts builds only "App".
    const result = run(["web/src/world/Board.browser.tsx"]);
    expect(result.full ? [] : result.browser).toEqual([
      "web/src/world/Board.test.ts",
    ]);
  });

  test("verification runs for its adapters' code and contract owners", () => {
    const town = run(["web/src/world/Town.tsx"]);
    expect(town.full ? null : town.verification).toBe(false);
    const owned = run(["web/src/world/Town.tsx"], (path) =>
      path.startsWith("web/src/world/Town"),
    );
    expect(owned.full ? null : owned.verification).toBe(true);
    const model = run(["quint/adapter.ts"]);
    expect(model.full ? null : model.verification).toBe(true);
  });

  test("data files run the tests that read them by name", () => {
    // Pipeline policy can change which checks run, so it needs the full gate.
    expect(run([".github/workflows/ci.yml"])).toMatchObject({ full: true });
    expect(run(["CHANGELOG.md"])).toMatchObject({
      unit: ["scripts/release.test.ts"],
    });
  });

  test("a shared base name is not a reference to every file with it", () => {
    // "index.html" names two files; no test names either by path.
    expect(run(["docs/guide.md", "site/index.html"])).toMatchObject({
      full: true,
    });
  });

  test("spawned repo-relative paths keep their edges despite duplicate basenames", () => {
    expect(graph.deps.get("server/src/http/auth-process.test.ts")).toEqual(
      new Set(["server/src/index.ts"]),
    );
    expect(run(["server/src/index.ts"])).toMatchObject({
      full: false,
      unit: ["server/src/http/auth-process.test.ts"],
    });
    expect(graph.deps.get("scripts/package.test.ts")).toEqual(
      new Set(["server/package.json"]),
    );
    expect(run(["web/src/index.ts"])).toMatchObject({ full: true });
  });

  test("extension-less slash names still resolve browser fixtures", () => {
    expect(run(["web/src/world/town/TownCanvas.browser.tsx"])).toMatchObject({
      full: false,
      unit: ["web/src/world/TownCanvas.test.ts"],
    });
  });

  test("code no check reaches runs the full gate (review)", () => {
    expect(run(["scripts/orphan.ts"])).toMatchObject({ full: true });
    // A verification change elsewhere in the push does not cover it.
    expect(run(["scripts/orphan.ts", "quint/adapter.ts"])).toMatchObject({
      full: true,
    });
    // Code only verification's adapters reach is covered by verification.
    expect(run(["server/src/model.ts"])).toEqual({
      full: false,
      unit: [],
      browser: [],
      verification: true,
    });
  });

  test("a deleted file runs the tests that still name or import it (review)", () => {
    const tracked = Object.keys(files).filter(
      (path) => path !== "fixtures/expected.json" && path !== "web/src/util.ts",
    );
    const after = buildGraph(root, tracked, [
      "fixtures/expected.json",
      "web/src/util.ts",
    ]);
    expect(affected(after, ["fixtures/expected.json"], suites)).toMatchObject({
      full: false,
      unit: ["scripts/data.test.ts"],
    });
    expect(affected(after, ["web/src/util.ts"], suites)).toMatchObject({
      full: false,
      unit: ["web/src/util.test.ts"],
      browser: ["web/src/world/Board.test.ts"],
    });
    // Deleting a file nothing refers to any more needs no test.
    const orphanGone = buildGraph(
      root,
      Object.keys(files).filter((path) => path !== "scripts/orphan.ts"),
      ["scripts/orphan.ts"],
    );
    expect(affected(orphanGone, ["scripts/orphan.ts"], suites)).toMatchObject({
      full: false,
      unit: [],
    });
  });

  test("fixtures by lower-case name, CSS imports and build aliases count", () => {
    expect(run(["web/src/links.browser.tsx"])).toMatchObject({
      unit: ["web/src/uiScale.test.ts"],
    });
    // world-responsive.css ← world.css ← Town ← App ← App.test.
    expect(run(["web/src/world/world-responsive.css"])).toMatchObject({
      full: false,
      browser: ["web/src/world/App.test.ts"],
    });
    // Reached only by the build's release alias, which always runs.
    expect(run(["web/src/world/release.ts"])).toEqual({
      full: false,
      unit: [],
      browser: [],
      verification: false,
    });
  });

  test("inert text runs nothing; unknown files and the toolchain run all", () => {
    expect(run(["docs/guide.md"])).toEqual({
      full: false,
      unit: [],
      browser: [],
      verification: false,
    });
    expect(run(["herdr-plugin.toml"])).toMatchObject({ full: true });
    expect(run(["bun.lock"])).toMatchObject({ full: true });
    expect(run(["web/vite.config.ts"])).toMatchObject({ full: true });
    expect(run(["scripts/affected.ts"])).toMatchObject({ full: true });
  });
});
