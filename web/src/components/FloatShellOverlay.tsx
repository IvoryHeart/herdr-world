import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Power, X } from "lucide-react";
import { bridge, type BridgeControlMsg } from "../api";
import { TERMINAL_FONT_FAMILY, terminalFontOptions } from "../appearance";
import { isMobileLayout } from "../layoutPreferences";
import { pluginActionShortcut } from "../pluginActionShortcuts";
import { store } from "../store";
import {
  type FloatShellTarget,
  hideFloatShell,
  useFloatShellTarget,
} from "../world/floatShell";

const RESIZE_DEBOUNCE_MS = 150;
/** The service refuses more than 64 KiB of keys in one call. */
const MAX_INPUT_BYTES = 48 * 1024;

type Phase =
  | { kind: "opening" }
  | { kind: "open"; created: boolean }
  | { kind: "closed"; reason: string };

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(data: string): Uint8Array {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loaded with `PopupOverlay`'s chunk and after TerminalView's, whose styles
 * carry xterm's (see App.tsx), so it adds no asset of its own.
 *
 * World's float shell on herdr-core, over whatever view is open: the
 * equivalent of the TUI's Herdr Float popup, which core has no notion of.
 * Hiding leaves the shell running for the next open; **End shell** ends it.
 */
export function FloatShellOverlay({
  terminalTheme,
  terminalFontFamily = TERMINAL_FONT_FAMILY,
  terminalFontScale,
}: {
  terminalTheme: ITheme;
  terminalFontFamily?: string;
  terminalFontScale: number;
}) {
  const target = useFloatShellTarget();
  if (!target) return null;
  return (
    <FloatShellWindow
      // A new target (another room, or a reconnected core) is a new view.
      key={`${target.connectionId}:${target.generation}:${target.terminalId}`}
      target={target}
      terminalTheme={terminalTheme}
      terminalFontFamily={terminalFontFamily}
      terminalFontScale={terminalFontScale}
    />
  );
}

function FloatShellWindow({
  target,
  terminalTheme,
  terminalFontFamily,
  terminalFontScale,
}: {
  target: FloatShellTarget;
  terminalTheme: ITheme;
  terminalFontFamily: string;
  terminalFontScale: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const streamRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "opening" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme;
  }, [terminalTheme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: terminalFontFamily,
      ...terminalFontOptions(isMobileLayout(), terminalFontScale),
      theme: terminalTheme,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;
    let disposed = false;
    let stream: string | null = null;

    // Keys go one call at a time, so they arrive in the order typed; what is
    // typed meanwhile joins the next call.
    let pending: Uint8Array[] = [];
    let sending = false;
    const flush = async () => {
      if (sending || !stream) return;
      sending = true;
      try {
        while (pending.length && stream && !disposed) {
          let size = 0;
          const take: Uint8Array[] = [];
          while (
            pending.length &&
            size + pending[0]!.byteLength <= MAX_INPUT_BYTES
          ) {
            const next = pending.shift()!;
            size += next.byteLength;
            take.push(next);
          }
          if (!take.length)
            take.push(pending.shift()!.slice(0, MAX_INPUT_BYTES));
          const bytes = new Uint8Array(
            take.reduce((n, b) => n + b.byteLength, 0),
          );
          let at = 0;
          for (const part of take) {
            bytes.set(part, at);
            at += part.byteLength;
          }
          await bridge.call("world.float.input", {
            stream,
            data: base64(bytes),
          });
        }
      } catch (error) {
        // Never replayed: a person sees what reached the shell and retypes.
        pending = [];
        store.notify({
          kind: "error",
          message: "Float shell input was not sent",
          detail: messageOf(error),
        });
      } finally {
        sending = false;
      }
    };
    const encoder = new TextEncoder();
    const onData = term.onData((data) => {
      if (!stream) return;
      pending.push(encoder.encode(data));
      void flush();
    });
    const onBinary = term.onBinary((data) => {
      if (!stream) return;
      pending.push(Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff));
      void flush();
    });
    // The toggle that opened it hides it again, as in Herdr Float.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && pluginActionShortcut(event)) {
        event.preventDefault();
        hideFloatShell();
        return false;
      }
      return true;
    });

    const offControl = bridge.onControl((control: BridgeControlMsg) => {
      const push = control;
      if (!stream || push.stream !== stream) return;
      if (push.type === "float_output" && typeof push.data === "string") {
        // Bytes, not text: xterm joins a character split across pushes.
        term.write(fromBase64(push.data));
      } else if (push.type === "float_closed") {
        stream = null;
        streamRef.current = null;
        if (push.ended) {
          // The shell itself ended (exit, or End shell): nothing to show.
          hideFloatShell();
          return;
        }
        setPhase({ kind: "closed", reason: push.reason ?? "Stream closed" });
      }
    });

    const dims = fit.proposeDimensions();
    bridge
      .call("world.float.open", {
        connection_id: target.connectionId,
        connection_generation: target.generation,
        terminal_id: target.terminalId,
        cols: dims?.cols ?? term.cols,
        rows: dims?.rows ?? term.rows,
      })
      .then((opened: { stream: string; created: boolean }) => {
        if (disposed) {
          void bridge
            .call("world.float.hide", { stream: opened.stream })
            .catch(() => {});
          return;
        }
        stream = opened.stream;
        streamRef.current = opened.stream;
        setPhase({ kind: "open", created: opened.created });
        fit.fit();
        const settled = fit.proposeDimensions();
        if (
          settled &&
          dims &&
          (settled.cols !== dims.cols || settled.rows !== dims.rows)
        )
          void bridge
            .call("world.float.resize", { stream, ...settled })
            .catch(() => {});
        term.focus();
      })
      .catch((error: unknown) => {
        if (!disposed) setPhase({ kind: "closed", reason: messageOf(error) });
      });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        fit.fit();
        const next = fit.proposeDimensions();
        if (!next || !stream) return;
        void bridge
          .call("world.float.resize", { stream, ...next })
          .catch(() => {});
      }, RESIZE_DEBOUNCE_MS);
    });
    resizeObserver.observe(container);
    term.focus();

    return () => {
      disposed = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      offControl();
      onData.dispose();
      onBinary.dispose();
      // Hiding leaves the shell running; only this view goes.
      if (stream)
        void bridge.call("world.float.hide", { stream }).catch(() => {});
      stream = null;
      streamRef.current = null;
      term.dispose();
      termRef.current = null;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
    // Theme updates in place; a font change applies to the next open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const endShell = () => {
    const stream = streamRef.current;
    if (!stream) return hideFloatShell();
    bridge.call("world.float.stop", { stream }).catch((error: unknown) =>
      store.notify({
        kind: "error",
        message: "The float shell was not ended",
        detail: messageOf(error),
      }),
    );
  };

  const title = `Shell · ${target.label}`;
  return (
    <div
      className="float-shell-backdrop"
      onPointerDown={(event) => {
        // Outside the window hides it; the shell keeps running.
        if (event.target === event.currentTarget) hideFloatShell();
      }}
    >
      <section
        className="float-shell-window"
        role="dialog"
        aria-label={title}
        data-phase={phase.kind}
      >
        <header className="float-shell-head">
          <span className="float-shell-title">{title}</span>
          {phase.kind === "opening" ? (
            <span className="float-shell-note">Opening…</span>
          ) : null}
          {phase.kind === "closed" ? (
            <button
              type="button"
              className="float-shell-action"
              onClick={() => {
                setPhase({ kind: "opening" });
                setAttempt((value) => value + 1);
              }}
            >
              Open again
            </button>
          ) : null}
          <button
            type="button"
            className="float-shell-action"
            disabled={phase.kind !== "open"}
            title="End this room's shell and whatever runs in it"
            onClick={endShell}
          >
            <Power size={13} aria-hidden="true" />
            <span>End shell</span>
          </button>
          <button
            type="button"
            className="float-shell-hide"
            aria-label="Hide shell"
            title="Hide: the shell keeps running"
            onClick={hideFloatShell}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        {phase.kind === "closed" ? (
          <p className="float-shell-reason" role="status">
            {phase.reason}
          </p>
        ) : null}
        <div ref={containerRef} className="float-shell-screen" />
      </section>
    </div>
  );
}
