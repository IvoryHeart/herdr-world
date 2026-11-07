import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_TAP_MARK,
  claudeStatusLineTap,
  claudeTapArgs,
  claudeTapCommand,
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
const ports = (home: string, env: Record<string, string> = {}) => ({
  fs,
  home,
  env,
  join,
  now,
  pid: 7,
});
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

test("the tap program prints the user's status line unchanged and records the reading", async () => {
  const { home, project } = sandbox();
  // The user's command sees the same input and its output passes through byte for byte.
  settings(join(home, ".claude", "settings.json"), {
    statusLine: {
      type: "command",
      command: `cat > "${join(home, "seen.json")}"; printf '  mine\\n\\tline 2 '; exit 3`,
    },
  });
  const stdin = input({ workspace: { project_dir: project } });
  const run = Bun.spawn(["sh", "-c", claudeTapCommand()], {
    cwd: project,
    env: { ...process.env, HOME: home },
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, out] = await Promise.all([
    run.exited,
    new Response(run.stdout).text(),
  ]);
  expect(out).toBe("  mine\n\tline 2 ");
  expect(exit).toBe(3);
  expect(fs.readFileSync(join(home, "seen.json"), "utf8")).toBe(stdin);
  expect(JSON.parse(reading(home)).windows).toHaveLength(2);

  // Without a status line of the user's, the tap prints nothing.
  fs.rmSync(join(home, ".claude", "settings.json"));
  const quiet = Bun.spawn(["sh", "-c", claudeTapCommand()], {
    cwd: project,
    env: { ...process.env, HOME: home },
    stdin: Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [quietExit, quietOut] = await Promise.all([
    quiet.exited,
    new Response(quiet.stdout).text(),
  ]);
  expect([quietExit, quietOut]).toEqual([0, ""]);
});

test("Claude launches get the tap through per-launch settings only", () => {
  const [flag, value] = claudeTapArgs();
  expect(flag).toBe("--settings");
  expect(JSON.parse(value!)).toEqual({
    statusLine: { type: "command", command: claudeTapCommand() },
  });
  const plain = withClaudeLimitsTap({ kind: "claude" }, false);
  expect((plain.args as (name: string) => string[])("agent")).toEqual(
    claudeTapArgs(),
  );
  const profile = withClaudeLimitsTap(
    { kind: "claude", args: (name: string) => ["--agent", name] },
    false,
  );
  expect((profile.args as (name: string) => string[])("scout")).toEqual([
    "--agent",
    "scout",
    ...claudeTapArgs(),
  ]);
  // Other harnesses and Windows hosts launch exactly as before.
  const codex = { kind: "codex", args: ["-m", "x"] };
  expect(withClaudeLimitsTap(codex, false)).toBe(codex);
  const windows = { kind: "claude", args: ["--agent", "x"] };
  expect(withClaudeLimitsTap(windows, true)).toBe(windows);
});
