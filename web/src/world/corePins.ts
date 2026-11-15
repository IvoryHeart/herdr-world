import { useEffect, useState, useSyncExternalStore } from "react";
import { tabCardKey } from "../../../shared/terminalColor";
import { bridge } from "../api";
import { store } from "../store";
import type { DeskPin } from "./board/boardDocument";
import {
  worldRuntimeStore,
  type WorldRuntimeConnection,
  type WorldRuntimeState,
} from "./runtimeStore";

/**
 * One pin for herdr-core agents, shared with Herdr's apps (desktop app
 * `docs/labels.md`): an agent is pinned while its `herdr.pinned` label is
 * set, in every client. World's desk and card pins for a core tab are that
 * label, and pinned goes first: a pinned desk takes its room's first seats in
 * Town, a pinned card the first places by its workspace on Board.
 *
 * A desk (a core tab) is pinned while any of its terminals is. Pinning it
 * pins its agents (its terminals, when it has no agent); unpinning it clears
 * every terminal's pin, so the desk is no longer pinned in any client.
 * Herdr's own (TUI) agents have no runtime pin: their desk and card pins stay
 * World's own.
 */

export type CoreTabPin = {
  connectionId: string;
  generation: number;
  /** World observes this core now: pins can be written. */
  live: boolean;
  pinned: boolean;
  members: readonly { terminal: string; agent: boolean; pinned: boolean }[];
};

/** Core tabs by their Board card key (the key desk pins and colours use). */
export type CorePins = ReadonlyMap<string, CoreTabPin>;

const NO_PINS: CorePins = new Map();

/** Every observed core tab's pin, by card key. Stale hosts keep their last
 * observed pins for display, marked not live. */
export function corePinsOf(
  connections: readonly WorldRuntimeConnection[],
): CorePins {
  let pins: Map<string, CoreTabPin> | null = null;
  for (const connection of connections) {
    const snapshot = connection.snapshot;
    if (connection.runtime !== "herdr-core" || !snapshot) continue;
    const live = connection.state === "ready" && !connection.stale;
    const workspaceIds = new Set(
      snapshot.workspaces.map((workspace) => workspace.workspace_id),
    );
    for (const tab of snapshot.tabs) {
      const members = snapshot.panes
        .filter(
          (pane) =>
            pane.tab_id === tab.tab_id &&
            pane.workspace_id === tab.workspace_id,
        )
        .map((pane) => ({
          terminal: pane.pane_id,
          agent: Boolean(pane.agent),
          pinned: pane.favourite === true,
        }));
      (pins ??= new Map()).set(
        tabCardKey(connection.connectionId, tab.tab_id, workspaceIds),
        {
          connectionId: connection.connectionId,
          generation: connection.generation,
          live,
          pinned: members.some((member) => member.pinned),
          members,
        },
      );
    }
  }
  return pins ?? NO_PINS;
}

let lastState: WorldRuntimeState | null = null;
let lastPins: CorePins = NO_PINS;
/** The core pins World observes now (one derivation per runtime revision). */
export function currentCorePins(): CorePins {
  const state = worldRuntimeStore.get();
  if (state !== lastState) {
    lastState = state;
    const next = corePinsOf(state.connections);
    lastPins = samePins(lastPins, next) ? lastPins : next;
  }
  return lastPins;
}

function samePins(a: CorePins, b: CorePins) {
  if (a.size !== b.size) return false;
  for (const [key, pin] of b) {
    const was = a.get(key);
    if (
      !was ||
      was.pinned !== pin.pinned ||
      was.live !== pin.live ||
      was.generation !== pin.generation ||
      was.members.length !== pin.members.length ||
      was.members.some(
        (member, index) =>
          member.terminal !== pin.members[index]!.terminal ||
          member.agent !== pin.members[index]!.agent ||
          member.pinned !== pin.members[index]!.pinned,
      )
    )
      return false;
  }
  return true;
}

export function useCorePins(): CorePins {
  return useSyncExternalStore(
    worldRuntimeStore.subscribe,
    currentCorePins,
    currentCorePins,
  );
}

/**
 * World's saved desk pins as Town shows them: a core tab is pinned exactly
 * when its label says so; Herdr tabs keep their saved pins.
 */
