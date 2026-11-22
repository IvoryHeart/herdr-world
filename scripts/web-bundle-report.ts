/**
 * Where the web bundle's bytes go. Builds the web app once with hidden source
 * maps into a temporary folder (server/public is left alone), then prints:
 *
 * - totals as the asset check counts them, and the help pictures apart;
 * - bytes, gzip and brotli per asset type;
 * - the largest files, each with its biggest packages or app folders;
 * - the largest packages and app folders across the whole bundle;
 * - what a first load of /town fetches (entry, World app, Town view) and what
 *   each view adds or where its code lives.
 *
 * Usage: `bun scripts/web-bundle-report.ts [--top N]`.
 * Measurements are printed, never committed; re-run after a change.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

type ManifestChunk = {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
};
export type Manifest = Record<string, ManifestChunk>;

const repoRoot = join(import.meta.dir, "..");
const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((char, index) => [char, index]));

/** Decode one source-map segment's base64 VLQ fields. */
export function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = BASE64_VALUE.get(char);
    if (digit === undefined) throw new Error(`Invalid VLQ character: ${char}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

/**
 * Generated characters per original source, from a v3 source map and the
 * generated text. Characters with no mapping count as "(unmapped)".
 */
export function attributeSourceMap(
  code: string,
  map: { sources: string[]; mappings: string },
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (key: string, length: number) => {
    if (length > 0) out.set(key, (out.get(key) ?? 0) + length);
  };
  const lines = code.split("\n");
  const mappingLines = map.mappings.split(";");
  let source = 0;
  for (let line = 0; line < lines.length; line++) {
    const length = lines[line].length + (line < lines.length - 1 ? 1 : 0);
    let column = 0;
    let owner: string | undefined;
    let start = 0;
    for (const segment of (mappingLines[line] ?? "").split(",")) {
      if (!segment) continue;
      const fields = decodeVlq(segment);
      column += fields[0];
      add(owner ?? "(unmapped)", column - start);
      start = column;
      if (fields.length >= 4) {
        source += fields[1];
        owner = map.sources[source];
      } else owner = undefined;
    }
    add(owner ?? "(unmapped)", length - start);
  }
  return out;
}

/**
 * The owning package (`name@version`) of a source path, or the app folder for
 * World's own sources (`web/src/world/town`), or the path itself.
 */
export function ownerOf(source: string): string {
  const parts = source.split("node_modules/");
  if (parts.length > 1) {
    const rest = parts[parts.length - 1].split("/");
    const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
    const store = /\.bun\/(.+?)\/$/.exec(parts[parts.length - 2] ?? "");
    const version = store ? /@([^@]+)$/.exec(store[1])?.[1] : undefined;
    return version ? `${name}@${version}` : name;
  }
  const app = /(?:^|\/)web\/src\/(.*)$/.exec(source.replace(/^(\.\.\/)+/, ""));
  if (app) {
    const folders = app[1].split("/").slice(0, -1);
    return ["web/src", ...folders.slice(0, 2)].join("/");
  }
  return source.replace(/^(\.\.\/)+/, "");
}

/** Files reached from the given manifest keys through static imports only. */
export function staticClosure(manifest: Manifest, keys: string[]): string[] {
  const seen = new Set<string>();
  const files = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing Vite manifest chunk: ${key}`);
    seen.add(key);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  };
  for (const key of keys) visit(key);
  return [...files];
}

export const keyOf = (manifest: Manifest, src: string) => {
  const key = Object.keys(manifest).find((candidate) =>
    candidate.endsWith(src),
  );
  if (!key) throw new Error(`No Vite manifest chunk for ${src}`);
  return key;
};

/**
 * The three steps of a first load of /town: the entry's static graph, the
 * World app that main.tsx always mounts, and the default Town view. Each step
 * lists only files the earlier steps did not already fetch.
 */
export function firstLoadSteps(manifest: Manifest) {
  const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
  const steps: [string, string[]][] = [
    ["entry", entries],
    ["World app", [keyOf(manifest, "src/world/WorldFoundationApp.tsx")]],
    ["Town view", [keyOf(manifest, "src/world/TownView.tsx")]],
  ];
  const fetched = new Set<string>();
  return steps.map(([name, keys]) => {
    const files = staticClosure(manifest, keys).filter(
      (file) => !fetched.has(file),
    );
    for (const file of files) fetched.add(file);
    return { name, files };
  });
}

