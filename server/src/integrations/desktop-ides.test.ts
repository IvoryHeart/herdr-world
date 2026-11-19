import { expect, test } from "bun:test";
import {
  IDE_REGISTRY,
  detectDesktopIdes,
  desktopIdeArgs,
  launchDesktopIde,
} from "./desktop-ides";

test("discovery only checks fixed launchers and never starts an IDE", () => {
  const found = detectDesktopIdes({
    platform: "linux",
    home: "/home/tester",
    which: (name) => (name === "code" ? "/usr/bin/code" : null),
    exists: (path) => path === "/usr/bin/code",
  });
  expect(found.filter((row) => row.executable).map((row) => row.id)).toEqual([
    "vscode",
  ]);
  expect(found.length).toBe(IDE_REGISTRY.length);
  expect(found.find((row) => row.id === "cursor")?.reason).toContain(
    "launcher",
  );
});

test("local paths are arguments, including spaces, punctuation and leading dashes", () => {
  expect(
    desktopIdeArgs("vscode", "/projects/a #?%/file.ts", undefined, 42),
  ).toEqual(["--goto", "/projects/a #?%/file.ts:42"]);
  expect(desktopIdeArgs("idea", "/projects/-sample", undefined, 3)).toEqual([
    "--line",
    "3",
    "/projects/-sample",
  ]);
});

test("SSH handoffs encode paths and retain the exact alias", () => {
  expect(
    desktopIdeArgs("vscode", "/srv/a #?%/file.ts", "dev-alias", 7),
  ).toEqual([
    "--remote",
    "ssh-remote+dev-alias",
    "--goto",
    "/srv/a #?%/file.ts:7",
  ]);
  expect(
    desktopIdeArgs(
      "cursor",
      "/srv/project",
      "dev@host.example",
      undefined,
      true,
    ),
  ).toEqual(["--remote", "ssh-remote+dev@host.example", "/srv/project/"]);
  expect(
    desktopIdeArgs("zed", "/srv/a #?%", "dev-alias", undefined, true),
  ).toEqual(["ssh://dev-alias/srv/a%20%23%3F%25"]);
  expect(desktopIdeArgs("vscode", "/srv/no-extension", "dev-alias")).toEqual([
    "--remote",
    "ssh-remote+dev-alias",
    "--goto",
    "/srv/no-extension",
  ]);
  expect(
    desktopIdeArgs(
      "vscode",
      "/srv/folder.with.dot",
      "dev-alias",
      undefined,
      true,
    ),
  ).toEqual(["--remote", "ssh-remote+dev-alias", "/srv/folder.with.dot/"]);
  expect(() => desktopIdeArgs("idea", "/srv/project", "dev-alias")).toThrow(
    "Gateway",
  );
  expect(() =>
    desktopIdeArgs("vscode", "/srv/project", "-oProxyCommand=evil"),
  ).toThrow();
  expect(() => desktopIdeArgs("vscode", "relative", undefined)).toThrow();
  expect(() => desktopIdeArgs("vscode", "/srv/\u0000evil")).toThrow();
});

test("standard application and Toolbox locations supplement PATH on desktop hosts", () => {
  const mac =
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  expect(
    detectDesktopIdes({
      platform: "darwin",
      which: () => null,
      exists: (path) => path === mac,
    }).find((ide) => ide.id === "vscode")?.executable,
  ).toBe(mac);
  const windows = "C:\\Apps\\Programs\\Microsoft VS Code\\Code.exe";
  expect(
    detectDesktopIdes({
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\Apps" },
      which: () => "C:\\bin\\code.cmd",
      exists: (path) => path === windows,
    }).find((ide) => ide.id === "vscode")?.executable,
  ).toBe(windows);
  const toolbox = "/home/tester/.local/share/JetBrains/Toolbox/scripts/idea";
  expect(
    detectDesktopIdes({
      platform: "linux",
      home: "/home/tester",
      which: () => null,
      exists: (path) => path === toolbox,
    }).find((ide) => ide.id === "idea")?.executable,
  ).toBe(toolbox);
});

test("launcher reports failed starts and immediate unsuccessful exits", async () => {
  const options = {
    platform: "linux" as const,
    readCgroup: () => "0::/session-3.scope",
  };
  await launchDesktopIde(process.execPath, ["-e", "process.exit(0)"], options);
  await expect(
    launchDesktopIde(process.execPath, ["-e", "process.exit(1)"], options),
  ).rejects.toThrow("launcher failed");
  await expect(
    launchDesktopIde("/missing/ide-launcher", [], options),
  ).rejects.toThrow("Could not start");
});

function launchHarness(exitCode = 0) {
  const commands: string[][] = [];
  let unreferenced = false;
  return {
    commands,
    get unreferenced() {
      return unreferenced;
    },
    spawn: (command: string[]) => {
      commands.push(command);
      return {
        exited: Promise.resolve(exitCode),
        unref: () => {
          unreferenced = true;
        },
      };
    },
  };
}

