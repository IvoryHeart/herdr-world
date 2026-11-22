import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { isPrecompressible } from "../shared/precompressedAssets";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * Write `<file>.br` (brotli, best quality) and `<file>.gz` (gzip level 9)
 * beside each compressible file in the content-hashed assets directory,
 * once at build time so serving never compresses. A variant that is not
 * smaller than its file is not written; the service then sends the file.
 */
export async function precompressAssets(assetsDir: string) {
  const names = (await readdir(assetsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isPrecompressible(entry.name))
    .map((entry) => entry.name);
  const totals = { files: names.length, raw: 0, br: 0, gzip: 0 };
  await Promise.all(
    names.map(async (name) => {
      const path = join(assetsDir, name);
      const content = await readFile(path);
      const [br, gz] = await Promise.all([
        brotli(content, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: content.length,
          },
        }),
        gzipAsync(content, { level: 9 }),
      ]);
      totals.raw += content.length;
      for (const [variant, suffix, key] of [
        [br, ".br", "br"],
        [gz, ".gz", "gzip"],
      ] as const) {
        if (variant.length >= content.length) continue;
        await writeFile(`${path}${suffix}`, variant);
        totals[key] += variant.length;
      }
    }),
  );
  return totals;
}

/** Precompresses `<outDir>/assets` after every production (and watch) build. */
// Vite's plugin shape, kept structural: Vite is a dependency of web/ only.
type BuildPlugin = {
  name: string;
  apply: "build";
  configResolved(config: {
    root: string;
    build: { outDir: string; write: boolean };
  }): void;
  closeBundle(): Promise<void>;
};

export function precompressAssetsPlugin(): BuildPlugin {
  let outDir = "";
  let write = true;
  return {
    name: "herdr-world-precompress-assets",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      // In-memory builds (tests) write nothing, so there is nothing to compress.
      write = config.build.write;
    },
    async closeBundle() {
      if (!write) return;
      await precompressAssets(join(outDir, "assets")).catch((error) => {
        // A build that emitted no hashed assets has nothing to compress.
        if (error?.code !== "ENOENT") throw error;
      });
    },
  };
}
