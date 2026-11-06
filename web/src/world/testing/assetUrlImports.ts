import { basename } from "node:path";
import type { BunPlugin } from "bun";

/**
 * Vite's `?url` asset imports for browser test bundles built with Bun, which
 * cannot resolve them. Each becomes the asset's file name; the file itself is
 * not served. PDF.js's worker is the one such import, and it loads only when
 * a browser without a PDF viewer opens a PDF, which these fixtures never do.
 */
export const assetUrlImports: BunPlugin = {
  name: "world-asset-url",
  setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, (args) => ({
      path: args.path,
      namespace: "asset-url",
    }));
    builder.onLoad({ filter: /.*/, namespace: "asset-url" }, (args) => ({
      contents: `export default ${JSON.stringify(`/${basename(args.path.slice(0, -"?url".length))}`)}`,
      loader: "js",
    }));
  },
};
