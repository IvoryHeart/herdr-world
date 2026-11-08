/**
 * Town's edge arrows and Next (townEdgeArrows.ts, townNext.ts) for the
 * canvas: the marked agents, the arrows each drawn frame, the camera trips
 * with their pulse, and N / Shift+N on a desktop. Only the camera moves and
 * Needs you opens; agents stay where they are.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useLayoutPreferences } from "../../layoutPreferences";
import { formatShortcut, matchesShortcut } from "../../shortcutBindings";
import { getShortcutSnapshot } from "../../shortcutPreferences";
import { sharedDeskStore } from "../deskStateStore";
import { openNeedsYou } from "../needsYou";
import { townWorldAnchor } from "./scene/townHud";
import type { TownSceneCamera } from "./scene/townSceneCamera";
import type { TownLevel } from "./townCamera";
import { TownEdgeArrowStore, type TownPulse } from "./TownEdgeLayer";
import {
  townEdgeArrows,
  townEdgeArrowsShown,
  type TownEdgeArrow,
  type TownEdgeMark,
  type TownEdgeRect,
  type TownEdgeTarget,
} from "./townEdgeArrows";
import { TOWN_TILE, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import {
  townEdgeMarked,
  townKeyIgnored,
  townNeedsYouAgentKey,
  townNextLabel,
  townNextStep,
  type TownEdgeMarked,
  type TownNextCursor,
} from "./townNext";
import { townReceptionMark } from "./townReceptionFilter";
import type { TownRendererHandle } from "./townRenderer";

/** Needs you's items in its order, each with its agent's leaf ID and mark. */
export type TownNeedsYouOrder = () => readonly {
  itemKey: string;
  leafId: string | null;
  mark: TownEdgeMark;
}[];

const NO_ARROWS: readonly TownEdgeArrow[] = [];
const NO_MARKED: readonly TownEdgeMarked[] = [];
/** Reception's marks as edge marks. */
const EDGE_MARK = { blocked: "needs", ask: "asks", done: "done" } as const;

/**
 * For the canvas's current state, its camera, its renderer and its host (whose
 * parent, Town's shell, holds the chrome arrows keep out of).
 */
