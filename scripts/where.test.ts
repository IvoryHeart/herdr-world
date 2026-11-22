import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";
import {
  readCapabilities,
  findCapabilities,
  renderFeatures,
  renderFeatureSite,
} from "./where";

test("fresh owner query finds drag entry points, core move path and requirement", () => {
  const hits = [
    findCapabilities(readCapabilities(), "drag core desk").find(
      (c) => c.id === "world-surfaces/town-moves",
    )!,
  ];
  expect(hits[0]).toBeDefined();
  expect(hits[0].codePaths).toContain("web/src/world/town/TownCanvas.tsx");
  expect(hits[0].codePaths).toContain("server/src/herdr-core/town-move.ts");
  expect(hits[0].requirements).toContain("Town desk and agent moves");
  expect(hits[0].notesPath).toBe(
    "openspec/specs/world-surfaces/town-moves/notes.md",
  );
});

test("lookup searches names, Purpose, requirement names and notes without matching unrelated bodies", () => {
  const caps = readCapabilities();
  for (const query of [
    "town-moves",
    "drag",
    "replacement pane",
    "Town desk and agent moves",
  ])
    expect(
      findCapabilities(caps, query).some(
        (c) => c.id === "world-surfaces/town-moves",
      ),
    ).toBe(true);
  expect(findCapabilities(caps, "no-such-capability-xyz")).toEqual([]);
  expect(findCapabilities(caps, "")).toEqual(caps);
});

test("feature reference is computed from current specs and usage notes", () => {
  const output = renderFeatures(readCapabilities());
  expect(output).toContain("Town desk and agent moves");
  expect(output).toContain("Runtime support");
  expect(output).toContain("Generated");
  expect(output).not.toContain("**Code:**");
});

test("site reference rewrites source links including fragments and preserves local anchors", () => {
  const html = renderFeatureSite(
    "## Runtime support\n\n[contract](openspec/specs/example/spec.md#requirement-example) [here](#runtime-support)\n",
  );
  expect(html).toContain('id="runtime-support"');
  expect(html).toContain(
    'href="https://github.com/IvoryHeart/herdr-world/blob/main/openspec/specs/example/spec.md#requirement-example"',
  );
  expect(html).toContain('href="#runtime-support"');
});

test("lookup reads new notes immediately and supports a new capability's delta and JSON CLI", () => {
  const root = mkdtempSync(join(tmpdir(), "feature-map-"));
  try {
    mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
    mkdirSync(join(root, "openspec/changes/new/specs/example"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "openspec/changes/new/specs/example/spec.md"),
      "## ADDED Requirements\n\n### Requirement: Example behavior\nBody-only-secret\n",
    );
    writeFileSync(
      join(root, "openspec/specs/example/notes.md"),
      "**Code:**\n\n- `server/src/example.ts`\n",
    );
    expect(
      findCapabilities(readCapabilities(root), "Body-only-secret"),
    ).toEqual([]);
    writeFileSync(
      join(root, "openspec/specs/example/notes.md"),
      "**Code:**\n\n- `server/src/example.ts`\n\n**Pitfalls:**\n\n- Freshly changed marker\n",
    );
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dir, "where.ts"), "freshly", "--json"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)[0]).toMatchObject({
      id: "example",
      specPath: "openspec/changes/new/specs/example/spec.md",
      codePaths: ["server/src/example.ts"],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
