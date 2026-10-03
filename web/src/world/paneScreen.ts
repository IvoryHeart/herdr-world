import { useCallback, useEffect, useState } from "react";
import type { ConnectionClient } from "../api";
import { pollingTargets } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

const MAX_PANES = 16;
const POLL_MS = 4_000;
const BORDER_ONLY = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝▔▁▏▕\-_=+|·•.]*$/;
// Footer and input chrome that agent TUIs draw below their output.
const CHROME =
  /\?\s*for shortcuts|esc to cancel|ctrl\+[a-z] to|shift\+tab to|context (left|\d+% used)|weekly \d+% left|tokens? used|f\d to view|for agents|^\s*[⎿└]?\s*tip:|update installed|restart to update|^\s*[↑↓]\s?\d|\$\d+\.\d+ \(|\(auto\)|^\s*~?\/\S*( \([^)]*\))?\s*$/i;
const INPUT_PROMPT = /^\s*(?:[›❯>]|│\s*[›❯>])(?:\s|$)/;

/** Read live, not narrowed: visibility changes while reads are awaited. */
function pageHidden() {
  return document.visibilityState === "hidden";
}

function textOf(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const nested = textOf(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function clean(line: string) {
  return line
    .replace(/^\s*│\s?/, "")
    .replace(/\s?│\s*$/, "")
    .trimEnd();
}

function meaningful(line: string) {
  return line.trim().length > 0 && !BORDER_ONLY.test(line);
}

/**
 * The bottom of a blocked agent's screen is the question it is asking: the
 * proposal, its target and the choices. Keep that block intact.
 */
export function questionFromScreen(screen: string, maxLines = 14): string[] {
  const lines = screen.split("\n").map(clean).filter(meaningful);
  return lines.filter((line) => !CHROME.test(line)).slice(-maxLines);
}

/**
 * A working agent's latest progress sits above its input box and footer.
 * Drop that chrome and return the last few lines of real output.
 */
export function activityFromScreen(screen: string, maxLines = 3): string[] {
  const lines = screen.split("\n").map(clean);
  let end = lines.length;
  // Only the bottom of the screen holds the input box and footer.
  const floor = Math.max(0, lines.length - 10);
  for (let index = lines.length - 1; index >= floor; index -= 1) {
    if (INPUT_PROMPT.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines
    .slice(0, end)
    .filter((line) => meaningful(line) && !CHROME.test(line))
    .slice(-maxLines);
}

/**
 * Identity of the terminal whose screen is shown: the pane in one runtime
 * generation running one agent session. A new session or generation on the
 * same pane is a different screen and must never inherit the old one's text.
 */
export function screenIdentity(leaf: WorldLeafObject) {
  return JSON.stringify([
    leaf.connectionId,
    leaf.generation,
    leaf.pane.pane_id,
    leaf.agentSessionFingerprint ?? null,
  ]);
}

/**
 * Polls the visible screen of a bounded, most-urgent-first set of panes on the
 * selected host. Returns a reader that only yields text for the leaf's current
 * identity.
 */
export function usePaneScreens(
  leaves: WorldLeafObject[],
  client: ConnectionClient,
) {
  const [screens, setScreens] = useState<Map<string, string>>(() => new Map());
  const targets = pollingTargets(leaves, MAX_PANES);
  const targetKey = targets
    .map((leaf) => `${screenIdentity(leaf)}:${leaf.status}`)
    .join("\n");

  useEffect(() => setScreens(new Map()), [client.connectionId]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const live = new Set(targets.map(screenIdentity));
    // Drop text for identities that are no longer polled.
    setScreens((current) => {
      const kept = new Map([...current].filter(([key]) => live.has(key)));
      return kept.size === current.size ? current : kept;
    });
    const poll = async () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      // A hidden page reads nothing; it refreshes as soon as it is shown.
      if (pageHidden()) {
        if (!cancelled) timer = window.setTimeout(run, POLL_MS);
        return;
      }
      for (const leaf of targets) {
        if (cancelled || !client.isCurrent()) return;
        // Stop reading as soon as the page is hidden; showing it resumes.
        if (pageHidden()) break;
        const identity = screenIdentity(leaf);
        try {
          const result = await client.call(
            "pane.read",
            { pane_id: leaf.pane.pane_id, source: "visible", strip_ansi: true },
            8_000,
          );
          const text = textOf(result);
          // A read that finishes after the polled set changed belongs to an
          // identity this effect no longer serves.
          if (cancelled || text === null) continue;
          setScreens((current) =>
            current.get(identity) === text
              ? current
              : new Map(current).set(identity, text),
          );
        } catch {
          // A pane that cannot be read keeps its last screen until it can.
        }
      }
      if (!cancelled) timer = window.setTimeout(run, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !polling) void run();
    };
    let polling = false;
    const run = async () => {
      polling = true;
      try {
        await poll();
      } finally {
        polling = false;
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void run();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // targetKey captures every identity and status change of the polled panes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, targetKey]);

  return useCallback(
    (leaf: WorldLeafObject) => screens.get(screenIdentity(leaf)),
    [screens],
  );
}
