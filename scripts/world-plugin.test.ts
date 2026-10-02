import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeUrl,
  parseSha256File,
  readServiceEnv,
  releaseAssetFor,
  resolvePluginRoot,
} from "./world-plugin";

describe("plugin build commands", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function checkout() {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "world-plugin-build-test-")),
    );
    roots.push(root);
    for (const dir of ["scripts", "server", "bin"]) {
      mkdirSync(join(root, dir));
    }
    copyFileSync(
      join(import.meta.dir, "world-plugin.ts"),
      join(root, "scripts/world-plugin.ts"),
    );
    mkdirSync(join(root, "server/src/config"), { recursive: true });
    copyFileSync(
      join(import.meta.dir, "../server/src/config/data-paths.ts"),
      join(root, "server/src/config/data-paths.ts"),
    );
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.0.0" }),
    );
    writeFileSync(join(root, "herdr-plugin.toml"), 'version = "9.8.7"\n');
    writeFileSync(
      join(root, "bin/bun"),
      `#!/bin/sh
printf '%s: %s\\n' "$PWD" "$*" >> "$BUILD_LOG"
[ "$PWD" != "$FAIL_DIR" ] || exit 23
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(root, "fetch.js"),
      `import { appendFileSync } from "node:fs";
globalThis.fetch = async (url) => {
  appendFileSync(process.env.FETCH_LOG, url + "\\n");
  if (process.env.HTTP_STATUS === "throw") throw new Error("network unavailable");
  return new Response("missing", { status: Number(process.env.HTTP_STATUS) });
};
`,
    );
    return root;
  }

  function invoke(
    root: string,
    verb: string,
    env: Record<string, string> = {},
  ) {
    return Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        join(root, "fetch.js"),
        join(root, "scripts/world-plugin.ts"),
        verb,
      ],
      {
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
          BUILD_LOG: join(root, "build.log"),
          FETCH_LOG: join(root, "fetch.log"),
          HTTP_STATUS: "404",
          FAIL_DIR: "",
          ...env,
        },
      },
    );
  }

  test("build-source installs all dependencies and builds without downloading a release", () => {
    const root = checkout();
    const result = invoke(root, "build-source");
    expect(result.exitCode).toBe(0);
    expect(
      readFileSync(join(root, "build.log"), "utf8").trim().split("\n"),
    ).toEqual([
      `${root}: install --frozen-lockfile`,
      `${root}: run build`,
      `${root}: build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig ${root}/scripts/world-plugin.ts --outfile ${root}/server/herdr-world-plugin.exe`,
    ]);
    expect(existsSync(join(root, "fetch.log"))).toBe(false);
  });

  test("build-source stops on dependency installation failure", () => {
    const root = checkout();
    expect(invoke(root, "build-source", { FAIL_DIR: root }).exitCode).toBe(23);
    expect(
      readFileSync(join(root, "build.log"), "utf8").trim().split("\n"),
    ).toHaveLength(1);
    expect(existsSync(join(root, "fetch.log"))).toBe(false);
  });

  test.each(["404", "500", "throw"])(
    "release-only build fails actionably on %s and explains source fallback",
    (status) => {
      const root = checkout();
      const result = invoke(root, "build", { HTTP_STATUS: status });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(
        "bun scripts/world-plugin.ts build-source",
      );
      expect(result.stderr.toString()).toContain("herdr plugin link .");
      expect(result.stderr.toString()).toContain("--ref vX.Y.Z");
      expect(existsSync(join(root, "build.log"))).toBe(false);
      const requests = readFileSync(join(root, "fetch.log"), "utf8")
        .trim()
        .split("\n");
      expect(requests).toHaveLength(2);
      for (const url of requests) {
        expect(url).toContain("/releases/download/v9.8.7/herdr-world-");
      }
      expect(existsSync(join(root, "server/herdr-world"))).toBe(false);
      expect(existsSync(join(root, "server/herdr-world.exe"))).toBe(false);
    },
  );

  test("compiled actions work with Bun absent from the server PATH", () => {
    if (process.platform === "win32") return;
    const root = checkout();
    writeFileSync(
      join(root, "server/herdr-world"),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "herdr-world 9.8.7"; else echo "installed"; fi\n',
      { mode: 0o755 },
    );
    mkdirSync(join(root, "real-bin"));
    symlinkSync(process.execPath, join(root, "real-bin/bun"));
    const build = Bun.spawnSync(
      [
        process.execPath,
        join(root, "scripts/world-plugin.ts"),
        "compile-launcher",
      ],
      {
        env: {
          ...process.env,
          PATH: `${join(root, "real-bin")}:/usr/bin:/bin`,
        },
      },
    );
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
    const launcher = join(root, "server/herdr-world-plugin.exe");
    expect(existsSync(launcher)).toBe(true);
    for (const [verb, expected] of [
      ["version", "herdr-world 9.8.7"],
      ["status", "installed"],
    ]) {
      const result = Bun.spawnSync([launcher, verb], {
        cwd: root,
        env: { ...process.env, PATH: "/usr/bin:/bin" },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe(expected);
    }
  });
});

test("compiled launcher resolves the plugin checkout instead of Bun's virtual module URL", () => {
  expect(
    resolvePluginRoot(
      "/plugin/server/herdr-world-plugin.exe",
      "file:///$bunfs/root/herdr-world-plugin.exe",
    ),
  ).toBe("/plugin");
});

test("plugin actions and panel use the standalone launcher", () => {
  const manifest = Bun.TOML.parse(
    readFileSync(join(import.meta.dir, "../herdr-plugin.toml"), "utf8"),
  ) as {
    build: Array<{ command: string[] }>;
    panes: Array<{ command: string[] }>;
    actions: Array<{ command: string[] }>;
  };
  expect(manifest.build[0]?.command).toEqual([
    "bun",
    "scripts/world-plugin.ts",
    "build",
  ]);
  for (const entry of [...manifest.panes, ...manifest.actions]) {
    expect(entry.command[0]).toBe("server/herdr-world-plugin.exe");
  }
});

describe("releaseAssetFor", () => {
  test("maps every supported platform to an archive and binary name", () => {
    expect(releaseAssetFor("darwin", "arm64")).toEqual({
      asset: "herdr-world-darwin-arm64",
      binary: "herdr-world",
    });
    expect(releaseAssetFor("linux", "x64")).toEqual({
      asset: "herdr-world-linux-x64",
      binary: "herdr-world",
    });
    expect(releaseAssetFor("win32", "x64")?.binary).toBe("herdr-world.exe");
    expect(releaseAssetFor("win32", "arm64")?.asset).toBe(
      "herdr-world-windows-arm64",
    );
  });

  test("returns null for unsupported platforms", () => {
    expect(releaseAssetFor("freebsd", "x64")).toBeNull();
    expect(releaseAssetFor("darwin", "ia32")).toBeNull();
  });
});

describe("parseSha256File", () => {
  test("extracts the digest from shasum output", () => {
    const digest = "a".repeat(64);
    expect(
      parseSha256File(`${digest}  herdr-world-darwin-arm64.tar.xz\n`),
    ).toBe(digest);
  });

  test("rejects content without a digest", () => {
    expect(parseSha256File("not a checksum")).toBeNull();
    expect(parseSha256File("zzzz" + "0".repeat(60))).toBeNull();
  });
});

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
      "# HOST=10.0.0.1\nUNRELATED_SETTING=info\nHOST=127.0.0.1\n";
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
    expect(computeUrl(fixture({}))).toBe("http://127.0.0.1:8787");
  });

  test("includes the login token only for non-loopback binds", () => {
    const dir = fixture({
      "herdr-world.env": "HOST=0.0.0.0\nPORT=8791\n",
      "auth-token": "abc123\n",
    });
    expect(computeUrl(dir)).toBe("http://localhost:8791/?token=abc123");
  });

  test("ignores a stale token file on loopback binds", () => {
    const dir = fixture({
      "herdr-world.env": "HOST=127.0.0.1\nPORT=8787\n",
      "auth-token": "abc123\n",
    });
    expect(computeUrl(dir)).toBe("http://127.0.0.1:8787");
  });

  test("password values suppress tokens, while empty values do not", () => {
    const dir = fixture({
      "herdr-world.env": "HOST=0.0.0.0\nHERDR_WORLD_PASSWORD=new\n",
      "auth-token": "saved-token\n",
    });
    expect(computeUrl(dir)).toBe("http://localhost:8787");
    writeFileSync(
      join(dir, "herdr-world.env"),
      "HOST=0.0.0.0\nHERDR_WORLD_PASSWORD=\n",
    );
    expect(computeUrl(dir)).toBe("http://localhost:8787/?token=saved-token");
  });

  test("honors exported and quoted entries without a token file", () => {
    const dir = fixture({
      "herdr-world.env": 'export HOST="0.0.0.0"\nPORT = "8799"\n',
    });
    expect(computeUrl(dir)).toBe("http://localhost:8799");
  });
});
