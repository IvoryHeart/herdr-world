import type { Database } from "bun:sqlite";
import type { Run } from "../gate/observe";
import { basename } from "node:path";
import type { Action, CrewSettings } from "./plan";
import { activeRuns, getAction, runsOf } from "./store";
import { harnessOf } from "./worker";
import { routeJudgment } from "./review-judgments";

export function sessionActions(
  crew: Database,
  settings: CrewSettings,
  actions: Action[],
  run: Run,
) {
  return actions.map((action) =>
    routeJudgment(
      reviewerSessionAdmission(crew, settings, action, run) ?? action,
      settings,
    ),
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
  const run = runsOf(crew, pr).find(
    (run) =>
      run.id !== excludeRun &&
      run.reviewer === reviewer &&
      !run.cwd &&
      run.session &&
      run.harness === harness &&
      run.model === model?.model &&
      run.finishedAt !== null,
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
      return `Retained reviewer session is still owned by ${agent.name ?? "an unnamed reviewer"} in ${agent.tab_id ?? agent.pane_id ?? "a live tab"}; original-owner cleanup and explicit operator rearm are required`;
    }
    return null;
  } catch {
    return unreadable;
  }
}

/** Same check in dry runs and real passes; a recorded handoff never self-rearms. */
export function reviewerSessionAdmission(
  crew: Database,
  settings: CrewSettings,
  action: Action,
  run: Run,
): Action | null {
  if (!settings.convergingReviews || action.kind !== "confirm") return null;
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
