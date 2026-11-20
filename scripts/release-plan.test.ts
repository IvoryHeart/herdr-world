import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("untagged dispatch can rehearse 0.3.6; publication fails closed on branches and mismatched tags", () => {
  const root = mkdtempSync(join(tmpdir(), "release-plan-"));
  try {
    for (const directory of ["web", "server"]) mkdirSync(join(root, directory));
    for (const name of [
      "package.json",
      "web/package.json",
      "server/package.json",
    ])
      writeFileSync(join(root, name), '{"version":"0.0.0"}');
    writeFileSync(join(root, "herdr-plugin.toml"), 'version = "0.3.5"\n');
    const run = (overrides: Record<string, string>) =>
      Bun.spawnSync(
        [process.execPath, join(import.meta.dir, "release-plan.ts")],
        {
          cwd: root,
          env: {
            ...process.env,
            GITHUB_OUTPUT: "",
            GITHUB_EVENT_NAME: "workflow_dispatch",
            GITHUB_REF: "refs/heads/main",
            GITHUB_REF_NAME: "main",
            VERSION_INPUT: "0.3.6",
            DRY_RUN: "",
            ...overrides,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    const dryRun = run({});
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout.toString()).toContain(
      "Dry run (no publication): v0.3.6",
    );
    expect(run({ DRY_RUN: "false" }).exitCode).toBe(1);
    expect(
      run({
        DRY_RUN: "false",
        GITHUB_REF: "refs/tags/v0.3.6",
        GITHUB_REF_NAME: "v0.3.6",
      }).stderr.toString(),
    ).toContain("Publication requires");
    expect(run({ VERSION_INPUT: "$(false)" }).stderr.toString()).toContain(
      "Invalid release version",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
