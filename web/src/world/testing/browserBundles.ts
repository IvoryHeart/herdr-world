import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { assetUrlImports, rawSvgImports } from "./assetUrlImports";

// Entry names are checked against the source files at runtime.
export type WorldBrowserEntry = string;

export async function discoverWorldBrowserEntries(
  directory = join(import.meta.dir, ".."),
): Promise<WorldBrowserEntry[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((file) => file.isFile() && file.name.endsWith(".browser.tsx"))
    .map((file) => file.name.slice(0, -".browser.tsx".length))
    .sort();
}

async function entryDirectory(
  entry: WorldBrowserEntry,
  root: string,
  source?: string,
) {
  if (!(await discoverWorldBrowserEntries(source)).includes(entry))
    throw new Error(`Unknown World browser entry: ${entry}`);
  return join(root, entry);
}

export type WorldBrowserBundle = {
  directory: string;
  assets: Map<string, Blob>;
};

// Only immutable JS/CSS is shared. Profiles, RPC state and result gates belong
// to individual cases, including when a test holds a resource response open.
export async function buildWorldBrowserBundle(
  entry: WorldBrowserEntry,
  root: string,
  source = join(import.meta.dir, ".."),
): Promise<WorldBrowserBundle> {
  const directory = await entryDirectory(entry, root, source);
  const build = await Bun.build({
    entrypoints: [join(source, `${entry}.browser.tsx`)],
    outdir: directory,
    target: "browser",
    plugins: [assetUrlImports, rawSvgImports],
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
  const directory = await entryDirectory(entry, root);
  const assets = new Map<string, Blob>();
  for (const filename of await readdir(directory)) {
    assets.set(`/${filename}`, Bun.file(join(directory, filename)));
  }
  return { directory, assets };
}
