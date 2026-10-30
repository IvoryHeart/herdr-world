import type { CSSProperties } from "react";
import { POD_STATE_LABELS, podName, podRounds, type PodState } from "../pods";
import { TERMINAL_COLOR_HEX } from "../terminalColor";
import { DeskWorkBadge } from "./DeskWorkBadge";
import type { TownBadgeTone } from "./townBadges";
import type { TownPodPlaque as Plaque } from "./townTeams";

const TONES: Record<PodState, TownBadgeTone> = {
  reviewing: "pending",
  fixes: "fail",
  ready: "pass",
  merged: "plain",
};

/**
 * A pod's plaque on its wall: the pull request's number, its state from the
 * pull request card (Reviewing, Fixes requested, READY) and its rounds,
 * inside its wall so neighbouring pods' plaques never overlap. The state
 * gives way first, then the rounds; the branch name is on the desk's own
 * nameplate and in the plaque's tooltip. The number opens the pull request card, as a
 * desk's badge does.
 */
export function TownPodPlaque({
  plaque,
  left,
  top,
}: {
  plaque: Plaque;
  left: number;
  top: number;
}) {
  const { pod } = plaque;
  const name = podName(pod);
  const state = pod.state ? POD_STATE_LABELS[pod.state] : null;
  const rounds = podRounds(pod);
  const current = pod.rounds[pod.rounds.length - 1]?.round ?? 0;
  const earlier = pod.rounds.length - 1;
  const description = `${name}${pod.item ? `, ${pod.item.title}` : ""}${state ? `: ${state}` : ""}, ${rounds}`;
  return (
    <div
      className="town-desk-tags town-pod-plaque-at"
      style={
        {
          left,
          top,
          "--wall-w": `${plaque.w}px`,
        } as CSSProperties
      }
    >
      <span
        className="town-pod-plaque"
        data-state={pod.state ?? "unknown"}
        role="note"
        aria-label={`Pod ${description}`}
        title={description}
        style={{ borderColor: TERMINAL_COLOR_HEX[plaque.color] }}
      >
        <i aria-hidden="true" />
        {pod.item && pod.state ? (
          <DeskWorkBadge
            badge={{
              text: `#${pod.number}`,
              tone: TONES[pod.state],
              url: pod.item.url,
              itemKey: pod.item.key,
            }}
            deskLabel={`pod ${name}`}
          />
        ) : (
          <span aria-hidden="true">#{pod.number}</span>
        )}
        <span className="town-pod-plaque-name" aria-hidden="true">
          {state ?? ""}
        </span>
        <span className="town-pod-plaque-rounds" aria-hidden="true">
          r{current}
          {earlier ? ` +${earlier}` : ""}
        </span>
      </span>
    </div>
  );
}
