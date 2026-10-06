import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWorldBrowserBundle,
  readWorldBrowserBundle,
} from "./browserBundles";

test.each(["HostsFilter", "ProductionContexts"] as const)(
  "shared %s assets survive writing and can be served by another test file",
  async (entry) => {
    const root = await mkdtemp(join(tmpdir(), "world-bundle-regression-"));
    try {
      const built = await buildWorldBrowserBundle(entry, root);
      const loaded = await readWorldBrowserBundle(entry, root);
      for (const extension of ["js", "css"]) {
        const path = `/${entry}.browser.${extension}`;
        const original = await built.assets.get(path)!.arrayBuffer();
        const restored = await loaded.assets.get(path)!.arrayBuffer();
        expect(original.byteLength).toBeGreaterThan(100);
        expect(Bun.hash(original)).toBe(Bun.hash(restored));
      }
      expect(await loaded.assets.get("/index.html")!.text()).toContain(
        `/${entry}.browser.js`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
