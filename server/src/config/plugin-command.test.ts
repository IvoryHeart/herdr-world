import { afterEach, describe, expect, test, spyOn } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeUrl, readServiceEnv, runPluginCommand } from "./plugin-command";
import { runServiceCommand } from "./service-manager";

describe("readServiceEnv", () => {
  test("reads plain values", () => {
    expect(readServiceEnv("HOST=0.0.0.0\nPORT=8791\n", "HOST")).toBe("0.0.0.0");
    expect(readServiceEnv("HOST=0.0.0.0\nPORT=8791\n", "PORT")).toBe("8791");
  });

  test("accepts export prefix, whitespace, and quoted values", () => {
    const contents = "export HOST=\"0.0.0.0\"\n  PORT = '8799'\n";
    expect(readServiceEnv(contents, "HOST")).toBe("0.0.0.0");
    expect(readServiceEnv(contents, "PORT")).toBe("8799");
  });

  test("last occurrence wins and missing keys are undefined", () => {
    expect(readServiceEnv("PORT=1\nPORT=2\n", "PORT")).toBe("2");
    expect(readServiceEnv("HOST=x\n", "PORT")).toBeUndefined();
  });

  test("ignores comments and unrelated keys", () => {
    const contents =
      "# HOST=10.0.0.1\nHERDR_GUI_LOG_LEVEL=info\nHOST=127.0.0.1\n";
    expect(readServiceEnv(contents, "HOST")).toBe("127.0.0.1");
  });
});

describe("computeUrl", () => {
  const dirs: string[] = [];
  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "world-plugin-"));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
    }
    return dir;
  }
  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  test("defaults to loopback when no env file exists", () => {
    expect(computeUrl(fixture({}))).toBe("http://localhost:8787");
  });

  test("includes the login token for non-loopback binds", () => {
    const dir = fixture({
      "herdr-world.env": "HOST=0.0.0.0\nPORT=8791\n",
      "auth-token":
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    });
    expect(computeUrl(dir)).toBe(
      "http://localhost:8791/?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  test("reads the token from the service's own data folder", () => {
    const own = fixture({
      "auth-token":
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\n",
    });
    const dir = fixture({
      "herdr-world.env": `HOST=127.0.0.1\nHERDR_WORLD_DATA_DIR=${own}\n`,
      "auth-token":
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    });
    expect(computeUrl(dir)).toBe(
      "http://localhost:8787/?token=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    );
  });

  test("includes the login token for loopback binds", () => {
    const dir = fixture({
      "herdr-world.env": "HOST=127.0.0.1\nPORT=8787\n",
      "auth-token":
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    });
    expect(computeUrl(dir)).toBe(
      "http://localhost:8787/?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  test("does not publish stale tokens for fixed passwords or invalid generated credentials", () => {
    const dir = fixture({
      "herdr-world.env":
        "HOST=::1\nHERDR_WORLD_PASSWORD=synthetic-password-long-enough\n",
      "auth-token": "a".repeat(64),
    });
    expect(computeUrl(dir)).toBe("http://localhost:8787");
    writeFileSync(join(dir, "herdr-world.env"), "HOST=2001:db8::1\n");
    writeFileSync(join(dir, "auth-token"), "invalid-token");
    expect(computeUrl(dir)).toBe("http://[2001:db8::1]:8787");
  });

  test("rejects incomplete TLS instead of printing an HTTP login link", () => {
    const dir = fixture({
      "herdr-world.env": "HERDR_WORLD_TLS_CERT=missing.pem\n",
    });
    expect(() => computeUrl(dir)).toThrow("requires both");
  });

  test("honors exported and quoted entries without a token file", () => {
    const dir = fixture({
      "herdr-world.env": 'export HOST="0.0.0.0"\nPORT="8799"\n',
    });
    expect(computeUrl(dir)).toBe("http://localhost:8799");
  });
});

test("plugin dispatch rejects extra arguments and leaves other CLI commands alone", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await runPluginCommand(["service", "install"], "9.8.7")).toBeNull();
    expect(
      await runPluginCommand(["plugin", "restart", "--force"], "9.8.7"),
    ).toBe(1);
    expect(await runPluginCommand(["plugin", "version"], "9.8.7")).toBe(0);
    expect(log).toHaveBeenCalledWith("herdr-world 9.8.7");
  } finally {
    error.mockRestore();
    log.mockRestore();
  }
});

