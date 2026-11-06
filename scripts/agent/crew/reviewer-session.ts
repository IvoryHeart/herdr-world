import type { Database } from "bun:sqlite";
import type { Run } from "../gate/observe";
import { basename } from "node:path";
import type { Action, CrewSettings } from "./plan";
import { activeRuns, getAction, runsOf, type StoredRun } from "./store";
import { reviewCycles } from "./round-policy-store";
import { harnessOf } from "./worker";
import { routeJudgment } from "./review-judgments";

export function sessionActions(
  crew: Database,
  settings: CrewSettings,
  actions: Action[],
  run: Run,
) {
  return actions.flatMap((action) =>
    reviewerCompletionWait(crew, settings, action, run)
      ? []
      : [
          routeJudgment(
            reviewerSessionAdmission(crew, settings, action, run) ?? action,
            settings,
          ),
        ],
  );
}

/** Resolve exactly the identity the worker will resume, without rotating it. */
export function retainedReviewer(
  crew: Database,
  settings: CrewSettings,
  pr: number,
  reviewer: string,
  excludeRun?: number,
) {
  const model = settings.roster[reviewer];
  const harness = model && (harnessOf(model) ?? "codex");
  const freshStart = reviewCycles(crew, pr)[0]?.freshStart;
  const run = runsOf(crew, pr).find(
    (run) =>
      run.id !== excludeRun &&
      (freshStart === undefined || run.startedAt >= freshStart) &&
      run.reviewer === reviewer &&
      !run.cwd &&
      run.session &&
      run.harness === harness &&
      run.model === model?.model,
  );
  return {
    harness,
    session:
      settings.reviewerSessions?.[String(pr)]?.[reviewer] ?? run?.session,
    run,
  };
}

/** A live idle harness still owns its session; never close or type into it. */
export function reviewerSessionOwner(
  run: Run,
  harness: string,
  session: string,
  finishing: StoredRun[] = [],
): string | null {
  const result = run(["herdr", "agent", "list"]);
  const unreadable = "Reviewer session ownership inventory is unreadable";
  if (result.code !== 0) return unreadable;
  try {
    const agents = JSON.parse(result.stdout)?.result?.agents;
    if (!Array.isArray(agents)) return unreadable;
    for (const agent of agents) {
      if (!agent || typeof agent !== "object" || Array.isArray(agent))
        return unreadable;
      const identity = agent.agent_session;
      if (!identity || identity.value !== session) continue;
      if (identity.kind !== "id" || identity.agent !== harness)
        return unreadable;
      if (typeof agent.pane_id !== "string") return unreadable;
      const process = run([
        "herdr",
        "pane",
        "process-info",
        "--pane",
        agent.pane_id,
      ]);
      if (process.code !== 0) return unreadable;
      const processes = JSON.parse(process.stdout)?.result?.process_info
        ?.foreground_processes;
      if (!Array.isArray(processes)) return unreadable;
      if (
        processes.some(
          (p) => !p || typeof p.name !== "string" || !Array.isArray(p.argv),
        )
      )
        return unreadable;
      // A completed tab can retain display identity after its harness exits.
      if (
        !processes.some(
          (p) =>
            p.name === harness ||
            (typeof p.argv[0] === "string" && basename(p.argv[0]) === harness),
        )
      )
        continue;
      if (
        finishing.some(
          (r) =>
            r.pane === agent.pane_id &&
            processes.some(
              (p) =>
                p.pid === r.pid &&
                p.argv.some(
                  (a: string) => a.endsWith("/crew.ts") || a === "crew.ts",
                ) &&
                p.argv[p.argv.indexOf("--run") + 1] === String(r.id),
            ),
        )
      )
        return CREW_COMPLETION_WAIT;
      return `Retained reviewer session is still owned by ${agent.name ?? "an unnamed reviewer"} in ${agent.tab_id ?? agent.pane_id ?? "a live tab"}; original-owner cleanup and explicit operator rearm are required`;
    }
    return null;
  } catch {
    return unreadable;
  }
}

export const CREW_COMPLETION_WAIT =
  "Tracked reviewer worker is completing its normal exit";

export function reviewerCompletionWait(
  crew: Database,
  settings: CrewSettings,
  action: Action,
  run: Run,
) {
  if (
    !settings.convergingReviews ||
    (action.kind !== "confirm" &&
      !(
        action.kind === "review" &&
        settings.reviewerSessions?.[String(action.pr)]?.[action.target]
      ))
  )
    return false;
  const retained = retainedReviewer(crew, settings, action.pr, action.target);
  const finishing = runsOf(crew, action.pr).filter(
    (r) =>
      r.reviewer === action.target &&
      r.session === retained.session &&
      r.finishedAt !== null &&
      r.exitCode === 0 &&
      r.result &&
      !r.cwd &&
      r.pid &&
      r.pane,
  );
  return Boolean(
    retained.session &&
      retained.harness &&
      finishing.length &&
      reviewerSessionOwner(
        run,
        retained.harness,
        retained.session,
        finishing,
      ) === CREW_COMPLETION_WAIT,
  );
}

/** Same check in dry runs and real passes; a recorded handoff never self-rearms. */
export function reviewerSessionAdmission(
  crew: Database,
  settings: CrewSettings,
  action: Action,
  run: Run,
): Action | null {
  if (
    !settings.convergingReviews ||
    (action.kind !== "confirm" &&
      !(
        action.kind === "review" &&
        settings.reviewerSessions?.[String(action.pr)]?.[action.target]
      ))
  )
    return null;
  // A timed-out attempt has its own durable hold, owned by the operator.
  if (getAction(crew, action.key)?.state === "failed") return null;
  const key = `${action.key}|session-owner`;
  const held = getAction(crew, key);
  const retained = retainedReviewer(crew, settings, action.pr, action.target);
  // Current crew work waits on its normal completion, not a handoff.
  if (
    activeRuns(crew).some(
      (entry) =>
        entry.pr === action.pr &&
        entry.reviewer === action.target &&
        entry.session === retained.session,
    )
  )
    return null;
  const reason =
    held && held.state !== "superseded"
      ? "Reviewer session handoff awaits explicit operator rearm"
      : !retained.session || !retained.harness
        ? "Retained reviewer identity is unavailable"
        : reviewerSessionOwner(run, retained.harness, retained.session);
  return reason
    ? {
        key,
        pr: action.pr,
        head: action.head,
        kind: "judgment",
        target: "owner",
        text: `NEEDS-OWNER #${action.pr}: ${reason}; no confirmation launched.`,
      }
    : null;
}
