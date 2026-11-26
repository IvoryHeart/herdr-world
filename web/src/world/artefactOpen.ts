import { useEffect, useRef } from "react";
import type { FileExplorerEntry } from "../types";

/**
 * Opening an agent's artefact. A file opens in World's own viewer: the
 * agent's Inspector, Files view, at that path (read through the agent's
 * connection like any file there). A link opens in a new browser tab.
 *
 * The request is a local UI intent for one Inspector window, never World
 * state: the view asks, the agent's Inspector takes it once and drops it.
 */
const ARTEFACT_FILE_EVENT = "herdr-world:artefact-file";

type Pending = { nodeId: string; path: string; at: number };
let pending: Pending | null = null;
/** An unanswered request is dropped, so a later open never jumps to it. */
const PENDING_MS = 30_000;

export function requestArtefactFile(nodeId: string, path: string) {
  pending = { nodeId, path, at: Date.now() };
  window.dispatchEvent(new CustomEvent(ARTEFACT_FILE_EVENT));
}

/** The path asked for this agent's Inspector, taken once. */
function takeArtefactFile(nodeId: string): string | null {
  if (!pending || pending.nodeId !== nodeId) return null;
  const { path, at } = pending;
  pending = null;
  return Date.now() - at <= PENDING_MS ? path : null;
}

/**
 * An agent's Inspector takes the file asked for it, now or when asked later,
 * while its Files view can open (`ready`); `open` shows that file there.
 */
export function useArtefactFileRequests(
  conversation: { nodeId: string; availableViews: readonly string[] },
  ready: boolean,
  open: (entry: FileExplorerEntry) => void,
) {
  const opener = useRef(open);
  opener.current = open;
  const enabled = ready && conversation.availableViews.includes("files");
  const { nodeId } = conversation;
  useEffect(() => {
    if (!enabled) return;
    const take = () => {
      const path = takeArtefactFile(nodeId);
      if (!path) return;
      const name = path.split("/").filter(Boolean).pop() ?? path;
      const hidden = name.startsWith(".");
      opener.current({
        name,
        path,
        type: "file",
        size: 0,
        mtime_ms: 0,
        hidden,
      });
    };
    take();
    window.addEventListener(ARTEFACT_FILE_EVENT, take);
    return () => window.removeEventListener(ARTEFACT_FILE_EVENT, take);
  }, [enabled, nodeId]);
}
