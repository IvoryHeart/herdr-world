import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHROME, TEST } from "./affected";
import { worldBrowserSuites } from "./world-browser-suites";

/** Every tracked test file. */
export function trackedTests(root: string) {
  const result = Bun.spawnSync(["git", "ls-files"], { cwd: root });
  return result.stdout
    .toString()
    .split("\n")
    .filter((path) => TEST.test(path));
}

/**
 * The local lanes' test files: World browser suites, other tests that start
 * Chrome (the web browser lane) and plain units.
 */
export function splitTests(root: string, tests: string[]) {
  const world = new Set(worldBrowserSuites);
  const rest = tests.filter((path) => !world.has(path));
  const chrome = rest.filter((path) =>
    CHROME.test(readFileSync(join(root, path), "utf8")),
  );
  return {
    world: tests.filter((path) => world.has(path)),
    chrome,
    unit: rest.filter((path) => !chrome.includes(path)),
  };
}