/** Where each view's own code lives; a view with an entry adds its closure. */
const VIEWS: { name: string; sources: RegExp; entry?: string }[] = [
  {
    name: "Town",
    sources: /^web\/src\/world\/(?:town\/|Town)/,
    entry: "src/world/TownView.tsx",
  },
  {
    name: "Board",
    sources: /^web\/src\/world\/(?:board\/|Board)/,
    entry: "src/world/BoardView.tsx",
  },
  { name: "Desk", sources: /^web\/src\/world\/(?:Desk|desk)/ },
  { name: "Usage", sources: /^web\/src\/world\/usage\// },
  { name: "Shipyard", sources: /^web\/src\/world\/(?:shipyard\/|Shipyard)/ },
  { name: "Help", sources: /^web\/src\/help\// },
  {
    name: "Settings",
    sources: /^web\/src\/(?:settings\/|components\/\w*Settings)/,
    entry: "src/settings/SettingsHome.tsx",
  },
];

type Sizes = { raw: number; gzip: number; brotli: number };
const sizesOf = (content: Buffer): Sizes => ({
  raw: content.length,
  gzip: gzipSync(content, { level: 9 }).length,
  brotli: brotliCompressSync(content, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length,
});
const add = (a: Sizes, b: Sizes): Sizes => ({
  raw: a.raw + b.raw,
  gzip: a.gzip + b.gzip,
  brotli: a.brotli + b.brotli,
});
const ZERO: Sizes = { raw: 0, gzip: 0, brotli: 0 };
const kib = (bytes: number) => (bytes / 1024).toFixed(1);

async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, path)));
    else out.push(relative(root, path));
  }
  return out;
}

async function build(outDir: string) {
  const vite = Bun.spawn(
    [
      "bun",
      "x",
      "vite",
      "build",
      "--config",
      "vite.config.ts",
      "--sourcemap",
      "hidden",
      "--outDir",
      outDir,
      "--emptyOutDir",
      "--logLevel",
      "warn",
    ],
    { cwd: join(repoRoot, "web"), stdout: "inherit", stderr: "inherit" },
  );
  if ((await vite.exited) !== 0) throw new Error("vite build failed");
}

