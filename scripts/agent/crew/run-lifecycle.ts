import type { Database } from "bun:sqlite";
import { shortSha } from "../../../shared/pullRequests";
import type { Deps } from "./deps";
import type { Action, CrewSettings } from "./plan";
import { checkoutOf } from "./review";
import {
  activeRuns,
  actionsIn,
  finishRun,
  getAction,
  getRun,
  runFor,
  RUN_TIMEOUT_EXIT_CODE,
  setAction,
  setRunProgress,
  type StoredAction,
} from "./store";

const START_MS = 3 * 60_000;
const RUN_ATTEMPTS = 2;
const AUTHOR_KINDS = new Set(["fix", "ci", "conflict", "screenshots"]);

/** A durable timeout cause belongs to one run, whether it has actions or not. */
export function timeoutRun(crew: Database, entry: Pick<Action, "key">) {
  const id = /^run:(\d+)\|timeout(?:\|github)?$/u.exec(entry.key)?.[1];
  return id ? getRun(crew, Number(id)) : null;
}

export function timeoutHolds(crew: Database, entry: StoredAction) {
  const run = timeoutRun(crew, entry);
  const action = run && getAction(crew, run.actionKey);
  return (
    entry.state !== "superseded" &&
    run?.exitCode === RUN_TIMEOUT_EXIT_CODE &&
    run.result === null &&
    action?.state !== "done" &&
    action?.state !== "superseded"
  );
}

/** Finish before signalling; a late worker cannot overwrite the outcome. */
export function stopRun(
  crew: Database,
  id: number,
  code: number,
  now: number,
  deps: Deps,
) {
  finishRun(crew, id, code, null, now);
  const pid = getRun(crew, id)?.pid;
  if (pid) deps.kill(pid);
}

export function settleRuns(
  crew: Database,
  settings: CrewSettings,
  dir: string,
  now: number,
  deps: Deps,
  record: (entry: Action) => void,
  say: (text: string) => void,
) {
  for (const active of activeRuns(crew)) {
    const progress = deps.progress?.(
      active,
      active.cwd ?? checkoutOf(dir, active),
      now,
    );
    const recent =
      progress != null &&
      Number.isFinite(progress) &&
      progress >= active.startedAt &&
      progress <= now
        ? progress
        : active.startedAt;
    if (recent > (active.progressAt ?? active.startedAt))
      setRunProgress(crew, active.id, recent);
    const lastWork = Math.max(
      active.startedAt,
      active.progressAt ?? active.startedAt,
      recent,
    );
    const startupExpired =
      active.pid === null && now - active.startedAt >= START_MS;
    if (
      startupExpired ||
      now - lastWork >= settings.runTimeoutMinutes * 60_000
    ) {
      const bound = startupExpired
        ? "startup limit (3 minutes without reporting a PID)"
        : `inactivity limit (${settings.runTimeoutMinutes} minutes without harness work)`;
      // Persist the run outcome and its notification outbox together. A crash
      // cannot leave a finished manual/orphan run without its owner cause.
      const expired = crew.transaction(() => {
        if (getRun(crew, active.id)?.finishedAt !== null) return false;
        finishRun(crew, active.id, RUN_TIMEOUT_EXIT_CODE, null, now);
        record({
          key: `run:${active.id}|timeout`,
          pr: active.pr,
          head: active.head,
          kind: "judgment",
          target: "owner",
          text: `NEEDS-OWNER #${active.pr} at ${shortSha(active.head)}: run ${active.id} for ${active.reviewer} timed out at its ${bound}; slot released, no automatic retry. Inspect its round pane and run log.`,
        });
        return true;
      })();
      const pid = getRun(crew, active.id)?.pid;
      if (expired && pid) deps.kill(pid);
      continue;
    }
    if (active.pid !== null && deps.alive(active.pid)) continue;
    if (active.pid === null) continue;
    finishRun(crew, active.id, -1, null, now);
  }
  for (const running of actionsIn(crew, ["pending", "running"])) {
    const last = runFor(crew, running);
    if (!last || last.finishedAt === null) continue;
    if (last.exitCode === RUN_TIMEOUT_EXIT_CODE) {
      setAction(crew, running.key, "failed", now, `run ${last.id}`);
      say(
        `#${running.pr} run ${last.id} for ${running.target} timed out; slot released without retry`,
      );
      continue;
    }
    if (running.state !== "running") continue;
    // A fixer that ended without pushing leaves the step to the author;
    // a head gets one fixer.
    if (last.cwd && AUTHOR_KINDS.has(running.kind)) {
      setAction(
        crew,
        running.key,
        "pending",
        now,
        `fixer exited ${last.exitCode}`,
      );
      say(
        `#${running.pr} fixer for ${running.target} ended without pushing (exit ${last.exitCode}); the step waits for ${running.target}`,
      );
    } else if (last.exitCode === 0) {
      setAction(crew, running.key, "done", now);
      say(`#${running.pr} run ${running.target} finished (run ${last.id})`);
    } else if (running.attempts < RUN_ATTEMPTS) {
      setAction(crew, running.key, "pending", now, `exit ${last.exitCode}`);
      say(
        `#${running.pr} run ${running.target} exited ${last.exitCode}; retrying`,
      );
    } else {
      setAction(crew, running.key, "failed", now, `exit ${last.exitCode}`);
      say(
        `#${running.pr} run ${running.target} failed (exit ${last.exitCode})`,
      );
    }
  }
}
