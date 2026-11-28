import { expect, test } from "bun:test";
import {
  BUNDLED_DIFF_THEMES,
  onlyBundledDiffThemes,
  UNBUNDLED_THEME,
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
