import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureServerLogger } from "../utils/logger";
import { openStorage } from "./storage";
import { startTestService } from "./testing/services";
import {
  MARKERS,
  runTwoServices,
  type TwoServicesReport,
} from "./testing/two-services";

beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));

/** Where an environment-derived data path would land. */
const DATA_ENVIRONMENT = [
  "HOME",
  "XDG_CONFIG_HOME",
  "APPDATA",
  "USERPROFILE",
  "HERDR_WORLD_DATA_DIR",
  "HERDR_WORLD_SETTINGS_PATH",
  "HERDR_WORLD_CONNECTIONS_PATH",
  "HERDR_WORLD_BOARD_PATH",
  "HERDR_WORLD_LEDGER_PATH",
  "HERDR_WORLD_AGENT_PROFILES_PATH",
  "HERDR_WORLD_WEB_PUSH_PATH",
  "HERDR_WORLD_ASSISTANT_DIR",
] as const;

function decoyEnvironment(decoy: string) {
  return {
    HOME: decoy,
    XDG_CONFIG_HOME: decoy,
    APPDATA: decoy,
    USERPROFILE: decoy,
    HERDR_WORLD_DATA_DIR: join(decoy, "data"),
  };
}

/** Every file below `directory`, relative to it. */
function files(directory: string): string[] {
  return (readdirSync(directory, { recursive: true }) as string[])
    .filter((path) => statSync(join(directory, path)).isFile())
    .sort();
}

function expectOwnFolders(
  top: string,
  decoy: string,
  report: TwoServicesReport,
) {
  expect(files(decoy)).toEqual([]);
  for (const [name, other] of [
    ["first", "second"],
    ["second", "first"],
  ] as const) {
    const root = join(top, name);
    const read = (path: string) => readFileSync(join(root, path), "utf8");
    const marker = MARKERS[name];
    expect(JSON.parse(read("settings.json")).title_suffix).toBe(marker);
    expect(read("boards/board.json")).toContain(`${marker} note`);
    expect(read("boards/world-ledger.json")).toContain(`${marker} question?`);
    expect(read("agent-profiles.json")).toContain(`${marker} profile`);
    expect(read("connections.json")).toContain(marker);
    expect(read("source-secrets.json")).toContain(`${marker}-jira-token`);
    expect(existsSync(join(root, "session-secret.json"))).toBeTrue();
    expect(existsSync(join(root, "web-push.json"))).toBeTrue();
    for (const path of files(root))
      expect(read(path)).not.toContain(MARKERS[other]);
    expect(report.lockedWhileRunning[name]).toBeTrue();
    expect(existsSync(join(root, "instance.lock"))).toBeFalse();
    expect(report.crossCookieStatus[name]).toBe(401);
  }
  expect(report.publicKeys.first).toEqual(expect.any(String));
  expect(report.publicKeys.second).toEqual(expect.any(String));
  expect(report.publicKeys.first).not.toBe(report.publicKeys.second);
}

test("two services in one process write only their own data folders", async () => {
  const top = mkdtempSync(join(tmpdir(), "world-services-"));
  const decoy = join(top, "decoy");
  mkdirSync(decoy);
  // A store that fell back to the environment would write the decoy.
  const saved = DATA_ENVIRONMENT.map((name) => [name, process.env[name]]);
  for (const name of DATA_ENVIRONMENT) delete process.env[name];
  Object.assign(process.env, decoyEnvironment(decoy));
  try {
    expectOwnFolders(top, decoy, await runTwoServices(top));
  } finally {
    for (const [name, value] of saved)
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("a process started with a decoy HOME runs two services without writing it", async () => {
  // A process fixes its home folder when it starts, so only a new process can
  // show that nothing reads it for a write.
  const top = mkdtempSync(join(tmpdir(), "world-services-home-"));
  const decoy = join(top, "decoy");
  mkdirSync(decoy);
  try {
    const scenario = JSON.stringify(
      join(import.meta.dir, "testing", "two-services.ts"),
    );
    const logger = JSON.stringify(
      join(import.meta.dir, "..", "utils", "logger.ts"),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { configureServerLogger } from ${logger};
         import { runTwoServices } from ${scenario};
         configureServerLogger("error");
         console.log(JSON.stringify(await runTwoServices(${JSON.stringify(top)})));`,
      ],
      {
        env: {
          ...process.env,
          ...Object.fromEntries(
            DATA_ENVIRONMENT.map((name) => [name, undefined]),
          ),
          ...decoyEnvironment(decoy),
          // Bun's own transpiler cache, which is not World's to keep apart.
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(top, "bun-cache"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expectOwnFolders(top, decoy, JSON.parse(stdout));
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("a service refuses a folder another live service in this process holds", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "world-service-held-")), "data");
  const first = await startTestService(root);
  try {
    await expect(startTestService(root)).rejects.toThrow(
      `is in use by World (pid ${process.pid}, port 0)`,
    );
    // The refused start changed nothing: the first service still serves.
    expect((await fetch(`${first.base}/api/health`)).status).toBe(401);
  } finally {
    await first.service.stop();
  }
  const again = await startTestService(root);
  await again.service.stop();
  rmSync(join(root, ".."), { recursive: true, force: true });
});

test("a service whose storage cannot open releases its folder", async () => {
  const root = join(
    mkdtempSync(join(tmpdir(), "world-service-failed-")),
    "data",
  );
  await expect(
    startTestService(
      root,
      {},
      {},
      {
        storage: async () => {
          throw new Error("storage refused");
        },
      },
    ),
  ).rejects.toThrow("storage refused");
  expect(existsSync(join(root, "instance.lock"))).toBeFalse();
  const started = await startTestService(root);
  await started.service.stop();
  rmSync(join(root, ".."), { recursive: true, force: true });
});

test("stop closes the listener before storage and releases the folder last", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "world-service-stop-")), "data");
  const seen: { listening: boolean; locked: boolean }[] = [];
  let base = "";
  const started = await startTestService(
    root,
    {},
    {},
    {
      storage: async (paths, ports) => {
        const storage = await openStorage(paths, ports);
        return {
          ...storage,
          close: async () => {
            seen.push({
              listening: await fetch(`${base}/healthz`).then(
                () => true,
                () => false,
              ),
              locked: existsSync(join(root, "instance.lock")),
            });
            await storage.close();
          },
        };
      },
    },
  );
  base = started.base;
  expect((await fetch(`${base}/healthz`)).status).toBe(200);
  await Promise.all([started.service.stop(), started.service.stop()]);
  expect(seen).toEqual([{ listening: false, locked: true }]);
  expect(existsSync(join(root, "instance.lock"))).toBeFalse();
  rmSync(join(root, ".."), { recursive: true, force: true });
});
