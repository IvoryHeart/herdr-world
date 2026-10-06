import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type WorldBrowserEntry = "HostsFilter" | "ProductionContexts";
export type WorldBrowserBundle = {
  directory: string;
  assets: Map<string, Blob>;
};

// Only immutable JS/CSS is shared. Profiles, RPC state and result gates belong
// to individual cases, including when a test holds a resource response open.
export async function buildWorldBrowserBundle(
  entry: WorldBrowserEntry,
  root: string,
): Promise<WorldBrowserBundle> {
  const directory = join(root, entry);
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", `${entry}.browser.tsx`)],
    outdir: directory,
    target: "browser",
    plugins: [
      {
        name: "world-raw-svg",
        setup(builder) {
          builder.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
            path: Bun.resolveSync(
              args.path.slice(0, -4),
              dirname(args.importer),
            ),
            namespace: "raw-svg",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "raw-svg" },
            async (args) => ({
              contents: `export default ${JSON.stringify(await Bun.file(args.path).text())}`,
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  const assets = new Map<string, Blob>();
  for (const output of build.outputs) {
    // Bun can already have written an output to this path. Rewriting a
    // file-backed BuildArtifact onto itself truncates it before it is read.
    if (!(await Bun.file(output.path).exists()))
      await Bun.write(output.path, output);
    assets.set(`/${basename(output.path)}`, output);
  }
  await Bun.write(
    join(directory, "index.html"),
    `<link rel="stylesheet" href="/${entry}.browser.css"><script type="module" src="/${entry}.browser.js"></script>`,
  );
  return { directory, assets };
}

export async function readWorldBrowserBundle(
  entry: WorldBrowserEntry,
  root: string,
): Promise<WorldBrowserBundle> {
  const directory = join(root, entry);
  const assets = new Map<string, Blob>();
  for (const filename of await readdir(directory)) {
    assets.set(`/${filename}`, Bun.file(join(directory, filename)));
  }
  return { directory, assets };
}
