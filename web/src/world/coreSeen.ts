import { useEffect, useRef, useState } from "react";
import { bridge } from "../api";
import { type CoreShared, CoreSeenSharer } from "./coreShared";

export type { CoreShared } from "./coreShared";

/** How long a peek stays drawn before it counts as looking. */
export const CORE_LOOK_DWELL_MS = 600;

type Registry = {
  sharer: CoreSeenSharer;
  looking: Map<symbol, CoreShared>;
  foreground(): boolean;
  refresh(): void;
};

let registry: Registry | null = null;

function documentForeground() {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

function shared(): Registry {
  if (registry) return registry;
  const looking = new Map<symbol, CoreShared>();
  const sharer = new CoreSeenSharer((target) =>
    bridge.call(
      "world.core.seen",
      {
        connection_id: target.connectionId,
        connection_generation: target.generation,
        terminal: target.terminal,
        turn: target.turn,
        seen: target.seen,
      },
      5_000,
    ),
  );
  const next: Registry = {
    sharer,
    looking,
    foreground: documentForeground,
    refresh: () => sharer.update([...looking.values()], next.foreground()),
  };
  if (typeof window !== "undefined") {
    for (const name of ["focus", "blur"] as const)
      window.addEventListener(name, () => next.refresh());
    document.addEventListener("visibilitychange", () => next.refresh());
  }
  registry = next;
  return next;
}

/** Testing seam: replace the sharer's transport and foreground source. */
export function resetCoreSeenForTests(
  send: (target: CoreShared) => Promise<unknown>,
  foreground: () => boolean,
) {
  const looking = new Map<symbol, CoreShared>();
  const sharer = new CoreSeenSharer(send);
  registry = {
    sharer,
    looking,
    foreground,
    refresh: () => sharer.update([...looking.values()], foreground()),
  };
  return registry;
}

/**
 * Marks `target` as looked at while the calling view stays drawn. Pass
 * null for anything that is not a herdr-core agent. The look follows the
 * agent's identity: a new turn, a new generation or another client's
 * "mark unread" update it in place, so the same look never shares a turn
 * twice.
 */
export function useCoreSeen(target: CoreShared | null) {
  const identity = target
    ? JSON.stringify([target.connectionId, target.terminal])
    : null;
  const [token] = useState(() => Symbol("core-look"));
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    if (!identity) return;
    const shared_ = shared();
    const timer = setTimeout(() => {
      if (!latest.current) return;
      shared_.looking.set(token, latest.current);
      shared_.refresh();
    }, CORE_LOOK_DWELL_MS);
    return () => {
      clearTimeout(timer);
      if (shared_.looking.delete(token)) shared_.refresh();
    };
  }, [identity, token]);
  const facts = target
    ? `${target.generation}:${target.turn}:${target.seen}:${target.stale === true}`
    : null;
  useEffect(() => {
    const shared_ = registry;
    if (!shared_ || !latest.current || !shared_.looking.has(token)) return;
    shared_.looking.set(token, latest.current);
    shared_.refresh();
  }, [facts, token]);
}

/** A request whose label never came back is shown as settled after this. */
export const CORE_FAVOURITE_SETTLE_MS = 5_000;

/**
 * The favourite (`herdr.pinned`) for a core agent: its shown state, and a
 * toggle that asks the service and shows the request while it is out.
 */
export function useCoreFavourite(
  target: CoreShared | null,
  notify?: (message: string) => void,
) {
  const [pending, setPending] = useState<boolean | null>(null);
  const favourite = pending ?? target?.favourite ?? false;
  useEffect(() => {
    if (pending === null) return;
    // The shown label caught up with the request.
    if (target?.favourite === pending) return setPending(null);
    const timer = setTimeout(() => setPending(null), CORE_FAVOURITE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pending, target?.favourite]);
  const toggle = () => {
    if (!target || pending !== null) return;
    const want = !target.favourite;
    setPending(want);
    bridge
      .call(
        "world.core.favourite",
        {
          connection_id: target.connectionId,
          connection_generation: target.generation,
          terminal: target.terminal,
          favourite: want,
        },
        5_000,
      )
      .then(
        (reply) => {
          // Nothing to change: the label already said so.
          if ((reply as { written?: unknown } | null)?.written !== true)
            setPending(null);
        },
        () => {
          setPending(null);
          notify?.("Couldn't change the favourite in Herdr's apps");
        },
      );
  };
  return { favourite, pending: pending !== null, toggle };
}
