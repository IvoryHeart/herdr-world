import { useEffect, useRef, useState } from "react";
import { worldSessionStorage } from "../../browserStorage";
import { CloseButton } from "../../components/CloseButton";
import type { IdeInstance, IdeStatus } from "./ideClient";

/** The servers whose workbench this browser tab loaded, across page reloads. */
const LOADED_KEY = "code.loaded";
const LOADED_LIMIT = 16;
/** The ones this page loaded. */
const loadedThisPage = new Set<string>();

type Reloaded = "page" | "page-again";

/**
 * Notes that this page loads a server's workbench, and says whether it is a
 * load again: "page" when an earlier page of this tab had it (the page
 * reloaded), "page-again" when this page had it and let it go (its server
 * ended or failed and started again), else null.
 */
function noteLoaded(id: string): Reloaded | null {
  const again = loadedThisPage.has(id);
  loadedThisPage.add(id);
  let earlier: string[] = [];
  try {
    const saved = JSON.parse(worldSessionStorage.getItem(LOADED_KEY) ?? "[]");
    if (Array.isArray(saved))
      earlier = saved.filter((entry) => typeof entry === "string");
    worldSessionStorage.setItem(
      LOADED_KEY,
      JSON.stringify(
        [...earlier.filter((entry) => entry !== id), id].slice(-LOADED_LIMIT),
      ),
    );
  } catch {
    // Storage off: a reloaded page can't tell, and says nothing.
  }
  if (again) return "page-again";
  return earlier.includes(id) ? "page" : null;
}

const live = (listed: readonly IdeInstance[], id: string) =>
  listed.some((entry) => entry.id === id && entry.state !== "failed");

/**
 * Workbenches loaded on this page stay loaded while another project is in
 * front, and while World reattaches to their server (its connection
 * changed, World restarted): the frame keeps its page and VS Code
 * reconnects on its own, so nothing reloads (#1262). Only a server that
 * failed or is gone (a Stop that ended it) lets its frame go; a failed Stop
 * keeps it. `reloaded` is a workbench that loaded again, and why, until
 * dismissed.
 */
export function useKeptWorkbenches(
  instance: IdeInstance | undefined,
  showing: boolean,
  status: IdeStatus | null | undefined,
) {
  const listed = status?.instances;
  const [visited, setVisited] = useState<string[]>([]);
  // Once per frame: StrictMode runs an effect twice.
  const noted = useRef(new Set<string>());
  const [reloaded, setReloaded] = useState<{
    id: string;
    why: Reloaded;
  } | null>(null);

  const id = showing ? instance?.id : undefined;
  useEffect(() => {
    if (!id || visited.includes(id)) return;
    if (!noted.current.has(id)) {
      noted.current.add(id);
      const why = noteLoaded(id);
      setReloaded(why ? { id, why } : null);
    }
    setVisited((current) =>
      current.includes(id) ? current : [...current, id],
    );
  }, [id, visited]);

  // A server that failed or is no longer listed lets its frame go: a new
  // start loads afresh, and the screen before said why.
  useEffect(() => {
    if (!listed) return;
    for (const kept of noted.current)
      if (!live(listed, kept)) noted.current.delete(kept);
    setVisited((current) => {
      const next = current.filter((kept) => live(listed, kept));
      return next.length === current.length ? current : next;
    });
  }, [listed]);

  return {
    visited,
    reloaded:
      showing && reloaded && reloaded.id === instance?.id ? reloaded.why : null,
    dismiss: () => setReloaded(null),
  };
}

/** Says why a workbench in front loaded again, until closed. */
export function ReloadedNote({
  why,
  ide,
  onClose,
}: {
  why: Reloaded;
  ide: string;
  onClose: () => void;
}) {
  return (
    <p className="code-view-reloaded" role="status">
      <span>
        {why === "page"
          ? `This page reloaded, so ${ide} loaded again. Its server kept running.`
          : `${ide} loaded again: its server started again, or World reopened the Code view.`}
      </span>
      <CloseButton onClick={onClose} />
    </p>
  );
}

/**
 * Every kept workbench, one frame each. Those behind are hidden in place at
 * full size, never unmounted, moved or display:none, so each keeps its page
 * and layout.
 */
export function WorkbenchFrames({
  frames,
  front,
  title,
  theme,
}: {
  frames: readonly IdeInstance[];
  front: string | null;
  title: (entry: IdeInstance) => string;
  theme: "light" | "dark";
}) {
  return frames.map((entry) => {
    const shown = entry.id === front;
    return (
      <iframe
        key={entry.id}
        className="code-view-frame"
        data-front={shown ? "true" : "false"}
        aria-hidden={shown ? undefined : true}
        tabIndex={shown ? undefined : -1}
        src={entry.url}
        title={title(entry)}
        style={{ colorScheme: theme }}
        allow="clipboard-read; clipboard-write"
      />
    );
  });
}
