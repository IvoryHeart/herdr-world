import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  WindowBackButton,
  WindowControls,
  type ManagedWindowControls,
} from "./WindowControls";
import type { SnapTarget } from "./windowManager";

/**
 * A World window that is not an Inspector, such as Town's summary. It lives
 * in the same window frame and manager: movable, snappable, Back closes it,
 * and on a phone it is a full-screen detail screen with a top Back.
 */
export type WorldPanelEntry = {
  id: string;
  label: string;
  initialSnap?: SnapTarget;
  onClose(): void;
};

type WorldPanels = {
  panels: readonly WorldPanelEntry[];
  register(entry: WorldPanelEntry): () => void;
  bodies: Readonly<Record<string, HTMLElement | null>>;
  panelBodyRef(id: string): (element: HTMLDivElement | null) => void;
};

export const WorldPanelsContext = createContext<WorldPanels | null>(null);

const NO_PANELS: WorldPanels = {
  panels: [],
  register: () => () => {},
  bodies: {},
  panelBodyRef: () => () => {},
};

/** The open panel windows; none outside a World shell. */
export function useWorldPanels(): WorldPanels {
  return useContext(WorldPanelsContext) ?? NO_PANELS;
}

/**
 * The open panels, for the window manager, and the context <WorldPanel>
 * registers with. Each panel's body is recorded once through a stable ref.
 */
export function useWorldPanelRegistry() {
  const [panels, setPanels] = useState<readonly WorldPanelEntry[]>([]);
  const [bodies, setBodies] = useState<
    Readonly<Record<string, HTMLElement | null>>
  >({});
  const register = useCallback((entry: WorldPanelEntry) => {
    setPanels((current) => [
      ...current.filter((panel) => panel.id !== entry.id),
      entry,
    ]);
    return () =>
      setPanels((current) => current.filter((panel) => panel.id !== entry.id));
  }, []);
  const refs = useRef<Record<string, (element: HTMLDivElement | null) => void>>(
    {},
  );
  const panelBodyRef = useCallback(
    (id: string) =>
      (refs.current[id] ??= (element) =>
        setBodies((current) =>
          current[id] === element ? current : { ...current, [id]: element },
        )),
    [],
  );
  return useMemo(
    () => ({ panels, register, bodies, panelBodyRef }),
    [panels, register, bodies, panelBodyRef],
  );
}

/** Panel window ids share one prefix so they never collide with Inspectors. */
export function worldPanelWindowId(name: string) {
  return `panel:${name}`;
}

/**
 * Opens a panel window while mounted and renders its children inside it.
 * The children stay in the caller's React tree, so they keep its props and
 * context; unmounting closes the window.
 */
export function WorldPanel({
  name,
  label,
  initialSnap,
  onClose,
  children,
}: {
  name: string;
  label: string;
  initialSnap?: SnapTarget;
  onClose(): void;
  children: ReactNode;
}) {
  const panels = useContext(WorldPanelsContext);
  const close = useRef(onClose);
  close.current = onClose;
  const id = worldPanelWindowId(name);
  const register = panels?.register;
  useLayoutEffect(
    () =>
      register?.({
        id,
        label,
        initialSnap,
        onClose: () => close.current(),
      }),
    [register, id, label, initialSnap],
  );
  const body = panels?.bodies[id];
  return body ? createPortal(children, body) : null;
}

/** A panel window's one bar (Back, title, window actions) and its body. */
export function WorldPanelWindow({
  label,
  controls,
  onBody,
}: {
  label: string;
  controls: ManagedWindowControls;
  onBody(element: HTMLDivElement | null): void;
}) {
  return (
    <div className="world-panel-window">
      <header
        className="world-panel-bar is-window-drag-handle"
        title="Drag to move"
      >
        <WindowBackButton controls={controls} label={`${label} window`} />
        <strong className="world-panel-title">{label}</strong>
        <WindowControls controls={controls} label={`${label} window`} />
      </header>
      <div ref={onBody} className="world-panel-body" />
    </div>
  );
}
