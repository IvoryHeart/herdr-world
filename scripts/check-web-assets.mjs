import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const publicRoot = fileURLToPath(new URL("../server/public/", import.meta.url));
/** Validate the reviewed whole-bundle policy, including a short reason history. */
export function parseBundleBudget(text) {
  const value = JSON.parse(text);
  if (
    !value ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes <= 0 ||
    !Number.isSafeInteger(value.files) ||
    value.files <= 0 ||
    !Array.isArray(value.history) ||
    !value.history.length ||
    value.history.some((reason) => typeof reason !== "string" || !reason.trim())
  )
    throw new Error(
      "scripts/web-asset-budget.json needs positive integer bytes/files and a nonempty reason history",
    );
  return { bytes: value.bytes, files: value.files };
}

/** Whole-bundle budgets, also projected onto current main for open PRs. */
export const BUNDLE_BUDGET = parseBundleBudget(
  await readFile(new URL("./web-asset-budget.json", import.meta.url), "utf8"),
);

export const BUDGET_REQUEST =
  "Request a separate owner-approved PR changing only scripts/web-asset-budget.json, with bytes/files and a short history reason. Feature PRs must not edit the budget or scripts/check-web-assets.mjs.";

/** Exact minimum policy change; equality passes and reductions need no raise. */
export function budgetRaiseRequest(size, budget = BUNDLE_BUDGET) {
  const raises = ["bytes", "files"]
    .filter((key) => size[key] > budget[key])
    .map(
      (key) =>
        `${key}: ${budget[key]} -> ${size[key]} (+${size[key] - budget[key]})`,
    );
  if (raises.length)
    return `Web asset budget exceeded: ${raises.join("; ")}. ${BUDGET_REQUEST}`;
}
// Help pictures (#1025, web/public/help/) are generated per help entry at two
// sizes and two themes, and load only when a help card is shown. They have
// their own budget so that adding help never competes with code for bytes:
// 50 files and 1.0 MiB for 13 entries on 2026-11-20.
export const HELP_PICTURE_DIRECTORY = "help";
const maxHelpPictureFiles = 240;
const maxHelpPictureBytes = 5 * 1024 * 1024;
const maxInitialJsBytes = 660 * 1024;
const maxInitialJsGzipBytes = 202 * 1024;
const maxInitialCssBytes = 196 * 1024;

/** Follow eager imports only, from app entries or explicitly selected features. */
export function initialAssetFiles(
  manifest,
  entries = Object.keys(manifest).filter((key) => manifest[key].isEntry),
) {
  if (!entries.length) throw new Error("Vite manifest has no entry points");
  const visited = new Set();
  const files = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing Vite manifest chunk: ${key}`);
    visited.add(key);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  for (const entry of entries) visit(entry);
  return [...files];
}

/**
 * World's development tools (web/src/world/devtools/) must not ship: release
 * builds compile them out, and their marker string must appear in no asset.
 * A deliberate HERDR_WORLD_BUILD_DEVTOOLS=1 build is exempt.
 */
export const DEVTOOLS_MARKER = "herdr-world-devtools";
/**
 * A view's trace call with a literal kind (`trace.record("input", …)`): the
 * recording paths views keep outside the marked trace module, which a
 * release build drops through their DEVTOOLS guards.
 */
const TRACE_CALL = /\.record\(\s*["'`]/;
export function devtoolsAssets(files) {
  return files
    .filter(
      ({ content }) =>
        content.includes(DEVTOOLS_MARKER) || TRACE_CALL.test(content),
    )
    .map(({ name }) => name);
}

export function assertLazyGrammarAssets(manifest) {
  const grammarFiles = new Set(
    Object.entries(manifest)
      .filter(
        ([key, chunk]) =>
          chunk.name?.startsWith("syntax-") ||
          (key.includes("@shikijs") && key.includes("langs")),
      )
      .map(([, chunk]) => chunk.file),
  );
  // The World shell may embed WorkspaceInspectorHost in its Office view;
  // validate it when Vite emits a standalone feature chunk, while requiring
  // Settings, which remains lazy.
  for (const name of ["SettingsHome", "WorkspaceInspectorHost"]) {
    const entries = Object.keys(manifest).filter(
      (key) => manifest[key].name === name,
    );
    if (!entries.length) {
      if (name === "SettingsHome") {
        throw new Error(`Missing Vite feature chunk: ${name}`);
      }
      continue;
    }
    for (const file of initialAssetFiles(manifest, entries)) {
      if (grammarFiles.has(file)) {
        throw new Error(`${name} eagerly loads syntax grammar asset: ${file}`);
      }
    }
  }
}

/** The PdfPages chunk, the assets it references and every pdfjs-dist file. */
export function pdfAssetFiles(manifest) {
  const pages = Object.values(manifest).find(
    (chunk) => chunk.name === "PdfPages" && chunk.isDynamicEntry,
  );
  if (!pages) throw new Error("Missing lazy Vite feature chunk: PdfPages");
  return [
    ...new Set([
      pages.file,
      ...(pages.assets ?? []),
      ...Object.entries(manifest)
        .filter(([key]) => key.includes("/pdfjs-dist/"))
        .map(([, chunk]) => chunk.file),
    ]),
  ];
}

/**
 * PDF.js and its worker load only when a PDF is opened: no initial chunk may
 * be, or reference, one of their files.
 */
