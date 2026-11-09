import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import {
  CLAUDE_TAP_MARK,
  claudeStatusLineTap,
  claudeTapArgs,
  claudeTapCommand,
  claudeTapRuntime,
  parseClaudeTapRuntime,
} from "./claude-tap";
import { withClaudeLimitsTap } from "../agent/profile-launch";

/** Synthetic status line input; no real account data. */
const now = 1_900_000_000_000;
const input = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: "PRIVATE_SESSION",
    subscription_type: "PRIVATE_PLAN",
    rate_limits: {
      five_hour: { used_percentage: 42.5, resets_at: 1_900_003_600 },
      seven_day: { used_percentage: 104, resets_at: 1_900_400_000 },
    },
    ...extra,
  });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function sandbox() {
  const home = fs.mkdtempSync(join(tmpdir(), "claude-tap-"));
  roots.push(home);
  const project = join(home, "project");
  fs.mkdirSync(join(project, ".claude"), { recursive: true });
  fs.mkdirSync(join(home, ".claude"), { recursive: true });
  return { home, project };
}
const uid = process.geteuid?.() ?? null;
const ports = (
  home: string,
  env: Record<string, string> = {},
  more: { uid?: number | null; cwd?: string } = {},
) => ({
  fs,
  path,
  home,
  env,
  cwd: home,
  uid,
  now,
  pid: 7,
  ...more,
});
/** World's own executable: Bun under test, the compiled World binary when installed. */
const self = { kind: "bun" as const, path: process.execPath };
const reading = (home: string) =>
  fs.readFileSync(
    join(home, ".cache", "herdr-world", "claude-status-line.json"),
    "utf8",
  );
const settings = (path: string, value: unknown) =>
  fs.writeFileSync(path, JSON.stringify(value));

test("the tap records only the limit numbers and finds the user's own status line", () => {
  const { home, project } = sandbox();
  const workspace = { workspace: { project_dir: project } };
  expect(claudeStatusLineTap(input(workspace), ports(home))).toBeNull();
  const text = reading(home);
  expect(JSON.parse(text)).toEqual({
    version: 1,
    at: now,
    windows: [
      {
        window_minutes: 300,
        used_percent: 42.5,
        resets_at: 1_900_003_600_000,
      },
      // Above 100 % once exceeded: clamped, as for Codex.
      {
        window_minutes: 10080,
        used_percent: 100,
        resets_at: 1_900_400_000_000,
      },
    ],
  });
  for (const secret of ["PRIVATE_SESSION", "PRIVATE_PLAN", project])
    expect(text).not.toContain(secret);
  expect(
    fs.statSync(join(home, ".cache", "herdr-world", "claude-status-line.json"))
      .mode & 0o777,
  ).toBe(0o600);

  // Claude Code's precedence below the flag: local project, project, user.
  const line = (command: string) => ({
    statusLine: { type: "command", command },
  });
  settings(join(home, ".claude", "settings.json"), line("user-line"));
  expect(claudeStatusLineTap(input(workspace), ports(home))).toBe("user-line");
  settings(join(project, ".claude", "settings.json"), line("project-line"));
  expect(claudeStatusLineTap(input(workspace), ports(home))).toBe(
    "project-line",
  );
  settings(join(project, ".claude", "settings.local.json"), line("local"));
  expect(claudeStatusLineTap(input(workspace), ports(home))).toBe("local");
  // A file without a status line defers; one that names the tap never recurses.
  settings(join(project, ".claude", "settings.local.json"), { model: "x" });
  settings(
    join(project, ".claude", "settings.json"),
    line(`echo ${CLAUDE_TAP_MARK}`),
  );
  expect(claudeStatusLineTap(input(workspace), ports(home))).toBeNull();
  // CLAUDE_CONFIG_DIR moves the user settings.
  fs.rmSync(join(project, ".claude"), { recursive: true });
  const config = join(home, "config");
  fs.mkdirSync(config);
  settings(join(config, "settings.json"), line("config-line"));
  expect(
    claudeStatusLineTap(
      input(workspace),
      ports(home, { CLAUDE_CONFIG_DIR: config }),
    ),
  ).toBe("config-line");
});

