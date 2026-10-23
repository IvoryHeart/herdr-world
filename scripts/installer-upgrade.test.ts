import { expect, test } from "bun:test";
import { $ } from "bun";
import {
  chmodSync,
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
  releaseMirror,
  runtimeEnvironment,
  removeInstallerFixture,
  upgradeCookieStatus,
  InstallerCommandError,
  legacyBaselineStagingLock,
  baselineBuild,
  command,
} from "./installer-upgrade";

const legacyCleanupError = (version = "0.2.6") =>
  new InstallerCommandError(
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/install-plugin.ps1",
    ],
    1,
    `Installed Herdr World plugin binary ${version}\r\n`,
    [
      "Remove-Item : Cannot remove item C:\\fixture\\upgrade\\server\\.plugin-install-example.tmp\\herdr-world-windows-arm64\\herdr-world.exe: The process cannot",
      "access the file 'herdr-world.exe' because it is being used by another process.",
      "At C:\\fixture\\upgrade\\scripts\\install-plugin.ps1:112 char:3",
      "+   Remove-Item -LiteralPath $staging -Recurse -Force",
      "+   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
      "    + CategoryInfo          : WriteError: (herdr-world.exe:FileInfo) [Remove-Item], IOException",
      "    + FullyQualifiedErrorId : RemoveFileSystemItemIOError,Microsoft.PowerShell.Commands.RemoveItemCommand",
    ].join("\r\n"),
  );

test("only Windows v0.2.6-and-older baseline post-success staging locks are tolerated", () => {
  for (const version of ["0.0.1", "0.1.99", "0.2.0", "0.2.6"])
    expect(
      legacyBaselineStagingLock(
        legacyCleanupError(version),
        `v${version}`,
        "win32",
      ),
    ).toBe(true);
  for (const version of ["0.2.7", "0.3.0", "1.0.0", "0.2.6-rc.1", "00.2.6"])
    expect(
      legacyBaselineStagingLock(
        legacyCleanupError(version),
        `v${version}`,
        "win32",
      ),
    ).toBe(false);
  for (const platform of ["linux", "darwin"] as const)
    expect(
      legacyBaselineStagingLock(legacyCleanupError(), "v0.2.6", platform),
    ).toBe(false);
});

test("baseline checksum, version, download, promotion and unrelated cleanup errors stay fatal", () => {
  const original = legacyCleanupError();
  const changed = (
    patch: Partial<
      Pick<InstallerCommandError, "argv" | "exitCode" | "stdout" | "stderr">
    >,
  ) =>
    new InstallerCommandError(
      patch.argv ?? original.argv,
      patch.exitCode ?? original.exitCode,
      patch.stdout ?? original.stdout,
      patch.stderr ?? original.stderr,
    );
  const errors: unknown[] = [
    new Error(original.message),
    changed({ exitCode: 2 }),
    changed({ argv: ["powershell.exe", "-File", "scripts/other.ps1"] }),
    changed({ stdout: "" }),
    changed({ stdout: "Installed Herdr World plugin binary 0.2.5" }),
    changed({ stdout: original.stdout + "Binary version mismatch" }),
    changed({ stderr: "Package checksum mismatch" }),
    changed({ stderr: "Binary version mismatch" }),
    changed({ stderr: "download failed" }),
    changed({ stderr: original.stderr.replaceAll("Remove-Item", "Move-Item") }),
    changed({
      stderr: original.stderr.replace(
        ".plugin-install-example.tmp",
        "installed",
      ),
    }),
    changed({
      stderr: original.stderr.replace(
        "being used by another process",
        "access is denied",
      ),
    }),
    changed({
      stderr: original.stderr.replace(
        "RemoveFileSystemItemIOError",
        "OtherError",
      ),
    }),
    changed({
      stderr: original.stderr + "\r\n    + FullyQualifiedErrorId : OtherError",
    }),
  ];
  for (const error of errors)
    expect(legacyBaselineStagingLock(error, "v0.2.6", "win32")).toBe(false);
});

test("baseline-only tolerance cannot swallow current installers or later validation failures", async () => {
  const error = legacyCleanupError();
  const fail = async () => {
    throw error;
  };
  expect(await baselineBuild(fail, "v0.2.6", "win32")).toBe(true);
  await expect(baselineBuild(fail, "v0.2.7", "win32")).rejects.toBe(error);
  expect(await baselineBuild(async () => "installed", "v0.2.6", "win32")).toBe(
    false,
  );
  const invalidBinary = new Error("Baseline installed version mismatch");
  await expect(
    (async () => {
      await baselineBuild(fail, "v0.2.6", "win32");
      throw invalidBinary;
    })(),
  ).rejects.toBe(invalidBinary);
});

