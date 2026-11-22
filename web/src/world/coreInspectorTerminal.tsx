import {
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { lazyWithReload } from "../lazyWithReload";
import { holdTerminalComposerDraftScope } from "../terminalComposer";
import type { WorldObjectNode } from "./worldObject";
// The "not live now" notice is drawn here, before any watch loads.
import "./coreWatch.css";

// The Inspector's herdr-core Terminal tab, kept apart from the watch itself:
// World's control plane renders the tab and holds drafts on every page, but
// xterm (about 360 KB) loads only when a core Terminal tab is first shown.

/** Which herdr-core terminal to watch, as World's snapshot names it. */
export type CoreWatchTarget = {
  connectionId: string;
  generation: number;
  address: string;
};

const CoreTerminalWatch = lazyWithReload("world-core-terminal", () =>
  import("./CoreTerminalWatch").then((module) => ({
    default: module.CoreTerminalWatch,
  })),
);

/** What the watch needs of a World node: its label and, if live, its target. */
type WatchableNode = { label: string; watch?: CoreWatchTarget };
type WatchableWorld = { nodeById: ReadonlyMap<string, WatchableNode> };
type DraftScope = { connectionId: string; generation: number };

/**
 * Keeps unsent composer drafts for each core connection generation in
 * `scopes`. App's catalogue does not list core connections, so their drafts
 * are held here: a scope lets go (and its drafts go) only when its
 * generation leaves, an actual change of owner, never when a view closes.
 */
export function useCoreDraftScopes(scopes: readonly DraftScope[]) {
  const held = useRef(new Map<string, () => void>());
  const key = JSON.stringify(
    [
      ...new Set(
        scopes.map((s) => JSON.stringify([s.connectionId, s.generation])),
      ),
    ].sort(),
  );
  useEffect(() => {
    const wanted = new Set<string>(JSON.parse(key));
    for (const [scope, release] of held.current)
      if (!wanted.has(scope)) {
        held.current.delete(scope);
        release();
      }
    for (const scope of wanted)
      if (!held.current.has(scope)) {
        const [connectionId, generation] = JSON.parse(scope);
        held.current.set(
          scope,
          holdTerminalComposerDraftScope(connectionId, generation),
        );
      }
  }, [key]);
  useEffect(() => {
    const scopes = held.current;
    return () => {
      for (const release of scopes.values()) release();
      scopes.clear();
    };
  }, []);
}

/**
 * The Terminal tab's body for a live herdr-core leaf, or undefined for any
 * other node. The watch starts the first time the tab is shown and then
 * stays while the window is shown (hidden while another tab is), so a look
 * at Chat neither ends the stream nor gives the size back. Minimizing or
 * closing the window ends both: the page's watch and World's seat go, and
 * the watch starts again when the Terminal tab is shown next.
 */
export function coreInspectorTerminal(
  node: WorldObjectNode | undefined,
  view: {
    /** The Terminal tab is the one selected in the Inspector. */
    selected: boolean;
    /** The Inspector window is on screen (not minimized or hidden). */
    shown: boolean;
  },
): ReactNode | undefined {
  if (node?.kind !== "agent" && node?.kind !== "terminal") return;
  if (!node.coreControl) return;
  if (!node.watch || node.stale)
    return (
      <div className="core-watch-ended" role="status">
        <p>This herdr-core terminal is not live now.</p>
      </div>
    );
  return (
    <CoreInspectorTerminal
      key={`${node.id}:${node.watch.generation}`}
      target={node.watch}
      title={node.label}
      selected={view.selected}
      shown={view.shown}
    />
  );
}

function CoreInspectorTerminal({
  target,
  title,
  selected,
  shown,
}: {
  target: CoreWatchTarget;
  title: string;
  selected: boolean;
  shown: boolean;
}) {
  const [watching, setWatching] = useState(selected && shown);
  if (watching && !shown) setWatching(false);
  else if (!watching && shown && selected) setWatching(true);
  return watching ? (
    <Suspense fallback={null}>
      <CoreTerminalWatch
        target={target}
        title={title}
        active={selected && shown}
      />
    </Suspense>
  ) : null;
}

/** Every live core generation in `worlds` keeps its composer drafts. */
export function useCoreTerminalDrafts(worlds: readonly WatchableWorld[]) {
  const live = useMemo(
    () =>
      worlds.flatMap((world) =>
        [...world.nodeById.values()].flatMap((n) => (n.watch ? [n.watch] : [])),
      ),
    // The worlds' identities are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    worlds,
  );
  useCoreDraftScopes(live);
}
