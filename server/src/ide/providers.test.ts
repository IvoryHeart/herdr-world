import { expect, test } from "bun:test";
import {
  detectIdeProvider,
  IDE_PROVIDERS,
  type IdeDetectEnvironment,
  ideServerArgs,
  parseIdeVersion,
} from "./providers";

function environment(
  files: Record<string, string | true>,
  overrides: Partial<IdeDetectEnvironment> = {},
): IdeDetectEnvironment {
  const links = Object.fromEntries(
    Object.entries(files).filter(([, target]) => typeof target === "string"),
  ) as Record<string, string>;
  return {
    platform: "linux",
    which: (name) => (files[`/usr/bin/${name}`] ? `/usr/bin/${name}` : null),
    exists: (path) => path in files,
    realpath: (path) => links[path] ?? path,
    isExecutableFile: (path) => files[path] === true,
    version: async () => "1.99.0",
    homeDir: "/home/example",
    ...overrides,
  };
}

test("a snap install runs its CLI, not the snap launcher", async () => {
  const snapCli = "/snap/code/current/usr/share/code/bin/code-tunnel";
  const found = await detectIdeProvider(
    "vscode",
    environment({ "/usr/bin/code": "/usr/bin/snap", [snapCli]: true }),
  );
  expect(found).toMatchObject({
    state: "detected",
    path: snapCli,
    version: "1.99.0",
    configured: false,
  });
});

test("a package install runs the code-tunnel beside its launcher", async () => {
  const found = await detectIdeProvider(
    "vscode",
    environment({
      "/usr/bin/code": "/usr/share/code/bin/code",
      "/usr/share/code/bin/code-tunnel": true,
    }),
  );
  expect(found).toMatchObject({
    state: "detected",
    path: "/usr/share/code/bin/code-tunnel",
  });
});

test("macOS finds the app bundle's CLI", async () => {
  const cli =
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel";
  const found = await detectIdeProvider(
    "vscode",
    environment({ [cli]: true }, { platform: "darwin" }),
  );
  expect(found).toMatchObject({ state: "detected", path: cli });
});

test("a configured program wins and a broken one says so", async () => {
  const env = environment({
    "/opt/ide/bin/code-server": true,
    "/usr/bin/code-server": true,
  });
  expect(
    await detectIdeProvider("code-server", env, "/opt/ide/bin/code-server"),
  ).toMatchObject({
    state: "detected",
    path: "/opt/ide/bin/code-server",
    configured: true,
  });
  expect(
    await detectIdeProvider("code-server", env, "/opt/missing"),
  ).toMatchObject({
    state: "missing",
    configured: true,
  });
  expect(await detectIdeProvider("openvscode", env)).toMatchObject({
    state: "missing",
  });
  expect(
    await detectIdeProvider("vscode", environment({}, { platform: "win32" })),
  ).toMatchObject({
    state: "unsupported",
  });
});

test("version lines from each provider", () => {
  expect(parseIdeVersion("code 1.146.0 (commit abc, 2026-11-01)\n")).toBe(
    "1.146.0",
  );
  expect(parseIdeVersion("4.99.1 abcdef with Code 1.99.0\n")).toBe("4.99.1");
  expect(parseIdeVersion("\n1.98.2\nabc\nx64\n")).toBe("1.98.2");
  expect(parseIdeVersion("nothing")).toBeNull();
});

test("fixed argument lists per provider", () => {
  const launch = {
    basePath: "/ide/x",
    socketPath: "/run/s",
    tokenFile: "/run/t",
    folder: "/work/p",
  };
  expect(ideServerArgs("vscode", launch).args).toEqual([
    "serve-web",
    "--socket-path",
    "/run/s",
    "--connection-token-file",
    "/run/t",
    "--server-base-path",
    "/ide/x",
    "--default-folder",
    "/work/p",
    "--accept-server-license-terms",
  ]);
  expect(ideServerArgs("openvscode", launch).args).not.toContain(
    "--accept-server-license-terms",
  );
  expect(ideServerArgs("code-server", launch)).toEqual({
    args: [
      "--socket",
      "/run/s",
      "--socket-mode",
      "600",
      "--auth",
      "none",
      "--disable-update-check",
      // No generic port proxies behind World's route.
      "--disable-proxy",
      "/work/p",
    ],
    stripsBasePath: true,
  });
});

test("only Microsoft's build signs its connection, which needs HTTPS", () => {
  expect(IDE_PROVIDERS.vscode.needsSecurePage).toBe(true);
  expect(IDE_PROVIDERS.openvscode.needsSecurePage).toBe(false);
  expect(IDE_PROVIDERS["code-server"].needsSecurePage).toBe(false);
});
