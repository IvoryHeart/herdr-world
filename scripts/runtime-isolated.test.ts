import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  assertIsolation,
  controlOperation,
  isolationEndpoints,
  type Kit,
  kitBase,
  kitEnv,
  kitRoot,
  paths,
  processHelper,
  readKit,
  removeUninitializedKit,
  saveKit,
  stopKit,
} from "./runtime-isolated-kit";

const kits: Kit[] = [];
const linux = process.platform === "linux" ? test : test.skip;
afterEach(async () => {
  for (const kit of kits.splice(0)) {
    await processHelper("stop", kit.token);
    rmSync(kit.root, { recursive: true, force: true });
  }
});

function fixture(): Kit {
  const token = randomBytes(16).toString("hex");
  const name = `test-${token.slice(0, 8)}`;
  const root = kitRoot(name);
  mkdirSync(kitBase(), { recursive: true, mode: 0o700 });
  mkdirSync(root, { mode: 0o700 });
  const kit: Kit = {
    version: 1,
    name,
    root,
    token,
    session: `kit-${name}-${token.slice(0, 8)}`,
    binaries: { tui: "/synthetic/tui", core: "/synthetic/core" },
    versions: {},
  };
  for (const dir of ["home", "config", "state", "run", "world", "scratch"])
    mkdirSync(`${root}/${dir}`, { mode: 0o700 });
  saveKit(kit);
  kits.push(kit);
  return kit;
}

test.each(["default", "../owner", "a/b", "A", "", "a".repeat(21)])(
  "unsafe name %j is refused",
  (name) => {
    expect(() => kitRoot(name)).toThrow("name must");
  },
);

linux(
  "child environment is independent of owner runtime, credentials and shell startup",
  () => {
    const kit = fixture();
    const env = kitEnv(kit, {
      PATH: "/usr/bin:/bin",
      HOME: "/owner",
      XDG_STATE_HOME: "/owner/state",
      HERDR_SOCKET_PATH: "/owner/socket",
      HERDR_SESSION: "default",
      HC_SESSION: "default",
      HC_SOCKET: "/owner/core",
      HERDR_UNKNOWN_FUTURE_VARIABLE: "owner",
      HC_UNKNOWN_FUTURE_VARIABLE: "owner",
      HERDR_WORLD_DATA_DIR: "/owner/world",
      CLAUDE_CONFIG_DIR: "/owner/claude",
      CODEX_HOME: "/owner/codex",
      ANTHROPIC_API_KEY: "synthetic-secret",
      OPENAI_API_KEY: "synthetic-secret",
      BASH_ENV: "/owner/startup",
      ENV: "/owner/startup",
      NODE_OPTIONS: "--require=/owner/startup",
    });
    expect(Object.values(env).some((value) => value.includes("/owner"))).toBe(
      false,
    );
    expect(env.HERDR_SESSION).not.toBe("default");
    expect(env.HC_SESSION).toBe(kit.session);
    expect(env.HERDR_SOCKET_PATH).toBe(paths(kit).tui);
    for (const key of [
      "HC_SOCKET",
      "HERDR_UNKNOWN_FUTURE_VARIABLE",
      "HC_UNKNOWN_FUTURE_VARIABLE",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "BASH_ENV",
      "ENV",
      "NODE_OPTIONS",
    ])
      expect(env[key]).toBeUndefined();
  },
);

linux("a changed manifest or a symlink cannot redirect cleanup", async () => {
  const kit = fixture();
  writeFileSync(
    `${kit.root}/kit.json`,
    JSON.stringify({ ...kit, root: "/synthetic/owner" }),
  );
  await expect(stopKit(kit)).rejects.toThrow("invalid run manifest");
  saveKit(kit);
  rmSync(`${kit.root}/state`, { recursive: true });
  symlinkSync(`${kit.root}/scratch`, `${kit.root}/state`);
  await expect(assertIsolation(kit, false)).rejects.toThrow("private and real");
});

