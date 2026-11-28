import { expect, test } from "bun:test";
import {
  BUNDLED_DIFF_THEMES,
  onlyBundledDiffThemes,
  UNBUNDLED_THEME,
  WORLD_FOUNDATION_APP,
  worldStartupSharedChunk,
} from "./vite.config";

const plugin = onlyBundledDiffThemes();
const resolve = (source: string) =>
  (plugin.resolveId as (source: string) => string | undefined)(source);
const load = (id: string) => (plugin.load as (id: string) => unknown)(id);

test("diffs keep Pierre's default pair; every other theme resolves to one refusing module", () => {
  expect([...BUNDLED_DIFF_THEMES]).toEqual(["pierre-dark", "pierre-light"]);
  expect(resolve("@pierre/theme/pierre-dark")).toBeUndefined();
  expect(resolve("@pierre/theme/pierre-light")).toBeUndefined();
  for (const unused of [
    "@pierre/theme/pierre-dark-soft",
    "@pierre/theme/pierre-light-tritanopia",
    "@shikijs/themes/github-dark",
    "@shikijs/themes/nord",
  ])
    expect(resolve(unused)).toBe(UNBUNDLED_THEME);
  // Other modules of those packages and unrelated imports resolve normally.
  for (const other of ["@pierre/theme", "@shikijs/langs/css", "shiki"])
    expect(resolve(other)).toBeUndefined();
  expect(String(load(UNBUNDLED_THEME))).toContain("throw new Error");
  expect(load("src/shiki.ts")).toBeUndefined();
});

test("startup modules that lazy views share land in one startup chunk", () => {
  const app = WORLD_FOUNDATION_APP;
  const graph: Record<string, { importers: string[]; importedIds: string[] }> =
    {
      [app]: { importers: [], importedIds: ["/src/a.ts", "/src/b.ts"] },
      "/src/a.ts": { importers: [app], importedIds: ["/nm/node_modules/x.js"] },
      "/src/b.ts": { importers: [app, "/src/Desk.tsx"], importedIds: [] },
      "/src/Desk.tsx": { importers: [], importedIds: ["/src/b.ts"] },
      "/nm/node_modules/x.js": {
        importers: ["/src/a.ts", "/src/Desk.tsx"],
        importedIds: [],
      },
    };
  const name = worldStartupSharedChunk();
  const ctx = { getModuleInfo: (id: string) => graph[id] ?? null };
  // Shared with a lazy view: kept with startup instead of a file of its own.
  expect(name("/src/b.ts", ctx)).toBe("world-startup");
  // Only startup imports it, it is lazy-only, or a vendor group owns it.
  expect(name("/src/a.ts", ctx)).toBeNull();
  expect(name("/src/Desk.tsx", ctx)).toBeNull();
  expect(name("/nm/node_modules/x.js", ctx)).toBeNull();
});
