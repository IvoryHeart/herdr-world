import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  claudeStatusLineTap,
  type ClaudeTapPorts,
} from "../server/src/usage/claude-tap";

export const tapBoundaries = [
  "acquire",
  "prepare",
  "commit",
  "release",
] as const;
export type TapBoundary = (typeof tapBoundaries)[number];

/** Replay a bounded two-writer schedule through the real synchronous tap. */
export function replayTapLockSchedule(
  boundary: TapBoundary = "commit",
  stopped = false,
  tap = claudeStatusLineTap,
) {
  const home = fs.mkdtempSync(path.join(tmpdir(), "world-tap-lock-model-"));
  const file = path.join(
    home,
    ".cache",
    "herdr-world",
    "claude-status-line.json",
  );
  const lock = `${file}.lock`;
  const input = (used: number) =>
    JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: used, resets_at: 1_900_003_600 },
      },
    });
  let dead = false;
  const ports: ClaudeTapPorts = {
    fs,
    path,
    home,
    env: {},
    cwd: home,
    uid: process.geteuid?.() ?? null,
    now: 1_900_000_000_000,
    pid: 1,
    kill: (pid) => {
      if (pid === 1 && dead)
        throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
  };
  const used = () =>
    JSON.parse(fs.readFileSync(file, "utf8")).windows[0].used_percent as number;
  const commits: number[] = [];
  const logged = {
    ...fs,
    renameSync(from: fs.PathLike, to: fs.PathLike) {
      fs.renameSync(from, to);
      if (String(to) === file) commits.push(used());
    },
  };
  ports.fs = logged;
  try {
    tap(input(20), ports);
    let interleaved = false;
    const contend = (at: TapBoundary) => {
      if (at !== boundary || interleaved) return;
      interleaved = true;
      // Aged locks do not prove death. The separate dead probe is explicit.
      if (fs.existsSync(lock)) fs.utimesSync(lock, new Date(0), new Date(0));
      dead = stopped;
      tap(input(23), { ...ports, pid: 2 });
      // A confirmed-dead process cannot resume. Abort at the injected boundary.
      if (stopped) throw new Error("simulated process exit");
    };
    tap(input(22), {
      ...ports,
      fs: {
        ...logged,
        renameSync(from, to) {
          if (String(to) === lock) contend("acquire");
          if (String(to) === file) contend("commit");
          logged.renameSync(from, to);
        },
        writeFileSync(...args: Parameters<typeof fs.writeFileSync>) {
          if (String(args[0]).endsWith(".tmp")) contend("prepare");
          fs.writeFileSync(...args);
        },
        unlinkSync(target) {
          if (String(target).startsWith(`${lock}${path.sep}`))
            contend("release");
          fs.unlinkSync(target);
        },
      },
    });
    assert(interleaved, `tap schedule did not cross ${boundary}`);
    // The optional reading retries on the next status line update.
    tap(input(23), { ...ports, pid: 2 });
    return { commits };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
