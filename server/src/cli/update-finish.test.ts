import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  renderLaunchdService,
  renderSystemdService,
  resolveServicePaths,
} from "../config/service-definitions";
import { createTestCli, type TestCli } from "./test-context";
import { createUpdateCommand } from "./update";

let cli: TestCli;
afterEach(() => cli?.cleanup());

const herdrOutput = [
  "Herdr 0.9.5 is current.",
  "Integration codex: updated",
  "Plugin ivoryheart.herdr-world: updated",
].join("\n");

function fakeHerdr(code = 0) {
  const calls: string[][] = [];
  return {
    calls,
    runProcess: async (argv: string[]) => {
      calls.push(argv);
      return { code, stdout: herdrOutput, stderr: code ? "plugin failed" : "" };
    },
  };
}

function service(platform: string, executable?: string) {
  const paths = resolveServicePaths(
    platform === "linux" ? "systemd" : "launchd",
    cli.home,
  );
  mkdirSync(dirname(paths.definition), { recursive: true });
  writeFileSync(
    paths.definition,
    platform === "linux"
      ? renderSystemdService(
          executable ?? cli.context.runtime.execPath,
          paths.config,
        )
      : renderLaunchdService(executable ?? cli.context.runtime.execPath, paths),
  );
}

describe("installer update finalization", () => {
  test.each(["linux", "darwin"])(
    "%s upgrades Herdr and integrations before restarting its running service without another World download",
    async (platform) => {
      const fake = fakeHerdr();
      cli = createTestCli({
        runtime: { platform },
        runCommand: () => {
          expect(fake.calls).toHaveLength(1);
          return 0;
        },
        captureCommand: () => ({ code: 0, stdout: "\tstate = running\n" }),
      });
      // Exercise escaped executable paths in both native definition formats.
      cli.context.runtime.execPath += " & %";
      service(platform);
      expect(
        await createUpdateCommand(fake).run(["--finish-install"], cli.context),
      ).toBe(0);
      expect(fake.calls).toEqual([
        [cli.context.runtime.execPath, "herdr", "upgrade"],
      ]);
      expect(cli.output).toEqual(
        expect.arrayContaining([
          ...herdrOutput.split("\n"),
          "Restarted the service.",
        ]),
      );
      expect(
        cli.commands.some((argv) =>
          platform === "linux"
            ? argv.includes("restart") && argv.includes("herdr-world.service")
            : argv.includes("kickstart"),
        ),
      ).toBe(true);
    },
  );

  test.each(["linux", "darwin"])(
    "%s leaves a service using a different executable running",
    async (platform) => {
      cli = createTestCli({
        runtime: { platform },
        runCommand: () => 0,
        captureCommand: () => ({ code: 0, stdout: "\tstate = running\n" }),
      });
      service(platform, "/opt/example/herdr-world");
      expect(
        await createUpdateCommand(fakeHerdr()).run(
          ["--finish-install"],
          cli.context,
        ),
      ).toBe(0);
      expect(cli.output.join("\n")).toContain(
        "managed service runs a different executable",
      );
      expect(
        cli.commands.some(
          (argv) => argv.includes("restart") || argv.includes("kickstart"),
        ),
      ).toBe(false);
    },
  );

  test.each(["missing", "inactive", "unsupported"])(
    "explains why a %s service was not restarted",
    async (state) => {
      cli = createTestCli({
        runtime: {
          platform: state === "unsupported" ? "unsupported" : "linux",
        },
      });
      if (state === "inactive") service("linux");
      expect(
        await createUpdateCommand(fakeHerdr()).run(
          ["--finish-install"],
          cli.context,
        ),
      ).toBe(0);
      expect(cli.output.join("\n")).toContain("not restarted");
      expect(cli.output.join("\n")).toContain(
        "Restart any running herdr-world process",
      );
    },
  );

  test("a Herdr failure is reported and still restarts World", async () => {
    cli = createTestCli({ runCommand: () => 0 });
    service("linux");
    expect(
      await createUpdateCommand(fakeHerdr(1)).run(
        ["--finish-install"],
        cli.context,
      ),
    ).toBe(0);
    expect(cli.output).toEqual(
      expect.arrayContaining([
        "plugin failed",
        "Herdr was not fully upgraded; run `herdr-world herdr upgrade` to retry.",
        "Restarted the service.",
      ]),
    );
  });

  test("a Herdr process error still permits the World restart", async () => {
    cli = createTestCli({ runCommand: () => 0 });
    service("linux");
    expect(
      await createUpdateCommand({
        runProcess: async () => {
          throw new Error("spawn failed");
        },
      }).run(["--finish-install"], cli.context),
    ).toBe(0);
    expect(cli.output).toContain("Herdr upgrade failed: spawn failed");
    expect(cli.output).toContain("Restarted the service.");
  });

  test.each(["--check", "--json"])(
    "rejects %s with finalization before running any step",
    async (flag) => {
      cli = createTestCli();
      const fake = fakeHerdr();
      await expect(
        createUpdateCommand(fake).run(["--finish-install", flag], cli.context),
      ).rejects.toThrow("cannot be combined");
      expect(fake.calls).toHaveLength(0);
      expect(cli.commands).toHaveLength(0);
    },
  );

  test("the installer's skip option leaves Herdr alone and still restarts World", async () => {
    cli = createTestCli({ runCommand: () => 0 });
    cli.context.runtime.env.HERDR_WORLD_SKIP_HERDR = "1";
    service("linux");
    const fake = fakeHerdr();
    expect(
      await createUpdateCommand(fake).run(["--finish-install"], cli.context),
    ).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(cli.output.join("\n")).toContain("HERDR_WORLD_SKIP_HERDR=1");
    expect(cli.output).toContain("Restarted the service.");
  });

  test("a failed service restart is reported with a failure exit code", async () => {
    cli = createTestCli({
      runCommand: (argv) => (argv.includes("restart") ? 1 : 0),
    });
    service("linux");
    expect(
      await createUpdateCommand(fakeHerdr()).run(
        ["--finish-install"],
        cli.context,
      ),
    ).toBe(1);
    expect(cli.output.join("\n")).toContain("restart failed");
  });
});
