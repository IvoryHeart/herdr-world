import { afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWorldBrowserBundle,
  readWorldBrowserBundle,
  type WorldBrowserBundle,
  type WorldBrowserEntry,
} from "./browserBundles";

const bundles = new Map<WorldBrowserEntry, Promise<WorldBrowserBundle>>();
let ownedRoot: Promise<string> | undefined;

export function worldBrowserBundle(entry: WorldBrowserEntry) {
  let bundle = bundles.get(entry);
  if (!bundle) {
    const preparedRoot = Bun.env.HERDR_WORLD_TEST_ASSETS;
    if (preparedRoot) bundle = readWorldBrowserBundle(entry, preparedRoot);
    else {
      ownedRoot ??= mkdtemp(join(tmpdir(), "world-test-assets-"));
      bundle = ownedRoot.then((root) => buildWorldBrowserBundle(entry, root));
    }
    bundles.set(entry, bundle);
  }
  return bundle;
}

afterAll(async () => {
  if (ownedRoot) await rm(await ownedRoot, { recursive: true, force: true });
});