test("input without limits leaves the last reading in place", () => {
  const { home, project } = sandbox();
  claudeStatusLineTap(input(), ports(home));
  const before = reading(home);
  for (const other of [
    "not json",
    JSON.stringify({ rate_limits: null, workspace: { project_dir: project } }),
    JSON.stringify({
      rate_limits: { five_hour: { used_percentage: "50" } },
    }),
    JSON.stringify({ rate_limits: { five_hour: { used_percentage: -1 } } }),
  ])
    claudeStatusLineTap(other, { ...ports(home), now: now + 1 });
  expect(reading(home)).toBe(before);
});

test("sessions writing out of order keep the highest reading per window until it resets", () => {
  const { home } = sandbox();
  const fiveHour = 1_900_003_600,
    week = 1_900_400_000;
  const session = (five: number, seven: number, resets = fiveHour) =>
    JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: five, resets_at: resets },
        seven_day: { used_percentage: seven, resets_at: week },
      },
    });
  const used = () =>
    JSON.parse(reading(home)).windows.map(
      (w: { used_percent: number; resets_at: number }) => [
        w.used_percent,
        w.resets_at / 1000,
      ],
    );
  // A fresh session sees 23 % / 22 %; an older one still holds 22 % / 21 %.
  claudeStatusLineTap(session(23, 22), ports(home));
  claudeStatusLineTap(session(22, 21), { ...ports(home), now: now + 1 });
  expect(used()).toEqual([
    [23, fiveHour],
    [22, week],
  ]);
  expect(JSON.parse(reading(home)).at).toBe(now + 1);
  // A rise in either window is kept.
  claudeStatusLineTap(session(22, 30), ports(home));
  expect(used()).toEqual([
    [23, fiveHour],
    [30, week],
  ]);
  // A new five-hour window starts fresh; a session still in the old one
  // cannot bring it back.
  const next = fiveHour + 18_000;
  claudeStatusLineTap(session(1, 30, next), ports(home));
  claudeStatusLineTap(session(40, 30, fiveHour), ports(home));
  expect(used()).toEqual([
    [1, next],
    [30, week],
  ]);
  // Without a reset time nothing is comparable: the new reading stands.
  claudeStatusLineTap(
    JSON.stringify({ rate_limits: { five_hour: { used_percentage: 0 } } }),
    ports(home),
  );
  expect(JSON.parse(reading(home)).windows).toEqual([
    { window_minutes: 300, used_percent: 0, resets_at: null },
  ]);
});

/** One session's status line input with a five-hour reading in one window. */
const fiveHourAt = (used: number) =>
  JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: used, resets_at: 1_900_003_600 },
    },
  });
const fiveHourUsed = (home: string) =>
  JSON.parse(reading(home)).windows[0].used_percent as number;

test("concurrent taps never lower the reading: one reads, merges and replaces at a time", () => {
  const { home } = sandbox();
  const dir = join(home, ".cache", "herdr-world");
  claudeStatusLineTap(fiveHourAt(20), ports(home));
  const committed: number[] = [fiveHourUsed(home)];
  const logged = {
    ...fs,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      fs.renameSync(from, to);
      committed.push(fiveHourUsed(home));
    },
  };
  // Tap A has read 20 % and prepared 22 % when tap B, holding 23 %, runs.
  // B cannot read until A commits, so it can neither be overwritten by A's
  // 22 % nor commit from the old 20 %.
  let interleaved = false;
  claudeStatusLineTap(fiveHourAt(22), {
    ...ports(home),
    pid: 1,
    fs: {
      ...logged,
      writeFileSync(...args: Parameters<typeof fs.writeFileSync>) {
        if (!interleaved) {
          interleaved = true;
          claudeStatusLineTap(fiveHourAt(23), {
            ...ports(home),
            pid: 2,
            fs: logged,
          });
        }
        return fs.writeFileSync(...args);
      },
    },
  });
  expect(interleaved).toBe(true);
  expect(committed).toEqual([20, 22]);
  // B's next status line update commits its 23 %; a stale 22 % keeps it.
  claudeStatusLineTap(fiveHourAt(23), { ...ports(home), pid: 2, fs: logged });
  claudeStatusLineTap(fiveHourAt(22), { ...ports(home), pid: 1, fs: logged });
  expect(committed).toEqual([20, 22, 23, 23]);
  expect(fs.readdirSync(dir)).toEqual(["claude-status-line.json"]);
});

