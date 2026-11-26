import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createTestCli } from "../cli/test-context";
import { restartServiceUsing } from "../cli/update-finish";
import {
  renderLaunchdService,
  renderSystemdService,
  resolveServicePaths,
} from "./service-definitions";
import { ownsHomebrewService } from "./service-executable";
import { runServiceCommand } from "./service-manager";

test("Homebrew service follows opt across a keg replacement", () => {
  if (process.platform === "win32") return;
  const homeDir = mkdtempSync(join(tmpdir(), "world-brew-service-"));
  try {
    const prefix = join(homeDir, "brew");
    const keg = join(prefix, "Cellar/herdr-world/0.3.7/libexec/herdr-world");
    const stable = join(prefix, "opt/herdr-world/libexec/herdr-world");
    mkdirSync(dirname(keg), { recursive: true });
    mkdirSync(dirname(dirname(dirname(stable))), { recursive: true });
    writeFileSync(keg, "old", { mode: 0o755 });
    symlinkSync(
      join(prefix, "Cellar/herdr-world/0.3.7"),
      dirname(dirname(stable)),
    );
    expect(
      runServiceCommand(["service", "install"], {
        runtime: {
          platform: "darwin",
          homeDir,
          execPath: keg,
          argv: [keg],
          uid: 1000,
        },
        runCommand: () => 0,
        getLanIPs: () => [],
        log: () => {},
        error: () => {},
      }),
    ).toBe(0);
    const definition = readFileSync(
      join(homeDir, "Library/LaunchAgents/dev.herdr-world.plist"),
      "utf8",
    );
    expect(definition).toContain(stable);
    expect(definition).not.toContain("/Cellar/");
    const next = join(prefix, "Cellar/herdr-world/0.3.8/libexec/herdr-world");
    mkdirSync(dirname(next), { recursive: true });
    writeFileSync(next, "new", { mode: 0o755 });
    rmSync(dirname(dirname(stable)));
    symlinkSync(
      join(prefix, "Cellar/herdr-world/0.3.8"),
      dirname(dirname(stable)),
    );
    rmSync(join(prefix, "Cellar/herdr-world/0.3.7"), { recursive: true });
    expect(readFileSync(stable, "utf8")).toBe("new");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("running Homebrew finalization migrates its generated old-keg service only", () => {
  for (const platform of ["darwin", "linux"]) {
    const cli = createTestCli({
      runtime: { platform },
      runCommand: () => 0,
      captureCommand: () => ({ code: 0, stdout: "\tstate = running\n" }),
    });
    try {
      const prefix = join(cli.home, "brew");
      const keg = join(prefix, "Cellar/herdr-world/0.3.8/libexec/herdr-world");
      const stable = join(prefix, "opt/herdr-world/libexec/herdr-world");
      mkdirSync(dirname(keg), { recursive: true });
      mkdirSync(join(prefix, "opt"), { recursive: true });
      writeFileSync(keg, "new", { mode: 0o755 });
      symlinkSync(
        join(prefix, "Cellar/herdr-world/0.3.8"),
        join(prefix, "opt/herdr-world"),
      );
      cli.context.runtime.execPath = keg;
      cli.context.runtime.argv = [keg];
      const paths = resolveServicePaths(
        platform === "linux" ? "systemd" : "launchd",
        cli.home,
      );
      mkdirSync(dirname(paths.definition), { recursive: true });
      const prior = join(
        prefix,
        "Cellar/herdr-world/0.3.7/libexec/herdr-world",
      );
      writeFileSync(
        paths.definition,
        platform === "linux"
          ? renderSystemdService(prior, paths.config)
          : renderLaunchdService(prior, paths),
      );
      expect(restartServiceUsing(cli.context, keg)).toBe(0);
      const definition = readFileSync(paths.definition, "utf8");
      expect(definition).toContain(stable);
      expect(definition).not.toContain("Cellar");
      expect(
        cli.commands.some((argv) =>
          argv.includes(platform === "linux" ? "restart" : "bootstrap"),
        ),
      ).toBe(true);
      for (const other of [
        prior.replace("/brew/", "/other/"),
        prior.replace("herdr-world/0.3.7", "herdr-world-rc/0.3.7"),
        "/usr/local/bin/herdr-world",
      ])
        expect(
          ownsHomebrewService(keg, renderSystemdService(other, paths.config)),
        ).toBe(false);
      expect(ownsHomebrewService(keg, prior)).toBe(false);
    } finally {
      cli.cleanup();
    }
  }
});
