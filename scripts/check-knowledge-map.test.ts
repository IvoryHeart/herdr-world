import { afterEach, expect, test } from "bun:test";
import {
  assessKnowledgeMapImpact,
  changedPathsBetween,
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

test("World changes require a map update or a stated no-impact reason", () => {
  const world = ["web/src/world/graph/GraphCanvas.tsx"];
  expect(assessKnowledgeMapImpact(world, null).ok).toBe(false);
  expect(
    assessKnowledgeMapImpact([...world, "docs/knowledge-map.md"], null).ok,
  ).toBe(true);
  expect(
    assessKnowledgeMapImpact(
      world,
      "Knowledge map impact: unchanged — Graph canvas ownership and navigation stayed in the same modules.",
    ).ok,
  ).toBe(true);
  expect(
    assessKnowledgeMapImpact(
      world,
      "Knowledge map impact: unchanged — <explain why navigation did not change>",
    ).ok,
  ).toBe(false);
  expect(
    assessKnowledgeMapImpact(world, "Knowledge map impact: unchanged — n/a").ok,
  ).toBe(false);
  expect(assessKnowledgeMapImpact(["server/src/index.ts"], null).ok).toBe(true);
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
  expect(assessKnowledgeMapImpact(changed, null).ok).toBe(false);
});
