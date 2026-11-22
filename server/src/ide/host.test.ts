import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_EXIT,
  hostAttachScript,
  hostListScript,
  hostStartScript,
  hostStopByHand,
  hostStopScript,
  type IdeHostStart,
  parseHostLines,
  parseHostList,
  parseHostPending,
} from "./host";
import { systemHostRun } from "./hosts";
import {
  hasSetsid,
  type ProcessTreeStandIn,
  parentOf,
  processTreeStandIn,
} from "./testing/process-tree-stand-in";

/**
 * The scripts that keep an IDE server's life on its host, run here under
 * the local `sh` with a stand-in IDE: an SSH host runs the same scripts,
 * only the transport is left out. HOME points at a scratch folder, so the
 * SSH root lands there.
 */
const dirs: string[] = [];
const standIns: ProcessTreeStandIn[] = [];
afterEach(() => {
  for (const standIn of standIns.splice(0)) standIn.cleanup();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const WORLD = "world-aaaaaaaaaaaaaaaa";
const ID = "server-bbbbbbbbbbbbbbbb";
const GRACE = 300;

function setup() {
  const top = mkdtempSync(join(tmpdir(), "hw-ide-host-"));
  dirs.push(top);
  const home = join(top, "home");
  const project = join(top, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  const standIn = processTreeStandIn(top);
  standIns.push(standIn);
  const hostRun = systemHostRun({ PATH: "/usr/bin:/bin", HOME: home });
  const run = (script: string, stdin?: string) =>
    hostRun({ kind: "local" }, script, { stdin, timeoutMs: 20_000 });
  const start = (overrides: Partial<IdeHostStart> = {}) =>
    hostStartScript({
      root: { remote: true },
      id: ID,
      worldId: WORLD,
      connectionId: "box",
      provider: "vscode",
      binary: standIn.launcher,
      basePath: `/ide/${ID}`,
      folder: project,
      startedAt: "2026-11-19T10:00:00.000Z",
      nonce: randomBytes(16).toString("base64url"),
      token: true,
      stopGraceMs: GRACE,
      ...overrides,
    });
  const attach = (overrides: { worldId?: string; folder?: string } = {}) =>
    run(
      hostAttachScript({
        root: { remote: true },
        id: ID,
        worldId: WORLD,
        provider: "vscode",
        folder: project,
        stopGraceMs: GRACE,
        ...overrides,
      }),
    ).then((result) => parseHostLines(result.stdout));
  const root = join(home, ".local/state/herdr-world/ide");
  return { top, home, project, standIn, run, start, attach, root };
}

function alive(pid: number) {
  const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
    .stdout.toString()
    .trim();
  return stat !== "" && !stat.startsWith("Z");
}

test.if(hasSetsid())(
  "a server outlives the script that started it; a second start finds it; Stop ends all of it, a re-parented terminal too",
  async () => {
    const h = setup();
    const first = await h.run(h.start(), "secret-token-value\n");
    expect(first.code).toBe(0);
    expect(parseHostLines(first.stdout).values.get("result")).toBe("started");
    expect(parseHostLines(first.stdout).values.get("root")).toBe(h.root);
    const pids = await h.standIn.started();
    // The script and its ssh session are gone; everything it started runs.
    expect(h.standIn.survivors().sort()).toEqual(
      [pids.launcher, pids.server, pids.shell].sort(),
    );
    // The terminal's helper exited: it is outside the server's tree.
    expect(parentOf(pids.shell)).not.toBe(pids.server);

    // Private, and the token never on a command line.
    expect(statSync(h.root).mode & 0o777).toBe(0o700);
    expect(statSync(join(h.root, ID, "token")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(h.root, ID, "token"), "utf8")).toBe(
      "secret-token-value",
    );
    const commandLines = Bun.spawnSync(["ps", "-A", "-o", "args="]).stdout;
    expect(commandLines.toString()).not.toContain("secret-token-value");

    // A second start for the same folder launches nothing.
    h.standIn.forget();
    const second = await h.run(h.start(), "another-token\n");
    expect(parseHostLines(second.stdout).values.get("result")).toBe("running");
    await Bun.sleep(200);
    expect(existsSync(join(h.top, "launcher.pid"))).toBe(false);

    // A later World checks it is its own, for this provider and folder.
    const attached = await h.attach();
    expect(attached.values.get("state")).toBe("running");
    expect(attached.values.get("token")).toBe("secret-token-value");
    expect(attached.values.get("started")).toBe("2026-11-19T10:00:00.000Z");
    expect(attached.values.get("downloads")).toBe("0");
    // VS Code's CLI retrying the download of its web server, as it logs it.
    appendFileSync(
      join(h.root, ID, "log"),
      "[10:00:01] info Downloading server 0123abcd\n".repeat(2),
    );
    expect((await h.attach()).values.get("downloads")).toBe("2");
    expect(
      (await h.attach({ worldId: "world-cccccccccccccccc" })).values.get(
        "state",
      ),
    ).toBe("foreign");
    expect((await h.attach({ folder: h.home })).values.get("state")).toBe(
      "foreign",
    );

    const listed = parseHostList(
      (await h.run(hostListScript({ remote: true }, WORLD, GRACE))).stdout,
    );
    expect(listed).toEqual([
      {
        id: ID,
        provider: "vscode",
        folder: h.project,
        connectionId: "box",
        startedAt: "2026-11-19T10:00:00.000Z",
        state: "running",
      },
    ]);
    expect(
      parseHostList(
        (
          await h.run(
            hostListScript({ remote: true }, "world-cccccccccccccccc", GRACE),
          )
        ).stdout,
      ),
    ).toEqual([]);

    // Another World can't stop it.
    expect(
      parseHostLines(
        (
          await h.run(
            hostStopScript(
              { remote: true },
              ID,
              "world-cccccccccccccccc",
              GRACE,
            ),
          )
        ).stdout,
      ).values.get("result"),
    ).toBe("foreign");
    expect(alive(pids.server)).toBe(true);

    const stopped = await h.run(
      hostStopScript({ remote: true }, ID, WORLD, GRACE),
    );
    expect(parseHostLines(stopped.stdout).values.get("result")).toBe("stopped");
    // TERM is ignored by the server and the shell: only KILL ends them.
    expect([pids.launcher, pids.server, pids.shell].filter(alive)).toEqual([]);
    expect(existsSync(join(h.root, ID))).toBe(false);
    expect((await h.attach()).values.get("state")).toBe("gone");
  },
  20_000,
);

test.if(hasSetsid())(
  "two starts for the same folder at once launch one server",
  async () => {
    const h = setup();
    const results = await Promise.all([
      h.run(h.start(), "token-one\n"),
      h.run(h.start(), "token-two\n"),
    ]);
    expect(
      results
        .map(
          (result) =>
            parseHostLines(result.stdout).values.get("result") ??
            `no result (exit ${result.code}): ${result.stderr.trim()}`,
        )
        .sort(),
    ).toEqual(["running", "started"]);
    const pids = await h.standIn.started();
    await h.run(hostStopScript({ remote: true }, ID, WORLD, GRACE));
    expect([pids.launcher, pids.server, pids.shell].filter(alive)).toEqual([]);
  },
  20_000,
);

test("a start whose folder another start claimed meanwhile launches nothing and keeps the other's token", async () => {
  const h = setup();
  const script = h.start();
  const link = script.indexOf('if ! ln "$d/record.$n"');
  expect(link).toBeGreaterThan(0);
  // The other start links its record and moves its token in first.
  const other = [
    'printf "world=%s\\n" other > "$d/record"',
    'printf other-token > "$d/token"',
    "",
  ].join("\n");
  const raced = await h.run(
    `${script.slice(0, link)}${other}${script.slice(link)}`,
    "token-one\n",
  );
  expect(parseHostLines(raced.stdout).values.get("result")).toBe("running");
  await Bun.sleep(200);
  expect(existsSync(join(h.top, "launcher.pid"))).toBe(false);
  const folder = join(h.root, ID);
  expect(readFileSync(join(folder, "token"), "utf8")).toBe("other-token");
  expect(readFileSync(join(folder, "record"), "utf8")).toBe("world=other\n");
  expect(
    Bun.spawnSync(["ls", "-A", folder]).stdout.toString().trim().split("\n"),
  ).toEqual(["record", "token"]);
});

test.if(hasSetsid())(
  "a server that exits on its own says why, ends what it left behind, and the next start starts afresh",
  async () => {
    const h = setup();
    const crash = join(h.top, "crash");
    writeFileSync(
      crash,
      `#!/bin/sh\n'${join(h.top, "stand-in", "server")}' &\nsleep 0.5\necho "error: unable to bind the socket" >&2\nexit 3\n`,
    );
    chmodSync(crash, 0o755);
    await h.run(h.start({ binary: crash }), "token\n");
    const deadline = Date.now() + 10_000;
    let state = await h.attach();
    while (state.values.get("state") !== "exited" && Date.now() < deadline) {
      await Bun.sleep(100);
      state = await h.attach();
    }
    expect(state.values.get("state")).toBe("exited");
    expect(state.values.get("exit")).toBe("3");
    expect(state.values.has("token")).toBe(false);
    expect(state.log).toContain("error: unable to bind the socket");
    // The supervisor ended the server it left, and that server's terminal.
    const server = Number(readFileSync(join(h.top, "server.pid"), "utf8"));
    const shellFile = join(h.top, "shell.pid");
    for (let i = 0; i < 50 && !existsSync(shellFile); i++) await Bun.sleep(20);
    const shell = Number(readFileSync(shellFile, "utf8"));
    for (let i = 0; i < 50 && (alive(server) || alive(shell)); i++)
      await Bun.sleep(100);
    expect([server, shell].filter(alive)).toEqual([]);

    h.standIn.forget();
    const again = await h.run(h.start(), "token\n");
    expect(parseHostLines(again.stdout).values.get("result")).toBe("started");
    const pids = await h.standIn.started();
    await h.run(hostStopScript({ remote: true }, ID, WORLD, GRACE));
    expect([pids.launcher, pids.server, pids.shell].filter(alive)).toEqual([]);
  },
  30_000,
);

test("a missing folder and a root that isn't World's own are refused", async () => {
  const h = setup();
  const missing = await h.run(
    h.start({ folder: join(h.top, "nowhere") }),
    "token\n",
  );
  expect(missing.code).toBe(HOST_EXIT.folder);

  const linked = join(h.top, "linked");
  symlinkSync(h.top, linked);
  const refused = await h.run(h.start({ root: { path: linked } }), "token\n");
  expect(refused.code).toBe(HOST_EXIT.dir);
  expect(existsSync(join(h.top, ID))).toBe(false);
});

test("looking and stopping create nothing on a host World never used", async () => {
  const h = setup();
  const list = await h.run(hostListScript({ remote: true }, WORLD, GRACE));
  expect(list.code).toBe(0);
  expect(parseHostList(list.stdout)).toEqual([]);
  expect((await h.attach()).values.get("state")).toBe("gone");
  const stop = await h.run(hostStopScript({ remote: true }, ID, WORLD, GRACE));
  expect(parseHostLines(stop.stdout).values.get("result")).toBe("gone");
  expect(existsSync(join(h.home, ".local/state"))).toBe(false);
});

/**
 * Pauses a start script just before it claims the folder, until `go`
 * exists: what a lost, slow start reply looks like on the host.
 */
function pausedStart(h: ReturnType<typeof setup>) {
  const script = h.start();
  const claim = script.indexOf('if ! mkdir "$d"');
  expect(claim).toBeGreaterThan(0);
  const wait = `: > "${h.top}/paused"; while [ ! -e "${h.top}/go" ]; do nap; done\n`;
  return `${script.slice(0, claim)}${wait}${script.slice(claim)}`;
}

async function untilFile(path: string) {
  for (let i = 0; i < 200 && !existsSync(path); i++) await Bun.sleep(20);
  expect(existsSync(path)).toBe(true);
}

for (const by of ["Stop", "a look"] as const)
  test(`a start ${by} overtook before it claimed the folder launches nothing`, async () => {
    const h = setup();
    const started = h.run(pausedStart(h), "token\n");
    await untilFile(join(h.top, "paused"));
    // Listed meanwhile as pending: neither failed nor gone.
    const list = await h.run(hostListScript({ remote: true }, WORLD, GRACE));
    expect([...parseHostPending(list.stdout)]).toEqual([ID]);
    if (by === "Stop") {
      const stop = await h.run(
        hostStopScript({ remote: true }, ID, WORLD, GRACE),
      );
      expect(parseHostLines(stop.stdout).values.get("result")).toBe("gone");
    } else expect((await h.attach()).values.get("state")).toBe("gone");
    writeFileSync(join(h.top, "go"), "");
    const result = await started;
    expect(result.code).toBe(HOST_EXIT.voided);
    expect(existsSync(join(h.root, ID))).toBe(false);
    expect(existsSync(join(h.top, "launcher.pid"))).toBe(false);
    const after = await h.run(hostListScript({ remote: true }, WORLD, GRACE));
    expect(parseHostPending(after.stdout).size).toBe(0);
  });

test("a newer start voids an older one still waiting to claim", async () => {
  const h = setup();
  const older = h.run(pausedStart(h), "token\n");
  await untilFile(join(h.top, "paused"));
  // The newer start finds the older's mark and replaces it; let it claim.
  const newer = h.start({ binary: "/bin/true" });
  const claim = newer.indexOf('if ! mkdir "$d"');
  await h.run(`${newer.slice(0, claim)}exit 0\n`, "token\n");
  writeFileSync(join(h.top, "go"), "");
  expect((await older).code).toBe(HOST_EXIT.voided);
  expect(existsSync(join(h.root, ID))).toBe(false);
});

test.if(hasSetsid())(
  "an unfinished Stop stays pending, a look says so, and the next Stop or the hand command ends it",
  async () => {
    for (const finish of ["Stop", "by hand"] as const) {
      const h = setup();
      expect((await h.run(h.start(), "token\n")).code).toBe(0);
      const pids = await h.standIn.started();
      // A Stop that moved the folder aside, then lost its host.
      const aside = join(h.root, `.stop-${ID}-4242`);
      Bun.spawnSync(["mv", join(h.root, ID), aside]);
      const list = await h.run(hostListScript({ remote: true }, WORLD, GRACE));
      expect(parseHostList(list.stdout)).toEqual([]);
      expect([...parseHostPending(list.stdout)]).toEqual([ID]);
      expect((await h.attach()).values.get("state")).toBe("stopping");
      // A start meanwhile launches nothing new.
      const again = await h.run(h.start(), "token\n");
      expect(parseHostLines(again.stdout).values.get("result")).toBe("running");
      if (finish === "Stop") {
        const stop = await h.run(
          hostStopScript({ remote: true }, ID, WORLD, GRACE),
        );
        expect(parseHostLines(stop.stdout).values.get("result")).toBe(
          "stopped",
        );
      } else {
        const command = hostStopByHand(ID);
        const byHand = await h.run(command);
        expect(byHand.code).toBe(0);
      }
      // The hand command sends TERM only; the stand-in's server ignores it.
      const ended =
        finish === "Stop" ? [pids.launcher, pids.server] : [pids.launcher];
      for (let i = 0; i < 100 && ended.some(alive); i++) await Bun.sleep(50);
      expect(ended.filter(alive)).toEqual([]);
      expect(existsSync(aside)).toBe(false);
    }
  },
  30_000,
);