for (const [verb, exitCode, definitionType] of [
  ["start", 0, "generated"],
  ["restart", 0, "generated"],
  ["restart", 23, "generated"],
  ["restart", 1, "custom"],
] as const) {
  test.skipIf(process.platform === "win32")(
    `native ${verb} preserves configuration for a ${definitionType} service with exit ${exitCode}`,
    async () => {
      const root = mkdtempSync(join(tmpdir(), "herdr-world-native-plugin-"));
      try {
        const homeDir = join(root, "home");
        const serviceDir = join(homeDir, ".config/systemd/user");
        const configDir = join(homeDir, ".config/herdr-world");
        mkdirSync(serviceDir, { recursive: true });
        mkdirSync(configDir, { recursive: true });
        const definition = join(serviceDir, "herdr-world.service");
        const binary = join(root, "herdr-world");
        const previous =
          (definitionType === "generated"
            ? "# Generated by herdr-world service install.\n"
            : "# Custom service definition.\n") +
          "[Service]\nExecStart=/previous-installation/herdr-world\n";
        writeFileSync(definition, previous);
        const config = "HOST=127.0.0.1\nPORT=8799\n";
        const token = "a".repeat(64);
        writeFileSync(join(configDir, "herdr-world.env"), config);
        writeFileSync(join(configDir, "auth-token"), token);
        const calls: string[][] = [];
        const runNative = (file: string, args: string[]) => {
          calls.push([file, ...args]);
          const result = runServiceCommand(args, {
            runtime: {
              platform: "linux",
              homeDir,
              execPath: file,
              argv: [file, ...args],
            },
            runCommand: (argv) => {
              if (argv.includes("herdr-gui.service")) return 4;
              appendFileSync(
                join(root, "service.log"),
                JSON.stringify(argv) + "\n",
              );
              return argv.includes("daemon-reload") ? exitCode : 0;
            },
            getLanIPs: () => [],
            log: () => {},
            error: () => {},
          });
          return { status: typeof result === "number" ? result : 1 };
        };
        expect(
          await runPluginCommand(["plugin", verb], "9.8.7", binary, runNative),
        ).toBe(exitCode);
        expect(calls).toEqual([
          [
            binary,
            "service",
            "install",
            ...(verb === "start" ? ["--force"] : []),
          ],
        ]);
        expect(readFileSync(join(configDir, "herdr-world.env"), "utf8")).toBe(
          config,
        );
        expect(readFileSync(join(configDir, "auth-token"), "utf8")).toBe(token);
        if (definitionType === "custom") {
          expect(readFileSync(definition, "utf8")).toBe(previous);
          expect(existsSync(join(root, "service.log"))).toBe(false);
        } else {
          expect(readFileSync(definition, "utf8")).toContain(
            `ExecStart=${binary}\n`,
          );
          expect(readFileSync(definition, "utf8")).not.toContain(
            "/previous-installation",
          );
          expect(readFileSync(join(root, "service.log"), "utf8")).toContain(
            "daemon-reload",
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

test.skipIf(process.platform === "win32")(
  "default native dispatch preserves argv boundaries and child exit status",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "native-plugin-dispatch-"));
    try {
      const binary = join(root, "native world");
      const record = join(root, "arguments");
      const quote = (value: string) =>
        "'" + value.replaceAll("'", "'\\''") + "'";
      writeFileSync(
        binary,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + quote(record) + "\nexit 23\n",
        { mode: 0o755 },
      );
      expect(
        await runPluginCommand(["plugin", "restart"], "9.8.7", binary),
      ).toBe(23);
      expect(readFileSync(record, "utf8")).toBe("service\ninstall\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
