import { sshCommandArgv } from "../bridge/ssh-command";
import { shQuote } from "../utils/process-utils";
import type { RunProcessWithCodeTimeout } from "../workspace/file-types";

/**
 * Claude Code passes its subscription limits (`rate_limits`) only to its
 * status line command, on stdin, and saves them nowhere. When World starts a
 * Claude agent it passes per-launch settings (`--settings`) whose status line
 * is this tap: it records the numbers for the usage collector, then runs the
 * user's own status line command, if any, with the same input and its output
 * unchanged. The integration installer also registers it for host-wide sessions.
 */

/** The tap keeps its newest reading in ~/.cache/herdr-world/claude-status-line.json. */
/** Marks the tap's own command so it never runs itself as the user's. */
export const CLAUDE_TAP_MARK = "herdr-world-claude-tap";

export type ClaudeTapPorts = {
  fs: typeof import("node:fs");
  path: typeof import("node:path");
  home: string;
  env: Record<string, string | undefined>;
  /** The directory Claude Code ran the status line in. */
  cwd: string;
  /** The effective user ID, or null where the platform has none (Windows). */
  uid: number | null;
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
  const { fs, path, home, env, cwd, uid, now, pid } = ports;
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
      const dir = path.join(home, ".cache", "herdr-world"),
        file = path.join(dir, "claude-status-line.json"),
        temporary = `${file}.${pid}.tmp`;
      // Every Claude session's tap writes this one file with its own last
      // snapshot, so an older session can arrive after a fresher one. Within
      // a window (same resets_at) usage only rises until the reset: keep the
      // highest reading, and a stored later window over an earlier one.
      let saved: Record<string, any> = {};
      try {
        saved = object(JSON.parse(fs.readFileSync(file, "utf8")));
      } catch {
        // No earlier reading, or a damaged one: this reading stands.
      }
      for (const [i, w] of windows.entries()) {
        const old = object(
          (Array.isArray(saved.windows) && saved.version === 1
            ? saved.windows
            : []
          ).find((o: any) => object(o).window_minutes === w.window_minutes),
        );
        if (
          typeof old.used_percent === "number" &&
          Number.isFinite(old.used_percent) &&
          old.used_percent >= 0 &&
          old.used_percent <= 100 &&
          Number.isSafeInteger(old.resets_at) &&
          w.resets_at !== null &&
          (old.resets_at > w.resets_at ||
            (old.resets_at === w.resets_at &&
              old.used_percent > w.used_percent))
        )
          windows[i] = {
            window_minutes: w.window_minutes,
            used_percent: old.used_percent,
            resets_at: old.resets_at,
          };
      }
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
  // The session's settings directory: the directory Claude Code started in.
  const project = path.resolve(
    typeof object(raw.workspace).project_dir === "string"
      ? raw.workspace.project_dir
      : typeof raw.cwd === "string"
        ? raw.cwd
        : cwd,
  );
  const entry = (p: string) => {
    try {
      return fs.lstatSync(p);
    } catch {
      return null;
    }
  };
  // Claude Code keeps local settings at the canonical Git root (a worktree's
  // main checkout) when the user owns that root, its .git and .claude, on
  // hosts with user IDs; otherwise, and for a root at home, in the project.
  let local = project;
  let root: string | null = null;
  for (let dir = project; ; ) {
    const git = entry(path.join(dir, ".git"));
    if (git) {
      if (git.isDirectory() || git.isFile()) root = dir;
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (root !== null && uid !== null)
    try {
      let top = root;
      try {
        const read = (p: string) => fs.readFileSync(p, "utf8").trim();
        const link = read(path.join(root, ".git"));
        if (link.startsWith("gitdir:")) {
          const gitdir = path.resolve(root, link.slice(7).trim()),
            common = path.resolve(gitdir, read(path.join(gitdir, "commondir"))),
            back = path.resolve(gitdir, read(path.join(gitdir, "gitdir")));
          if (
            path.dirname(gitdir) === path.join(common, "worktrees") &&
            fs.realpathSync(back) ===
              path.join(fs.realpathSync(root), ".git") &&
            (path.basename(common) === ".git" ||
              !entry(path.join(common, ".git")))
          )
            top =
              path.basename(common) === ".git" ? path.dirname(common) : common;
        }
      } catch {
        // A .git directory, or a link that is not a worktree's: the root itself.
      }
      const claude = entry(path.join(top, ".claude")),
        real = fs.realpathSync(top);
      if (
        real !== fs.realpathSync(project) &&
        real !== fs.realpathSync(home) &&
        fs.statSync(top).uid === uid &&
        fs.lstatSync(path.join(top, ".git")).uid === uid &&
        (!claude || claude.uid === uid)
      )
        local = top;
    } catch {
      // Unverifiable: Claude Code keeps it in the project too.
    }
  // The user's own status line, by Claude Code's precedence below the flag:
  // local project, shared project, then user settings.
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  const config = configured?.startsWith("~")
    ? path.join(home, configured.slice(1).replace(/^[/\\]/, ""))
    : configured || path.join(home, ".claude");
  for (const file of [
    path.join(local, ".claude", "settings.local.json"),
    path.join(project, ".claude", "settings.json"),
    path.join(config, "settings.json"),
  ]) {
    let settings: Record<string, any>;
    try {
      settings = object(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      continue;
    }
    if (!("statusLine" in settings)) continue;
    let line = object(settings.statusLine);
    if (
      file === path.join(config, "settings.json") &&
      typeof line.command === "string" &&
      line.command.includes("herdr-world-claude-tap")
    ) {
      try {
        const saved = JSON.parse(
          fs.readFileSync(
            path.join(config, "herdr-world", "claude-status-line.json"),
            "utf8",
          ),
        );
        if (
          saved.version === 1 &&
          JSON.parse(saved.installed).statusLine.command === line.command
        )
          line =
            saved.before === null
              ? {}
              : object(JSON.parse(saved.before).statusLine);
      } catch {
        /* Missing or damaged backup: never recurse. */
      }
    }
    return line.type === "command" &&
      typeof line.command === "string" &&
      line.command.trim() &&
      !line.command.includes("herdr-world-claude-tap")
      ? line.command
      : null;
  }
  return null;
}

/** Variables only the tap's own start needs; the user's command never sees them. */
const TAP_ENV = [
  "HERDR_WORLD_TAP_CWD",
  "BUN_BE_BUN",
  "MSYS_NO_PATHCONV",
  "MSYS2_ARG_CONV_EXCL",
];

/** The tap as a program for Bun or Node: stdin in, the user's output out. */
export function claudeTapProgram() {
  return `const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const cp = await import('node:child_process');
const tap = ${claudeStatusLineTap.toString()};
const env = { ...process.env };
const cwd = env.HERDR_WORLD_TAP_CWD || process.cwd();
for (const name of ${JSON.stringify(TAP_ENV)}) delete env[name];
let input = Buffer.alloc(0);
try { input = fs.readFileSync(0); } catch {}
let command = null;
try { command = tap(input.toString('utf8'), { fs, path, home: os.homedir(), env, cwd,
uid: typeof process.geteuid === 'function' ? process.geteuid() : typeof process.getuid === 'function' ? process.getuid() : null,
now: Date.now(), pid: process.pid }); } catch {}
if (command) {
const windows = process.platform === 'win32';
const run = cp.spawnSync(windows ? 'bash' : command, windows ? ['-c', command] : [],
{ shell: !windows, cwd, env, input, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
process.exitCode = run.status ?? 1;
}`;
}

/**
 * A JavaScript runtime on the agent's host. Bun includes World's own
 * executable, which runs as Bun with BUN_BE_BUN=1.
 */
export type ClaudeTapRuntime = { kind: "bun" | "node"; path: string };

/**
 * The status line command. Claude Code runs it with sh, or Git Bash on
 * Windows. It starts the runtime from the root directory, so a project's
 * .env or bunfig.toml never loads, and hands the real directory over.
 */
export function claudeTapCommand(runtime: ClaudeTapRuntime) {
  const exe = shQuote(runtime.path.replaceAll("\\", "/"));
  const start =
    runtime.kind === "bun"
      ? `BUN_BE_BUN=1 exec ${exe} --no-env-file -e "$p"`
      : `exec ${exe} --input-type=module -e "$p"`;
  return `p=${shQuote(claudeTapProgram())}; HERDR_WORLD_TAP_CWD=$(pwd -W 2>/dev/null || pwd); export HERDR_WORLD_TAP_CWD; cd / && MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' ${start} # ${CLAUDE_TAP_MARK}`;
}

/** Claude Code arguments that install the tap for one launch only. */
export function claudeTapArgs(runtime: ClaudeTapRuntime): string[] {
  return [
    "--settings",
    JSON.stringify({
      statusLine: { type: "command", command: claudeTapCommand(runtime) },
    }),
  ];
}

/** Read one probe's answer: the runtime's absolute path, Bun first. */
export function parseClaudeTapRuntime(
  stdout: string,
  windows: boolean,
): ClaudeTapRuntime | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  if (windows) {
    for (const kind of ["bun", "node"] as const) {
      const path = lines.find(
        (line) =>
          /^[A-Za-z]:\\[^"\r\n]*$/.test(line) &&
          line.toLowerCase().endsWith(`\\${kind}.exe`),
      );
      if (path) return { kind, path };
    }
    return null;
  }
  const match = /^(bun|node) (\/[^\r\n]*)$/.exec(lines[0] ?? "");
  return match ? { kind: match[1] as "bun" | "node", path: match[2]! } : null;
}

/**
 * Where the tap runs for one launch. On World's own host that is World's
 * executable, so neither Bun nor Node needs to be installed. An SSH host is
 * asked for Bun or Node; with neither (or no answer) the launch goes without
 * the tap and the user's status line stays exactly as configured.
 */
export async function claudeTapRuntime(options: {
  host?: string;
  windows: boolean;
  run: RunProcessWithCodeTimeout;
}): Promise<ClaudeTapRuntime | null> {
  if (!options.host) return { kind: "bun", path: process.execPath };
  const probe = options.windows
    ? "where.exe bun.exe node.exe"
    : `sh -c ${shQuote(`for k in bun node; do p=$(command -v "$k") && case "$p" in /*) echo "$k $p"; exit 0;; esac; done; exit 1`)}`;
  try {
    const result = await options.run(
      sshCommandArgv(options.host, probe),
      10_000,
    );
    return parseClaudeTapRuntime(result.stdout, options.windows);
  } catch {
    return null;
  }
}
