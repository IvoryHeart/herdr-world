import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgentStarts } from "../agentStarts";
import { paintTownRider } from "./TownBusLayer";
import {
  TOWN_ARRIVAL_SIT_WAIT_MS,
  TownArrivals,
  townAgentsByTerminal,
  townArrivalPath,
  townArrivalWalkMs,
  townPathLength,
  townPathPose,
  type TownArrival,
} from "./townArrivals";
import type { TownBusRoute } from "./townBus";
import type { TownLayout, TownPoint } from "./townLayout";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import type { TownLook } from "./townSprites";
import "./townArrivals.css";

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The arrivals Town plays now (townArrivals.ts), and the agents they keep
 * outside their buildings (`arriving`, for the actors). The set keeps its
 * identity while its members are unchanged.
 */
export function useTownArrivals(
  model: TownModel,
  layout: TownLayout,
  route: TownBusRoute,
) {
  const starts = useAgentStarts();
  const [planner] = useState(() => new TownArrivals());
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    const now = performance.now();
    const changed = planner.update(
      starts,
      townAgentsByTerminal(model),
      (agentKey, from) => {
        const agent = model.agents.get(agentKey);
        const path = agent && townArrivalPath(layout, route, agent, from);
        return path ? townArrivalWalkMs(path) : null;
      },
      now,
      reducedMotion(),
    );
    if (changed) setVersion((n) => n + 1);
    // Wake when one reaches its door or its welcome is over.
    const next = planner.nextChange(now);
    if (next === null) return;
    const timer = setTimeout(() => setVersion((n) => n + 1), next - now + 20);
    return () => clearTimeout(timer);
  }, [planner, starts, model, layout, route, version]);
  const members = planner.outside(performance.now()).join("\n");
  const arriving: ReadonlySet<string> = useMemo(
    () => new Set(members ? members.split("\n") : []),
    [members],
  );
  return { arrivals: planner.arrivals, arriving };
}

/**
 * Each arriving agent on its walk from the town center or its bus stop to
 * its front door, as the same character it is indoors, and its welcome once
 * it has sat down: a burst of sparkles and its name, fading. With reduced
 * motion the welcome is a still highlight that fades.
 */
export const TownArrivalLayer = memo(function TownArrivalLayer({
  arrivals,
  model,
  layout,
  route,
  lookOf,
  renderer,
}: {
  arrivals: readonly TownArrival[];
  model: TownModel;
  layout: TownLayout;
  route: TownBusRoute;
  lookOf(key: string): TownLook;
  renderer: { readonly current: TownRendererHandle | null };
}) {
  const walkers = useRef(new Map<number, HTMLElement>());
  const welcomes = useRef(new Map<number, HTMLElement>());
  /** When each welcome began. */
  const welcomed = useRef(new Map<number, number>());
  const paths = useMemo(() => {
    const byId = new Map<number, TownPoint[]>();
    for (const arrival of arrivals) {
      const agent = model.agents.get(arrival.agentKey);
      const path =
        agent && !arrival.still
          ? townArrivalPath(layout, route, agent, arrival.from)
          : null;
      if (path) byId.set(arrival.id, path);
    }
    return byId;
  }, [arrivals, model, layout, route]);

  useEffect(() => {
    const live = new Set(arrivals.map((arrival) => arrival.id));
    for (const id of welcomed.current.keys())
      if (!live.has(id)) welcomed.current.delete(id);
    if (!arrivals.length) return;
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      for (const arrival of arrivals) {
        const node = walkers.current.get(arrival.id);
        const canvas = node?.querySelector("canvas");
        const path = paths.get(arrival.id);
        const out =
          !!path && now >= arrival.begin && now < arrival.end && !!canvas;
        if (node && node.hasAttribute("data-out") !== out)
          node.toggleAttribute("data-out", out);
        if (out) {
          const pose = townPathPose(
            path,
            (townPathLength(path) * (now - arrival.begin)) /
              (arrival.end - arrival.begin),
          );
          const bob = pose.walking && pose.frame % 2 ? -1 : 0;
          node!.style.translate = `${pose.x}px ${pose.y + bob}px`;
          paintTownRider(
            canvas!,
            lookOf(arrival.agentKey),
            pose.dir,
            pose.frame,
          );
        }
        const welcome = welcomes.current.get(arrival.id);
        if (!welcome || now < arrival.end) continue;
        // Over the agent once it sits (or soon after it is in, wherever its
        // status took it), following it.
        const at = renderer.current?.actorPosition(arrival.agentKey) ?? null;
        if (
          !welcomed.current.has(arrival.id) &&
          at &&
          (at.seated || now >= arrival.end + TOWN_ARRIVAL_SIT_WAIT_MS)
        ) {
          welcomed.current.set(arrival.id, now);
          welcome.toggleAttribute("data-welcome", true);
        }
        if (at && welcomed.current.has(arrival.id))
          welcome.style.translate = `${at.x}px ${at.y}px`;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [arrivals, paths, lookOf, renderer]);

  if (!arrivals.length) return null;
  return (
    <div className="town-arrivals" aria-hidden="true">
      {arrivals.map((arrival) => {
        const agent = model.agents.get(arrival.agentKey);
        return [
          <div
            key={`walk-${arrival.id}`}
            ref={(node) => {
              if (node) walkers.current.set(arrival.id, node);
              else walkers.current.delete(arrival.id);
            }}
            className="town-bin-rider town-arrival-walker"
            data-agent={arrival.agentKey}
            data-arriving=""
          >
            <canvas width={14} height={20} />
          </div>,
          <div
            key={`welcome-${arrival.id}`}
            ref={(node) => {
              if (node) welcomes.current.set(arrival.id, node);
              else welcomes.current.delete(arrival.id);
            }}
            className="town-arrival-welcome"
            data-agent={arrival.agentKey}
          >
            <span className="town-arrival-sparkles">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <i key={index} style={{ rotate: `${index * 60}deg` }} />
              ))}
            </span>
            <span className="town-arrival-tag">
              {agent?.agentName ?? agent?.displayLabel ?? "New agent"}
            </span>
          </div>,
        ];
      })}
    </div>
  );
});
