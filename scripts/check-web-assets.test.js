import { describe, expect, test } from "bun:test";
import {
  assertLazyGrammarAssets,
  assertLazyPdfAssets,
  assertNoRuntimeCode,
  DEVTOOLS_MARKER,
  devtoolsAssets,
  initialAssetFiles,
  pdfAssetFiles,
} from "./check-web-assets.mjs";
import { DEVTOOLS_MARKER as SOURCE_MARKER } from "../web/src/world/devtools/trace";

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
        name: "ConfigurationDialog",
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
    ).toThrow("ConfigurationDialog eagerly loads syntax grammar asset");
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
