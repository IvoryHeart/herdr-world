import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./check-pr-body.ts", import.meta.url));
test("draft descriptions enforce the same knowledge-map and changelog rules before PR creation", () => {
  const root = mkdtempSync(join(tmpdir(), "pr-body-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Example");
    git("config", "user.email", "example@example.invalid");
    writeFileSync(join(root, "README.md"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(root, "web/src/world"), { recursive: true });
    writeFileSync(
      join(root, "web/src/world/example.ts"),
      "export const value = 1;\n",
    );
    git("add", ".");
    git("commit", "-qm", "change");
    const body = join(root, "body.md");
    const run = (text: string) => {
      writeFileSync(body, text);
      return spawnSync(process.execPath, [cli, body], {
        cwd: root,
        encoding: "utf8",
      });
    };
    const invalid = run("Knowledge map impact: unchanged\nChangelog: none\n");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Knowledge map impact:");
    expect(invalid.stderr).toContain("Changelog:");
    const reason =
      "Knowledge map impact: unchanged — Existing ownership and entry points remain accurate.\n";
    expect(
      run(
        reason +
          "Changelog: none — Only synthetic regression coverage changes.\n",
      ).status,
    ).toBe(0);
    mkdirSync(join(root, "changes"));
    writeFileSync(
      join(root, "changes/example.md"),
      "### Fixed\n\n- Keep synthetic behavior consistent.\n",
    );
    git("add", "changes");
    git("commit", "-qm", "fragment");
    expect(run(reason).status).toBe(0);
    writeFileSync(join(root, "changes/example.md"), "invalid fragment");
    expect(run(reason).status).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
