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
  "web/src/world/Board.browser.tsx": 'import "./Board";\n',
  "web/src/world/Board.test.ts":
    'const entry = join(import.meta.dir, "Board.browser.tsx");\n',
  "web/src/world/App.tsx": 'import "./Board";\nimport "./Town";\n',
  "web/src/world/Town.tsx": "export {};\n",
  "web/src/world/App.browser.tsx": 'import "./App";\n',
  "web/src/world/testing/bundles.ts":
    'export type Entry = "App" | "Board";\nexport const build = (e: Entry) => e;\n',
  "web/src/world/App.test.ts":
    'import { build } from "./testing/bundles";\nbuild("App");\n',
  "quint/adapter.ts": 'import "../web/src/world/Town";\n',
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
    expect(run([".github/workflows/ci.yml"])).toMatchObject({
      unit: ["scripts/release.test.ts"],
    });
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
