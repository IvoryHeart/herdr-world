import { describe, expect, test } from "bun:test";
import {
  assertLazyGrammarAssets,
  assertLazyPdfAssets,
  assertNoRuntimeCode,
  BUNDLE_BUDGET,
  budgetRaiseRequest,
  collectAssetStats,
  DEVTOOLS_MARKER,
  devtoolsAssets,
  groupedGrammarLeaks,
  initialAssetFiles,
  JS_REGEX_ENGINE_MARKER,
  jsRegexEngineFiles,
  STARTUP_SOURCES,
  startupAssetFiles,
  startupXtermFiles,
  unusedThemeChunks,
  XTERM_MARKER,
  pdfAssetFiles,
  parseBundleBudget,
} from "./check-web-assets.mjs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { DEVTOOLS_MARKER as SOURCE_MARKER } from "../web/src/world/devtools/trace";

describe("reviewed whole-bundle budget", () => {
  const policy = { bytes: 100, files: 10, history: ["Initial reviewed limit"] };

  test("loads both ceilings from the reviewed data without fixing their values in code", () => {
    const data = readFileSync(
      new URL("./web-asset-budget.json", import.meta.url),
      "utf8",
    );
    expect(parseBundleBudget(data)).toEqual(BUNDLE_BUDGET);
    const { bytes, files } = JSON.parse(data);
    expect(BUNDLE_BUDGET).toEqual({ bytes, files });
  });

  test("accepts lower ceilings and requires valid counts and reason history", () => {
    expect(parseBundleBudget(JSON.stringify(policy))).toEqual({
      bytes: 100,
      files: 10,
    });
    for (const invalid of [
      { ...policy, bytes: 0 },
      { ...policy, bytes: 1.5 },
      { ...policy, files: -1 },
      { ...policy, files: "10" },
      { ...policy, history: [] },
      { ...policy, history: [" "] },
      { ...policy, history: undefined },
    ])
      expect(() => parseBundleBudget(JSON.stringify(invalid))).toThrow(
        "web-asset-budget.json",
      );
  });

  test("reports the exact raise and requests a separate owner-approved data PR", () => {
    const request = budgetRaiseRequest({ bytes: 105, files: 12 }, policy);
    expect(request).toContain("bytes: 100 -> 105 (+5)");
    expect(request).toContain("files: 10 -> 12 (+2)");
    expect(request).toContain("separate owner-approved PR");
    expect(request).toContain("scripts/web-asset-budget.json");
    expect(request).toContain("history");
    expect(
      budgetRaiseRequest({ bytes: 100, files: 10 }, policy),
    ).toBeUndefined();
    expect(budgetRaiseRequest({ bytes: 101, files: 9 }, policy)).not.toContain(
      "files:",
    );
  });
});

describe("release web assets carry no development tools", () => {
  test("an asset holding the devtools marker is named, others pass", () => {
    expect(SOURCE_MARKER).toBe(DEVTOOLS_MARKER);
    expect(
      devtoolsAssets([
        {
          name: "assets/BoardView.js",
          content: `x(${JSON.stringify(DEVTOOLS_MARKER)})`,
        },
        { name: "assets/TownView.js", content: "town()" },
      ]),
    ).toEqual(["assets/BoardView.js"]);
  });

  test("a view's trace call outside the trace module is named too (review)", () => {
    expect(
      devtoolsAssets([
        {
          name: "assets/TownView.js",
          content: "e.type!==`move`&&i.record(`input`,e)",
        },
        { name: "assets/Quoted.js", content: 'k.record("select",{key:e})' },
        // A method of that name called without a literal kind is not one.
        { name: "assets/Other.js", content: "store.record(entry)" },
      ]),
    ).toEqual(["assets/TownView.js", "assets/Quoted.js"]);
  });
});

