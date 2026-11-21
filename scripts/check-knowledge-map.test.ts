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

const temporaryRepos: string[] = [];

afterEach(() => {
  for (const root of temporaryRepos.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
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

test("a file moved out of World still counts as a World change", () => {
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

  const changed = changedPathsBetween(root, base, head);
  expect(changed).toContain("web/src/world/view.ts");
  expect(assessKnowledgeMapImpact(changed, []).ok).toBe(false);
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