test("Linux service handoff moves every IDE family outside World's cgroup", async () => {
  const h = launchHarness();
  for (const executable of [
    "/usr/bin/code",
    "/usr/bin/cursor",
    "/usr/bin/zed",
    "/opt/idea/bin/idea.sh",
  ]) {
    const args = ["/projects/a space/$literal;file.ts"];
    await launchDesktopIde(executable, args, {
      platform: "linux",
      readCgroup: () =>
        "0::/user.slice/user-1000.slice/user@1000.service/app.slice/herdr-world.service\n",
      spawn: h.spawn,
    });
    expect(h.commands.at(-1)).toEqual([
      "systemd-run",
      "--user",
      "--scope",
      "--collect",
      "--quiet",
      "--",
      executable,
      ...args,
    ]);
  }
  expect(h.unreferenced).toBe(true);
});

test("ordinary Linux login scopes and Windows retain native launcher arguments", async () => {
  for (const platform of ["linux", "win32"] as const) {
    const h = launchHarness();
    await launchDesktopIde("/usr/bin/code", ["--goto", "/projects/file.ts:7"], {
      platform,
      readCgroup: () => "0::/user.slice/session-3.scope\n",
      spawn: h.spawn,
    });
    expect(h.commands).toEqual([
      ["/usr/bin/code", "--goto", "/projects/file.ts:7"],
    ]);
  }
});

test("macOS activates the detected bundle through LaunchServices, including PATH symlinks", async () => {
  for (const executable of [
    "/usr/local/bin/code",
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  ]) {
    const h = launchHarness();
    await launchDesktopIde(executable, ["--goto", "/projects/file name.ts:7"], {
      platform: "darwin",
      application: "Visual Studio Code",
      realpath: () =>
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      spawn: h.spawn,
    });
    expect(h.commands).toEqual([
      [
        "/usr/bin/open",
        "-n",
        "-a",
        "/Applications/Visual Studio Code.app",
        "--args",
        "--goto",
        "/projects/file name.ts:7",
      ],
    ]);
  }
  const h = launchHarness();
  await launchDesktopIde(
    "/opt/launchers/idea",
    ["--line", "3", "/projects/app"],
    {
      platform: "darwin",
      application: "IntelliJ IDEA",
      realpath: () => "/opt/launchers/idea",
      spawn: h.spawn,
    },
  );
  expect(h.commands).toEqual([
    [
      "/usr/bin/open",
      "-n",
      "-a",
      "IntelliJ IDEA",
      "--args",
      "--line",
      "3",
      "/projects/app",
    ],
  ]);
});

test("unsafe isolation and activation failures never fall back to a direct IDE child", async () => {
  for (const platform of ["linux", "darwin"] as const) {
    const h = launchHarness(1);
    await expect(
      launchDesktopIde("/usr/bin/code", [], {
        platform,
        application: "Visual Studio Code",
        realpath: () => "/usr/bin/code",
        readCgroup: () => "0::/app.slice/herdr-world.service\n",
        spawn: h.spawn,
      }),
    ).rejects.toThrow("launcher failed");
    expect(h.commands).toHaveLength(1);
    expect(h.commands[0][0]).not.toBe("/usr/bin/code");
    expect(h.unreferenced).toBe(true);
  }
  const h = launchHarness();
  await expect(
    launchDesktopIde("/usr/bin/code", [], {
      platform: "linux",
      readCgroup: () => {
        throw new Error("proc unavailable");
      },
      spawn: h.spawn,
    }),
  ).rejects.toThrow("Could not start");
  expect(h.commands).toHaveLength(0);
});

test("missing isolation helper refuses without running the IDE", async () => {
  const commands: string[][] = [];
  await expect(
    launchDesktopIde("/usr/bin/code", ["/projects/app"], {
      platform: "linux",
      readCgroup: () => "0::/app.slice/herdr-world.service",
      spawn: (command) => {
        commands.push(command);
        throw new Error("helper missing");
      },
    }),
  ).rejects.toThrow("systemd user session");
  expect(commands).toHaveLength(1);
  expect(commands[0][0]).toBe("systemd-run");
});

test("root cgroups can launch directly; unknown supervision requires isolation", async () => {
  for (const [cgroup, command] of [
    ["0::/", "/usr/bin/code"],
    ["", "systemd-run"],
    ["1:name=systemd:/app.slice/world.service", "systemd-run"],
  ]) {
    const h = launchHarness();
    await launchDesktopIde("/usr/bin/code", [], {
      platform: "linux",
      readCgroup: () => cgroup,
      spawn: h.spawn,
    });
    expect(h.commands[0][0]).toBe(command);
  }
});