describe("initial web asset budget", () => {
  test("counts transitive eager JS/CSS once, without charging lazy features", () => {
    expect(
      initialAssetFiles({
        "index.html": {
          isEntry: true,
          file: "app.js",
          imports: ["shared", "other"],
          css: ["app.css"],
          dynamicImports: ["preview"],
        },
        shared: { file: "shared.js", imports: ["other"], css: ["shared.css"] },
        other: { file: "other.js", imports: ["shared"], css: ["shared.css"] },
        preview: {
          isDynamicEntry: true,
          file: "preview.js",
          css: ["preview.css"],
        },
      }).sort(),
    ).toEqual(["app.css", "app.js", "other.js", "shared.css", "shared.js"]);
  });

  test("keeps grammar groups out of unrelated feature dependency graphs", () => {
    const manifest = {
      settings: {
        name: "SettingsHome",
        file: "settings.js",
        imports: ["shared"],
      },
      inspector: {
        name: "WorkspaceInspectorHost",
        file: "inspector.js",
        imports: ["shared"],
      },
      shared: { file: "shared.js", dynamicImports: ["grammar"] },
      grammar: { name: "syntax-extra", file: "grammar.js" },
    };
    expect(() => assertLazyGrammarAssets(manifest)).not.toThrow();
    expect(() =>
      assertLazyGrammarAssets({
        ...manifest,
        shared: { file: "shared.js", imports: ["grammar"] },
      }),
    ).toThrow("SettingsHome eagerly loads syntax grammar asset");
    expect(() =>
      assertLazyGrammarAssets({
        ...manifest,
        inspector: { ...manifest.inspector, imports: ["grammar"] },
      }),
    ).toThrow("WorkspaceInspectorHost eagerly loads syntax grammar asset");
    expect(() => assertLazyGrammarAssets({})).toThrow(
      "Missing Vite feature chunk",
    );
  });

  test("fails closed on missing entry points or missing eager chunks", () => {
    expect(() => initialAssetFiles({})).toThrow("no entry points");
    expect(() =>
      initialAssetFiles({
        app: { isEntry: true, file: "app.js", imports: ["missing"] },
      }),
    ).toThrow("Missing Vite manifest chunk");
  });
});

describe("startup web asset budget", () => {
  const [app, town] = STARTUP_SOURCES;
  const manifest = {
    "index.html": {
      isEntry: true,
      file: "index.js",
      imports: ["_runtime.js"],
      dynamicImports: [app],
    },
    "_runtime.js": { file: "runtime.js" },
    [app]: {
      isDynamicEntry: true,
      file: "app.js",
      css: ["app.css"],
      imports: ["_runtime.js"],
      dynamicImports: [town, "src/world/CoreTerminalWatch.tsx"],
    },
    [town]: { isDynamicEntry: true, file: "town.js", imports: ["_pixi.js"] },
    "_pixi.js": { file: "pixi.js" },
    "src/world/CoreTerminalWatch.tsx": {
      isDynamicEntry: true,
      file: "watch.js",
    },
  };

  test("counts the World app and Town, which every first load fetches, but no lazy feature", () => {
    expect(STARTUP_SOURCES).toEqual([
      "src/world/WorldFoundationApp.tsx",
      "src/world/TownView.tsx",
    ]);
    expect(startupAssetFiles(manifest).sort()).toEqual([
      "app.css",
      "app.js",
      "index.js",
      "pixi.js",
      "runtime.js",
      "town.js",
    ]);
    // The entry-only count misses both.
    expect(initialAssetFiles(manifest).sort()).toEqual([
      "index.js",
      "runtime.js",
    ]);
  });

  test("fails closed when the World app or Town chunk is missing", () => {
    const withoutTown = { ...manifest };
    delete withoutTown[town];
    expect(() => startupAssetFiles(withoutTown)).toThrow(
      `Missing Vite startup chunk: ${town}`,
    );
    expect(() => startupAssetFiles({ [app]: manifest[app] })).toThrow(
      "no entry points",
    );
  });

  test("names a startup file that carries xterm", () => {
    expect(
      startupXtermFiles([
        { name: "app.js", content: `x;throw new Error("${XTERM_MARKER}.")` },
        { name: "town.js", content: "class Terminal{}" },
      ]),
    ).toEqual(["app.js"]);
  });
});

describe("unused highlighter code is not shipped", () => {
  const theme = (path) => `../node_modules/.bun/x/node_modules/${path}`;

  test("only Pierre's default dark and light diff themes are emitted", () => {
    expect(
      unusedThemeChunks({
        [theme("@pierre/theme/dist/pierre-dark.mjs")]: { file: "a.js" },
        [theme("@pierre/theme/dist/pierre-light.mjs")]: { file: "b.js" },
        "src/shiki.ts": { file: "c.js" },
      }),
    ).toEqual([]);
    expect(
      unusedThemeChunks({
        [theme("@pierre/theme/dist/pierre-dark.mjs")]: { file: "a.js" },
        [theme("@pierre/theme/dist/pierre-dark-soft.mjs")]: { file: "b.js" },
        [theme("@shikijs/themes/dist/nord.mjs")]: { file: "c.js" },
      }),
    ).toEqual([
      theme("@pierre/theme/dist/pierre-dark-soft.mjs"),
      theme("@shikijs/themes/dist/nord.mjs"),
    ]);
  });

  test("names an asset that carries Shiki's JavaScript regex engine", () => {
    expect(
      jsRegexEngineFiles([
        { name: "diff.js", content: "createJavaScriptRegexEngine" },
        { name: "worker.js", content: `"${JS_REGEX_ENGINE_MARKER} x"` },
      ]),
    ).toEqual(["worker.js"]);
  });

  test("a common grammar never fetches a grammar group", () => {
    const lang = (name) => theme(`@shikijs/langs/dist/${name}.mjs`);
    const manifest = {
      _group: { name: "syntax-extra", file: "extra.js", imports: ["_js"] },
      _js: { name: "javascript", file: "javascript.js" },
      [lang("shellscript")]: { isDynamicEntry: true, file: "sh.js" },
    };
    expect(
      groupedGrammarLeaks(manifest, ["javascript", "shellscript"]),
    ).toEqual([]);
    // A group that took in the grammar it embeds, or a grammar importing a group.
    expect(
      groupedGrammarLeaks(
        {
          ...manifest,
          [lang("shellscript")]: {
            ...manifest[lang("shellscript")],
            imports: ["_group"],
          },
        },
        ["javascript", "shellscript", "css"],
      ),
    ).toEqual(["shellscript -> extra.js", "css (no chunk of its own)"]);
  });
});

