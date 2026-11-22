import { readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const publicRoot = fileURLToPath(new URL("../server/public/", import.meta.url));
// Town and Board are the visual views, each a lazy chunk with its own
// renderer or layout code; Ranger, commit history and the diff worker add
// bounded lazy assets. Retiring Office, Tree and Graph (and Office's character
// sprites) left 129 files and 13.0 MiB, so the budgets keep a little headroom.
// File splits (store, Chat) and lazy features add small chunks without adding
// bytes: 144 files on 2026-10-23, 24 of them under 2 KiB (re-export facades and
// shared helpers). Merging small shared chunks into one group pulled lazy code
// into the startup bundle (initial JS 313 -> 686 KiB), so the file count gets
// headroom instead; total bytes and the initial budgets are what users pay for
// and stay as they are. The always-mounted herdr-core kill confirmation
// shares ConfirmDialog with Town and Board, splitting ModalDialogs into its
// own chunk (181 files on 2026-11-11). End shell confirms the same way from
// the float shell's lazy chunk, which moves that confirmation and the float
// shell's read model into one shared chunk and its CSS (185 files, no new
// bytes, on 2026-11-17).
// The #981 Code view design study adds three standalone, on-demand static
// assets (HTML, CSS and JS), without adding to the application's eager graph.
// Account for those files explicitly; byte and startup budgets remain binding.
// New room's dialog reads each connection's recent folders, which splits the
// World runtime store into a lazy chunk of its own (190 files with #981, no new
// bytes or initial load, on 2026-11-19).
// The one Integrations screen (#1008) in Configuration shares the sources,
// usage-metrics and connection-manager modules with World's views, so they
// become their own small chunks (+3 files after removing the two retired
// dialogs, no new bytes on the initial load).
// #1035 Settings (one registry and one search) loads as two lazy
// chunks and a stylesheet; its catalog shares small stores with Town, chat and
// the command box, which split into chunks of their own (+6 files and about
// 35 KiB, with no initial load, on 2026-11-20). Retiring the Configuration
// dialog split its tabs into lazy Settings pages (Runtime, connection,
// Integrations, instance name, speech, worktree command) with their
// stylesheets: +12 files and fewer total bytes (212 files, 15.3 MiB).
const maxFileCount = 212;
// PDF.js and its worker (1.66 MiB) load only when a PDF is drawn by it, on
// browsers without a PDF viewer (Roamgate R#537). Ruling S4 raised only this
// total, from 13.25 MiB; assertLazyPdfAssets keeps them out of the initial load.
// The Integrations screen (#1008, +17 KB) fit main alone, but main
// grew under it to 13 KB of headroom; 15.3 MiB carries both, initial budgets
// unchanged (2026-11-19). The lazy #1035 Settings adds about 35 KiB
// on top of it (15.31 MiB together, so 15.4 MiB on 2026-11-20).
// The Usage screens (#1029: Budget, Runs at once, Tokens and Breakdown, with
// the testing fixture) load with Town's lazy chunk and add about 57 KiB.
// Main grew under it (Settings pages), so its delta on main projects to
// 15.41 MiB; 15.5 MiB carries both, initial budgets unchanged (2026-11-20).
// The Town harbour and warehouse (#1028) fit main alone, but main's Library
// (#1082) grew under it: 15.42 MiB together, so 15.5 MiB, initial budgets
// unchanged (2026-11-20).
// Apartments (#1011: the resident search/history dialog, its store and Town's
// apartment building) add about 18.7 KB to lazy chunks; startup budgets are
// unchanged.
// The combined Usage/harbour/Apartments merge measures 15.55 MiB; 15.6 MiB
// carries those lazy features together, with startup budgets unchanged.
// Resident avatars (#1069) share Town's sprites in lazy Apartments chunks;
// main measures 15.503 MiB within the same 15.6 MiB total (2026-11-20).
// Merging the Weather source and its published Town consumer (#1040/#1100)
// with main's Apartments and post-office work measures 16,270,139 bytes
// (15.5164 MiB): 17,211 bytes above 15.5 MiB. Account for the combined
// delivered features at 15.6 MiB; file, help-picture and startup limits stay.
// Town's quiet-agent mark (#1130: rule, hourglass and Busy sub-line, all in
// the lazy Town chunk) adds about 5 KB, still within 15.6 MiB (2026-11-21).
// Moving agents between runtimes (#1172: Move to… on Town and Board desks and
// the handoff request) adds 4,703 bytes to lazy chunks on a main that measures
// 16,354,314 bytes (3,471 below 15.6 MiB) on 2026-11-22. 15.7 MiB carries it;
// file, help-picture and startup limits stay.
// Rooms per row and one Town building per machine (#1198) add to Town's lazy
// chunk: 16,363,027 bytes (15.605 MiB) with main, so 15.7 MiB; file,
// help-picture and startup limits stay.
const maxTotalBytes = 15.7 * 1024 * 1024;
/** Whole-bundle budgets, also projected onto current main for open PRs. */
export const BUNDLE_BUDGET = { files: maxFileCount, bytes: maxTotalBytes };
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

/** Counts the bundle, leaving out the help pictures' own folder. */
export async function collectAssetStats(
  root = publicRoot,
  exclude = [HELP_PICTURE_DIRECTORY],
) {
  const directories = [root];
  let fileCount = 0;
  let totalBytes = 0;

  while (directories.length) {
    const directory = directories.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (directory === root && exclude.includes(entry.name)) continue;
        directories.push(path);
        continue;
      }
      const metadata = await stat(path);
      fileCount += 1;
      totalBytes += metadata.size;
    }
  }

  return { fileCount, totalBytes };
}

async function checkAssets() {
  const { fileCount, totalBytes } = await collectAssetStats(publicRoot);
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
    ["files", fileCount, maxFileCount, 1, "files"],
    ["total", totalBytes, maxTotalBytes, 1024 * 1024, "MiB"],
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
  if (process.env.HERDR_WORLD_BUILD_DEVTOOLS !== "1") {
    const shipped = devtoolsAssets(await textAssets(publicRoot));
    if (shipped.length) {
      process.stderr.write(
        `web assets contain World development tools: ${shipped.join(", ")}\n`,
      );
      process.exitCode = 1;
    } else process.stdout.write("web assets: no development tools\n");
  }
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
