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
  await launchDesktopIde(process.execPath, ["-e", "process.exit(0)"]);
  await expect(
    launchDesktopIde(process.execPath, ["-e", "process.exit(1)"]),
  ).rejects.toThrow("launcher failed");
  await expect(launchDesktopIde("/missing/ide-launcher", [])).rejects.toThrow(
    "Could not start",
  );
});