describe("PDF.js loads only when a PDF is opened", () => {
  // The shape of the production manifest: PdfPages is a lazy feature chunk of
  // the lazy file preview, and the worker is an asset only it references.
  const manifest = () => ({
    "index.html": {
      file: "assets/index.js",
      isEntry: true,
      imports: ["_shared.js"],
      dynamicImports: ["src/components/FilePreviewContent.tsx"],
    },
    "_shared.js": { file: "assets/shared.js" },
    "src/components/FilePreviewContent.tsx": {
      file: "assets/FilePreviewContent.js",
      name: "FilePreviewContent",
      isDynamicEntry: true,
      imports: ["_shared.js"],
      dynamicImports: ["src/components/PdfPages.tsx"],
    },
    "src/components/PdfPages.tsx": {
      file: "assets/PdfPages.js",
      name: "PdfPages",
      isDynamicEntry: true,
      imports: ["_shared.js"],
      css: ["assets/PdfPages.css"],
      assets: ["assets/pdf.worker.min.mjs"],
    },
    "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs": {
      file: "assets/pdf.worker.min.mjs",
    },
  });

  test("passes while PdfPages and its worker stay lazy", () => {
    expect(pdfAssetFiles(manifest())).toEqual([
      "assets/PdfPages.js",
      "assets/pdf.worker.min.mjs",
    ]);
    expect(() => assertLazyPdfAssets(manifest())).not.toThrow();
  });

  test("fails when the initial load imports PdfPages", () => {
    const eager = manifest();
    eager["index.html"].imports.push("src/components/PdfPages.tsx");
    expect(() => assertLazyPdfAssets(eager)).toThrow(
      "The initial load includes PDF.js: assets/PdfPages.js",
    );
  });

  test("fails when an initial chunk references the worker", () => {
    const eager = manifest();
    eager["_shared.js"].assets = ["assets/pdf.worker.min.mjs"];
    expect(() => assertLazyPdfAssets(eager)).toThrow(
      "The initial load includes PDF.js: assets/pdf.worker.min.mjs",
    );
  });

  test("fails when PDF.js is no longer a lazy chunk", () => {
    const merged = manifest();
    delete merged["src/components/PdfPages.tsx"];
    expect(() => assertLazyPdfAssets(merged)).toThrow(
      "Missing lazy Vite feature chunk: PdfPages",
    );
  });

  test("refuses code compiled at run time", () => {
    expect(() => assertNoRuntimeCode("a.js", "f=new Function('x')")).toThrow(
      "a.js compiles code at run time",
    );
    expect(() => assertNoRuntimeCode("a.js", "x=eval(y)")).toThrow();
    expect(() =>
      assertNoRuntimeCode("a.js", "new FunctionBasedShading(a);vm.eval(b)"),
    ).not.toThrow();
  });
});

test("help pictures count against their own budget, not the bundle's", async () => {
  const root = mkdtempSync(join(tmpdir(), "web-assets-"));
  try {
    mkdirSync(join(root, "assets"));
    mkdirSync(join(root, "help"));
    writeFileSync(join(root, "assets/app.js"), "1234");
    writeFileSync(join(root, "help/town.zoom.phone.dark.webp"), "12345678");
    expect(await collectAssetStats(root)).toEqual({
      fileCount: 1,
      totalBytes: 4,
      brotliBytes: 0,
      gzipBytes: 0,
    });
    expect(await collectAssetStats(join(root, "help"), [])).toEqual({
      fileCount: 1,
      totalBytes: 8,
      brotliBytes: 0,
      gzipBytes: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("precompressed variants are reported beside the raw budget, not in it", async () => {
  const root = mkdtempSync(join(tmpdir(), "web-assets-"));
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets/app-hash.js"), "1234567890");
    writeFileSync(join(root, "assets/app-hash.js.br"), "123");
    writeFileSync(join(root, "assets/app-hash.js.gz"), "1234");
    // A .gz or .br without its file is a file of its own, and counts.
    writeFileSync(join(root, "assets/archive.gz"), "12");
    expect(await collectAssetStats(root)).toEqual({
      fileCount: 2,
      totalBytes: 12,
      brotliBytes: 3,
      gzipBytes: 4,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
