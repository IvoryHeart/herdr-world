import { shQuote } from "../utils/process-utils";

/**
 * Claude Code passes its subscription limits (`rate_limits`) only to its
 * status line command, on stdin, and saves them nowhere. When World starts a
 * Claude agent it passes per-launch settings (`--settings`) whose status line
 * is this tap: it records the numbers for the usage collector, then runs the
 * user's own status line command, if any, with the same input and its output
 * unchanged. The user's settings files are only read, never written.
 */

/** The tap keeps its newest reading in ~/.cache/herdr-world/claude-status-line.json. */
/** Marks the tap's own command so it never runs itself as the user's. */
export const CLAUDE_TAP_MARK = "herdr-world-claude-tap";

export type ClaudeTapPorts = {
  fs: typeof import("node:fs");
  home: string;
  env: Record<string, string | undefined>;
  join(...parts: string[]): string;
  now: number;
  pid: number;
};

/**
 * Record the limit numbers in one status line input and return the user's
 * own status line command, or null. Self-contained: it runs as the tap
 * program on the agent's host. Only numbers and times reach the file.
 */
export function claudeStatusLineTap(
  input: string,
  ports: ClaudeTapPorts,
): string | null {
  const { fs, home, env, join, now, pid } = ports;
  const object = (v: any): Record<string, any> =>
    v && typeof v === "object" && !Array.isArray(v) ? v : {};
  let raw: Record<string, any> = {};
  try {
    raw = object(JSON.parse(input));
  } catch {
    // Not JSON: nothing to record; the user's command still runs.
  }
  const limits = object(raw.rate_limits);
  const windows: {
    window_minutes: number;
    used_percent: number;
    resets_at: number | null;
  }[] = [];
  for (const [name, minutes] of [
    ["five_hour", 300],
    ["seven_day", 10080],
  ] as const) {
    const w = object(limits[name]),
      used = w.used_percentage,
      resets = w.resets_at;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0)
      continue;
    windows.push({
      window_minutes: minutes,
      used_percent: Math.min(100, used),
      resets_at:
        typeof resets === "number" &&
        Number.isFinite(resets) &&
        resets > 0 &&
        resets < 1e11
          ? Math.round(resets * 1000)
          : null,
    });
  }
  if (windows.length)
    try {
      const dir = join(home, ".cache", "herdr-world"),
        file = join(dir, "claude-status-line.json"),
        temporary = `${file}.${pid}.tmp`;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, at: now, windows }),
        { mode: 0o600 },
      );
      fs.renameSync(temporary, file);
    } catch {
      // A reading is optional; the user's status line is not.
    }
  // The user's own status line, by Claude Code's precedence below the flag:
  // local project, shared project, then user settings.
  const project =
    typeof object(raw.workspace).project_dir === "string"
      ? raw.workspace.project_dir
      : typeof raw.cwd === "string"
        ? raw.cwd
        : process.cwd();
  const config = env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  for (const path of [
    join(project, ".claude", "settings.local.json"),
    join(project, ".claude", "settings.json"),
    join(config, "settings.json"),
  ]) {
    let settings: Record<string, any>;
    try {
      settings = object(JSON.parse(fs.readFileSync(path, "utf8")));
    } catch {
      continue;
    }
    if (!("statusLine" in settings)) continue;
    const line = object(settings.statusLine);
    return line.type === "command" &&
      typeof line.command === "string" &&
      line.command.trim() &&
      !line.command.includes("herdr-world-claude-tap")
      ? line.command
      : null;
  }
  return null;
}

/** The tap as a program for Bun or Node: stdin in, the user's output out. */
export function claudeTapProgram() {
  return `const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const cp = await import('node:child_process');
const tap = ${claudeStatusLineTap.toString()};
let input = Buffer.alloc(0);
try { input = fs.readFileSync(0); } catch {}
let command = null;
try { command = tap(input.toString('utf8'), { fs, home: os.homedir(), env: process.env, join: path.join, now: Date.now(), pid: process.pid }); } catch {}
if (command) {
const run = cp.spawnSync(command, { shell: true, input, stdio: ['pipe', 'inherit', 'inherit'] });
process.exitCode = run.status ?? 1;
}`;
}

/** The status line command: the tap under Bun, else Node. */
export function claudeTapCommand() {
  return `p=${shQuote(claudeTapProgram())}; if command -v bun >/dev/null 2>&1; then exec bun -e "$p"; elif command -v node >/dev/null 2>&1; then exec node --input-type=module -e "$p"; fi # ${CLAUDE_TAP_MARK}`;
}

/** Claude Code arguments that install the tap for one launch only. */
export function claudeTapArgs(): string[] {
  return [
    "--settings",
    JSON.stringify({
      statusLine: { type: "command", command: claudeTapCommand() },
    }),
  ];
}