linux("core lock cannot select a default socket or follow a symlink", () => {
  const kit = fixture();
  mkdirSync(paths(kit).core, { recursive: true, mode: 0o700 });
  const lock = `${paths(kit).core}/core.lock`;
  writeFileSync(lock, "/synthetic/owner/default.sock");
  expect(() => isolationEndpoints(kit)).toThrow("core socket escaped");
  rmSync(lock);
  writeFileSync(`${kit.root}/foreign.lock`, "/synthetic/owner/default.sock");
  symlinkSync(`${kit.root}/foreign.lock`, lock);
  expect(() => isolationEndpoints(kit)).toThrow("owned regular file");
});

linux("stop recovers a crash before the initial manifest was published", () => {
  const kit = fixture();
  rmSync(kit.root, { recursive: true });
  mkdirSync(kit.root, { mode: 0o700 });
  writeFileSync(`${kit.root}/kit.json.new`, '{"interrupted":');
  expect(removeUninitializedKit(kit.name)).toBe(true);
  expect(existsSync(kit.root)).toBe(false);
  mkdirSync(kit.root, { mode: 0o700 });
  writeFileSync(`${kit.root}/unknown-file`, "preserve");
  expect(() => removeUninitializedKit(kit.name)).toThrow("missing manifest");
  expect(readFileSync(`${kit.root}/unknown-file`, "utf8")).toBe("preserve");
});

linux(
  "operation lock refuses concurrent controls and releases without stale PID recovery",
  async () => {
    // Nested acquisition refuses immediately; returning releases the kernel lock.
    await controlOperation(async () => {
      await expect(controlOperation(async () => true)).rejects.toThrow(
        "another kit operation",
      );
    });
    expect(await controlOperation(async () => "released")).toBe("released");
  },
);

function sleeper(env: Record<string, string>, descendant = false) {
  // The test runner injects its own HERDR_* tripwire variables into subprocess
  // launches. Strip those in this inert sleep fixture before its final exec.
  const inner = descendant
    ? "env -i /bin/sleep 600 & echo ready; wait"
    : "echo ready; exec /bin/sleep 600";
  const proc = spawn(
    "/bin/sh",
    [
      "-c",
      `unset HERDR_WORLD_TEST_ISOLATION HERDR_WORLD_TEST_TRIPWIRE; exec /bin/sh -c '${inner}'`,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  return {
    proc,
    ready: once(proc.stdout!, "data"),
    exited: once(proc, "exit"),
  };
}

linux(
  "crash recovery uses the run marker, cleans descendants and leaves unrelated processes alive",
  async () => {
    const kit = fixture();
    const owned = sleeper(kitEnv(kit));
    const unrelated = sleeper({ PATH: "/usr/bin:/bin" });
    try {
      await Promise.all([owned.ready, unrelated.ready]);
      expect((await assertIsolation(kit, false)).processes).toBe(1);
      // No PID was saved in the manifest: a subsequent CLI can still stop the run.
      const reloaded = readKit(kit.name)!;
      const receipt = await stopKit(reloaded);
      await owned.exited;
      expect(receipt.removed_processes).toBe(1);
      expect(existsSync(kit.root)).toBe(false);
      expect(JSON.parse(await processHelper("inspect", kit.token))).toEqual([]);
      expect(process.kill(unrelated.proc.pid!, 0)).toBe(true);
    } finally {
      unrelated.proc.kill();
      await unrelated.exited;
    }
  },
);

linux("cleanup includes a child that cleared its environment", async () => {
  const kit = fixture();
  const child = sleeper(kitEnv(kit), true);
  await child.ready;
  const receipt = await stopKit(kit);
  await child.exited;
  expect(receipt.removed_processes).toBe(2);
  expect(JSON.parse(await processHelper("inspect", kit.token))).toEqual([]);
});

linux(
  "unexpected runtime variables fail the live isolation check",
  async () => {
    const kit = fixture();
    const child = sleeper({
      ...kitEnv(kit),
      HC_SOCKET: "/synthetic/owner.sock",
    });
    await child.ready;
    await expect(assertIsolation(kit, false)).rejects.toThrow(
      "unexpected runtime variable HC_SOCKET",
    );
  },
);

test("real acceptance is on demand, outside automatic test discovery", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(pkg.scripts["runtime:isolated"]).toBe(
    "bun scripts/runtime-isolated.ts",
  );
  expect(
    readFileSync(
      new URL("./runtime-isolated-self-test.ts", import.meta.url),
      "utf8",
    ),
  ).not.toContain('from "bun:test"');
});
