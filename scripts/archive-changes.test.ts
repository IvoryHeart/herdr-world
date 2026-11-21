import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveChanges } from "./archive-changes";

test("batch uses main dates, skips incomplete work and restores a conflict before stopping", () => {
  const root = mkdtempSync(join(tmpdir(), "archive-batch-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
    writeFileSync(join(root, "openspec/specs/example/spec.md"), "original");
    for (const [index, name] of [
      "z-first",
      "a-conflict",
      "later",
      "unfinished",
    ].entries()) {
      mkdirSync(join(root, "openspec/changes", name), { recursive: true });
      writeFileSync(
        join(root, "openspec/changes", name, "tasks.md"),
        name === "unfinished" ? "- [ ] pending" : "- [x] done",
      );
      git("add", ".");
      execFileSync("git", ["commit", "-qm", name], {
        cwd: root,
        env: {
          ...process.env,
          GIT_COMMITTER_DATE: `2026-01-0${index + 1}T00:00:00Z`,
        },
      });
    }
    const attempted: string[] = [];
    const result = archiveChanges(root, (name) => {
      attempted.push(name);
      writeFileSync(join(root, "openspec/specs/example/spec.md"), name);
      if (name === "a-conflict") throw new Error("conflicting delta");
      mkdirSync(join(root, "openspec/changes/archive"), { recursive: true });
      renameSync(
        join(root, "openspec/changes", name),
        join(root, "openspec/changes/archive", name),
      );
    });
    expect(attempted).toEqual(["z-first", "a-conflict"]);
    expect(result.stopped).toBe("a-conflict");
    expect(result.archived).toEqual(["z-first"]);
    expect(
      readFileSync(join(root, "openspec/specs/example/spec.md"), "utf8"),
    ).toBe("z-first");
    expect(existsSync(join(root, "openspec/changes/a-conflict"))).toBe(true);
    expect(archiveChanges(root, () => {}).skipped).toEqual(["unfinished"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pinned CLI archives a valid delta and stops at a real requirement conflict", () => {
  const root = mkdtempSync(join(tmpdir(), "archive-cli-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const requirement = (name: string) =>
    `### Requirement: ${name}\n\nWorld SHALL expose ${name}.\n\n#### Scenario: Available\n\n- **WHEN** requested\n- **THEN** it is available\n`;
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    mkdirSync(join(root, "openspec/specs/example"), { recursive: true });
    writeFileSync(
      join(root, "openspec/specs/example/spec.md"),
      `# Example\n\n## Purpose\n\nProvide synthetic observable behavior for the archive regression.\n\n## Requirements\n\n${requirement("Existing")}`,
    );
    for (const [name, added] of [
      ["first", "Fresh"],
      ["second", "Missing"],
    ]) {
      const change = join(root, "openspec/changes", name);
      mkdirSync(join(change, "specs/example"), { recursive: true });
      writeFileSync(
        join(change, "tasks.md"),
        "- [x] Implemented and verified\n",
      );
      writeFileSync(
        join(change, "proposal.md"),
        "## Why\n\nExercise validated archive integration.\n\n## What Changes\n\n- Add a synthetic requirement.\n\n## Impact\n\n- Affected specs: example\n",
      );
      writeFileSync(
        join(change, "specs/example/spec.md"),
        `## ${name === "second" ? "MODIFIED" : "ADDED"} Requirements\n\n${requirement(added)}`,
      );
    }
    git("add", ".");
    git("commit", "-qm", "merged changes");
    const result = archiveChanges(root);
    expect(result.archived).toEqual(["first"]);
    expect(result.stopped).toBe("second");
    expect(
      readFileSync(join(root, "openspec/specs/example/spec.md"), "utf8"),
    ).toContain("Requirement: Fresh");
    expect(existsSync(join(root, "openspec/changes/second"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("archive workflow serializes one reviewed bot branch and never publishes main", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(
      new URL("../.github/workflows/openspec-archive.yml", import.meta.url),
      "utf8",
    ),
  ) as {
    on: { push: { branches: string[] } };
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: { archive: { if: string; steps: { run?: string }[] } };
  };
  expect(workflow.on.push.branches).toEqual(["main"]);
  expect(workflow.concurrency).toEqual({
    group: "openspec-archive",
    "cancel-in-progress": false,
  });
  expect(workflow.jobs.archive.if).toBe("github.ref == 'refs/heads/main'");
  const commands = workflow.jobs.archive.steps
    .map((s) => s.run ?? "")
    .join("\n");
  expect(commands).toContain("branch=bot/openspec-archive");
  expect(commands).toContain(
    'git push --force-with-lease origin "HEAD:refs/heads/$branch"',
  );
  expect(commands).not.toMatch(
    /git push[^\n]*\bmain\b|gh pr merge|--auto|--draft/,
  );
});
