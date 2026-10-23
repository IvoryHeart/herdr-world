import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import type {
  SnapTarget,
  WindowCommand,
  WindowManagerState,
} from "./windowManager";
import { useSystemBack } from "../../systemBack";

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

type PanelFocusRequest = { id: string; seq: number };

type WorldPanels = {
  panels: readonly WorldPanelEntry[];
  register(entry: WorldPanelEntry): () => void;
  bodies: Readonly<Record<string, HTMLElement | null>>;
  panelBodyRef(id: string): (element: HTMLDivElement | null) => void;
  focusRequest?: PanelFocusRequest | null;
  focus?(id: string): void;
  deliverFocus?(request: PanelFocusRequest, deliver: () => void): void;
};

export const WorldPanelsContext = createContext<WorldPanels | null>(null);

const NO_PANELS: WorldPanels = {
  panels: [],
  register: () => () => {},
  bodies: {},
  panelBodyRef: () => () => {},
  focusRequest: null,
  focus: () => {},
  deliverFocus: () => {},
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
  const registered = useRef(new Map<string, WorldPanelEntry>());
  const sequence = useRef(0);
  const pending = useRef<PanelFocusRequest | null>(null);
  const [focusRequest, setFocusRequest] = useState<PanelFocusRequest | null>(
    null,
  );
  const publishFocus = useCallback((request: PanelFocusRequest | null) => {
    pending.current = request;
    setFocusRequest(request);
  }, []);
  const [bodies, setBodies] = useState<
    Readonly<Record<string, HTMLElement | null>>
  >({});
  const register = useCallback(
    (entry: WorldPanelEntry) => {
      if (registered.current.has(entry.id) && pending.current?.id === entry.id)
        publishFocus(null);
      registered.current.set(entry.id, entry);
      setPanels([...registered.current.values()]);
      return () => {
        if (registered.current.get(entry.id) !== entry) return;
        registered.current.delete(entry.id);
        setPanels([...registered.current.values()]);
        if (pending.current?.id === entry.id) publishFocus(null);
      };
    },
    [publishFocus],
  );
  const focus = useCallback(
    (id: string) => {
      publishFocus({ id, seq: ++sequence.current });
    },
    [publishFocus],
  );
  const deliverFocus = useCallback(
    (request: PanelFocusRequest, deliver: () => void) => {
      if (
        pending.current?.seq !== request.seq ||
        !registered.current.has(request.id)
      )
        return;
      deliver();
      if (pending.current?.seq === request.seq) publishFocus(null);
    },
    [publishFocus],
  );
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
    () => ({
      panels,
      register,
      bodies,
      panelBodyRef,
      focusRequest,
      focus,
      deliverFocus,
    }),
    [panels, register, bodies, panelBodyRef, focusRequest, focus, deliverFocus],
  );
}

/** Deliver the newest launch intent once its registered window exists. */
export function useWorldPanelFocus(
  registry: WorldPanels,
  state: WindowManagerState,
  dispatch: (command: WindowCommand) => void,
) {
  const { focusRequest: request, deliverFocus } = registry;
  const ready = Boolean(
    request &&
      state.windows[request.id] &&
      registry.panels.some((panel) => panel.id === request.id),
  );
  useEffect(() => {
    if (request && ready)
      deliverFocus?.(request, () =>
        dispatch({ type: "focus", id: request.id }),
      );
  }, [request, ready, deliverFocus, dispatch]);
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
  focusKey,
  onClose,
  children,
}: {
  name: string;
  label: string;
  initialSnap?: SnapTarget;
  /** A launcher increments this to restore and raise an already-open panel. */
  focusKey?: number;
  onClose(): void;
  children: ReactNode;
}) {
  const panels = useContext(WorldPanelsContext);
  const close = useRef(onClose);
  close.current = onClose;
  const id = worldPanelWindowId(name);
  const register = panels?.register;
  const focus = panels?.focus;
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
  useLayoutEffect(() => {
    if (focusKey !== undefined) focus?.(id);
  }, [focus, id, focusKey]);
  // On a phone a panel is a detail screen: the system Back closes it first,
  // before any Inspector beneath it.
  useSystemBack(Boolean(register), () => close.current(), "panel");
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
