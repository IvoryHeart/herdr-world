import { expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHerdrCommand } from "./cli";
import { findHerdrBinary, detectHerdrSetup } from "./bootstrap";
import { installVerifiedHerdr, VERIFIED_HERDR_VERSION } from "./release";
import { upgradeHerdr } from "./upgrade";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "world-missing-herdr-"));
  const installDir = join(root, "runtime");
  const external = join(root, "external");
  mkdirSync(installDir);
  mkdirSync(external);
  const binary = join(installDir, "herdr");
  const payload = `herdr ${VERIFIED_HERDR_VERSION}\n`;
  const deps = {
    platform: "linux",
    arch: "x64",
    homeDir: root,
    installDir,
    pathEnv: external,
    binPathEnv: "",
    worldVersion: "0.2.7",
    installMissing: true,
    onlyIfMissing: true,
    readVersion: (path: string) => readFileSync(path, "utf8"),
    expectedSha256: new Bun.CryptoHasher("sha256")
      .update(payload)
      .digest("hex"),
    download: async (_url: string, path: string) => {
      writeFileSync(path, payload);
    },
  };
  return {
    root,
    binary,
    external,
    payload,
    deps,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test.each(["0.8.2", "999.0.0"])(
  "missing-only operation preserves %s appearing after status",
  async (version) => {
    const f = fixture();
    try {
      expect(findHerdrBinary(f.deps)).toBeNull();
      const previous = `herdr ${version}\n`;
      writeFileSync(f.binary, previous, { mode: 0o755 });
      const report = await upgradeHerdr({
        ...f.deps,
        download: async () => {
          throw new Error("Existing Herdr must not download");
        },
      });
      expect(readFileSync(f.binary, "utf8")).toBe(previous);
      expect(report.binary).toBe("unchanged");
      expect(report.integrations).toEqual([]);
      expect(report.plugin.action).toBe("skipped");
    } finally {
      f.clean();
    }
  },
);

test.each(["0.8.2", "999.0.0"])(
  "missing-only operation preserves %s appearing during download",
  async (version) => {
    const f = fixture();
    try {
      const previous = `herdr ${version}\n`;
      const report = await upgradeHerdr({
        ...f.deps,
        download: async (_url, path) => {
          writeFileSync(f.binary, previous, { mode: 0o755 });
          writeFileSync(path, f.payload);
        },
      });
      expect(readFileSync(f.binary, "utf8")).toBe(previous);
      expect(report.binary).toBe("unchanged");
    } finally {
      f.clean();
    }
  },
);

test("a runtime appearing on another PATH entry prevents default publication", async () => {
  const f = fixture();
  try {
    const external = join(f.external, "herdr");
    const report = await upgradeHerdr({
      ...f.deps,
      download: async (_url, path) => {
        writeFileSync(external, "herdr 999.0.0\n", { mode: 0o755 });
        writeFileSync(path, f.payload);
      },
    });
    expect(report.binary).toBe("unchanged");
    expect(report.binaryPath).toBe(external);
    expect(existsSync(f.binary)).toBe(false);
  } finally {
    f.clean();
  }
});

test.each(["file", "symlink", "directory"])(
  "atomic publication preserves a late %s after the last lookup",
  async (kind) => {
    const f = fixture();
    try {
      const operation = installVerifiedHerdr({
        ...f.deps,
        findExistingBinary: () => {
          if (kind === "file")
            writeFileSync(f.binary, "herdr 999.0.0\n", { mode: 0o755 });
          else if (kind === "symlink")
            symlinkSync(join(f.root, "not-created"), f.binary);
          else mkdirSync(f.binary);
          return null;
        },
      });
      if (kind === "file") expect((await operation).installed).toBe(false);
      else await expect(operation).rejects.toThrow(f.binary);
      if (kind === "file")
        expect(readFileSync(f.binary, "utf8")).toBe("herdr 999.0.0\n");
      else if (kind === "symlink")
        expect(readlinkSync(f.binary)).toBe(join(f.root, "not-created"));
      else expect(lstatSync(f.binary).isDirectory()).toBe(true);
    } finally {
      f.clean();
    }
  },
);

test("concurrent missing installers use isolated staging and exactly one publishes", async () => {
  const f = fixture();
  try {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const download = async (_url: string, path: string) => {
      writeFileSync(path, f.payload);
      if (++arrivals === 2) release();
      await barrier;
    };
    const results = await Promise.all([
      installVerifiedHerdr({ ...f.deps, download }),
      installVerifiedHerdr({ ...f.deps, download }),
    ]);
    expect(results.filter((result) => result.installed)).toHaveLength(1);
    expect(readFileSync(f.binary, "utf8")).toBe(f.payload);
  } finally {
    f.clean();
  }
});

test("CLI missing-only flag reaches the protected operation without integration changes", async () => {
  const f = fixture();
  try {
    writeFileSync(f.binary, "herdr 0.8.2\n", { mode: 0o755 });
    const messages: string[] = [];
    const code = await runHerdrCommand(
      ["herdr", "upgrade", "--install", "--only-if-missing"],
      "0.2.7",
      {
        loadConfig: () =>
          ({ socketPath: join(f.root, "fixture.sock") }) as never,
        log: (line) => messages.push(line),
        error: (line) => {
          throw new Error(line);
        },
        upgrade: (options) =>
          upgradeHerdr({ ...f.deps, onlyIfMissing: false, ...options }),
      },
    );
    expect(code).toBe(0);
    expect(messages.join("\n")).toContain("left unchanged");
    expect(readFileSync(f.binary, "utf8")).toBe("herdr 0.8.2\n");
  } finally {
    f.clean();
  }
});

test.each([false, true])(
  "pre-existing dangling entry is reported before download (missing-only=%s)",
  async (onlyIfMissing) => {
    const f = fixture();
    try {
      const blockedTarget = join(f.root, "absent");
      symlinkSync(blockedTarget, f.binary);
      let downloads = 0;
      const deps = {
        ...f.deps,
        onlyIfMissing,
        download: async () => {
          downloads++;
        },
      };
      await expect(
        onlyIfMissing ? upgradeHerdr(deps) : installVerifiedHerdr(deps),
      ).rejects.toThrow(f.binary);
      expect(downloads).toBe(0);
      expect(readlinkSync(f.binary)).toBe(blockedTarget);
    } finally {
      f.clean();
    }
  },
);

test.each(["directory", "non-executable"])(
  "real discovery cannot bypass CLI validation for a %s",
  async (kind) => {
    const f = fixture();
    try {
      if (kind === "directory") mkdirSync(f.binary);
      else writeFileSync(f.binary, "preserved", { mode: 0o644 });
      const original = lstatSync(f.binary);
      const discovery = await detectHerdrSetup({
        ...f.deps,
        ping: async () => {
          throw new Error("not running");
        },
      });
      expect(discovery).toEqual({ state: "installed", binaryPath: f.binary });
      let downloads = 0;
      await expect(
        upgradeHerdr({
          ...f.deps,
          readVersion: () => "",
          download: async () => {
            downloads++;
          },
        }),
      ).rejects.toThrow(
        `Herdr installation blocked by non-executable entry: ${f.binary}`,
      );
      expect(downloads).toBe(0);
      expect(lstatSync(f.binary).ino).toBe(original.ino);
      expect(lstatSync(f.binary).mode).toBe(original.mode);
      if (kind === "directory")
        expect(lstatSync(f.binary).isDirectory()).toBe(true);
      else expect(readFileSync(f.binary, "utf8")).toBe("preserved");
    } finally {
      f.clean();
    }
  },
);
