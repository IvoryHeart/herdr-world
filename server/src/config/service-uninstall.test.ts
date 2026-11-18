import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runServiceCommand } from "./service-manager";
import {
  GENERATED_MARKER,
  renderLaunchdService,
  renderSystemdService,
  resolveServicePaths,
} from "./service-definitions";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

for (const platform of ["launchd", "systemd"] as const) {
  test(`${platform} uninstall removes current and legacy World definitions only`, () => {
    const homeDir = mkdtempSync(join(tmpdir(), "world-uninstall-"));
    roots.push(homeDir);
    const paths = resolveServicePaths(platform, homeDir);
    mkdirSync(dirname(paths.definition), { recursive: true });
    mkdirSync(dirname(paths.config), { recursive: true });
    writeFileSync(paths.config, "# preserved configuration\n");
    const render =
      platform === "launchd"
        ? renderLaunchdService("/opt/example/herdr-world", paths)
        : renderSystemdService("/opt/example/herdr-world", paths.config);
    writeFileSync(paths.definition, render);
    const legacy = join(
      dirname(paths.definition),
      platform === "launchd" ? "old-world.plist" : "old-world.service",
    );
    writeFileSync(
      legacy,
      render.replaceAll("dev.herdr-world", "example.legacy-world"),
    );
    const core = join(
      dirname(paths.definition),
      platform === "launchd"
        ? "dev.herdr-core.plist"
        : "herdr-core-login.service",
    );
    writeFileSync(core, "# core owns its login item\n");
    const other = join(
      dirname(paths.definition),
      platform === "launchd" ? "example.other.plist" : "other.service",
    );
    writeFileSync(
      other,
      render.replace(GENERATED_MARKER, "User-owned definition"),
    );
    const commands: string[][] = [];
    const uninstall = () =>
      runServiceCommand(["service", "uninstall"], {
        runtime: {
          platform: platform === "launchd" ? "darwin" : "linux",
          homeDir,
          execPath: "/opt/example/herdr-world",
          argv: [],
          uid: 501,
        },
        runCommand: (argv) => {
          commands.push(argv);
          return 0;
        },
        log: () => undefined,
      });
    expect(uninstall()).toBe(0);
    expect(existsSync(paths.definition)).toBeFalse();
    expect(existsSync(legacy)).toBeFalse();
    expect(existsSync(paths.config)).toBeTrue();
    expect(existsSync(core)).toBeTrue();
    expect(existsSync(other)).toBeTrue();
    expect(
      commands.flat().some((arg) => arg.includes("herdr-core")),
    ).toBeFalse();
    if (platform === "launchd") {
      expect(commands).toContainEqual([
        "launchctl",
        "bootout",
        "gui/501/example.legacy-world",
      ]);
    } else {
      expect(commands).toContainEqual([
        "systemctl",
        "--user",
        "disable",
        "--now",
        "old-world.service",
      ]);
    }
    commands.length = 0;
    expect(uninstall()).toBe(0);
    expect(commands).toEqual([]);
  });
}

for (const platform of ["launchd", "systemd"] as const) {
  for (const failure of ["query", "stop", "reload"] as const) {
    if (platform === "launchd" && failure === "reload") continue;
    if (platform === "systemd" && failure === "query") continue;
    test(`${platform} preserves the legacy definition on ${failure} failure`, () => {
      const homeDir = mkdtempSync(join(tmpdir(), "world-uninstall-"));
      roots.push(homeDir);
      const paths = resolveServicePaths(platform, homeDir);
      mkdirSync(dirname(paths.definition), { recursive: true });
      const legacy = join(
        dirname(paths.definition),
        platform === "launchd" ? "legacy.plist" : "legacy.service",
      );
      const contents =
        platform === "launchd"
          ? renderLaunchdService("/opt/example/herdr-world", paths)
          : renderSystemdService("/opt/example/herdr-world", paths.config);
      writeFileSync(legacy, contents);
      const commands: string[][] = [];
      expect(
        runServiceCommand(["service", "uninstall"], {
          runtime: {
            platform: platform === "launchd" ? "darwin" : "linux",
            homeDir,
            execPath: "/opt/example/herdr-world",
            argv: [],
            uid: 501,
          },
          runCommand: (argv) => {
            commands.push(argv);
            return argv.includes(
              failure === "query"
                ? "print"
                : failure === "stop"
                  ? platform === "launchd"
                    ? "bootout"
                    : "disable"
                  : "daemon-reload",
            )
              ? 5
              : 0;
          },
          log: () => undefined,
        }),
      ).toBe(5);
      expect(readFileSync(legacy, "utf8")).toBe(contents);
      if (failure === "query")
        expect(commands.some((argv) => argv.includes("bootout"))).toBeFalse();
    });
  }
}

test("an old upstream marker belongs to World only with a World executable", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "world-uninstall-"));
  roots.push(homeDir);
  const paths = resolveServicePaths("launchd", homeDir);
  mkdirSync(dirname(paths.definition), { recursive: true });
  const legacy = join(dirname(paths.definition), "dev.herdr.herdr-gui.plist");
  const gui = join(dirname(paths.definition), "example.gui.plist");
  const contents = renderLaunchdService("/opt/example/herdr-world", paths)
    .replace(GENERATED_MARKER, "Generated by herdr-gui service install.")
    .replace(
      "<string>dev.herdr-world</string>",
      "<string>dev.herdr.herdr-gui</string>",
    );
  writeFileSync(legacy, contents);
  writeFileSync(
    gui,
    contents.replace("/opt/example/herdr-world", "/opt/example/herdr-gui"),
  );
  const commands: string[][] = [];
  expect(
    runServiceCommand(["service", "uninstall"], {
      runtime: {
        platform: "darwin",
        homeDir,
        execPath: "/opt/example/herdr-world",
        argv: [],
        uid: 501,
      },
      runCommand: (argv) => {
        commands.push(argv);
        return argv.includes("print") ? 113 : 0;
      },
      log: () => undefined,
    }),
  ).toBe(0);
  expect(existsSync(legacy)).toBeFalse();
  expect(existsSync(gui)).toBeTrue();
  expect(commands).toEqual([
    ["launchctl", "print", "gui/501/dev.herdr.herdr-gui"],
  ]);
});
