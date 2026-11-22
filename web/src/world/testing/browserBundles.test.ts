import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildWorldBrowserBundle,
  discoverWorldBrowserEntries,
  readWorldBrowserBundle,
} from "./browserBundles";

test("bundle entries come from top-level browser TSX files", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-entry-discovery-"));
  try {
    for (const name of [
      "Zebra.browser.tsx",
      "NewSuite.browser.tsx",
      "Unit.test.ts",
      "Ignored.browser.ts",
      "nested/Nested.browser.tsx",
    ])
      await Bun.write(join(root, name), "export {};\n");
    expect(await discoverWorldBrowserEntries(root)).toEqual([
      "NewSuite",
      "Zebra",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  "HostsFilter",
  "ProductionContexts",
  "AnswerDeliveries",
  "SharedViewCreation",
  "town/TownCanvas",
] as const)(
  "shared %s assets survive writing and can be served by another test file",
  async (entry) => {
    const root = await mkdtemp(join(tmpdir(), "world-bundle-regression-"));
    try {
      const built = await buildWorldBrowserBundle(entry, root);
      const loaded = await readWorldBrowserBundle(entry, root);
      for (const extension of ["js", "css"]) {
        const path = `/${basename(entry)}.browser.${extension}`;
        const original = await built.assets.get(path)!.arrayBuffer();
        const restored = await loaded.assets.get(path)!.arrayBuffer();
        expect(original.byteLength).toBeGreaterThan(100);
        expect(Bun.hash(original)).toBe(Bun.hash(restored));
      }
      expect(await loaded.assets.get("/index.html")!.text()).toContain(
        `/${basename(entry)}.browser.js`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each(["../TownCanvas", "/TownCanvas", "town/../../TownCanvas"])(
  "bundle paths reject traversal in %s",
  async (entry) => {
    await expect(buildWorldBrowserBundle(entry, "unused")).rejects.toThrow(
      "Unknown World browser entry",
    );
    await expect(readWorldBrowserBundle(entry, "unused")).rejects.toThrow(
      "Unknown World browser entry",
    );
  },
);
