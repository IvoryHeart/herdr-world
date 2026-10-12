import { describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { runServiceCommand } from "./service-manager";
import { dirname, join } from "node:path";
import {
  type ServerConfig,
  herdrConfigDir,
  nativeSocketPath,
  browserUrlFor,
  loadServerConfig,
  loadServerTls,
  resolveServerLogLevel,
} from "./server-config";

describe("herdrConfigDir", () => {
  test("uses APPDATA on win32", () => {
    const appData = join("C:", "AppData", "Roaming");
    expect(herdrConfigDir("win32", appData)).toBe(join(appData, "herdr"));
  });

  test("falls back under the home directory on win32 without APPDATA", () => {
    expect(herdrConfigDir("win32", null)).toBe(
      join(homedir(), "AppData", "Roaming", "herdr"),
    );
  });

  test("uses the XDG-style config dir on other platforms", () => {
    expect(herdrConfigDir("darwin")).toBe(join(homedir(), ".config", "herdr"));
    expect(herdrConfigDir("linux")).toBe(join(homedir(), ".config", "herdr"));
  });
});

describe("resolveServerLogLevel", () => {
  test("prefers the CLI value over the environment", () => {
    expect(resolveServerLogLevel("debug", "error")).toBe("debug");
  });

  test("uses the environment and defaults to info", () => {
    expect(resolveServerLogLevel(undefined, "warn")).toBe("warn");
    expect(resolveServerLogLevel(undefined, undefined)).toBe("info");
  });
});

describe("native TLS", () => {
  test("keeps HTTP by default and rejects incomplete or unreadable TLS settings", () => {
    expect(loadServerTls(undefined, undefined)).toBeUndefined();
    expect(() => loadServerTls("cert.pem", undefined)).toThrow("requires both");
    expect(() => loadServerTls(undefined, "key.pem")).toThrow("requires both");
    expect(() =>
      loadServerTls(
        "/nonexistent-roamgate-test/cert.pem",
        "/nonexistent-roamgate-test/key.pem",
      ),
    ).toThrow("Invalid TLS configuration");
    expect(browserUrlFor("0.0.0.0", 8787)).toBe("http://localhost:8787");
    expect(browserUrlFor("0.0.0.0", 8443, true)).toBe("https://localhost:8443");
    expect(browserUrlFor("192.0.2.10", 8443, true)).toBe(
      "https://192.0.2.10:8443",
    );
    expect(browserUrlFor("2001:db8::1", 8443, true)).toBe(
      "https://[2001:db8::1]:8443",
    );
  });

  test.skipIf(!Bun.which("openssl"))(
    "loads PEM files, honors CLI precedence, and serves trusted HTTPS and WSS",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "roamgate-tls-test-"));
      const cert = join(dir, "cert.pem"),
        key = join(dir, "key.pem");
      const originalArgs = process.argv;
      const originalCert = process.env.HERDR_WORLD_TLS_CERT;
      const originalKey = process.env.HERDR_WORLD_TLS_KEY;
      try {
        writeFileSync(
          join(dir, "openssl.cnf"),
          "[req]\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n",
        );
        const generated = Bun.spawnSync(
          [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-sha256",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-keyout",
            key,
            "-out",
            cert,
            "-config",
            join(dir, "openssl.cnf"),
          ],
          { stdout: "ignore", stderr: "pipe" },
        );
        expect(generated.exitCode).toBe(0);
        const tls = loadServerTls(cert, key)!;
        process.env.HERDR_WORLD_TLS_CERT = "missing-cert.pem";
        process.env.HERDR_WORLD_TLS_KEY = "missing-key.pem";
        process.argv = [
          process.execPath,
          "herdr-world",
          "--host",
          "127.0.0.1",
          "--tls-cert",
          cert,
          "--tls-key",
          key,
        ];
        expect(loadServerConfig("0.0.0").tls).toEqual(tls);
        process.argv = [process.execPath, "herdr-world", "--host", "127.0.0.1"];
        process.env.HERDR_WORLD_TLS_CERT = cert;
        process.env.HERDR_WORLD_TLS_KEY = key;
        expect(loadServerConfig("0.0.0").tls).toEqual(tls);
        if (process.platform !== "win32") {
          const configDir = join(dir, ".config", "herdr-world");
          mkdirSync(configDir, { recursive: true });
          writeFileSync(
            join(configDir, "herdr-world.env"),
            `HOST=0.0.0.0\nPORT=8443\nHERDR_WORLD_TLS_CERT=${JSON.stringify(cert)}\nHERDR_WORLD_TLS_KEY=${JSON.stringify(key)}\n`,
          );
          const logs: string[] = [];
          expect(
            runServiceCommand(["service", "install"], {
              runtime: {
                platform: "linux",
                homeDir: dir,
                execPath: "/opt/herdr-world-test/bin/herdr-world",
                argv: [
                  "/opt/herdr-world-test/bin/herdr-world",
                  "service",
                  "install",
                ],
                uid: 1000,
              },
              runCommand: (argv) =>
                argv.includes("herdr-gui.service") ? 4 : 0,
              getLanIPs: () => ["192.0.2.10"],
              log: (message) => logs.push(message),
            }),
          ).toBe(0);
          expect(
            logs.some((line) =>
              line.startsWith("Open: https://localhost:8443/"),
            ),
          ).toBe(true);
          expect(
            logs.some((line) =>
              line.startsWith("LAN: https://192.0.2.10:8443/"),
            ),
          ).toBe(true);
        }
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          tls,
          fetch(req, server) {
            if (server.upgrade(req)) return;
            return new Response("secure");
          },
          websocket: {
            message(ws, data) {
              ws.send(data);
            },
          },
        });
        let socket: WebSocket | undefined;
        try {
          expect(
            await (
              await fetch(`https://127.0.0.1:${server.port}`, {
                tls: { ca: tls.cert },
              })
            ).text(),
          ).toBe("secure");
          socket = Reflect.construct(WebSocket, [
            `wss://127.0.0.1:${server.port}`,
            { tls: { ca: tls.cert } },
          ]) as WebSocket;
          const echoed = new Promise<string>((resolve, reject) => {
            socket!.onopen = () => socket!.send("hello");
            socket!.onmessage = (event) => resolve(String(event.data));
            socket!.onerror = () => reject(new Error("WSS connection failed"));
          });
          expect(await echoed).toBe("hello");
        } finally {
          socket?.close();
          server.stop(true);
        }
        const otherKey = join(dir, "other-key.pem");
        expect(
          Bun.spawnSync(["openssl", "genrsa", "-out", otherKey, "2048"], {
            stdout: "ignore",
            stderr: "pipe",
          }).exitCode,
        ).toBe(0);
        expect(() => loadServerTls(cert, otherKey)).toThrow(
          "Invalid TLS configuration",
        );
        writeFileSync(key, "not a PEM private key");
        expect(() => loadServerTls(cert, key)).toThrow(
          "Invalid TLS configuration",
        );
        writeFileSync(cert, "not a PEM certificate");
        expect(() => loadServerTls(cert, otherKey)).toThrow(
          "Invalid TLS configuration",
        );
      } finally {
        process.argv = originalArgs;
        if (originalCert === undefined) delete process.env.HERDR_WORLD_TLS_CERT;
        else process.env.HERDR_WORLD_TLS_CERT = originalCert;
        if (originalKey === undefined) delete process.env.HERDR_WORLD_TLS_KEY;
        else process.env.HERDR_WORLD_TLS_KEY = originalKey;
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("nativeSocketPath", () => {
  test("maps Herdr's Windows socket name onto its named pipe", () => {
    const logical = String.raw`C:\AppData\Roaming\herdr\herdr.sock`;
    const native = String.raw`\\.\pipe\C:\AppData\Roaming\herdr\herdr.sock`;

    expect(nativeSocketPath(logical, "win32")).toBe(native);
    expect(nativeSocketPath(native, "win32")).toBe(native);
    const upperPrefix = String.raw`\\.\PIPE\existing`;
    expect(nativeSocketPath(upperPrefix, "win32")).toBe(upperPrefix);
    expect(nativeSocketPath(logical, "linux")).toBe(logical);
  });
});

test.each(["127.0.0.1", "localhost", "::1"])(
  "requires login on loopback %s",
  (host) => {
    const previousArgv = process.argv;
    try {
      process.argv = [
        process.execPath,
        "herdr-world",
        "--host",
        host,
        "--password",
        "synthetic-login-password",
      ];
      const config = loadServerConfig("0.0.0");
      expect(config.authRequired).toBe(true);
      expect(config.password).toBe("synthetic-login-password");
    } finally {
      process.argv = previousArgv;
    }
  },
);

test("reading configuration for management commands does not create or rotate session signing state", () => {
  const dir = mkdtempSync(join(tmpdir(), "roamgate-session-config-"));
  try {
    const statePath = join(
      dir,
      process.platform === "win32" ? "herdr-world" : ".config/herdr-world",
      "session-secret.json",
    );
    const load = (password: string) => {
      const result = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `import {loadServerConfig} from ${JSON.stringify(join(import.meta.dir, "server-config.ts"))}; process.argv = [process.execPath, "herdr-world"]; loadServerConfig("test");`,
        ],
        {
          env: {
            ...process.env,
            HOME: dir,
            APPDATA: dir,
            NODE_ENV: "production",
            HERDR_WORLD_PASSWORD: password,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.exitCode).toBe(0);
    };
    load("first-test-password");
    expect(existsSync(statePath)).toBe(false);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, "existing-signing-state");
    load("other-test-password");
    load("");
    expect(readFileSync(statePath, "utf8")).toBe("existing-signing-state");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("optional PIN configuration", () => {
  test.each([
    undefined,
    "",
    "012345",
    "123456789012",
    "12345",
    "1234567890123",
    "12345a",
    " 123456",
    "１２３４５６",
  ])(
    "validates HERDR_WORLD_PIN=%s without weakening the strong credential",
    (pin) => {
      const dir = mkdtempSync(join(tmpdir(), "roamgate-pin-config-"));
      try {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          HOME: dir,
          APPDATA: dir,
          NODE_ENV: "production",
          HERDR_WORLD_PASSWORD: "strong-test-password",
        };
        delete env.HERDR_GUI_PIN;
        if (pin === undefined) delete env.HERDR_WORLD_PIN;
        else env.HERDR_WORLD_PIN = pin;
        const result = Bun.spawnSync(
          [
            process.execPath,
            "-e",
            `import {loadServerConfig} from ${JSON.stringify(join(import.meta.dir, "server-config.ts"))}; process.argv = [process.execPath, "herdr-world"]; console.log(JSON.stringify(loadServerConfig("test")));`,
          ],
          { env, stdout: "pipe", stderr: "pipe" },
        );
        const valid = !pin || /^[0-9]{6,12}$/.test(pin);
        expect(result.exitCode).toBe(valid ? 0 : 2);
        if (valid) {
          const config = JSON.parse(result.stdout.toString()) as ServerConfig;
          expect(config.pin).toBe(pin || undefined);
          expect(config.password).toBe("strong-test-password");
          expect(config.generatedAuthToken).toBeUndefined();
        } else {
          expect(result.stderr.toString()).toContain("6 to 12 ASCII digits");
          expect(result.stderr.toString()).not.toContain(pin!);
        }
        expect(existsSync(join(dir, ".config", "herdr-world"))).toBe(false);
        expect(existsSync(join(dir, "herdr-world"))).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test("PIN keeps generated-token recovery and follows environment precedence", () => {
    const dir = mkdtempSync(join(tmpdir(), "roamgate-pin-config-"));
    try {
      let token: string | undefined;
      for (const [pin, legacyPin, expected] of [
        [undefined, "012345", undefined],
        ["", "012345", undefined],
        ["654321", "invalid", "654321"],
      ] as const) {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          HOME: dir,
          APPDATA: dir,
          NODE_ENV: "production",
          HERDR_WORLD_PASSWORD: "",
          HERDR_GUI_PIN: legacyPin,
        };
        if (pin === undefined) delete env.HERDR_WORLD_PIN;
        else env.HERDR_WORLD_PIN = pin;
        const result = Bun.spawnSync(
          [
            process.execPath,
            "-e",
            `import {loadServerConfig} from ${JSON.stringify(join(import.meta.dir, "server-config.ts"))}; process.argv = [process.execPath, "herdr-world"]; console.log(JSON.stringify(loadServerConfig("test")));`,
          ],
          { env, stdout: "pipe", stderr: "pipe" },
        );
        expect(result.exitCode).toBe(0);
        const config = JSON.parse(result.stdout.toString()) as ServerConfig;
        expect(config.pin).toBe(expected);
        expect(config.generatedAuthToken).toMatch(/^[a-f0-9]{64}$/);
        expect(config.password).toBe(config.generatedAuthToken!);
        if (token) expect(config.generatedAuthToken).toBe(token);
        token = config.generatedAuthToken;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
