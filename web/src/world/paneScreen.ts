import { useEffect, useState } from "react";
import type { ConnectionClient } from "../api";
import type { WorldLeafObject } from "./worldObject";

const MAX_PANES = 16;
const POLL_MS = 4_000;
const BORDER_ONLY = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝▔▁▏▕\-_=+|·•.]*$/;
// Footer and input chrome that agent TUIs draw below their output.
const CHROME =
  /\?\s*for shortcuts|esc to cancel|ctrl\+[a-z] to|shift\+tab to|context (left|\d+% used)|weekly \d+% left|tokens? used|f\d to view|for agents|^\s*[⎿└]?\s*tip:|update installed|restart to update/i;
const INPUT_PROMPT = /^\s*(?:[›❯>]|│\s*[›❯>])(?:\s|$)/;

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

/** Polls the visible screen of a bounded set of panes on the selected host. */
export function usePaneScreens(
  leaves: WorldLeafObject[],
  client: ConnectionClient,
) {
  const [screens, setScreens] = useState<Map<string, string>>(() => new Map());
  const targets = leaves.slice(0, MAX_PANES);
  const targetKey = targets
    .map((leaf) => `${leaf.id}:${leaf.generation}:${leaf.status}`)
    .join("\n");

  useEffect(() => setScreens(new Map()), [client.connectionId]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      for (const leaf of targets) {
        if (cancelled || !client.isCurrent()) return;
        try {
          const result = await client.call(
            "pane.read",
            { pane_id: leaf.pane.pane_id, source: "visible", strip_ansi: true },
            8_000,
          );
          const text = textOf(result);
          if (cancelled || text === null) continue;
          setScreens((current) =>
            current.get(leaf.id) === text
              ? current
              : new Map(current).set(leaf.id, text),
          );
        } catch {
          // A pane that cannot be read keeps its last screen until it can.
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // targetKey captures every relevant change to the polled panes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, targetKey]);

  return screens;
}
