import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { terminalFontOptions } from "../appearance";
import { isMobileLayout } from "../layoutPreferences";
import { detectShortcutPlatform } from "../shortcutBindings";
import {
  type AgentPrompt,
  type AgentActivity,
  parseAgentPrompt,
  parseAgentActivity,
} from "../agentPrompt";
export function b64toBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
export function b64toText(b64: string): string | null {
  try {
    return new TextDecoder().decode(b64toBytes(b64));
  } catch {
    return null;
  }
}

/** True only once `pending` has held continuously for `delayMs`. */
export function useDelayedFlag(pending: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!pending) {
      setElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setElapsed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, pending]);
  return pending && elapsed;
}

export function terminalDensity(terminalFontScale: number) {
  const compact = typeof window !== "undefined" && isMobileLayout();
  return terminalFontOptions(compact, terminalFontScale);
}

export function isApplePlatform() {
  return detectShortcutPlatform() === "mac";
}

export function shouldAvoidVirtualKeyboard() {
  return isMobileLayout() || window.matchMedia("(any-pointer: coarse)").matches;
}

export function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function isSafariBrowser() {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function trimCopiedLinePadding(text: string) {
  return text.replace(/[ \t]+(?=\r?\n|$)/g, "");
}

/** The bottom screen of a terminal, as text, whatever is scrolled into view. */
export function terminalScreenLines(term: Terminal): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < term.rows; row++)
    lines.push(
      buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? "",
    );
  return lines;
}

export function useTerminalChatState(
  termRef: RefObject<Terminal | null>,
  chatShown: boolean,
  status: string | undefined,
  scope: string,
) {
  // Not working: blocked on a question, or one Herdr does not report yet (a
  // new session's "trust this folder?", before Claude's hooks run).
  const agentWaiting = chatShown && status?.toLowerCase() !== "working";
  const chatShownRef = useRef(chatShown);
  chatShownRef.current = chatShown;
  useEffect(() => {
    if (chatShown) termRef.current?.textarea?.blur();
  }, [chatShown]);
  const agentWorking = chatShown && status?.toLowerCase() === "working";
  const [agentPrompt, setAgentPrompt] = useState<AgentPrompt | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(
    null,
  );
  useEffect(() => {
    if (!agentWaiting && !agentWorking) {
      setAgentPrompt(null);
      setAgentActivity(null);
      return;
    }
    // What the agent asks, and what it says it is doing, are only on its
    // screen, and change as it goes.
    const read = () => {
      const term = termRef.current;
      if (!term) return;
      const screen = terminalScreenLines(term);
      // A menu can be up while the agent still counts as working (its
      // question before the hooks say it waits): read both then.
      setAgentPrompt((current) => {
        const buffer = term.buffer.active;
        const next = parseAgentPrompt(screen, (row, column) => {
          const cell = buffer.getLine(buffer.baseY + row)?.getCell(column);
          return !!cell && !cell.isBgDefault();
        });
        return JSON.stringify(current) === JSON.stringify(next)
          ? current
          : next;
      });
      if (agentWorking)
        setAgentActivity((current) => {
          const next = parseAgentActivity(screen);
          return current?.word === next?.word &&
            current?.detail === next?.detail
            ? current
            : next;
        });
    };
    read();
    // Read again as soon as the screen changes (a key moved the menu's
    // cursor), once a frame at most; the timer catches a terminal attached
    // later.
    let frame: number | null = null;
    const written = termRef.current?.onWriteParsed(() => {
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null;
          read();
        });
    });
    const timer = window.setInterval(read, 1000);
    return () => {
      window.clearInterval(timer);
      written?.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [agentWaiting, agentWorking, scope, termRef]);
  return { agentPrompt, agentActivity, chatShownRef };
}
