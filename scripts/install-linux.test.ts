import { expect, test } from "bun:test";
import {
  mkdtempSync,
  existsSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  dockerArguments,
  withInstallResources,
  installOptions,
  installBaselineTag,
} from "./install-linux";
import { latestStableRelease } from "./installer-upgrade";

const python = Bun.which("python3") ?? Bun.which("python");

for (const mode of ["success", "transient", "permanent", "install-failure"]) {
  test.skipIf(process.platform === "win32")(
    `image package setup handles ${mode} fetches without hiding failures`,
    () => {
      const root = mkdtempSync(join(tmpdir(), "install-apt-"));
      try {
        // The cached base owns package setup; never run its user/system changes.
        writeFileSync(
          join(root, "apt-get"),
          `#!/bin/sh
printf '%s\\n' "$*" >> "$APT_FIXTURE/calls"
case " $* " in
  *' update '*)
    case "$APT_MODE" in
      permanent) exit 100 ;;
      transient)
        if [ ! -f "$APT_FIXTURE/failed" ]; then
          : > "$APT_FIXTURE/failed"
          echo '520 from fixture package mirror' >&2
          exit 100
        fi ;;
    esac ;;
  *' install '*) [ "$APT_MODE" != install-failure ] || exit 100 ;;
esac
`,
          { mode: 0o755 },
        );
        const result = spawnSync("/bin/sh", ["scripts/install-linux/apt.sh"], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            APT_FIXTURE: root,
            APT_MODE: mode,
          },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(
          mode === "permanent" || mode === "install-failure" ? 100 : 0,
        );
        const calls = readFileSync(join(root, "calls"), "utf8")
          .trim()
          .split("\n");
        const updates = calls.filter((line) => line.includes("update"));
        const installs = calls.filter((line) => line.includes("install"));
        expect(updates).toHaveLength(
          mode === "transient" || mode === "permanent" ? 2 : 1,
        );
        expect(installs).toHaveLength(mode === "permanent" ? 0 : 1);
        for (const update of updates)
          expect(update).toContain("APT::Update::Error-Mode=any");
        for (const call of calls) {
          expect(call).toContain("Acquire::Retries=1");
          expect(call).not.toMatch(
            /AllowInsecure|AllowUnauthenticated|allow-unauthenticated/,
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

test.skipIf(!python)(
  "installer assertions preserve runtime identity and tolerate setup completion ordering",
  () => {
    const result = spawnSync(
      python!,
      ["scripts/install-linux/test_scenarios.py"],
      {
        encoding: "utf8",
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stdout + result.stderr).toContain("Ran 5 tests");
    expect(result.status, result.stdout + result.stderr).toBe(0);
  },
);

test("containers isolate cgroups and downloads without host ports or privilege", () => {
  const args = dockerArguments("fixture", "image", "/tmp/assets");
  expect(args).toContain("--cgroupns=private");
  expect(args).toContain("SYS_ADMIN");
  expect(args).toContain("apparmor=unconfined");
  expect(args).toContain("seccomp=unconfined");
  expect(args).toContain("--tmpfs");
  expect(args.join(" ")).toContain("/artifacts,readonly");
  expect(args.join(" ")).toContain("remount,rw /sys/fs/cgroup");
  expect(args.join(" ")).not.toMatch(
    /--privileged|--publish|--network.host|\/sys\/fs\/cgroup:/,
  );
});

for (const outcome of ["success", "failure", "interrupt"] as const) {
  test(`cleanup owns only its resources after ${outcome}, including a failed create`, async () => {
    const root = mkdtempSync(join(tmpdir(), "install-cleanup-"));
    const calls: string[][] = [];
    try {
      const run = async (args: string[]) => {
        calls.push(args);
        return "";
      };
      const work = withInstallResources(
        root,
        "fixture",
        run,
        async (resources) => {
          resources.containers.add("fixture-fresh");
          resources.image = "fixture-image";
          if (outcome !== "success") throw new Error(outcome);
        },
      );
      if (outcome === "success") await work;
      else await expect(work).rejects.toThrow(outcome);
      expect(existsSync(root)).toBe(false);
      expect(calls).toEqual([
        ["docker", "rm", "--force", "fixture-fresh"],
        ["docker", "image", "rm", "--force", "fixture-image"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("cleanup attempts image and temp removal even when container removal fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "install-cleanup-"));
  const calls: string[] = [];
  await expect(
    withInstallResources(
      root,
      "fixture",
      async (args) => {
        calls.push(args[1]!);
        if (args[1] === "rm") throw new Error("daemon unavailable");
        return "";
      },
      async (resources) => {
        resources.containers.add("fixture-fresh");
        resources.image = "fixture-image";
      },
    ),
  ).rejects.toThrow("cleanup");
  expect(calls).toEqual(["rm", "image"]);
  expect(existsSync(root)).toBe(false);
});

test("cleanup failures retain the original installation failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "install-cleanup-"));
  const original = new Error("installer failed");
  try {
    await withInstallResources(
      root,
      "fixture",
      async () => {
        throw new Error("daemon unavailable");
      },
      async (resources) => {
        resources.containers.add("fixture-fresh");
        throw original;
      },
    );
    throw new Error("expected cleanup failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toContain(original);
    expect(existsSync(root)).toBe(false);
  }
});

test("reuse is explicit and versions cannot become shell or URL input", () => {
  expect(installOptions(["--case", "core-only"]).only).toBe("core-only");
  expect(installOptions([]).reuse).toBe(false);
  expect(
    installOptions([
      "--reuse",
      "--version",
      "0.0.0-rc.1",
      "--core-version",
      "latest",
    ]).coreVersion,
  ).toBe("latest");
  for (const args of [
    ["--reuse"],
    ["--version", "../bad"],
    ["--core-version", "1.0.0;id"],
    ["--case", "missing"],
    ["--unknown"],
  ]) {
    expect(() => installOptions(args)).toThrow();
  }
});

test("missing Docker skips locally and fails mandatory CI acceptance", () => {
  for (const required of [false, true]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/install-linux.ts", ...(required ? ["--require-docker"] : [])],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
      },
    );
    expect(result.status).toBe(required ? 1 : 0);
    expect(result.stdout).toContain(
      "SKIP Linux installation: Docker is not installed",
    );
    if (required) expect(result.stderr).toContain("CI requires Docker");
  }
});

test("container and native upgrades share the published stable baseline policy", async () => {
  for (const release of [
    { tag_name: "v1.2.3", draft: false, prerelease: false },
    { tag_name: "v1.2.3-rc.1", draft: false, prerelease: true },
    { tag_name: "v1.2.3", draft: true, prerelease: false },
    { tag_name: "../bad", draft: false, prerelease: false },
  ]) {
    const download = (async () =>
      Response.json(release)) as unknown as typeof fetch;
    if (release.tag_name === "v1.2.3" && !release.draft) {
      expect((await latestStableRelease(download)).tag).toBe("v1.2.3");
    } else
      await expect(latestStableRelease(download)).rejects.toThrow("Baseline");
  }
});

test("container installs reuse the frozen native baseline without a second lookup", async () => {
  const unavailable = (async () => {
    throw new Error("GitHub baseline lookup failed: 403");
  }) as unknown as typeof fetch;
  expect(await installBaselineTag("v1.2.3", unavailable)).toBe("v1.2.3");
  for (const tag of ["v1.2.3-rc.1", "../bad", "v01.2.3"]) {
    await expect(installBaselineTag(tag, unavailable)).rejects.toThrow(
      "stable version tag",
    );
  }
});

test("without a frozen baseline, container installs resolve the latest stable release", async () => {
  let calls = 0;
  const download = (async () => {
    calls++;
    return Response.json({
      tag_name: "v1.2.4",
      draft: false,
      prerelease: false,
    });
  }) as unknown as typeof fetch;
  expect(await installBaselineTag("", download)).toBe("v1.2.4");
  expect(calls).toBe(1);
});

test("native acceptance is isolated from Linux PRs; releases check running channel upgrades", async () => {
  const workflow = async (name: string): Promise<any> =>
    Bun.YAML.parse(await Bun.file(`.github/workflows/${name}.yml`).text());
  const native = await workflow("installer-upgrade");
  const release = await workflow("release");
  const candidate = await workflow("release-candidate");
  const ci = await workflow("ci");
  const step = native.jobs.upgrade.steps.find((item: any) =>
    item.run?.includes("test:install-linux"),
  );
  expect(step.if).toBe("matrix.platform == 'linux-x64'");
  expect(step.run).toContain("--reuse --version");
  expect(step.run).toContain("--require-docker");
  expect(step["continue-on-error"]).toBeUndefined();
  expect(ci.jobs["installer-upgrade"]).toBeUndefined();
  expect(ci.jobs.delivery.needs).not.toContain("installer-upgrade");
  expect(ci.jobs["release-candidate"]).toBeUndefined();
  expect(release.jobs.candidate.uses).toBe(
    "./.github/workflows/release-candidate.yml",
  );
  expect(
    candidate.jobs["homebrew-smoke"].steps.some((item: any) =>
      item.run?.includes("release-channel-upgrade.py"),
    ),
  ).toBe(true);
  expect(JSON.stringify(candidate)).not.toContain("test:install-linux");
  expect(release.jobs.publish.needs).toContain("candidate");
});
