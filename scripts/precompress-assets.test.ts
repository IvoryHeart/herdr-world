import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import {
  precompressAssets,
  precompressAssetsPlugin,
} from "./precompress-assets";

test("build writes brotli and gzip variants beside compressible assets only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "world-precompress-"));
  try {
    const script = "export const town = 'Town';\n".repeat(200);
    await writeFile(join(dir, "app-hash.js"), script);
    await writeFile(join(dir, "font-hash.woff2"), script);
    // Too small for compression to win: no variant, the file is served.
    await writeFile(join(dir, "tiny-hash.css"), "a{}");
    const totals = await precompressAssets(dir);
    expect((await readdir(dir)).sort()).toEqual([
      "app-hash.js",
      "app-hash.js.br",
      "app-hash.js.gz",
      "font-hash.woff2",
      "tiny-hash.css",
    ]);
    const br = await readFile(join(dir, "app-hash.js.br"));
    const gz = await readFile(join(dir, "app-hash.js.gz"));
    expect(brotliDecompressSync(br).toString()).toBe(script);
    expect(gunzipSync(gz).toString()).toBe(script);
    expect(totals).toEqual({
      files: 2,
      raw: script.length + 3,
      br: br.length,
      gzip: gz.length,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the build plugin compresses only builds that write their output", async () => {
  const root = await mkdtemp(join(tmpdir(), "world-precompress-plugin-"));
  try {
    await mkdir(join(root, "out/assets"), { recursive: true });
    await writeFile(
      join(root, "out/assets/app-hash.js"),
      "let a = 1;\n".repeat(99),
    );
    const plugin = precompressAssetsPlugin();
    // In-memory test builds share the real config and outDir: leave it alone.
    plugin.configResolved({ root, build: { outDir: "out", write: false } });
    await plugin.closeBundle();
    expect(await readdir(join(root, "out/assets"))).toEqual(["app-hash.js"]);
    plugin.configResolved({ root, build: { outDir: "out", write: true } });
    await plugin.closeBundle();
    expect((await readdir(join(root, "out/assets"))).sort()).toEqual([
      "app-hash.js",
      "app-hash.js.br",
      "app-hash.js.gz",
    ]);
    plugin.configResolved({ root, build: { outDir: "empty", write: true } });
    await plugin.closeBundle();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
