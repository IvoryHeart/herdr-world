import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  claudeStatusLineTap,
  type ClaudeTapPorts,
} from "../server/src/usage/claude-tap";

/** Replay the checker counterexample at actual filesystem call boundaries. */
export function replayTapLockCounterexample() {
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
  const ports: ClaudeTapPorts = {
    fs,
    path,
    home,
    env: {},
    cwd: home,
    uid: process.geteuid?.() ?? null,
    now: 1_900_000_000_000,
    pid: 1,
  };
  const used = () =>
    JSON.parse(fs.readFileSync(file, "utf8")).windows[0].used_percent as number;
  const commits: number[] = [];
  try {
    claudeStatusLineTap(input(20), ports);
    commits.push(used());
    let interleaved = false;
    claudeStatusLineTap(input(22), {
      ...ports,
      fs: {
        ...fs,
        renameSync(from, to) {
          if (String(to) === file && !interleaved) {
            interleaved = true;
            // Reproduce suspension past stale expiry without sleeping.
            fs.utimesSync(lock, new Date(0), new Date(0));
            claudeStatusLineTap(input(23), { ...ports, pid: 2 });
            commits.push(used());
          }
          fs.renameSync(from, to);
        },
      },
    });
    assert(interleaved, "tap schedule did not cross the commit boundary");
    commits.push(used());
    assert.deepEqual(
      commits,
      [20, 23, 22],
      "reported tap counterexample no longer reproduces; verify the repair and strengthen the gate",
    );
    return {
      commits,
      trace: [
        "A acquired and read 20",
        "A prepared 22 and passed ownership check",
        "A suspended; B recovered stale lock and committed 23",
        "A renamed 22 after B",
      ],
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
