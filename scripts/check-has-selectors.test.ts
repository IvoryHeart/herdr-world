import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED, broadHasCompounds, problems } from "./check-has-selectors";

test("flags :has() on the page or World shell", () => {
  expect(
    broadHasCompounds(`
      .app:has(.terminal-composer-input:focus) .topbar > * { display: none; }
      body:has(> .world-view-search-overlay) .world-search-results p { color: red; }
      :root:has(.x) .y { color: red; }
      .world-foundation-shell[data-view="town"]:has(.z) { color: red; }
      .world-view-layout:has(> .needs-you-tab) > .world-view-stage { color: red; }
      :has(.anything) { color: red; }
    `),
  ).toEqual([
    ".app:has(.terminal-composer-input:focus)",
    "body:has(> .world-view-search-overlay)",
    ":root:has(.x)",
    '.world-foundation-shell[data-view="town"]:has(.z)',
    ".world-view-layout:has(> .needs-you-tab)",
    ":has(.anything)",
  ]);
});

test("resolves nesting and at-rules", () => {
  expect(
    broadHasCompounds(`
      :where(html[data-layout="mobile"]) {
        /* a comment { with braces } */
        --x: "a { b";
        &:has(.world-back-to-view) {
          .topbar { display: none; }
        }
      }
      @media (max-width: 600px) {
        body:has(.sheet) .tab { visibility: hidden; }
      }
    `),
  ).toEqual([
    ':where(html[data-layout="mobile"]):has(.world-back-to-view)',
    "body:has(.sheet)",
  ]);
});

test("leaves component subjects alone", () => {
  expect(
    broadHasCompounds(`
      .terminal-shell:has(.terminal-composer) { padding: 0; }
      .app-header:has(.x), .body-text:has(.y) { color: red; }
      .town-desk-tag:has(.town-desk-badge) { gap: 2px; }
      .row:not(:has(.marker))::before { content: ""; }
      :root[data-terminal-input-focus~="composer"] .app .topbar { opacity: 0; }
    `),
  ).toEqual([]);
});

test("refuses a new broad :has() and a stale allowance", () => {
  const entry = ALLOWED[0]!;
  expect(
    problems([
      { path: entry.file, css: `${entry.has} .topbar { opacity: 1; }` },
      { path: "web/src/new.css", css: "body:has(.thing) .x { color: red; }" },
    ]).map((line) => line.split(":")[0]),
  ).toEqual(
    expect.arrayContaining([
      "web/src/new.css",
      "scripts/check-has-selectors.ts",
    ]),
  );
});

test("the web sources pass", () => {
  const root = join(import.meta.dir, "..");
  const files = [...new Bun.Glob("web/src/**/*.css").scanSync({ cwd: root })]
    .sort()
    .map((path) => ({ path, css: readFileSync(join(root, path), "utf8") }));
  expect(problems(files)).toEqual([]);
});
