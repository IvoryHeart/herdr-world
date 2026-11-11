import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, Eye, Keyboard } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import "@xterm/xterm/css/xterm.css";
import { bridge, type ConnectionStatus } from "../api";
import {
  type CoreGrid,
  type CoreGridMove,
  type CoreWatchReply,
  CoreWatchScreen,
  watchEndedText,
  watchGridText,
  watchScale,
} from "../coreWatch";
import type { ResolvedTheme } from "../appearance";
import { terminalThemeFor } from "../terminalThemes";
import {
  CoreTyping,
  fittedGrid,
  isFocusReport,
  userInputSignal,
} from "../coreTyping";
import { holdTerminalComposerDraftScope } from "../terminalComposer";
import { CoreTerminalComposer } from "./CoreTerminalComposer";
import "./coreWatch.css";

/** Which herdr-core terminal to watch, as World's snapshot names it. */
export type CoreWatchTarget = {
  connectionId: string;
  generation: number;
  address: string;
};

const pageTheme = (): ResolvedTheme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

function streamKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `w${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The page is visible: a hidden page holds no stream (one per visible view). */
function usePageVisible() {
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** Advances each time the World socket connects again (its watches ended). */
function useBridgeEpoch() {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let last: ConnectionStatus | null = null;
    return bridge.onStatus((status) => {
      if (status === "connected" && last !== null && last !== "connected")
        setEpoch((value) => value + 1);
      last = status;
    });
  }, []);
  return epoch;
}

/**
 * A herdr-core terminal, watched and typed into. Core's grid is adopted
 * exactly (the desktop pane's size, World's while you type, or headless);
 * the drawing is only scaled to fit, so rotating a phone or opening its
 * keyboard never changes the terminal by itself. The first real key opens
 * core's keyboard at the size that fits this view; leaving (focus away for
 * a few seconds, a minute without keys, Back) gives the size back. xterm's
 * own replies to the program go only while World holds the keyboard.
 */
export function CoreTerminalWatch({
  target,
  title,
  onClose,
}: {
  target: CoreWatchTarget;
  title: string;
  onClose(): void;
}) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [grid, setGrid] = useState<CoreGrid | null>(null);
  const [moved, setMoved] = useState<CoreGridMove | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [drawn, setDrawn] = useState({ width: 0, height: 0 });
  const [attempt, setAttempt] = useState(0);
  const [canType, setCanType] = useState(true);
  const [typed, setTyped] = useState<CoreGrid | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const typingRef = useRef<CoreTyping | null>(null);
  const visible = usePageVisible();
  const epoch = useBridgeEpoch();

  // One xterm for the view's lifetime. Its input goes to core's keyboard.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: false,
      allowProposedApi: true,
      scrollback: 2000,
      cols: 80,
      rows: 24,
      fontSize: 13,
      theme: terminalThemeFor(pageTheme()),
      scrollbar: { showScrollbar: false },
    });
    term.loadAddon(new UnicodeGraphemesAddon());
    term.open(host);
    termRef.current = term;
    // Keys and pastes are genuine; xterm's answers to the program's queries
    // are not, so they never take the size. Without a way to tell them apart
    // the view stays watch-only.
    const signal = userInputSignal(term);
    if (!signal) {
      term.options.disableStdin = true;
      setCanType(false);
    }
    const typedData = term.onData((data) => {
      const genuine = signal?.take() ?? false;
      if (!genuine && isFocusReport(data)) return;
      if (genuine) setNotice(null);
      void typingRef.current?.type(data, !genuine).catch(() => undefined);
    });
    const typedBinary = term.onBinary((data) => {
      const genuine = signal?.take() ?? false;
      void typingRef.current
        ?.type(
          Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff),
          !genuine,
        )
        .catch(() => undefined);
    });
    const themes = new MutationObserver(() => {
      term.options.theme = terminalThemeFor(pageTheme());
    });
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      themes.disconnect();
      typedData.dispose();
      typedBinary.dispose();
      signal?.dispose();
      termRef.current = null;
      term.dispose();
    };
  }, []);

  // The stream: opened while the page is visible, again after World's socket
  // or the core connection comes back, closed when the view goes.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !visible) return;
    const stream = streamKey();
    let live = true;
    term.reset();
    setGrid(null);
    setMoved(null);
    setEnded(null);
    setTyped(null);
    const typing = new CoreTyping(
      {
        input: (batch) => bridge.call("world.core.input", { stream, ...batch }),
        leave: () => bridge.call("world.core.leave", { stream }),
      },
      {
        size: () => {
          const drawing =
            hostRef.current?.querySelector<HTMLElement>(".xterm-screen");
          const view = viewRef.current;
          const pad = view ? getComputedStyle(view) : null;
          return fittedGrid(
            { cols: term.cols, rows: term.rows },
            {
              width: drawing?.offsetWidth ?? 0,
              height: drawing?.offsetHeight ?? 0,
            },
            {
              width:
                (view?.clientWidth ?? 0) -
                parseFloat(pad?.paddingLeft ?? "0") -
                parseFloat(pad?.paddingRight ?? "0"),
              height:
                (view?.clientHeight ?? 0) -
                parseFloat(pad?.paddingTop ?? "0") -
                parseFloat(pad?.paddingBottom ?? "0"),
            },
          );
        },
        refused: (message) => live && setNotice(message),
        changed: (held) => live && setTyped(held),
      },
    );
    typingRef.current = typing;
    const screen = new CoreWatchScreen({
      resize: (cols, rows) => {
        // xterm's resize first parses every write before it (flushSync), so
        // earlier bytes are drawn on their own grid and later ones on this.
        term.resize(cols, rows);
        // xterm's own grid, for anyone checking it is core's.
        if (hostRef.current)
          hostRef.current.dataset.termGrid = `${term.cols}x${term.rows}`;
        setGrid({ cols, rows });
      },
      write: (bytes) => term.write(bytes),
    });
    const off = bridge.onCoreTerminal(stream, (push) => {
      if (!live) return;
      try {
        screen.apply(push);
      } catch (error) {
        setEnded((error as Error).message);
        return;
      }
      setMoved(screen.moved);
      if ("closed" in push) {
        typing.stop();
        setEnded(watchEndedText(push.closed));
      }
    });
    bridge
      .call("world.core.watch", {
        connection_id: target.connectionId,
        generation: target.generation,
        address: target.address,
        stream,
      })
      .then((opened: CoreWatchReply) => {
        if (!live) return;
        screen.opened(opened);
        setMoved(screen.moved);
      })
      .catch((error: Error) => {
        typing.stop();
        if (live) setEnded(error.message);
      });
    return () => {
      live = false;
      typing.stop();
      if (typingRef.current === typing) typingRef.current = null;
      off();
      void bridge.call("world.core.unwatch", { stream }).catch(() => undefined);
    };
  }, [
    target.connectionId,
    target.generation,
    target.address,
    visible,
    epoch,
    attempt,
  ]);

  // Measure the drawing at actual size once xterm has laid out the new grid.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !grid) return;
    const frame = requestAnimationFrame(() => {
      const screen = host.querySelector<HTMLElement>(".xterm-screen");
      if (screen)
        setDrawn({ width: screen.offsetWidth, height: screen.offsetHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [grid]);

  // Scale to the view: a rotation or a phone keyboard changes the view only.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const fit = () =>
      setScale(
        watchScale(drawn, {
          width: view.clientWidth,
          height: view.clientHeight,
        }),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(view);
    return () => observer.disconnect();
  }, [drawn]);

  useEffect(() => {
    // Escape is a key for the program while you type in it or its composer.
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (event.key === "Escape" && !target?.closest?.("textarea, input"))
        onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      className="core-watch"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}'s terminal`}
      data-core-watch={target.address}
      data-typing={typed ? "" : undefined}
      onFocus={() => typingRef.current?.focus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          typingRef.current?.focus(false);
      }}
    >
      <header className="core-watch-head">
        <button
          type="button"
          className="core-watch-back"
          onClick={onClose}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="core-watch-title">
          <strong>{title}</strong>
          <small data-core-watch-grid>
            {watchGridText(grid, moved, typed)}
          </small>
        </div>
        {typed ? (
          <span
            className="core-watch-badge"
            data-core-watch-badge="typing"
            title="World has this terminal's size while you type. It goes back when you leave."
          >
            <Keyboard size={14} aria-hidden="true" />
            Typing
          </span>
        ) : (
          <span
            className="core-watch-badge"
            data-core-watch-badge="watching"
            title={
              canType
                ? "Type to send keys. World takes the terminal's size while you type."
                : "This browser can't tell typing from terminal replies, so World only watches."
            }
          >
            <Eye size={14} aria-hidden="true" />
            Watching
          </span>
        )}
      </header>
      {notice ? (
        <p className="core-watch-notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div className="core-watch-view" ref={viewRef}>
        <div
          className="core-watch-frame"
          style={{
            width: drawn.width ? drawn.width * scale : undefined,
            height: drawn.height ? drawn.height * scale : undefined,
          }}
        >
          <div
            className="core-watch-host"
            ref={hostRef}
            data-scale={scale.toFixed(3)}
            style={{ transform: `scale(${scale})` }}
          />
        </div>
        {ended ? (
          <div className="core-watch-ended" role="status">
            <p>{ended}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Watch again
            </button>
          </div>
        ) : null}
      </div>
      {canType && !ended ? (
        <CoreTerminalComposer
          target={target}
          type={(data) =>
            typingRef.current?.type(data) ??
            Promise.reject(new Error("The terminal closed"))
          }
          terminal={termRef}
          onError={setNotice}
        />
      ) : null}
    </section>
  );
}

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
 * Which core terminal is open as a watch. While its connection is away the
 * view keeps the last target, so it can say why the watch ended; when the
 * connection returns with a new generation the view watches again. Every
 * live core generation in `worlds` keeps its composer drafts.
 */
export function useCoreTerminalWatch(worlds: readonly WatchableWorld[]) {
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const last = useRef<CoreWatchTarget | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const find = (id: string) => {
    for (const world of worlds) {
      const node = world.nodeById.get(id);
      if (node) return node;
    }
    return undefined;
  };
  const node = open ? find(open.id) : undefined;
  if (node?.watch) last.current = node.watch;
  const live = useMemo(
    () =>
      worlds.flatMap((world) =>
        [...world.nodeById.values()].flatMap((n) => (n.watch ? [n.watch] : [])),
      ),
    // The worlds' identities are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    worlds,
  );
  // The open view's generation stays held while it says why its stream ended.
  useCoreDraftScopes(open && last.current ? [...live, last.current] : live);
  return {
    /** Opens `id` as a watch when it is a live core terminal. */
    watch(id: string): boolean {
      const candidate = find(id);
      if (!candidate?.watch) return false;
      last.current = candidate.watch;
      setOpen({ id, title: candidate.label });
      return true;
    },
    view:
      open && last.current ? (
        <CoreTerminalWatch
          key={open.id}
          target={last.current}
          title={node?.label ?? open.title}
          onClose={close}
        />
      ) : null,
  };
}
