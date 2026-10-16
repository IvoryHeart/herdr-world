import { expect, test } from "bun:test";
import { $ } from "bun";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidateVersion,
  runtimeEnvironment,
  removeInstallerFixture,
  upgradeCookieStatus,
} from "./installer-upgrade";

test("native compile commands pass the build-environment wildcard literally through Bun Shell", async () => {
  const root = new URL("../server/", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("package.json", root), "utf8"),
  );
  const directory = mkdtempSync(join(tmpdir(), "world compiler argv "));
  const recorder = join(directory, "record.ts");
  writeFileSync(recorder, "console.log(JSON.stringify(process.argv.slice(2)))");
  const literal = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    for (const [name, script] of Object.entries(manifest.scripts)) {
      if (!name.startsWith("compile") || name === "compile:all") continue;
      const replay = (script as string).replace(
        /^bun build /,
        `${literal(process.execPath)} ${literal(recorder)} `,
      );
      const result = await $`${{ raw: replay }}`
        .cwd(fileURLToPath(root))
        .quiet()
        .nothrow();
      expect(result.exitCode, `${name}: ${result.stderr.toString()}`).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toContain(
        "--env=HERDR_WORLD_BUILD_*",
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the legacy cookie migration requires re-login; later upgrades preserve sessions", () => {
  expect(upgradeCookieStatus("v0.2.3")).toBe(401);
  expect(upgradeCookieStatus("v0.2.4")).toBe(200);
  expect(upgradeCookieStatus("v0.3.0")).toBe(200);
});

test("candidate versions are newer than the frozen stable release and uniquely identify CI", () => {
  expect(candidateVersion("v0.2.3", "12345")).toBe("0.2.4-rc.12345");
  expect(candidateVersion("v12.9.99", "2")).toBe("12.9.100-rc.2");
  for (const tag of ["main", "v0.2.3-rc.1", "v01.2.3", "v1.2.3\nanything"])
    expect(() => candidateVersion(tag, "1")).toThrow();
  for (const run of ["", "0", "1\nanything", "../1"])
    expect(() => candidateVersion("v0.2.3", run)).toThrow();
});

test("installer processes cannot inherit real World or remote-runtime configuration", () => {
  const prior = process.env.HERDR_WORLD_SSH_HOST;
  process.env.HERDR_WORLD_SSH_HOST = "synthetic-remote.example";
  try {
    const env = runtimeEnvironment("/synthetic/installer-home");
    expect(env.HERDR_WORLD_SSH_HOST).toBeUndefined();
    expect(env.HOME).toBe("/synthetic/installer-home");
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.PORT).toBe("0");
    expect(env.HERDR_WORLD_PASSWORD).toBe("installer-upgrade-fixture-password");
    expect(env.HERDR_WORLD_CONNECTIONS_PATH).toContain("connections.json");
  } finally {
    if (prior === undefined) delete process.env.HERDR_WORLD_SSH_HOST;
    else process.env.HERDR_WORLD_SSH_HOST = prior;
  }
});

test("Delivery checks require the pre-merge installer upgrade matrix", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/ci.yml", import.meta.url),
    ).text(),
  ) as any;
  expect(workflow.jobs.delivery.needs).toContain("installer-upgrade");
  expect(workflow.jobs["installer-upgrade"].uses).toBe(
    "./.github/workflows/installer-upgrade.yml",
  );
  const gate = workflow.jobs.delivery.steps.find(
    (step: any) => step.name === "Require installer upgrade evidence",
  );
  expect(gate?.env.INSTALLER_RESULT).toBe(
    "${{ needs.installer-upgrade.result }}",
  );
  expect(gate?.run).toBe('test "$INSTALLER_RESULT" = success');
});

test("installer upgrades run native released artifacts on every supported platform", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/installer-upgrade.yml", import.meta.url),
    ).text(),
  ) as any;
  const job = workflow.jobs.upgrade;
  // runner context is available to steps, but not reusable-workflow job env.
  expect(JSON.stringify(job.env)).not.toContain("runner.");
  expect(Object.keys(workflow.on)).toEqual([
    "workflow_call",
    "workflow_dispatch",
  ]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(job.strategy["fail-fast"]).toBe(false);
  expect(
    job.strategy.matrix.include.map((entry: any) => entry.platform).sort(),
  ).toEqual([
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-arm64",
    "windows-x64",
  ]);
  expect(job.steps.find((step: any) => step.with?.path)?.with.ref).toBe(
    "${{ needs.baseline.outputs.sha }}",
  );
  expect(
    job.steps.find((step: any) => step.name?.startsWith("Build the proposed"))
      ?.run,
  ).toBe('bash scripts/package-release.sh "$PACKAGE_PLATFORM"');
  expect(
    job.steps.find((step: any) => step.name?.startsWith("Verify fresh"))?.run,
  ).toBe("bun scripts/installer-upgrade.ts verify");
  for (const step of job.steps)
    expect(step["continue-on-error"]).toBeUndefined();
  expect(job["continue-on-error"]).toBeUndefined();
  expect(
    job.steps.find((step: any) => step.with?.["retention-days"])?.with[
      "retention-days"
    ],
  ).toBe(1);
});

test("installer fixture cleanup removes nested files and tolerates an already removed fixture", async () => {
  const directory = mkdtempSync(join(tmpdir(), "world-cleanup-fixture-"));
  mkdirSync(join(directory, "nested"));
  writeFileSync(join(directory, "nested", "fixture.txt"), "synthetic fixture");
  await removeInstallerFixture(directory);
  expect(existsSync(directory)).toBe(false);
  await removeInstallerFixture(directory);
});
