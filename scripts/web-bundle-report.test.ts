import { expect, test } from "bun:test";
import {
  attributeSourceMap,
  decodeVlq,
  firstLoadSteps,
  ownerOf,
  staticClosure,
} from "./web-bundle-report";

test("decodes source-map VLQ fields, including negatives and continuations", () => {
  expect(decodeVlq("AAAA")).toEqual([0, 0, 0, 0]);
  expect(decodeVlq("CCDA")).toEqual([1, 1, -1, 0]);
  expect(decodeVlq("gB")).toEqual([16]);
});

test("attributes each generated character to its source, or to unmapped", () => {
  // Line 1: "a" from one.js, "b" and the newline from two.js. Line 2: "c"
  // precedes any segment and "d" follows a segment without a source.
  const counts = attributeSourceMap("ab\ncd", {
    sources: ["one.js", "two.js"],
    mappings: "AAAA,CCAA;C",
  });
  expect(Object.fromEntries(counts)).toEqual({
    "one.js": 1,
    "two.js": 2,
    "(unmapped)": 2,
  });
});

test("names packages with their version and World's sources by folder", () => {
  expect(
    ownerOf(
      "node_modules/.bun/@pierre+theme@2.0.0/node_modules/@pierre/theme/dist/pierre-dark.mjs",
    ),
  ).toBe("@pierre/theme@2.0.0");
  expect(
    ownerOf("node_modules/.bun/pixi.js@8.22.0/node_modules/pixi.js/lib/a.mjs"),
  ).toBe("pixi.js@8.22.0");
  expect(ownerOf("node_modules/marked/lib/marked.esm.js")).toBe("marked");
  expect(ownerOf("web/src/world/town/townPaint.ts")).toBe("web/src/world/town");
  expect(ownerOf("web/src/world/town/deep/x.ts")).toBe("web/src/world/town");
  expect(ownerOf("web/src/main.tsx")).toBe("web/src");
  expect(ownerOf("shared/assistant.ts")).toBe("shared/assistant.ts");
});

test("splits a first load of /town into entry, World app and Town, each counted once", () => {
  const manifest = {
    "index.html": {
      file: "index.js",
      isEntry: true,
      imports: ["_shared.js"],
      css: ["index.css"],
    },
    "_shared.js": { file: "shared.js" },
    "src/world/WorldFoundationApp.tsx": {
      file: "app.js",
      isDynamicEntry: true,
      imports: ["_shared.js", "_ui.js"],
    },
    "_ui.js": { file: "ui.js" },
    "src/world/TownView.tsx": {
      file: "town.js",
      isDynamicEntry: true,
      imports: ["_ui.js"],
      dynamicImports: ["src/world/BoardView.tsx"],
    },
    "src/world/BoardView.tsx": { file: "board.js", isDynamicEntry: true },
  };
  expect(firstLoadSteps(manifest)).toEqual([
    { name: "entry", files: ["index.js", "index.css", "shared.js"] },
    { name: "World app", files: ["app.js", "ui.js"] },
    { name: "Town view", files: ["town.js"] },
  ]);
  expect(staticClosure(manifest, ["src/world/BoardView.tsx"])).toEqual([
    "board.js",
  ]);
  expect(() => staticClosure(manifest, ["missing"])).toThrow("missing");
});