test("a tap waits for the lock holder and merges with what it committed", () => {
  const { home } = sandbox();
  const dir = join(home, ".cache", "herdr-world"),
    file = join(dir, "claude-status-line.json"),
    lock = `${file}.lock`;
  claudeStatusLineTap(fiveHourAt(20), ports(home));
  // Tap A holds the lock; it commits 24 % while tap B waits with 23 %.
  fs.writeFileSync(lock, "");
  let waited = 0;
  claudeStatusLineTap(fiveHourAt(23), {
    ...ports(home),
    fs: {
      ...fs,
      openSync(...args: Parameters<typeof fs.openSync>) {
        try {
          return fs.openSync(...args);
        } catch (error) {
          if (waited++ === 0) {
            const before = reading(home);
            fs.writeFileSync(
              file,
              before.replace('"used_percent":20', '"used_percent":24'),
            );
            fs.unlinkSync(lock);
          }
          throw error;
        }
      },
    },
  });
  expect(waited).toBe(1);
  expect(fiveHourUsed(home)).toBe(24);
  expect(fs.readdirSync(dir)).toEqual(["claude-status-line.json"]);
});

test("a lock left by a dead tap is cleared, and a tap whose lock was cleared commits nothing", () => {
  const { home } = sandbox();
  const dir = join(home, ".cache", "herdr-world"),
    file = join(dir, "claude-status-line.json"),
    lock = `${file}.lock`;
  claudeStatusLineTap(fiveHourAt(20), ports(home));
  fs.writeFileSync(lock, "");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  claudeStatusLineTap(fiveHourAt(21), ports(home));
  expect(fiveHourUsed(home)).toBe(21);
  expect(fs.readdirSync(dir)).toEqual(["claude-status-line.json"]);

  // Paused past the stale age, tap A's lock was cleared and another tap now
  // holds a new one: A drops its prepared reading and leaves that lock alone.
  let replaced = false;
  claudeStatusLineTap(fiveHourAt(30), {
    ...ports(home),
    fs: {
      ...fs,
      writeFileSync(...args: Parameters<typeof fs.writeFileSync>) {
        if (!replaced) {
          replaced = true;
          fs.unlinkSync(lock);
          fs.writeFileSync(lock, "");
        }
        return fs.writeFileSync(...args);
      },
    },
  });
  expect(replaced).toBe(true);
  expect(fiveHourUsed(home)).toBe(21);
  expect(fs.readdirSync(dir).sort()).toEqual([
    "claude-status-line.json",
    "claude-status-line.json.lock",
  ]);
});

