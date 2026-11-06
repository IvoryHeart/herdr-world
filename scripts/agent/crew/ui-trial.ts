import type { GateInput, Verdict } from "../gate/predicate";
import type { Action, CrewSettings } from "./plan";

/** A clean current UI review needs the steward's owner Try, even while proof/CI settles. */
export function uiTrialReady(
  verdict: Verdict,
  input: GateInput,
  settings: CrewSettings,
) {
  const reviews = verdict.conditions.filter((c) => c.id.startsWith("review:"));
  return Boolean(
    settings.readySeat &&
      !settings.readyAsk &&
      input.state === "OPEN" &&
      !input.item?.draft &&
      !input.hold &&
      !input.labels.includes("on-hold") &&
      input.item?.pr?.uiChange === true &&
      reviews.length &&
      !verdict.conditions.some(
        (c) =>
          c.state === "judgment" ||
          (c.id.startsWith("crew-") && c.state !== "met"),
      ) &&
      reviews.every(
        (c) =>
          c.state === "met" &&
          input.item!.pr!.reviewers.some(
            (r) =>
              r.reviewer === c.id.slice(7) &&
              r.commit === verdict.head &&
              r.outcome === "confirmed",
          ),
      ),
  );
}

export function uiTrialAction(
  verdict: Verdict,
  input: GateInput,
  settings: CrewSettings,
): Action | null {
  if (!uiTrialReady(verdict, input, settings)) return null;
  const remaining = verdict.conditions
    .filter((c) => c.state !== "met")
    .map((c) => c.id);
  return {
    key: `${input.number}:${verdict.head}:ready:${settings.readySeat}`,
    pr: input.number,
    head: verdict.head!,
    kind: "ready",
    target: settings.readySeat!,
    text: `UI reviews clean #${input.number} at ${verdict.head}: ${input.item?.title ?? ""}; raise/dedupe the owner's Try through your existing preview flow. ${remaining.length ? "Merge gates still pending: " + remaining.join(", ") : "Technical gates ready; owner Try still required."}`,
  };
}
