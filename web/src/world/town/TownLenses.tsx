/**
 * Town lenses (townLens.ts) in the page: which lens is on, the tints drawn
 * over the town, and the legend that takes over the Town board while a lens
 * is on. Town always opens in Attention; the last lens chosen is remembered
 * per browser, for `L` and the ring's Lenses action.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Layers } from "lucide-react";
import { worldLocalStorage } from "../../browserStorage";
import type { WorldSourcesSnapshot } from "../../../../shared/worldSources";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { OfficeAgent } from "../officeProjectionTypes";
import type { TownCenterAction } from "./TownCenterMenu";
import { townDeskWork } from "./townBadges";
import {
  TOWN_LENSES,
  TOWN_LENS_HINTS,
  TOWN_LENS_NAMES,
  townLensStep,
  townLensView,
  townLensWords,
  type TownLensFacts,
  type TownLensId,
  type TownLensMark,
  type TownLensView,
} from "./townLens";
import { TOWN_TILE as T, townSeat, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import {
  townPlaceEconomy,
  townUsageCurrent,
  townUsageStore,
  useTownUsage,
} from "./townPlaceUsage";
import type { TownQuestMark } from "./townQuestPennant";
import { townScaleLensFacts } from "./townScaleLens";
import { townScaleSceneRequested } from "./townScaleScene";
import type { TownTarget } from "./townTargets";
import "./townLens.css";

const STORAGE_KEY = "townLens";
/** The page's own copy, for browsers whose storage is blocked. */
let lastLens: TownLensId = "idle";

function rememberedLens(): TownLensId {
  const saved = worldLocalStorage.getItem(STORAGE_KEY);
  return (
    TOWN_LENSES.find((lens) => lens === saved && lens !== "attention") ??
    lastLens
  );
}

function remember(lens: TownLensId) {
  if (lens === "attention") return;
  lastLens = lens;
  try {
    worldLocalStorage.setItem(STORAGE_KEY, lens);
  } catch {
    // A full or blocked storage keeps the choice for this page only.
  }
}

export type TownLensState = {
  lens: TownLensId;
  /** The chooser is open in the legend. */
  choosing: boolean;
  /** The legend replaces the Town board. */
  shown: boolean;
  pick(lens: TownLensId): void;
  step(direction: 1 | -1): void;
  /** `L`: on with the last lens chosen, then step on. */
  cycle(direction: 1 | -1): void;
  /** The ring's Lenses: the last lens chosen, with the chooser open. */
  open(): void;
  choose(): void;
  close(): void;
};

/** Which lens Town shows. It starts in Attention on every visit. */
export function useTownLensState(): TownLensState {
  const [lens, setLens] = useState<TownLensId>("attention");
  const [choosing, setChoosing] = useState(false);
  const shown = lens !== "attention" || choosing;
  const pick = useCallback((next: TownLensId) => {
    remember(next);
    setLens(next);
    setChoosing(next === "attention");
  }, []);
  const step = useCallback(
    (direction: 1 | -1) => {
      const next = townLensStep(lens, direction);
      remember(next);
      setLens(next);
      // Stepping onto Attention keeps the legend, to step on from it.
      setChoosing(next === "attention");
    },
    [lens],
  );
  const cycle = useCallback(
    (direction: 1 | -1) => {
      if (shown) step(direction);
      else pick(rememberedLens());
    },
    [shown, step, pick],
  );
  const open = useCallback(() => {
    setLens(rememberedLens());
    setChoosing(true);
  }, []);
  const choose = useCallback(
    () => setChoosing((was) => !was || lens === "attention"),
    [lens],
  );
  const close = useCallback(() => {
    setLens("attention");
    setChoosing(false);
  }, []);
  return { lens, choosing, shown, pick, step, cycle, open, choose, close };
}

/** The ring's Lenses action, next to Summary. */
export function withLensAction(
  actions: readonly TownCenterAction[],
  state: TownLensState,
): TownCenterAction[] {
  const action: TownCenterAction = {
    id: "lenses",
    label: "Lenses",
    icon: Layers,
    detail:
      state.lens === "attention" ? undefined : TOWN_LENS_NAMES[state.lens],
    run: state.open,
  };
  const at = actions.findIndex((candidate) => candidate.id === "summary");
  return at === -1
    ? [...actions, action]
    : [...actions.slice(0, at + 1), action, ...actions.slice(at + 1)];
}