export function withCorePins<T extends Readonly<Record<string, DeskPin>>>(
  saved: T,
  core: CorePins,
): T {
  let out: Record<string, DeskPin> | null = null;
  for (const [key, pin] of core) {
    const has = Object.prototype.hasOwnProperty.call(saved, key);
    if (pin.pinned && !has) (out ??= { ...saved })[key] = { cell: null };
    else if (!pin.pinned && has) delete (out ??= { ...saved })[key];
  }
  return (out as T | null) ?? saved;
}

/**
 * The Board cards to pin or unpin so they match their core labels: only for
 * cores observed live and cards Board has placed.
 */
export function coreCardPinChanges(
  pinned: ReadonlyMap<string, unknown>,
  core: CorePins,
  placed: (key: string) => boolean,
) {
  const pin: string[] = [];
  const unpin: string[] = [];
  for (const [key, tab] of core) {
    if (!tab.live || !placed(key)) continue;
    if (tab.pinned && !pinned.has(key)) pin.push(key);
    else if (!tab.pinned && pinned.has(key)) unpin.push(key);
  }
  return { pin, unpin };
}

/** The label writes that pin or unpin a core tab (the mixed-desk rule). */
export function corePinWrites(pin: CoreTabPin, pinned: boolean) {
  const targets = pinned
    ? pin.members.some((member) => member.agent)
      ? pin.members.filter((member) => member.agent)
      : pin.members
    : pin.members;
  return targets
    .filter((member) => member.pinned !== pinned)
    .map((member) => ({
      connection_id: pin.connectionId,
      connection_generation: pin.generation,
      terminal: member.terminal,
      favourite: pinned,
    }));
}

export const CORE_PIN_FAILED = "Couldn't change the pin in Herdr's apps";
export const CORE_PIN_STALE =
  "This agent's host is reconnecting: its pin can change once World sees it again";

/**
 * Pin or unpin a core tab in every Herdr client. The desk and card show it
 * when the label comes back. Resolves false (with a notice) when nothing
 * could be written.
 */
export async function setCoreTabPinned(
  pin: CoreTabPin,
  pinned: boolean,
  call: (
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<unknown> = bridge.call.bind(bridge),
  notify: (message: string) => void = (message) =>
    store.notify({ kind: "error", message }),
): Promise<boolean> {
  if (!pin.live) {
    notify(CORE_PIN_STALE);
    return false;
  }
  const results = await Promise.allSettled(
    corePinWrites(pin, pinned).map((params) =>
      call("world.core.favourite", params, 5_000),
    ),
  );
  if (results.some((result) => result.status === "rejected")) {
    notify(CORE_PIN_FAILED);
    return false;
  }
  return true;
}

/** The core tab holding a core agent's terminal (its desk and card). */
export function coreTabPinOf(
  core: CorePins,
  connectionId: string,
  terminal: string,
): CoreTabPin | null {
  for (const pin of core.values())
    if (
      pin.connectionId === connectionId &&
      pin.members.some((member) => member.terminal === terminal)
    )
      return pin;
  return null;
}

/** A request whose label never came back is shown as settled after this. */
export const CORE_PIN_SETTLE_MS = 5_000;

/**
 * A core agent's pin as a peek shows it: its desk's pin, shared with Herdr's
 * apps, with the request shown while it is out.
 */
export function useCoreAgentPin(
  target: { connectionId: string; terminal: string } | null,
  notify?: (message: string) => void,
) {
  const core = useCorePins();
  const pin = target
    ? coreTabPinOf(core, target.connectionId, target.terminal)
    : null;
  const [pending, setPending] = useState<boolean | null>(null);
  const label = pin?.pinned ?? false;
  useEffect(() => {
    if (pending === null) return;
    // The shown label caught up with the request.
    if (label === pending) return setPending(null);
    const timer = setTimeout(() => setPending(null), CORE_PIN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pending, label]);
  const toggle = () => {
    if (!pin || pending !== null) return;
    const want = !pin.pinned;
    setPending(want);
    void setCoreTabPinned(pin, want, undefined, notify).then((ok) => {
      if (!ok) setPending(null);
    });
  };
  return {
    pinned: pending ?? label,
    pending: pending !== null,
    live: pin?.live ?? false,
    toggle,
  };
}