export function assertLazyPdfAssets(manifest) {
  const pdf = new Set(pdfAssetFiles(manifest));
  const initial = new Set(initialAssetFiles(manifest));
  for (const chunk of Object.values(manifest)) {
    if (!initial.has(chunk.file)) continue;
    for (const file of [chunk.file, ...(chunk.assets ?? [])])
      if (pdf.has(file))
        throw new Error(`The initial load includes PDF.js: ${file}`);
  }
}

// eval( or Function( as a call, not a property or a longer name.
const RUNTIME_CODE = /(?:^|[^\w$.])(?:eval|Function)\(/;

/** PDF content must never become code: the shipped PDF.js has no eval path. */
export function assertNoRuntimeCode(name, text) {
  if (RUNTIME_CODE.test(text))
    throw new Error(`${name} compiles code at run time (eval or Function)`);
}

/** Build-time `.br`/`.gz` variant suffixes (shared/precompressedAssets.ts). */
const PRECOMPRESSED_SUFFIXES = { ".br": "brotliBytes", ".gz": "gzipBytes" };

/**
 * Counts the bundle, leaving out the help pictures' own folder. Budgets stay
 * on what the build makes: a precompressed `.br`/`.gz` variant beside its file
 * is not a file or bytes of its own, only reported as its compressed size.
 */
export async function collectAssetStats(
  root = publicRoot,
  exclude = [HELP_PICTURE_DIRECTORY],
) {
  const directories = [root];
  let fileCount = 0;
  let totalBytes = 0;
  const compressed = { brotliBytes: 0, gzipBytes: 0 };

  while (directories.length) {
    const directory = directories.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    const names = new Set(entries.map((entry) => entry.name));
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (directory === root && exclude.includes(entry.name)) continue;
        directories.push(path);
        continue;
      }
      const metadata = await stat(path);
      const suffix = entry.name.slice(-3);
      const variant = PRECOMPRESSED_SUFFIXES[suffix];
      if (variant && names.has(entry.name.slice(0, -3))) {
        compressed[variant] += metadata.size;
        continue;
      }
      fileCount += 1;
      totalBytes += metadata.size;
    }
  }

  return { fileCount, totalBytes, ...compressed };
}

async function checkAssets() {
  const { fileCount, totalBytes, brotliBytes, gzipBytes } =
    await collectAssetStats(publicRoot);
  const help = await collectAssetStats(
    `${publicRoot}/${HELP_PICTURE_DIRECTORY}`,
    [],
  ).catch(() => ({ fileCount: 0, totalBytes: 0 }));
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(`${publicRoot}/.vite/manifest.json`, "utf8"),
    );
  } catch (cause) {
    throw new Error(
      "Cannot read the Vite manifest; run the frontend build first",
      { cause },
    );
  }
  assertLazyGrammarAssets(manifest);
  assertLazyPdfAssets(manifest);
  for (const file of pdfAssetFiles(manifest))
    if (/\.m?js$/.test(file))
      assertNoRuntimeCode(
        file,
        await readFile(`${publicRoot}/${file}`, "utf8"),
      );
  let jsBytes = 0;
  let jsGzipBytes = 0;
  let cssBytes = 0;
  for (const file of initialAssetFiles(manifest)) {
    const content = await readFile(`${publicRoot}/${file}`);
    if (file.endsWith(".js")) {
      jsBytes += content.length;
      jsGzipBytes += gzipSync(content).length;
    } else if (file.endsWith(".css")) {
      cssBytes += content.length;
    }
  }
  const checks = [
    ["files", fileCount, BUNDLE_BUDGET.files, 1, "files"],
    ["total", totalBytes, BUNDLE_BUDGET.bytes, 1024 * 1024, "MiB"],
    ["help pictures", help.fileCount, maxHelpPictureFiles, 1, "files"],
    ["help pictures", help.totalBytes, maxHelpPictureBytes, 1024 * 1024, "MiB"],
    ["initial JS", jsBytes, maxInitialJsBytes, 1024, "KiB"],
    ["initial JS gzip", jsGzipBytes, maxInitialJsGzipBytes, 1024, "KiB"],
    ["initial CSS", cssBytes, maxInitialCssBytes, 1024, "KiB"],
  ];
  for (const [name, actual, max, unit, suffix] of checks) {
    const exceeded = actual > max;
    const message = `web asset ${name}: ${(actual / unit).toFixed(1)}/${max / unit} ${suffix}${exceeded ? " (budget exceeded)" : ""}\n`;
    (exceeded ? process.stderr : process.stdout).write(message);
    if (exceeded) process.exitCode = 1;
  }
  const request = budgetRaiseRequest({ files: fileCount, bytes: totalBytes });
  if (request) process.stderr.write(`${request}\n`);
  if (process.env.HERDR_WORLD_BUILD_DEVTOOLS !== "1") {
    const shipped = devtoolsAssets(await textAssets(publicRoot));
    if (shipped.length) {
      process.stderr.write(
        `web assets contain World development tools: ${shipped.join(", ")}\n`,
      );
      process.exitCode = 1;
    } else process.stdout.write("web assets: no development tools\n");
  }
  // Reported after the raw budget: what browsers download from World.
  process.stdout.write(
    `web asset precompressed: brotli ${(brotliBytes / 1024 / 1024).toFixed(1)} MiB, gzip ${(gzipBytes / 1024 / 1024).toFixed(1)} MiB\n`,
  );
}

/** Every text asset (scripts, styles, pages) under the public root. */
async function textAssets(root, prefix = "") {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...(await textAssets(path, `${name}/`)));
    else if (/\.(m?js|css|html)$/.test(entry.name))
      out.push({ name, content: await readFile(path, "utf8") });
  }
  return out;
}

if (import.meta.main) await checkAssets();