export async function report(root: string, top: number) {
  const manifest: Manifest = JSON.parse(
    await readFile(join(root, ".vite/manifest.json"), "utf8"),
  );
  const all = (await listFiles(root)).filter((file) => !file.endsWith(".map"));
  const files = new Map<string, Sizes>();
  const owners = new Map<string, Map<string, number>>();
  const sources = new Map<string, Map<string, number>>();
  for (const file of all) {
    const content = await readFile(join(root, file));
    files.set(file, sizesOf(content));
    if (!/\.m?js$/.test(file)) continue;
    const map = await readFile(join(root, `${file}.map`), "utf8").catch(
      () => undefined,
    );
    if (!map) continue;
    const text = content.toString("utf8");
    const chars = attributeSourceMap(text, JSON.parse(map));
    const scale = content.length / text.length;
    const fileDir = dirname(join(root, file));
    const bySource = new Map<string, number>();
    for (const [source, count] of chars) {
      // Repository-relative, so the report never prints a local path.
      const path =
        source === "(unmapped)"
          ? source
          : relative(repoRoot, resolve(fileDir, source));
      bySource.set(path, (bySource.get(path) ?? 0) + count * scale);
    }
    sources.set(file, bySource);
    const byOwner = new Map<string, number>();
    for (const [source, bytes] of bySource) {
      const owner = ownerOf(source);
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + bytes);
    }
    owners.set(file, byOwner);
  }

  const counted = [...files].filter(([file]) => !file.startsWith("help/"));
  const help = [...files].filter(([file]) => file.startsWith("help/"));
  const sum = (entries: [string, Sizes][]) =>
    entries.reduce((total, [, sizes]) => add(total, sizes), ZERO);
  const totals = sum(counted);
  const lines: string[] = [];
  const row = (cells: (string | number)[]) =>
    lines.push(`| ${cells.join(" | ")} |`);
  const table = (header: string[]) => {
    row(header);
    row(header.map((_, index) => (index ? "---:" : "---")));
  };

  lines.push("# Web bundle report", "");
  lines.push(
    `Counted (everything except help/): ${counted.length} files, ${totals.raw} B (${(totals.raw / 1048576).toFixed(2)} MiB); gzip ${kib(totals.gzip)} KiB, brotli ${kib(totals.brotli)} KiB.`,
  );
  const helpTotals = sum(help);
  lines.push(
    `Help pictures: ${help.length} files, ${kib(helpTotals.raw)} KiB.`,
    "",
  );

  lines.push("## By type", "");
  table(["Type", "Files", "Raw KiB", "gzip KiB", "brotli KiB"]);
  const types = new Map<string, [number, Sizes]>();
  for (const [file, sizes] of counted) {
    const type = /\.([a-z0-9]+)$/.exec(file)?.[1] ?? "(none)";
    const [count, total] = types.get(type) ?? [0, ZERO];
    types.set(type, [count + 1, add(total, sizes)]);
  }
  for (const [type, [count, sizes]] of [...types].sort(
    (a, b) => b[1][1].raw - a[1][1].raw,
  ))
    row([
      `.${type}`,
      count,
      kib(sizes.raw),
      kib(sizes.gzip),
      kib(sizes.brotli),
    ]);

  const topOwners = (byOwner: Map<string, number> | undefined, n: number) =>
    [...(byOwner ?? [])]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([owner, bytes]) => `${owner} ${kib(bytes)}`)
      .join(", ");

  lines.push("", `## Largest ${top} files`, "");
  table([
    "File",
    "Raw KiB",
    "gzip KiB",
    "brotli KiB",
    "Biggest contents (KiB)",
  ]);
  for (const [file, sizes] of counted
    .sort((a, b) => b[1].raw - a[1].raw)
    .slice(0, top))
    row([
      file,
      kib(sizes.raw),
      kib(sizes.gzip),
      kib(sizes.brotli),
      topOwners(owners.get(file), 4),
    ]);

  lines.push("", `## Largest ${top} packages and app folders (JS)`, "");
  table(["Owner", "Raw KiB", "Files"]);
  const overall = new Map<string, [number, number]>();
  for (const byOwner of owners.values())
    for (const [owner, bytes] of byOwner) {
      const [total, count] = overall.get(owner) ?? [0, 0];
      overall.set(owner, [total + bytes, count + 1]);
    }
  for (const [owner, [bytes, count]] of [...overall]
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, top))
    row([owner, kib(bytes), count]);
  const versions = new Map<string, string[]>();
  for (const owner of overall.keys()) {
    const match = /^(.+)@([^@]+)$/.exec(owner);
    if (match)
      versions.set(match[1], [...(versions.get(match[1]) ?? []), match[2]]);
  }
  const duplicates = [...versions].filter(([, list]) => list.length > 1);
  lines.push(
    "",
    `Packages shipped at more than one version: ${duplicates.length ? duplicates.map(([name, list]) => `${name} (${list.join(", ")})`).join("; ") : "none"}.`,
  );

  lines.push("", "## First load of /town", "");
  table(["Step", "Files", "Raw KiB", "gzip KiB", "brotli KiB"]);
  const steps = firstLoadSteps(manifest);
  let firstLoad = ZERO;
  for (const step of steps) {
    // Fonts load on first use of a glyph in their unicode-range, not up front.
    const sizes = step.files
      .filter((file) => !file.endsWith(".woff2"))
      .reduce((total, file) => add(total, files.get(file) ?? ZERO), ZERO);
    firstLoad = add(firstLoad, sizes);
    row([
      step.name,
      step.files.length,
      kib(sizes.raw),
      kib(sizes.gzip),
      kib(sizes.brotli),
    ]);
  }
  row([
    "total",
    steps.reduce((n, step) => n + step.files.length, 0),
    kib(firstLoad.raw),
    kib(firstLoad.gzip),
    kib(firstLoad.brotli),
  ]);

  const startup = new Set(steps.flatMap((step) => step.files));
  lines.push("", "## Views", "");
  table([
    "View",
    "Own code KiB",
    "Of it in the first load KiB",
    "Extra when opened KiB",
  ]);
  for (const view of VIEWS) {
    let own = 0;
    let inStartup = 0;
    for (const [file, bySource] of sources)
      for (const [source, bytes] of bySource)
        if (view.sources.test(source)) {
          own += bytes;
          if (startup.has(file)) inStartup += bytes;
        }
    const extra = view.entry
      ? staticClosure(manifest, [keyOf(manifest, view.entry)])
          .filter((file) => !startup.has(file))
          .reduce((total, file) => total + (files.get(file)?.raw ?? 0), 0)
      : undefined;
    row([
      view.name,
      kib(own),
      kib(inStartup),
      extra === undefined ? "—" : kib(extra),
    ]);
  }
  lines.push(
    "",
    "Town is the default view, so its chunks are in the first load. Lazy features inside any view (diffs, PDF, Mermaid, file preview, terminals) load on first use and are not counted under the view. Fonts load on the first glyph in their unicode-range and are left out of the first load.",
  );
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const topIndex = args.indexOf("--top");
  const top = topIndex >= 0 ? Number(args[topIndex + 1]) : 25;
  const outDir = await mkdtemp(join(tmpdir(), "herdr-world-bundle-"));
  try {
    await build(outDir);
    process.stdout.write(`${await report(outDir, top)}\n`);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
