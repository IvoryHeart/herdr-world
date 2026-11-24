import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBaseIdentity, buildInstallImage } from "./image";

test("dependency identity changes with its recipe or apt policy", () => {
  expect(installBaseIdentity(["recipe", "apt"])).toBe(
    installBaseIdentity(["recipe", "apt"]),
  );
  expect(installBaseIdentity(["recipe", "apt"])).not.toBe(
    installBaseIdentity(["recipe2", "apt"]),
  );
  expect(installBaseIdentity(["recipe", "apt"])).not.toBe(
    installBaseIdentity(["recipe", "apt2"]),
  );
});

for (const restored of [false, true]) {
  test(`a ${restored ? "restored" : "cold"} base always builds the current scenarios`, async () => {
    const root = mkdtempSync(join(tmpdir(), "installer-image-"));
    const cache = join(root, "base.tar");
    const calls: string[][] = [];
    if (restored) writeFileSync(cache, "cached image");
    try {
      await buildInstallImage(
        "fixture:test",
        async (args) => {
          calls.push(args);
          if (args[1] === "save")
            writeFileSync(args[args.indexOf("--output") + 1], "image");
          return "";
        },
        cache,
      );
      expect(calls.some((args) => args[1] === "load")).toBe(restored);
      expect(
        calls.some((args) =>
          args.includes("scripts/install-linux/Dockerfile.base"),
        ),
      ).toBe(!restored);
      expect(calls.some((args) => args[1] === "save")).toBe(!restored);
      const fixture = calls.at(-1)!;
      expect(fixture).toContain("build");
      expect(fixture).toContain("linux/amd64");
      expect(fixture).toContain("fixture:test");
      expect(fixture).toContain(`INSTALL_TEST_BASE=${installBaseIdentity()}`);
      expect(fixture.at(-1)).toBe("scripts/install-linux");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a failed dependency build never publishes a cache or builds the fixture", async () => {
  const calls: string[][] = [];
  await expect(
    buildInstallImage("fixture:test", async (args) => {
      calls.push(args);
      throw new Error("apt unavailable");
    }),
  ).rejects.toThrow("apt unavailable");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("scripts/install-linux/Dockerfile.base");
});

test.skipIf(process.platform === "win32")(
  "apt preserves dependencies and fails clearly without continuing after errors",
  () => {
    const root = mkdtempSync(join(tmpdir(), "installer-apt-"));
    try {
      for (const mode of ["success", "update", "install", "deadline"]) {
        const log = join(root, "calls");
        writeFileSync(log, "");
        writeFileSync(
          join(root, "apt-get"),
          `#!/bin/sh\nprintf '%s\\n' "$*" >> "$APT_TEST_LOG"\ncase " $* " in *" $APT_TEST_FAILURE "*) exit 100;; esac\n`,
          { mode: 0o755 },
        );
        writeFileSync(
          join(root, "timeout"),
          `#!/bin/sh\nprintf '%s %s\\n' "$1" "$2" >> "$APT_TEST_LOG"\n[ "$APT_TEST_FAILURE" != deadline ] || exit 124\nshift 2\nexec "$@"\n`,
          { mode: 0o755 },
        );
        const result = spawnSync("sh", ["scripts/install-linux/apt.sh"], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            APT_TEST_LOG: log,
            APT_TEST_FAILURE: mode,
          },
        });
        if (mode === "success") {
          expect(result.status).toBe(0);
          expect(result.stdout).toContain("[apt] update:");
          expect(result.stdout).toContain("[apt] install:");
          expect(result.stdout).toContain("(exit 0)");
        } else {
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Installer test base: apt failed");
          expect(result.stderr).toContain("300s total deadline");
        }
        const calls = readFileSync(log, "utf8");
        expect(calls).toContain("--kill-after=5s 300s");
        if (mode !== "deadline") {
          expect(calls).toContain("Acquire::Retries=1");
          expect(calls).toContain("Acquire::http::Timeout=15");
          expect(calls).toContain("Acquire::https::Timeout=15");
          expect(calls).toContain("APT::Update::Error-Mode=any");
        }
        if (mode === "update") expect(calls).not.toContain("install -y");
        if (mode === "success")
          expect(calls).toContain(
            "install -y --no-install-recommends systemd systemd-sysv dbus-user-session libpam-systemd ca-certificates curl xz-utils python3 python3-websocket",
          );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("only Linux x64 restores and saves the exact dependency image, even if a scenario fails", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/installer-upgrade.yml").text(),
  ) as any;
  const steps = workflow.jobs.upgrade.steps;
  const restore = steps.find((step: any) => step.id === "linux-base-cache");
  const save = steps.find(
    (step: any) => step.name === "Save the Linux installer dependency image",
  );
  expect(restore.if).toBe("matrix.platform == 'linux-x64'");
  expect(restore.uses).toContain("actions/cache/restore@");
  expect(restore.with.key).toContain(
    "hashFiles('scripts/install-linux/Dockerfile.base', 'scripts/install-linux/apt.sh')",
  );
  expect(restore.with["restore-keys"]).toBeUndefined();
  expect(save.uses).toContain("actions/cache/save@");
  expect(save.with).toEqual(restore.with);
  expect(save.if).toContain("!cancelled()");
  expect(save.if).toContain("matrix.platform == 'linux-x64'");
  expect(save.if).toContain(
    "steps.linux-base-cache.outputs.cache-hit != 'true'",
  );
  expect(
    steps.find((step: any) => step.run?.includes("test:install-linux")).env
      .INSTALLER_LINUX_BASE_CACHE,
  ).toBe(restore.with.path);
  expect(
    steps.find((step: any) => step.run?.includes("--check-mirror-failure")).if,
  ).toBe("matrix.platform == 'linux-x64'");
});
