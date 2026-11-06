import type { Database } from "bun:sqlite";
import type { Action, CrewSettings } from "./plan";
import type { Deps } from "./deps";
import type { Seat } from "./seats";
import { actionsIn, setAction, type StoredAction } from "./store";

/** A notice to the operator that belongs to another action. */
export function notice(parent: Action, suffix: string, text: string): Action {
  return {
    key: `${parent.key}|${suffix}`,
    pr: parent.pr,
    head: parent.head,
    kind: "judgment",
    target: "owner",
    text,
  };
}

/** Review plumbing goes to its operator; an explicit owner decision keeps its ask. */
export function routeJudgment(action: Action, settings: CrewSettings): Action {
  const seat = settings.reviewJudgmentSeat;
  if (
    !seat ||
    action.kind !== "judgment" ||
    action.target !== "owner" ||
    action.ownerDecision
  )
    return action;
  return {
    ...action,
    key: action.key.replace(":judgment:owner", `:judgment:${seat}`),
    target: seat,
    text: action.text.replace(/^NEEDS-OWNER/u, "NEEDS-REVIEW"),
  };
}

export function deliverReviewJudgments(
  crew: Database,
  now: number,
  deps: Deps,
  live: Seat[] | null,
  settings: CrewSettings,
  deliverable: (entry: StoredAction) => boolean,
  say: (text: string) => void,
) {
  for (const entry of actionsIn(crew, ["pending"])) {
    if (
      !["judgment", "ready"].includes(entry.kind) ||
      entry.target === "owner" ||
      entry.target === "github" ||
      !deliverable(entry)
    )
      continue;
    const seat = live?.find((seat) => seat.name === entry.target);
    if (
      !seat ||
      seat.focused ||
      !(
        entry.kind === "ready" ? ["idle", "done", "working"] : ["idle", "done"]
      ).includes(seat.status) ||
      settings.neverPrompt.includes(seat.name)
    )
      continue;
    const sent = deps.run([
      "herdr",
      "agent",
      "prompt",
      entry.target,
      entry.text,
    ]);
    const error = sent.code
      ? (sent.stderr || sent.stdout).trim().slice(0, 200)
      : null;
    setAction(
      crew,
      entry.key,
      sent.code ? (entry.attempts >= 2 ? "failed" : "pending") : "sent",
      now,
      error,
      true,
    );
    say(
      `#${entry.pr} ${sent.code ? "could not prompt" : "prompted"} review coordinator ${entry.target}${error ? `: ${error}` : ""}`,
    );
  }
}