test("Claude's local settings sit at the canonical Git root when the user owns it", () => {
  const { home } = sandbox();
  const line = (command: string) => ({
    statusLine: { type: "command", command },
  });
  // A repository with the agent started in a subdirectory.
  const repo = join(home, "repo"),
    sub = join(repo, "src", "deep");
  fs.mkdirSync(join(repo, ".git"), { recursive: true });
  fs.mkdirSync(join(repo, ".claude"), { recursive: true });
  fs.mkdirSync(join(sub, ".claude"), { recursive: true });
  settings(join(home, ".claude", "settings.json"), line("user-line"));
  settings(join(repo, ".claude", "settings.local.json"), line("root-local"));
  settings(join(sub, ".claude", "settings.local.json"), line("sub-local"));
  const at = (dir: string) =>
    input({ workspace: { project_dir: dir }, rate_limits: null });
  expect(claudeStatusLineTap(at(sub), ports(home))).toBe(
    uid === null ? "sub-local" : "root-local",
  );
  // Without user IDs (Windows) Claude Code keeps local settings in the project.
  expect(claudeStatusLineTap(at(sub), ports(home, {}, { uid: null }))).toBe(
    "sub-local",
  );
  // A root someone else owns is not trusted either.
  if (uid !== null)
    expect(
      claudeStatusLineTap(at(sub), ports(home, {}, { uid: uid + 1 })),
    ).toBe("sub-local");
  // The shared project file stays in the launch directory.
  fs.rmSync(join(sub, ".claude", "settings.local.json"));
  fs.rmSync(join(repo, ".claude", "settings.local.json"));
  settings(join(repo, ".claude", "settings.json"), line("root-shared"));
  expect(claudeStatusLineTap(at(sub), ports(home))).toBe("user-line");

  // A linked worktree's local settings are the main checkout's.
  if (uid === null) return;
  settings(join(repo, ".claude", "settings.local.json"), line("main-local"));
  const tree = join(home, "trees", "feature"),
    admin = join(repo, ".git", "worktrees", "feature");
  fs.mkdirSync(tree, { recursive: true });
  fs.mkdirSync(admin, { recursive: true });
  fs.writeFileSync(join(tree, ".git"), `gitdir: ${admin}\n`);
  fs.writeFileSync(join(admin, "commondir"), "../..\n");
  fs.writeFileSync(join(admin, "gitdir"), `${join(tree, ".git")}\n`);
  expect(claudeStatusLineTap(at(tree), ports(home))).toBe("main-local");
  // A .git link that is not a worktree's leaves the root where it is.
  fs.writeFileSync(join(admin, "gitdir"), join(home, "other", ".git"));
  expect(claudeStatusLineTap(at(tree), ports(home))).toBe("user-line");
  // A repository at home keeps local settings in the project.
  fs.mkdirSync(join(home, ".git"));
  const plain = join(home, "plain");
  fs.mkdirSync(plain);
  settings(join(home, ".claude", "settings.local.json"), line("home-local"));
  expect(claudeStatusLineTap(at(plain), ports(home))).toBe("user-line");
});