export function useTownEdgeNav(
  {
    model,
    layout,
    askingKeys,
    calm,
    needsYouOrder,
  }: {
    model: TownModel;
    layout: TownLayout;
    askingKeys: ReadonlySet<string>;
    calm: boolean;
    needsYouOrder: TownNeedsYouOrder | undefined;
  },
  view: TownSceneCamera,
  rendererRef: RefObject<TownRendererHandle | null>,
  hostRef: RefObject<HTMLElement | null>,
) {
  // Agents with a mark (! ? ✓) as Town draws them; reviewed work is already
  // idle in Town's projection. Edge arrows point at those off screen, and at
  // finished work Needs you lists for review (edgeMarked below).
  const marked = useMemo(() => {
    const list: TownEdgeMarked[] = [];
    for (const agent of model.agents.values()) {
      if (agent.stale) continue;
      const mark = townReceptionMark(
        agent.semanticStatus,
        askingKeys.has(agent.key),
      );
      if (mark)
        list.push({
          key: agent.key,
          mark: EDGE_MARK[mark],
          hostKey: agent.hostKey,
        });
    }
    return list;
  }, [model, askingKeys]);
  const roomsByKey = useMemo(
    () =>
      new Map(
        layout.buildings.flatMap((building) =>
          building.rooms.map((room) => [room.key, room] as const),
        ),
      ),
    [layout],
  );
  const latest = useRef({
    model,
    layout,
    marked,
    roomsByKey,
    calm,
    needsYouOrder,
  });
  latest.current = { model, layout, marked, roomsByKey, calm, needsYouOrder };
  /** Where an agent is drawn: itself, its desk, else its room's middle. */
  const agentPoint = (key: string) => {
    const renderer = rendererRef.current;
    if (!renderer) return null;
    const { model: m, layout: l, roomsByKey: rooms } = latest.current;
    const at = townWorldAnchor(key, m, l, (agentKey) =>
      renderer.actorPosition(agentKey),
    );
    const point = at.agent ?? at.workbench;
    if (point) return point;
    const room = rooms.get(m.agents.get(key)?.roomKey ?? "");
    return room
      ? {
          x: (room.x + room.w / 2) * TOWN_TILE,
          y: (room.y + room.h / 2) * TOWN_TILE,
        }
      : null;
  };
  /**
   * Town's marks plus finished work awaiting review in the shared review
   * state, as Needs you lists it: Town marks a finish only when it saw the
   * agent busy, so after a reload such work is idle in Town. Read on drawn
   * frames, not rendered, so stop notices do not re-render Town; computed
   * again when the review records, Town or the time window change.
   */
  const reviewCache = useRef<{
    state: unknown;
    model: TownModel | null;
    marked: readonly TownEdgeMarked[];
    bucket: number;
    list: readonly TownEdgeMarked[];
  }>({ state: null, model: null, marked: [], bucket: -1, list: [] });
  const edgeMarked = () => {
    const { model: m, marked: own, needsYouOrder: order } = latest.current;
    const state = sharedDeskStore().get();
    const bucket = Math.floor(Date.now() / 5000);
    const cache = reviewCache.current;
    if (
      cache.state === state &&
      cache.model === m &&
      cache.marked === own &&
      cache.bucket === bucket
    )
      return cache.list;
    const list = townEdgeMarked(own, order?.() ?? [], m.agents);
    reviewCache.current = { state, model: m, marked: own, bucket, list };
    return list;
  };
  const arrowsShown = useRef(false);
  // A review record that changes while arrows show asks for a frame.
  useEffect(
    () =>
      sharedDeskStore().subscribe(() => {
        if (arrowsShown.current) rendererRef.current?.invalidate("edge-arrows");
      }),
    [rendererRef],
  );
  const [arrowStore] = useState(() => new TownEdgeArrowStore());
  const keepOut = useRef<{ at: number; rects: TownEdgeRect[] }>({
    at: -Infinity,
    rects: [],
  });
  /** The Town board and the zoom group, which arrows keep out of. */
  const edgeKeepOut = () => {
    const now = performance.now();
    const host = hostRef.current;
    const shell = host?.parentElement;
    if (now - keepOut.current.at < 500 || !shell || !host)
      return keepOut.current.rects;
    const origin = host.getBoundingClientRect();
    const rects: TownEdgeRect[] = [];
    for (const element of shell.querySelectorAll(
      ":scope > .town-board, :scope > .town-board-chip, :scope > .town-zoom",
    )) {
      const box = element.getBoundingClientRect();
      if (box.width && box.height)
        rects.push({
          left: box.left - origin.left,
          top: box.top - origin.top,
          right: box.right - origin.left,
          bottom: box.bottom - origin.top,
        });
    }
    keepOut.current = { at: now, rects };
    return rects;
  };
  const [pulse, setPulse] = useState<TownPulse | null>(null);
  const pulseSeq = useRef(0);
  /** A pulse whose camera is still on its way; the next still frame shows it. */
  const pulseComing = useRef<TownPulse | null>(null);
  const frameArrows = (
    camera: TownRendererHandle["camera"],
    level: TownLevel,
  ) => {
    // The pulse waits for the camera, whose glide runs on frame time and
    // can outlast its seconds when frames are slow.
    const coming = pulseComing.current;
    if (coming && !camera.flying) {
      pulseComing.current = null;
      setPulse(coming);
    }
    arrowsShown.current = townEdgeArrowsShown(level);
    const list = arrowsShown.current ? edgeMarked() : NO_MARKED;
    if (!list.length) {
      arrowStore.set(NO_ARROWS);
      return;
    }
    const targets: TownEdgeTarget[] = [];
    for (const agent of list) {
      const point = agentPoint(agent.key);
      if (point) targets.push({ ...agent, x: point.x, y: point.y });
    }
    arrowStore.set(townEdgeArrows(targets, camera, level, edgeKeepOut()));
  };
  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(null), 1700);
    return () => window.clearTimeout(timer);
  }, [pulse]);
  /**
   * Move the camera to an agent and pulse its mark: a glide, or a jump with
   * no pulse under calm or reduced motion. Agents stay where they are.
   */
  const goToAgent = (key: string, mark: TownEdgeMark) => {
    const point = agentPoint(key);
    if (!point) return;
    const { model: m, roomsByKey: rooms, calm: still } = latest.current;
    const room = rooms.get(m.agents.get(key)?.roomKey ?? "") ?? null;
    view.goTo(point, room, still);
    setPulse(null);
    pulseComing.current = null;
    if (still || view.camera?.reducedMotion) return;
    pulseSeq.current += 1;
    pulseComing.current = {
      seq: pulseSeq.current,
      mark,
      x: point.x,
      y: point.y,
    };
    rendererRef.current?.invalidate("edge-pulse");
  };
  const goToArrow = (arrow: TownEdgeArrow) => {
    const key = arrow.keys[0];
    const mark = edgeMarked().find((agent) => agent.key === key);
    if (key) goToAgent(key, mark?.mark ?? arrow.mark);
  };
  const buildingLabel = (hostKey: string) =>
    latest.current.model.hosts.get(hostKey)?.displayLabel ?? "another building";
  // A new or answered mark asks for a frame, so the arrows follow it.
  useEffect(() => {
    rendererRef.current?.invalidate("edge-arrows");
  }, [rendererRef, marked]);
  const nextCursor = useRef<TownNextCursor>(null);
  const [nextText, setNextText] = useState("");
  const nextTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(nextTimer.current), []);
  const showNext = (text: string) => {
    setNextText(text);
    window.clearTimeout(nextTimer.current);
    nextTimer.current = window.setTimeout(() => setNextText(""), 2200);
  };
  /**
   * N: the camera to the next thing that needs you, in Needs you's order,
   * and Needs you open at it; Shift+N goes back. Nothing is answered.
   */
  const stepNext = (direction: 1 | -1) => {
    const order = latest.current.needsYouOrder?.() ?? [];
    const step = townNextStep(
      order.map((item) => item.itemKey),
      nextCursor.current,
      direction,
    );
    if (!step) {
      nextCursor.current = null;
      showNext("Nothing needs you");
      return;
    }
    nextCursor.current = step;
    const item = order[step.index]!;
    const agentKey = townNeedsYouAgentKey(
      latest.current.model.agents,
      item.leafId,
    );
    if (agentKey) goToAgent(agentKey, item.mark);
    openNeedsYou(item.itemKey);
    const { preset, platform } = getShortcutSnapshot();
    const key = preset.bindings["town.next"][0];
    showNext(
      townNextLabel(
        step.index,
        order.length,
        key ? formatShortcut(key, platform) : "",
      ),
    );
  };
  const stepNextRef = useRef(stepNext);
  stepNextRef.current = stepNext;
  // N and Shift+N (rebindable in Keyboard shortcuts) on a desktop; never
  // while typing in a field, the composer or a terminal.
  const { mobile } = useLayoutPreferences();
  useEffect(() => {
    if (mobile) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (townKeyIgnored(event.target)) return;
      const { bindings } = getShortcutSnapshot().preset;
      const direction = matchesShortcut(event, "town.next", bindings)
        ? 1
        : matchesShortcut(event, "town.previous", bindings)
          ? -1
          : 0;
      if (!direction || !rendererRef.current) return;
      event.preventDefault();
      stepNextRef.current(direction);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [rendererRef, mobile]);

  return {
    /** Recompute the arrows for a drawn frame. */
    frameArrows,
    arrowStore,
    goToArrow,
    buildingLabel,
    pulse,
    nextText,
  };
}