/** `L` steps lenses (Shift+L back); Escape leaves one. Typing never does. */
export function useTownLensKeys(
  state: TownLensState,
  shell: { readonly current: HTMLElement | null },
  ringOpen: boolean,
) {
  const latest = useRef({ state, ringOpen });
  latest.current = { state, ringOpen };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.closest(".xterm, [role='dialog'], [role='menu']"))
      )
        return;
      // Only keys meant for Town: the page itself, or Town's own elements.
      const inTown =
        !target ||
        target === document.body ||
        !!(shell.current && shell.current.contains(target));
      if (!inTown || document.querySelector(".modal-backdrop")) return;
      const { state, ringOpen } = latest.current;
      if (event.key === "l" || event.key === "L") {
        event.preventDefault();
        state.cycle(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape" && state.shown && !ringOpen) {
        event.preventDefault();
        state.close();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [shell]);
}

/** Readers refresh usage at most every minute while the Spend lens shows. */
const USAGE_REFRESH_MS = 60_000;
/** Ages and kept reads are re-checked this often while a lens is on. */
const LENS_TICK_MS = 30_000;

/**
 * The marks for the lens on, from what World has: activity times, today's
 * usage, the desks' linked work and quests. The scale scene
 * (`?scene=town-scale`) brings its own synthetic facts.
 */
