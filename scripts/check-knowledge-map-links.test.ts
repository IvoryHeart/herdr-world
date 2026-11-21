import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkKnowledgeMapLinks } from "./check-knowledge-map-links";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(markdown: string) {
  const root = mkdtempSync(join(tmpdir(), "knowledge-links-"));
  roots.push(root);
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
  writeFileSync(join(root, "openspec/specs/example/notes.md"), markdown);
  writeFileSync(
    join(root, "FEATURES.md"),
    '# Controls, `limits` & refusals\n## Controls, `limits` & refusals\n<a id="explicit"></a>\n',
  );
  writeFileSync(join(root, "docs/a space.md"), "# Space\n");
  return root;
}

test("resolves local files, directories, encoded paths, headings and explicit anchors", () => {
  const root = fixture(
    [
      "# Map",
      "[rules](../../../FEATURES.md#controls-limits--refusals)",
      "[duplicate](../../../FEATURES.md#controls-limits--refusals-1)",
      "[anchor](../../../FEATURES.md#explicit) [directory](../../../docs/)",
      "[encoded](../../../docs/a%20space.md#space) [self](#map)",
      "[reference][rules]\n\n[rules]: ../../../FEATURES.md#explicit",
      "[external](https://example.invalid/missing#anchor) [mail](mailto:dev@example.invalid)",
      "`[example](missing.ts)`\n```md\n[example](missing.md)\n```",
    ].join("\n"),
  );
  expect(checkKnowledgeMapLinks(root)).toEqual([]);
});

test("reports missing paths and fragments, including the wrong docs-relative FEATURES path", () => {
  const root = fixture(
    [
      "[wrong root](FEATURES.md#controls)",
      "[deleted](../../../web/completion-seen.ts)",
      "[bad fragment](../../../FEATURES.md#missing)",
    ].join("\n"),
  );
  expect(checkKnowledgeMapLinks(root)).toEqual([
    "FEATURES.md#controls: missing path",
    "../../../web/completion-seen.ts: missing path",
    "../../../FEATURES.md#missing: missing fragment #missing",
  ]);
});

test("CLI passes a valid map and check:docs rejects a planted broken link", () => {
  const root = fixture("[rules](../../../FEATURES.md#explicit)\n");
  const run = () =>
    spawnSync(
      process.execPath,
      [new URL("./check-knowledge-map-links.ts", import.meta.url).pathname],
      { cwd: root, encoding: "utf8" },
    );
  expect(run().status).toBe(0);
  writeFileSync(
    join(root, "openspec/specs/example/notes.md"),
    "[planted](missing.md)\n",
  );
  const scripts = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).scripts;
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { "check:docs": scripts["check:docs"] } }),
  );
  mkdirSync(join(root, "scripts"));
  copyFileSync(
    new URL("./check-knowledge-map-links.ts", import.meta.url),
    join(root, "scripts/check-knowledge-map-links.ts"),
  );
  const broken = spawnSync(process.execPath, ["run", "check:docs"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(broken.status).toBe(1);
  expect(broken.stderr).toContain("missing.md: missing path");
});
