import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
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
import { CoreTerminalComposer } from "./CoreTerminalComposer";
import type { CoreWatchTarget } from "./coreInspectorTerminal";
import {
  claimPageKeys,
  focusMovesToTerminal,
  inspectorKey,
  releasePageKeys,
} from "./coreTerminalKeys";
import "./coreWatch.css";

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
 * A herdr-core terminal, watched and typed into: the Terminal tab of World's
 * Inspector. Core's grid is adopted exactly and the drawing is only scaled
 * to fit (never below a readable size: the view scrolls instead). While the
 * view is open World asks core to hold the grid that fits it; core gives
 * World that size whenever no Herdr app leads, never takes it from one, and
 * gets it back when the view closes. Blur and idle give nothing back. A
 * click, or a key typed while the Inspector has no other text focus, focuses
 * the terminal and sends that key once. xterm's own replies to the program
 * go only after a person typed here.
 */
export function CoreTerminalWatch({
  target,
  title,
  active = true,
  typedEarly,
}: {
  target: CoreWatchTarget;
  title: string;
  /** Its tab is the one shown: keys typed in the Inspector come here. */
  active?: boolean;
  /** Keys typed for this terminal while it loaded, sent once it is here. */
  typedEarly?: string[];
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
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
  const [held, setHeld] = useState<CoreGrid | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const typingRef = useRef<CoreTyping | null>(null);
  /** Asks core to hold the grid that fits the view now (once the watch opened). */
  const holdRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
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
    setHeld(null);
    // The grid that fits the view at actual size, or null while the view is
    // hidden (another tab, a minimized window): a hidden view holds its size.
    const fits = () => {
      const drawing =
        hostRef.current?.querySelector<HTMLElement>(".xterm-screen");
      const view = viewRef.current;
      if (!view || !drawing) return null;
      const pad = getComputedStyle(view);
      const width =
        view.clientWidth -
        parseFloat(pad.paddingLeft || "0") -
        parseFloat(pad.paddingRight || "0");
      const height =
        view.clientHeight -
        parseFloat(pad.paddingTop || "0") -
        parseFloat(pad.paddingBottom || "0");
      if (
        width <= 0 ||
        height <= 0 ||
        drawing.offsetWidth <= 0 ||
        drawing.offsetHeight <= 0
      )
        return null;
      return fittedGrid(
        { cols: term.cols, rows: term.rows },
        { width: drawing.offsetWidth, height: drawing.offsetHeight },
        { width, height },
      );
    };
    const typing = new CoreTyping(
      {
        input: (batch) => bridge.call("world.core.input", { stream, ...batch }),
        hold: (size) => bridge.call("world.core.hold", { stream, ...size }),
      },
      {
        size: () => fits() ?? { cols: term.cols, rows: term.rows },
        refused: (message) => live && setNotice(message),
        changed: (size) => live && setHeld(size),
        // Keys typed before the watch answers wait for it, then go once.
        opening: true,
      },
    );
    typingRef.current = typing;
    let opened = false;
    holdRef.current = () => {
      const size = opened ? fits() : null;
      if (size) typing.hold(size);
    };
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
      .then((reply: CoreWatchReply) => {
        if (!live) return;
        screen.opened(reply);
        setMoved(screen.moved);
        opened = true;
        typing.open();
        holdRef.current?.();
      })
      .catch((error: Error) => {
        typing.stop();
        if (live) setEnded(error.message);
      });
    return () => {
      live = false;
      typing.stop();
      if (typingRef.current === typing) {
        typingRef.current = null;
        holdRef.current = null;
      }
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
    const fit = () => {
      // A hidden view keeps its scale and the size World holds.
      if (view.clientWidth <= 0 || view.clientHeight <= 0) return;
      setScale(
        watchScale(drawn, {
          width: view.clientWidth,
          height: view.clientHeight,
        }),
      );
      holdRef.current?.();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(view);
    return () => observer.disconnect();
  }, [drawn]);

  // Opening the tab by a click focuses the terminal, so its cursor shows
  // and the next key goes there (keyboard navigation between tabs stays).
  useEffect(() => {
    if (!active) return;
    claimPageKeys(sectionRef.current);
    if (focusMovesToTerminal()) termRef.current?.focus();
  }, [active]);

  // Keys typed while the watch was still loading go now, once, in order;
  // like any early key they wait for the watch to open.
  useEffect(() => {
    const term = termRef.current;
    const early = typedEarly?.splice(0) ?? [];
    if (!term || early.length === 0) return;
    if (activeRef.current) term.focus();
    if (!term.options.disableStdin)
      for (const key of early) term.input(key, true);
    // The keys are taken once, when the watch arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A key typed in this Inspector while nothing there takes typing (its
  // frame, its title bar, the page itself) focuses the terminal and is sent
  // there once, as typed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const term = termRef.current;
      const section = sectionRef.current;
      if (!activeRef.current || event.defaultPrevented || !term || !section)
        return;
      const key = inspectorKey(event, section);
      if (key === null) return;
      event.preventDefault();
      term.focus();
      if (!term.options.disableStdin) term.input(key, true);
    };
    document.addEventListener("keydown", onKey, true);
    const section = sectionRef.current;
    return () => {
      document.removeEventListener("keydown", onKey, true);
      releasePageKeys(section);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="core-watch"
      aria-label={`${title}'s terminal`}
      data-core-watch={target.address}
      data-held={held ? `${held.cols}x${held.rows}` : undefined}
      onPointerDownCapture={() => claimPageKeys(sectionRef.current)}
    >
      <header className="core-watch-head">
        <small className="core-watch-grid" data-core-watch-grid>
          {watchGridText(grid, moved, held)}
        </small>
        {canType ? null : (
          <span
            className="core-watch-badge"
            data-core-watch-badge="watching"
            title="This browser can't tell typing from terminal replies, so World only watches."
          >
            <Eye size={14} aria-hidden="true" />
            Watch only
          </span>
        )}
      </header>
      {notice ? (
        <p className="core-watch-notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div
        className="core-watch-view"
        ref={viewRef}
        // A click anywhere in the view (its margins too) focuses the terminal.
        onPointerDown={(event) => {
          if (
            event.button === 0 &&
            !(event.target as Element).closest("button")
          )
            requestAnimationFrame(() => termRef.current?.focus());
        }}
      >
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