/** Run the status line command as Claude Code does: sh, the session's directory. */
async function statusLine(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>,
  stdin: string,
) {
  const run = Bun.spawn(["/bin/sh", "-c", command], {
    cwd,
    env,
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, out] = await Promise.all([
    run.exited,
    new Response(run.stdout).text(),
  ]);
  return { exit, out };
}

test("the tap program prints the user's status line unchanged with neither Bun nor Node on PATH", async () => {
  const { home, project } = sandbox();
  // PATH holds only cat: the tap runs on World's own executable.
  const bin = join(home, "bin");
  fs.mkdirSync(bin);
  fs.symlinkSync(Bun.which("cat")!, join(bin, "cat"));
  const env = { HOME: home, PATH: bin, PRIVATE_KEEP: "kept" };
  // A project's .env and bunfig.toml never load into the tap or the user's command.
  fs.writeFileSync(join(project, ".env"), "PRIVATE_DOTENV=leaked\n");
  fs.writeFileSync(join(project, "preload.ts"), "console.log('PRELOADED');\n");
  fs.writeFileSync(
    join(project, "bunfig.toml"),
    'preload = ["./preload.ts"]\n',
  );
  // The user's command sees the same input, directory and environment, and
  // its output passes through byte for byte.
  settings(join(home, ".claude", "settings.json"), {
    statusLine: {
      type: "command",
      command: `cat > "${join(home, "seen.json")}"; printf '  mine\\n\\tline 2 %s %s %s %s' "$PWD" "\${PRIVATE_KEEP-}" "\${PRIVATE_DOTENV-none}" "\${BUN_BE_BUN-unset}"; exit 3`,
    },
  });
  const stdin = input({ workspace: { project_dir: project } });
  const first = await statusLine(claudeTapCommand(self), project, env, stdin);
  expect(first.out).toBe(`  mine\n\tline 2 ${project} kept none unset`);
  expect(first.exit).toBe(3);
  expect(fs.readFileSync(join(home, "seen.json"), "utf8")).toBe(stdin);
  expect(JSON.parse(reading(home)).windows).toHaveLength(2);

  // Without a status line of the user's, the tap prints nothing.
  fs.rmSync(join(home, ".claude", "settings.json"));
  const quiet = await statusLine(claudeTapCommand(self), project, env, stdin);
  expect([quiet.exit, quiet.out]).toEqual([0, ""]);
});

test("a compiled World executable runs the tap as Bun", async () => {
  const { home, project } = sandbox();
  const entry = join(home, "world.ts"),
    binary = join(home, "world-binary");
  fs.writeFileSync(entry, "console.log('WORLD STARTED');\n");
  const build = Bun.spawn(
    [process.execPath, "build", "--compile", entry, "--outfile", binary],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await build.exited).toBe(0);
  settings(join(home, ".claude", "settings.json"), {
    statusLine: { type: "command", command: "printf compiled" },
  });
  const run = await statusLine(
    claudeTapCommand({ kind: "bun", path: binary }),
    project,
    { HOME: home, PATH: "/usr/bin:/bin" },
    input({ workspace: { project_dir: project } }),
  );
  expect(run).toEqual({ exit: 0, out: "compiled" });
  expect(JSON.parse(reading(home)).windows).toHaveLength(2);
}, 60_000);

test("Claude launches get the tap through per-launch settings only", () => {
  const [flag, value] = claudeTapArgs(self);
  expect(flag).toBe("--settings");
  expect(JSON.parse(value!)).toEqual({
    statusLine: { type: "command", command: claudeTapCommand(self) },
  });
  const plain = withClaudeLimitsTap({ kind: "claude" }, self);
  expect((plain.args as (name: string) => string[])("agent")).toEqual(
    claudeTapArgs(self),
  );
  const profile = withClaudeLimitsTap(
    { kind: "claude", args: (name: string) => ["--agent", name] },
    self,
  );
  expect((profile.args as (name: string) => string[])("scout")).toEqual([
    "--agent",
    "scout",
    ...claudeTapArgs(self),
  ]);
  // Other harnesses, and hosts without a runtime for the tap, launch exactly as before.
  const codex = { kind: "codex", args: ["-m", "x"] };
  expect(withClaudeLimitsTap(codex, self)).toBe(codex);
  const bare = { kind: "claude", args: ["--agent", "x"] };
  expect(withClaudeLimitsTap(bare, null)).toBe(bare);
  // A Windows path runs from Git Bash with forward slashes.
  expect(
    claudeTapCommand({ kind: "node", path: "C:\\Tools\\node.exe" }),
  ).toContain("exec 'C:/Tools/node.exe' --input-type=module");
});

test("World's host runs the tap on World itself; SSH hosts are asked for Bun or Node", async () => {
  const calls: string[][] = [];
  const answer = (stdout: string, fail = false) =>
    (async (argv: string[]) => {
      calls.push(argv);
      if (fail) throw new Error("ssh failed");
      return { code: 0, stdout, stderr: "" };
    }) as unknown as Parameters<typeof claudeTapRuntime>[0]["run"];
  expect(
    await claudeTapRuntime({ windows: false, run: answer("unused") }),
  ).toEqual(self);
  expect(calls).toEqual([]);
  expect(
    await claudeTapRuntime({
      host: "dev.example.test",
      windows: false,
      run: answer("node /opt/node/bin/node\n"),
    }),
  ).toEqual({ kind: "node", path: "/opt/node/bin/node" });
  expect(calls.at(-1)!.join(" ")).toContain("command -v");
  expect(
    await claudeTapRuntime({
      host: "win.example.test",
      windows: true,
      run: answer(
        "C:\\Program Files\\nodejs\\node.exe\r\nC:\\Users\\dev\\.bun\\bin\\bun.exe\r\n",
      ),
    }),
  ).toEqual({ kind: "bun", path: "C:\\Users\\dev\\.bun\\bin\\bun.exe" });
  expect(calls.at(-1)!.join(" ")).toContain("where.exe bun.exe node.exe");
  // No runtime, or no answer: no tap.
  for (const run of [answer(""), answer("", true), answer("bun relative/bun")])
    expect(
      await claudeTapRuntime({ host: "dev.example.test", windows: false, run }),
    ).toBeNull();
  expect(parseClaudeTapRuntime("INFO: Could not find files\r\n", true)).toBe(
    null,
  );
});
