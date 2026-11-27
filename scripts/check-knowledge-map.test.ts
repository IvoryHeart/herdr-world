import { afterEach, expect, test } from "bun:test";
import {
  assessKnowledgeMapImpact,
  changedPathsBetween,
  assessSpecEdits,
} from "./check-knowledge-map";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readCapabilityNotes } from "./openspec-notes";

const temporaryRepos: string[] = [];

afterEach(() => {
  for (const root of temporaryRepos.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source ownership reads fresh capability notes before a delta is archived", () => {
  const root = mkdtempSync(join(tmpdir(), "capability-notes-"));
  temporaryRepos.push(root);
  mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
  mkdirSync(join(root, "openspec/changes/new/specs/example"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "openspec/changes/new/specs/example/spec.md"),
    "## ADDED Requirements\n\n### Requirement: New behavior\n",
  );
  const notes = join(root, "openspec/specs/example/notes.md");
  writeFileSync(
    notes,
    "**Code:**\n\n- `server/src/example.ts`\n\n**Tests:**\n\n- `server/src/unowned.test.ts`\n",
  );
  expect(readCapabilityNotes(root)[0]).toMatchObject({
    id: "example",
    specPath: "openspec/changes/new/specs/example/spec.md",
    notesPath: "openspec/specs/example/notes.md",
    codePaths: ["server/src/example.ts"],
  });
  expect(
    assessKnowledgeMapImpact(
      ["server/src/unowned.test.ts"],
      readCapabilityNotes(root),
    ).ok,
  ).toBe(false);
  writeFileSync(notes, "## Code paths\n\n- `server/src/new/`\n");
  expect(
    assessKnowledgeMapImpact(
      ["server/src/new/feature.ts"],
      readCapabilityNotes(root),
    ).ok,
  ).toBe(true);
  rmSync(join(root, "openspec/changes/new/specs/example/spec.md"));
  expect(() => readCapabilityNotes(root)).toThrow(
    "notes need a current spec or active change delta",
  );
});

test("changed sources need actual Code ownership, with no prose exemption", () => {
  const caps = [
    {
      codePaths: [
        "web/src/world/",
        "server/src/exact.ts",
        "scripts/check-*.ts",
      ],
    },
  ];
  expect(
    assessKnowledgeMapImpact(
      [
        "web/src/world/a.tsx",
        "server/src/exact.ts",
        "scripts/check-example.ts",
      ],
      caps,
    ).ok,
  ).toBe(true);
  expect(
    assessKnowledgeMapImpact(
      ["server/src/new.ts", "web/src/world-other/a.ts", "docs/a.md"],
      caps,
    ).uncovered,
  ).toEqual(["server/src/new.ts", "web/src/world-other/a.ts"]);
  expect(
    assessKnowledgeMapImpact(["docs/knowledge-map.md", "web/src/new.ts"], [])
      .ok,
  ).toBe(false);
});

test("feature contracts stay in deltas; an archive-only batch can synchronize specs", () => {
  const spec = "openspec/specs/example/spec.md";
  expect(assessSpecEdits([spec])).toHaveLength(1);
  expect(
    assessSpecEdits([
      "openspec/changes/feature/specs/example/spec.md",
      "openspec/specs/example/notes.md",
      "web/src/a.ts",
    ]),
  ).toEqual([]);
  expect(
    assessSpecEdits([
      spec,
      "openspec/changes/archive/2026-11-21-feature/tasks.md",
    ]),
  ).toEqual([]);
  expect(
    assessSpecEdits([
      spec,
      "openspec/changes/archive/example/tasks.md",
      "web/src/a.ts",
    ]),
  ).toHaveLength(1);
});

test("current specs allow only lossless shortening into one additional scenario", () => {
  const path = "openspec/specs/example/spec.md";
  const prefix =
    "# Example\n\n## Purpose\n\nA contract.\n\n## Requirements\n\n";
  const summary = "World SHALL retain its identity.";
  const detail = `Every record SHALL ${"keep its original binding ".repeat(24)}.`;
  const scenario =
    "#### Scenario: Existing\n- **WHEN** read\n- **THEN** identity is stable\n";
  const before = `${prefix}### Requirement: Identity\n\n${summary} ${detail}\n\n${scenario}`;
  const after = `${prefix}### Requirement: Identity\n\n${summary}\n\n#### Scenario: Binding details\n\n- **WHEN** World handles a record\n- **THEN** ${detail}\n\n${scenario}`;
  const assess = (old: string, next: string) =>
    assessSpecEdits([path], () => [old, next]);
  expect(assess(before, after)).toEqual([]);
  for (const changed of [
    after.replace("Every record SHALL", "Some records MAY"),
    after.replace("identity is stable", "identity may change"),
    after.replace("Requirement: Identity", "Requirement: Replacement"),
    after.replace("A contract.", "A different contract."),
    after.replace(`${summary}\n`, `${summary} ${detail}\n`),
    `${after}\n### Requirement: Extra\nWorld SHALL change.\n`,
  ])
    expect(assess(before, changed)).toHaveLength(1);
  expect(assess(before, "")).toHaveLength(1);
  expect(assessSpecEdits([path], () => undefined)).toHaveLength(1);
  expect(
    assess(before.replace(detail, "Short."), after.replace(detail, "Short.")),
  ).toHaveLength(1);
});

test("a moved source checks its destination rather than its deleted owner", () => {
  const root = mkdtempSync(join(tmpdir(), "knowledge-map-check-"));
  temporaryRepos.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic Tester");
  git("config", "user.email", "tester@example.invalid");
  mkdirSync(join(root, "web/src/world"), { recursive: true });
  writeFileSync(
    join(root, "web/src/world/view.ts"),
    "export const view = 1;\n",
  );
  git("add", ".");
  git("commit", "-qm", "Synthetic base");
  const base = git("rev-parse", "HEAD");
  mkdirSync(join(root, "web/src/shared"), { recursive: true });
  git("mv", "web/src/world/view.ts", "web/src/shared/view.ts");
  git("commit", "-qm", "Move view");
  const head = git("rev-parse", "HEAD");

  expect(changedPathsBetween(root, base, head)).toContain(
    "web/src/world/view.ts",
  );
  const changed = changedPathsBetween(root, base, head, {
    includeDeleted: false,
  });
  expect(changed).toEqual(["web/src/shared/view.ts"]);
  expect(assessKnowledgeMapImpact(changed, []).uncovered).toEqual([
    "web/src/shared/view.ts",
  ]);
  git("rm", "web/src/shared/view.ts");
  git("commit", "-qm", "Delete source and its owner");
  const deletedHead = git("rev-parse", "HEAD");
  expect(
    changedPathsBetween(root, base, deletedHead, { includeDeleted: false }),
  ).toEqual([]);
  expect(changedPathsBetween(root, base, deletedHead)).toEqual([
    "web/src/world/view.ts",
  ]);
});

test("base-only World changes do not count as pull-request changes", () => {
  const root = mkdtempSync(join(tmpdir(), "knowledge-map-check-"));
  temporaryRepos.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic Tester");
  git("config", "user.email", "tester@example.invalid");
  mkdirSync(join(root, "web/src/world"), { recursive: true });
  writeFileSync(
    join(root, "web/src/world/view.ts"),
    "export const view = 1;\n",
  );
  git("add", ".");
  git("commit", "-qm", "Shared ancestor");
  const baseBranch = git("branch", "--show-current");

  git("switch", "-qc", "feature");
  writeFileSync(join(root, "README.md"), "Feature documentation\n");
  git("add", ".");
  git("commit", "-qm", "Feature change");
  const head = git("rev-parse", "HEAD");

  git("switch", "-q", baseBranch);
  writeFileSync(
    join(root, "web/src/world/view.ts"),
    "export const view = 2;\n",
  );
  git("add", ".");
  git("commit", "-qm", "Base-only World change");
  const base = git("rev-parse", "HEAD");

  const changed = changedPathsBetween(root, base, head);
  expect(changed).toEqual(["README.md"]);
  expect(assessKnowledgeMapImpact(changed, []).ok).toBe(true);
});

test("all tracked sources have capability owners before enforcing coverage on PRs", () => {
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const capabilities = readCapabilityNotes();
  expect(assessKnowledgeMapImpact(paths, capabilities).uncovered).toEqual([]);
  expect(
    assessKnowledgeMapImpact(
      [
        "web/src/new-capability/unowned.ts",
        "server/src/new-capability/unowned.ts",
      ],
      capabilities,
    ).uncovered,
  ).toHaveLength(2);
});