test("candidate commands remain strict even with the known legacy cleanup output", async () => {
  const failure = legacyCleanupError();
  const script = `console.log(${JSON.stringify(failure.stdout)}); console.error(${JSON.stringify(failure.stderr)}); process.exit(1);`;
  await expect(
    command([process.execPath, "--eval", script], process.cwd(), process.env),
  ).rejects.toBeInstanceOf(InstallerCommandError);
});

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
  expect(workflow.jobs["installer-upgrade"]).toMatchObject({
    uses: "./.github/workflows/installer-upgrade.yml",
    needs: "validation-scope",
    if: "needs.validation-scope.outputs.mode == 'full'",
  });
  // ci-delivery-result requires success for full validation and a skip for
  // Markdown-only or exact-head reuse.
  const gates = workflow.jobs.delivery.steps.filter(
    (step: any) => step.run === "bun scripts/ci-delivery-result.ts",
  );
  expect(gates).toHaveLength(2);
  for (const gate of gates)
    expect(gate.env.INSTALLER_RESULT).toBe(
      "${{ needs.installer-upgrade.result }}",
    );
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

test.skipIf(process.platform === "win32")(
  "cleanup yields for transient filesystem denial and fails when denial persists",
  async () => {
    for (const transient of [true, false]) {
      const directory = mkdtempSync(join(tmpdir(), "world-cleanup-denial-"));
      const nested = join(directory, "nested");
      mkdirSync(nested);
      const file = join(nested, "held.txt");
      writeFileSync(file, "synthetic fixture");
      chmodSync(nested, 0o500);
      let release: ReturnType<typeof setTimeout> | undefined;
      try {
        if (transient) {
          release = setTimeout(() => chmodSync(nested, 0o700), 150);
          await removeInstallerFixture(directory);
          expect(existsSync(directory)).toBe(false);
        } else {
          await expect(
            removeInstallerFixture(directory),
          ).rejects.toHaveProperty("code", "EACCES");
          expect(existsSync(file)).toBe(true);
        }
      } finally {
        if (release) clearTimeout(release);
        if (existsSync(nested)) chmodSync(nested, 0o700);
        await removeInstallerFixture(directory);
      }
    }
  },
  5_000,
);

test("the baseline release is fetched once per cache and then served locally", async () => {
  const cache = mkdtempSync(join(tmpdir(), "installer baseline assets "));
  const fetched: string[] = [];
  const upstream = "https://releases.example.com/v1.2.3";
  const download = async (url: string) => {
    fetched.push(url);
    return url.endsWith("/absent.tar.xz")
      ? new Response("gone", { status: 404 })
      : new Response(`bytes of ${url}`);
  };
  const first = releaseMirror(cache, upstream, download);
  try {
    const name = "herdr-world-v1.2.3-linux-x64.tar.xz";
    const get = (mirror: ReturnType<typeof releaseMirror>, path: string) =>
      fetch(`${mirror.url.origin}/${path}`);
    expect(await (await get(first, name)).text()).toBe(
      `bytes of ${upstream}/${name}`,
    );
    expect(await (await get(first, name)).text()).toBe(
      `bytes of ${upstream}/${name}`,
    );
    expect((await get(first, "absent.tar.xz")).status).toBe(404);
    expect((await get(first, "..%2Fsecret")).status).toBe(404);
    expect(fetched).toEqual([
      `${upstream}/${name}`,
      `${upstream}/absent.tar.xz`,
    ]);

    // A later run restoring the same cache downloads nothing.
    const second = releaseMirror(cache, upstream, download);
    try {
      expect((await get(second, name)).status).toBe(200);
    } finally {
      second.stop(true);
    }
    expect(fetched).toHaveLength(2);
    expect(existsSync(join(cache, "absent.tar.xz"))).toBe(false);
  } finally {
    first.stop(true);
    rmSync(cache, { recursive: true, force: true });
  }
});

test("CI caches the baseline assets per release tag and platform", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(
      new URL("../.github/workflows/installer-upgrade.yml", import.meta.url),
    ).text(),
  ) as any;
  const upgrade = workflow.jobs.upgrade;
  expect(upgrade.env.INSTALLER_BASELINE_ASSETS).toBe(
    "${{ github.workspace }}/.agents/installer-baseline-assets",
  );
  expect(
    upgrade.steps.find(
      (step: any) => step.name === "Cache the baseline release assets",
    )?.with,
  ).toEqual({
    path: ".agents/installer-baseline-assets",
    key: "installer-baseline-${{ needs.baseline.outputs.tag }}-${{ matrix.platform }}",
  });
});
