import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("only the main version commit's matching tag can publish, with changelog as notes", () => {
  const root = mkdtempSync(join(tmpdir(), "release-plan-"));
  const script = join(import.meta.dir, "release-plan.ts");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "fixture",
    );
  };
  try {
    git("init", "-q");
    for (const directory of ["web", "server"]) mkdirSync(join(root, directory));
    for (const name of [
      "package.json",
      "web/package.json",
      "server/package.json",
    ])
      writeFileSync(join(root, name), '{"version":"0.0.0"}');
    writeFileSync(join(root, "herdr-plugin.toml"), 'version = "0.3.7"\n');
    commit();
    const run = (ref: string) =>
      Bun.spawnSync([process.execPath, script], {
        cwd: root,
        env: { ...process.env, GITHUB_REF: ref, GITHUB_OUTPUT: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
    for (const version of ["0.3.8-rc.1", "0.3.8-rc.2", "0.3.8"]) {
      writeFileSync(
        join(root, "herdr-plugin.toml"),
        `version = "${version}"\n`,
      );
      writeFileSync(
        join(root, "CHANGELOG.md"),
        `# Changelog\n\n## ${version}\n\n- Synthetic change.\n`,
      );
      commit();
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      expect(run(`refs/tags/v${version}`).exitCode).toBe(0);
      expect(run("refs/tags/v0.3.7").exitCode).toBe(1);
    }
    for (const ref of [
      "refs/heads/main",
      "refs/tags/v0.3.8-rc.2",
      "refs/tags/v0.3.7",
    ])
      expect(run(ref).exitCode).toBe(1);
    writeFileSync(join(root, "later.txt"), "later");
    commit();
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    expect(run("refs/tags/v0.3.8").stderr.toString()).toContain(
      "version commit",
    );
    git("checkout", "-q", "HEAD^");
    git("update-ref", "refs/remotes/origin/main", "HEAD^");
    expect(run("refs/tags/v0.3.8").exitCode).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
