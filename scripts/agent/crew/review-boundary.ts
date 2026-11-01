import type { Database } from "bun:sqlite";
import {
  evaluate,
  type GateInput,
  type GateConfig,
  type Verdict,
} from "../gate/predicate";
import type { Run } from "../gate/observe";
import type { CrewSettings } from "./plan";
import { roundFor } from "./store";

export type ReviewStart = { head: string; at: number };

export function validateReviewSettings(settings: CrewSettings) {
  const seat = settings.reviewJudgmentSeat;
  if (
    seat !== undefined &&
    (typeof seat !== "string" ||
      !/^[a-z][a-z0-9-]{0,79}$/u.test(seat) ||
      ["owner", "github"].includes(seat))
  )
    throw new Error("crew.reviewJudgmentSeat needs a named agent seat");
  if (
    !settings.reviewStarts ||
    typeof settings.reviewStarts !== "object" ||
    Array.isArray(settings.reviewStarts)
  )
    throw new Error("crew.reviewStarts needs per-PR head/time records");
  for (const [pr, start] of Object.entries(settings.reviewStarts)) {
    if (
      !/^[1-9]\d*$/u.test(pr) ||
      !start ||
      !/^[0-9a-f]{40}$/u.test(start.head) ||
      !Number.isSafeInteger(start.at) ||
      start.at <= 0
    )
      throw new Error(
        "crew.reviewStarts needs a PR number, full head SHA and positive millisecond time",
      );
    if (!seat) throw new Error("crew.reviewStarts requires reviewJudgmentSeat");
  }
}

/** A private crew projection; the gate store and original full history stay intact. */
export function reviewInput(input: GateInput, start?: ReviewStart): GateInput {
  if (!start || !input.item?.pr) return input;
  const history = input.history.filter((claim) => claim.at >= start.at);
  const latest = new Map<string, (typeof history)[number]>();
  for (const claim of history.toSorted((a, b) => a.at - b.at))
    latest.set(
      claim.reviewer
        ? `reviewer:${claim.reviewer}`
        : `source:${claim.sourceId ?? claim.url}`,
      claim,
    );
  return {
    ...input,
    history,
    reviewPosts: input.reviewPosts?.filter((post) => post.at >= start.at),
    item: {
      ...input.item,
      pr: { ...input.item.pr, reviewers: [...latest.values()] },
    },
  };
}

export function reviewObservation(
  observed: { inputs: GateInput[]; verdicts: Verdict[] },
  settings: CrewSettings,
  config: GateConfig,
  now: number,
) {
  const inputs = observed.inputs.map((input) =>
    reviewInput(input, settings.reviewStarts[String(input.number)]),
  );
  const verdicts = observed.verdicts.map((verdict) => {
    const input = inputs.find((input) => input.number === verdict.number);
    return input && settings.reviewStarts[String(input.number)]
      ? evaluate(input, config, now)
      : verdict;
  });
  return { inputs, verdicts };
}

export function roundAfterStart(
  crew: Database,
  pr: number,
  round: number,
  start?: ReviewStart,
) {
  if (!start) return true;
  const row = crew
    .query<{ created_at: number }, [number, number]>(
      "SELECT created_at FROM round WHERE pr = ? AND round = ?",
    )
    .get(pr, round);
  return !!row && row.created_at >= start.at;
}

export function reviewRound(
  crew: Database,
  pr: number,
  head: string,
  now: number,
  start?: ReviewStart,
) {
  const old = crew
    .query<{ created_at: number }, [number, string]>(
      "SELECT created_at FROM round WHERE pr = ? AND head = ? AND closed_at IS NULL",
    )
    .get(pr, head);
  return roundFor(
    crew,
    pr,
    head,
    now,
    !!(start && old && old.created_at < start.at),
  );
}

/** A boundary cannot erase/restart an existing crew round or cross rewritten history. */
export function reviewStartError(
  input: GateInput,
  start: ReviewStart | undefined,
  now: number,
  crew: Database,
  run: Run,
  mirror: string,
) {
  if (!start || input.state !== "OPEN" || !input.item?.headSha) return null;
  if (start.at > now) return "review adoption time is in the future";
  if (
    input.item?.headSha &&
    start.head !== input.item.headSha &&
    run([
      "git",
      "--git-dir",
      mirror,
      "merge-base",
      "--is-ancestor",
      start.head,
      input.item.headSha,
    ]).code !== 0
  )
    return "could not prove the adoption head precedes the current head";
  const cycles = crew
    .query<{ data: string }, [number]>(
      "SELECT data FROM review_cycle WHERE pr = ?",
    )
    .all(input.number);
  if (
    cycles.some(
      (row) =>
        !roundAfterStart(
          crew,
          input.number,
          (JSON.parse(row.data) as { round: number }).round,
          start,
        ),
    )
  )
    return "existing crew rounds predate the adoption boundary; operator reconciliation required";
  return null;
}