export function useTownLensView(
  lens: TownLensId,
  model: TownModel,
  {
    projection,
    sources,
    quests,
    activityAt,
  }: {
    projection: HerdrOfficeProjection;
    sources: WorldSourcesSnapshot;
    quests: ReadonlyMap<string, TownQuestMark>;
    activityAt?: (agent: OfficeAgent) => number | undefined;
  },
): TownLensView | null {
  const [scene] = useState(() =>
    typeof window === "undefined"
      ? false
      : townScaleSceneRequested(window.location.search),
  );
  const store = townUsageStore();
  const usage = useTownUsage(store);
  // The lens's clock: ages and kept usage are read again while it is on.
  const [now, setNow] = useState(() => store.clock());
  const on = lens !== "attention";
  useEffect(() => {
    if (!on) return;
    setNow(store.clock());
    const timer = window.setInterval(() => setNow(store.clock()), LENS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [on, store]);
  useEffect(() => {
    if (lens !== "spend" || scene) return;
    store.request();
    const timer = window.setInterval(() => store.request(), USAGE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [lens, scene, store]);
  const deskWork = useMemo(
    () =>
      lens === "pulls" && !scene ? townDeskWork(projection, sources) : null,
    [lens, scene, projection, sources],
  );
  return useMemo(() => {
    if (!on) return null;
    const facts: TownLensFacts = scene
      ? townScaleLensFacts(now, (workspaceId) => {
          const room = [...model.rooms.values()].find(
            (candidate) => candidate.workspaceRef.nativeId === workspaceId,
          );
          return room ? room.desks.map((desk) => desk.tabRef.nativeId) : [];
        })
      : {
          now,
          activityAt: (agent) => activityAt?.(agent),
          economy: (place) =>
            townPlaceEconomy(townUsageCurrent(usage, now), place),
          work: (desk) => deskWork?.get(desk.key),
          quest: (key) => quests.get(key),
        };
    return townLensView(lens, model, facts);
  }, [on, lens, model, scene, usage, now, deskWork, quests, activityAt]);
}

/** A hovered, focused or selected place's reading, for the legend. */
export function townLensReadout(
  view: TownLensView | null,
  model: TownModel,
  key: string | null,
): string | null {
  if (!view || key === null) return null;
  const room = model.rooms.get(key);
  if (room)
    return `${room.displayLabel}: ${view.rooms.get(key)?.words ?? "nothing to show"}`;
  const desk = model.desks.get(key);
  if (desk)
    return `${desk.displayLabel}: ${view.desks.get(key)?.words ?? "nothing to show"}`;
  const agent = model.agents.get(key);
  const deskKey = agent
    ? model.agentSeats.get(key)?.deskKey
    : model.devices.get(key)?.deskKey;
  const label = agent?.displayLabel ?? model.devices.get(key)?.displayLabel;
  if (!label) return null;
  const words =
    (agent && view.agents.get(key)?.words) ??
    (deskKey ? view.desks.get(deskKey)?.words : undefined);
  return `${label}: ${words ?? "nothing to show"}`;
}

/** Accessible targets name each place's reading while a lens is on. */
export function townLensTargets(
  targets: readonly TownTarget[],
  view: TownLensView | null,
): readonly TownTarget[] {
  if (!view) return targets;
  const name = TOWN_LENS_NAMES[view.lens];
  return targets.map((target) => {
    const words = townLensWords(view, target.kind, target.key);
    return words
      ? { ...target, label: `${target.label}. ${name}: ${words}` }
      : target;
  });
}

const markData = (mark: TownLensMark | undefined) =>
  mark === undefined || mark.swatch === null
    ? "none"
    : mark.swatch === "no-data"
      ? "no-data"
      : "value";

const markStyle = (view: TownLensView, mark: TownLensMark | undefined) =>
  typeof mark?.swatch === "number"
    ? ({ "--lens": view.swatches[mark.swatch]!.color } as React.CSSProperties)
    : undefined;

/**
 * The lens's tints in Town's world layer, under every sign and card: the
 * town dimmed, each room's floor in its aggregate colour, and, in rooms on
 * screen, each desk and seated agent in its own. Taps pass to the town.
 */
export function TownLensLayer({
  view,
  model,
  layout,
  shownRooms,
}: {
  view: TownLensView;
  model: TownModel;
  layout: TownLayout;
  /** Rooms on screen at room zoom (the HUD's tag rooms). */
  shownRooms: ReadonlySet<string>;
}) {
  return (
    <div className="town-lens" data-lens={view.lens} aria-hidden="true">
      <div
        className="town-lens-dim"
        style={{ width: layout.width * T, height: layout.height * T }}
      />
      {layout.buildings.flatMap((building) =>
        building.rooms.map((placed) => {
          const room = model.rooms.get(placed.key);
          if (!room) return null;
          const mark = view.rooms.get(placed.key);
          return (
            <div
              key={placed.key}
              className="town-lens-room"
              data-mark={markData(mark)}
              style={{
                left: placed.x * T,
                top: placed.y * T,
                width: placed.w * T,
                height: placed.h * T,
                ...markStyle(view, mark),
              }}
            >
              <span className="town-lens-room-label">
                <b>{room.displayLabel}</b>
                <small>{mark?.short ?? "—"}</small>
              </span>
              {shownRooms.has(placed.key)
                ? placed.cells.map((cell) => {
                    const desk = cell.deskKey
                      ? model.desks.get(cell.deskKey)
                      : undefined;
                    if (!desk) return null;
                    const deskMark = view.desks.get(desk.key);
                    return [
                      <i
                        key={desk.key}
                        className="town-lens-desk"
                        data-mark={markData(deskMark)}
                        style={{
                          left: (cell.x + 1 - placed.x) * T,
                          top: (cell.y - placed.y) * T,
                          width: 4 * T,
                          height: 4 * T,
                          ...markStyle(view, deskMark),
                        }}
                      />,
                      ...desk.paneDevices.flatMap((device, seat) => {
                        const agentMark = device.agentKey
                          ? view.agents.get(device.agentKey)
                          : undefined;
                        if (!agentMark || seat > 3) return [];
                        const at = townSeat(cell, seat);
                        return [
                          <i
                            key={device.key}
                            className="town-lens-seat"
                            data-mark={markData(agentMark)}
                            style={{
                              left: at.cx - 12 - placed.x * T,
                              top:
                                (at.top ? at.tableY : at.tableY + 34) -
                                placed.y * T,
                              ...markStyle(view, agentMark),
                            }}
                          />,
                        ];
                      }),
                    ];
                  })
                : null}
            </div>
          );
        }),
      )}
    </div>
  );
}

/**
 * The legend, in the Town board's place while a lens is on: the lens's
 * name with ‹ › and ✕, the chooser, its scale and the reading of the place
 * under the pointer or focus. Leaving the lens brings the board back.
 */
export function TownLensLegend({
  state,
  view,
  readout,
}: {
  state: TownLensState;
  view: TownLensView | null;
  readout: string | null;
}) {
  const name = TOWN_LENS_NAMES[state.lens];
  return (
    <div
      className="town-board town-lens-legend"
      role="group"
      aria-label={`Town lens: ${name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          state.close();
        }
      }}
    >
      <div className="town-lens-head">
        <button
          type="button"
          className="town-lens-step"
          aria-label="Previous lens"
          title="Previous lens (Shift+L)"
          onClick={() => state.step(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="town-lens-name"
          aria-expanded={state.choosing}
          aria-controls="town-lens-choices"
          title="Choose a lens"
          onClick={state.choose}
        >
          {name} ▾
        </button>
        <button
          type="button"
          className="town-lens-step"
          aria-label="Next lens"
          title="Next lens (L)"
          onClick={() => state.step(1)}
        >
          ›
        </button>
        <button
          type="button"
          className="town-lens-close"
          aria-label="Leave the lens"
          title="Back to Town as usual (Esc)"
          onClick={state.close}
        >
          ✕
        </button>
      </div>
      {state.choosing ? (
        <div
          id="town-lens-choices"
          className="town-lens-choices"
          role="radiogroup"
          aria-label="Lenses"
        >
          {TOWN_LENSES.map((lens) => (
            <button
              key={lens}
              type="button"
              role="radio"
              aria-checked={lens === state.lens}
              title={TOWN_LENS_HINTS[lens]}
              onClick={() => state.pick(lens)}
            >
              {TOWN_LENS_NAMES[lens]}
            </button>
          ))}
        </div>
      ) : null}
      {view ? (
        <ol className="town-lens-scale" aria-label={`${name} scale`}>
          {view.swatches.map((swatch) => (
            <li key={swatch.label}>
              <i style={{ background: swatch.color }} aria-hidden="true" />
              {swatch.label}
            </li>
          ))}
          {view.noData ? (
            <li data-mark="no-data">
              <i aria-hidden="true" />
              No data
            </li>
          ) : null}
        </ol>
      ) : (
        <p className="town-lens-note">
          {TOWN_LENS_HINTS.attention} Pick a lens.
        </p>
      )}
      {view?.note ? <p className="town-lens-note">{view.note}</p> : null}
      {view ? (
        <p className="town-lens-readout" role="status" aria-live="polite">
          {readout ?? "Hover, focus or tap a place to read it."}
        </p>
      ) : null}
    </div>
  );
}

/** Everything Town's canvas needs of its lenses, in one hook. */
export function useTownLenses(
  model: TownModel,
  {
    targets,
    centerActions,
    shell,
    ringOpen,
    ...facts
  }: Parameters<typeof useTownLensView>[2] & {
    targets: readonly TownTarget[];
    centerActions?: readonly TownCenterAction[];
    shell: { readonly current: HTMLElement | null };
    /** The town center's ring takes Escape while it is open. */
    ringOpen: boolean;
  },
) {
  const state = useTownLensState();
  useTownLensKeys(state, shell, ringOpen);
  const view = useTownLensView(state.lens, model, facts);
  /** The accessible target focused last, read in the legend. */
  const [focused, setFocused] = useState<string | null>(null);
  const ringActions = useMemo(
    () =>
      centerActions?.length ? withLensAction(centerActions, state) : undefined,
    [centerActions, state],
  );
  const lensTargets = useMemo(
    () => townLensTargets(targets, view),
    [targets, view],
  );
  return {
    state,
    view,
    model,
    ringActions,
    targets: lensTargets,
    focus: setFocused,
    focused,
  };
}

/**
 * The Town board, or while a lens is on, its legend in the board's place,
 * reading the hovered, focused or selected place.
 */
export function TownLensBoard({
  lens,
  hover,
  selected,
  children,
}: {
  lens: ReturnType<typeof useTownLenses>;
  hover: string | null;
  selected: string | null;
  children: ReactNode;
}) {
  if (!lens.state.shown) return children;
  return (
    <TownLensLegend
      state={lens.state}
      view={lens.view}
      readout={townLensReadout(
        lens.view,
        lens.model,
        hover ?? lens.focused ?? selected,
      )}
    />
  );
}
