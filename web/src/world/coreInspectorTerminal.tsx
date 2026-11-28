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
import {
  claimPageKeys,
  focusMovesToTerminal,
  inspectorKey,
  releasePageKeys,
  terminalKey,
} from "./coreTerminalKeys";
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
function useCoreDraftScopes(scopes: readonly DraftScope[]) {
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
  // Keys typed for this terminal before its watch has loaded.
  const [typedEarly] = useState<string[]>(() => []);
  if (watching && !shown) setWatching(false);
  else if (!watching && shown && selected) setWatching(true);
  const active = selected && shown;
  return watching ? (
    <Suspense
      fallback={
        <CoreWatchLoading title={title} active={active} typed={typedEarly} />
      }
    >
      <CoreTerminalWatch
        target={target}
        title={title}
        active={active}
        typedEarly={typedEarly}
      />
    </Suspense>
  ) : null;
}

/**
 * Stands in for the watch while its code loads. It takes focus and keys as
 * the terminal would, so the first key typed after opening the tab is kept
 * and sent once the watch is here.
 * @internal Test seam.
 */
export function CoreWatchLoading({
  title,
  active,
  typed,
}: {
  title: string;
  active: boolean;
  typed: string[];
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) return;
    claimPageKeys(sectionRef.current);
    if (focusMovesToTerminal()) sectionRef.current?.focus();
  }, [active]);
  useEffect(() => {
    const section = sectionRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (!activeRef.current || event.defaultPrevented || !section) return;
      const inside =
        event.target instanceof Node && section.contains(event.target);
      const key = inside ? terminalKey(event) : inspectorKey(event, section);
      if (key === null) return;
      event.preventDefault();
      section.focus();
      typed.push(key);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      releasePageKeys(section);
    };
  }, [typed]);
  return (
    <section
      ref={sectionRef}
      className="core-watch"
      aria-label={`${title}'s terminal`}
      aria-busy="true"
      data-core-watch-loading=""
      tabIndex={-1}
      onPointerDownCapture={() => claimPageKeys(sectionRef.current)}
    />
  );
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
