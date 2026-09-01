import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import {
  clampConversationGeometry,
  defaultConversationGeometry,
  defaultGraphConversationGeometry,
  moveConversationGeometry,
  resizeConversationGeometry,
} from "./conversationGeometry";
import type { ConversationGeometry } from "./conversationGeometry";
import type { WorldThemeId } from "./worldThemeRegistry";
import {
  MAX_SAVED_WORLD_WINDOWS,
  readWorldViewPrefs,
  withWorldViewThemeGeometry,
  worldViewGeometryForTheme,
  writeWorldViewPrefs,
} from "./worldViewPrefs";

export type WorldConversationBubblePanel = {
  id: string;
  targetKey: string;
  selectedKey: string | null;
  content: ReactNode;
};

type WorldConversationLayout = {
  rects: Readonly<Record<string, DOMRect>>;
};

const EMPTY_LAYOUT: WorldConversationLayout = { rects: {} };
const WorldConversationLayoutContext = createContext<WorldConversationLayout>(EMPTY_LAYOUT);

export function useWorldConversationLayout() {
  return useContext(WorldConversationLayoutContext);
}

export function WorldConversationLayer({
  activeThemeId,
  panels,
  compact,
  onFocus,
  onClose,
  children,
}: {
  activeThemeId: WorldThemeId;
  panels: readonly WorldConversationBubblePanel[];
  compact: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const [initialSavedView] = useState(readWorldViewPrefs);
  const savedViewRef = useRef(initialSavedView);
  const [rects, setRects] = useState<Record<string, DOMRect>>({});
  const rectSignatureRef = useRef("");
  const [geometry, setGeometry] = useState<Record<string, ConversationGeometry>>({});
  const [interaction, setInteraction] = useState<{
    id: string;
    mode: "moving" | "resizing";
  } | null>(null);
  const [order, setOrder] = useState<string[]>(() => savedViewRef.current.order);
  const geometryRef = useRef<Record<string, ConversationGeometry>>({});
  const geometryThemeRef = useRef(activeThemeId);
  const geometryFrameRef = useRef<number | null>(null);
  const interactionRef = useRef<{
    id: string;
    mode: "moving" | "resizing";
    pointerId: number;
    startX: number;
    startY: number;
    geometry: ConversationGeometry;
  } | null>(null);
  const panelIds = panels.map(({ id }) => id);
  const panelIdsKey = panelIds.join("|");

  const persistView = useCallback(() => {
    const latest = readWorldViewPrefs();
    const next = withWorldViewThemeGeometry({
      ...latest,
      order: order.filter(Boolean).slice(0, MAX_SAVED_WORLD_WINDOWS),
    }, activeThemeId, {
      ...worldViewGeometryForTheme(latest, activeThemeId),
      ...geometryRef.current,
    });
    savedViewRef.current = next;
    writeWorldViewPrefs(next);
  }, [activeThemeId, order]);

  const scheduleGeometryRender = () => {
    if (geometryFrameRef.current !== null) return;
    geometryFrameRef.current = window.requestAnimationFrame(() => {
      geometryFrameRef.current = null;
      setGeometry({ ...geometryRef.current });
    });
  };

  const updateGeometry = (id: string, requested: ConversationGeometry) => {
    const layer = layerRef.current;
    if (!layer || compact) return;
    const next = clampConversationGeometry(requested, layer.clientWidth, layer.clientHeight);
    const current = geometryRef.current[id];
    if (
      current && current.left === next.left && current.top === next.top &&
      current.width === next.width && current.height === next.height
    ) return;
    geometryRef.current = { ...geometryRef.current, [id]: next };
    scheduleGeometryRender();
  };

  const measuredGeometry = (id: string) => {
    const layer = layerRef.current;
    const panel = panelRefs.current[id];
    if (!layer || !panel) return null;
    const layerRect = layer.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return clampConversationGeometry({
      left: panelRect.left - layerRect.left,
      top: panelRect.top - layerRect.top,
      width: panelRect.width,
      height: panelRect.height,
    }, layer.clientWidth, layer.clientHeight);
  };

  const syncGeometry = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || compact || layer.clientWidth <= 0 || layer.clientHeight <= 0) return;
    const next: Record<string, ConversationGeometry> = {};
    for (const [index, panel] of panelsRef.current.entries()) {
      const current = geometryRef.current[panel.id];
      if (current) {
        next[panel.id] = clampConversationGeometry(current, layer.clientWidth, layer.clientHeight);
        continue;
      }
      const graphPlacement = activeThemeId === "graph";
      const base = graphPlacement
        ? defaultGraphConversationGeometry(layer.clientWidth, layer.clientHeight)
        : defaultConversationGeometry(layer.clientWidth, layer.clientHeight);
      next[panel.id] = clampConversationGeometry({
        ...base,
        left: base.left + index * 34 * (graphPlacement ? -1 : 1),
        top: base.top + index * 28 * (graphPlacement ? -1 : 1),
      }, layer.clientWidth, layer.clientHeight);
    }
    const changed = Object.keys(geometryRef.current).length !== Object.keys(next).length ||
      Object.entries(next).some(([id, value]) => {
        const current = geometryRef.current[id];
        return !current || current.left !== value.left || current.top !== value.top ||
          current.width !== value.width || current.height !== value.height;
      });
    if (changed) {
      geometryRef.current = next;
      setGeometry(next);
    }
  }, [activeThemeId, compact, panelIdsKey]);

  const measure = useCallback(() => {
    syncGeometry();
    const next: Record<string, DOMRect> = {};
    for (const panel of panelsRef.current) {
      const element = panelRefs.current[panel.id];
      if (element) next[panel.id] = element.getBoundingClientRect();
    }
    const signature = Object.entries(next).map(([id, rect]) =>
      `${id}:${rect.left}:${rect.top}:${rect.width}:${rect.height}`
    ).join("|");
    if (signature === rectSignatureRef.current) return;
    rectSignatureRef.current = signature;
    setRects(next);
  }, [syncGeometry]);

  useEffect(() => () => {
    if (geometryFrameRef.current !== null) window.cancelAnimationFrame(geometryFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    const ids = new Set(panelIds);
    const themeChanged = geometryThemeRef.current !== activeThemeId;
    const savedGeometry = worldViewGeometryForTheme(savedViewRef.current, activeThemeId);
    if (compact) {
      geometryRef.current = {};
      setGeometry({});
    } else {
      const next = Object.fromEntries(panelIds.flatMap((id) => {
        const value = (themeChanged ? undefined : geometryRef.current[id]) ?? savedGeometry[id];
        return value ? [[id, value] as const] : [];
      }));
      geometryRef.current = next;
      setGeometry(next);
    }
    geometryThemeRef.current = activeThemeId;
    setRects((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => ids.has(id)),
    ));
    setOrder((current) => {
      const preferred = current.length > 0 ? current : savedViewRef.current.order;
      return [
        ...preferred.filter((id) => ids.has(id)),
        ...panelIds.filter((id) => !preferred.includes(id)),
      ];
    });
    if (panelIds.length === 0) {
      interactionRef.current = null;
      setInteraction(null);
    }
    // The ID key intentionally isolates panel lifecycle from content-only refreshes.
  }, [activeThemeId, compact, panelIdsKey]);

  useLayoutEffect(measure, [geometry, measure]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    measure();
    if (panels.length === 0) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    for (const panel of panelsRef.current) {
      const element = panelRefs.current[panel.id];
      if (element) observer.observe(element);
    }
    const graphDiagnostics = activeThemeId === "graph" && window.__HERDR_GRAPH_RENDERER__;
    if (graphDiagnostics) graphDiagnostics.activeConversationObservers += 1;
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      if (graphDiagnostics) graphDiagnostics.activeConversationObservers -= 1;
    };
  }, [activeThemeId, measure, panelIdsKey]);

  useEffect(() => {
    if (!compact) persistView();
  }, [compact, geometry, order, persistView]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const eventTarget = event.target instanceof Element ? event.target : null;
      const activeElement = document.activeElement;
      if (
        eventTarget?.closest(".world-conversation-terminal") ||
        (activeElement instanceof Element && activeElement.closest(".world-conversation-terminal"))
      ) return;
      const focusedId = [...order].reverse().find((id) => panelIds.includes(id));
      if (!focusedId) return;
      event.preventDefault();
      event.stopPropagation();
      onClose(focusedId);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, order, panelIdsKey]);

  const focus = (id: string) => {
    setOrder((current) => [...current.filter((value) => value !== id), id]);
    onFocus(id);
  };

  const beginInteraction = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (compact || event.button !== 0) return;
    focus(id);
    const target = event.target instanceof Element ? event.target : null;
    const resizeHandle = target?.closest("[data-world-conversation-resize='true']");
    const header = target?.closest(".world-conversation-header");
    if (!resizeHandle && !header) return;
    if (header && target?.closest("button, a, input, textarea, select")) return;
    const panel = panelRefs.current[id];
    const current = geometryRef.current[id] ?? measuredGeometry(id);
    if (!panel || !current) return;
    event.preventDefault();
    event.stopPropagation();
    panel.setPointerCapture(event.pointerId);
    const mode = resizeHandle ? "resizing" : "moving";
    interactionRef.current = {
      id,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry: current,
    };
    setInteraction({ id, mode });
  };

  const moveInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    updateGeometry(
      current.id,
      current.mode === "moving"
        ? moveConversationGeometry(current.geometry, deltaX, deltaY, layer.clientWidth, layer.clientHeight)
        : resizeConversationGeometry(current.geometry, deltaX, deltaY, layer.clientWidth, layer.clientHeight),
    );
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    interactionRef.current = null;
    setInteraction(null);
  };

  const moveWithKeyboard = (id: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (compact || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target : null;
    const isHeader = Boolean(target?.closest(".world-conversation-header"));
    const isResize = Boolean(target?.closest("[data-world-conversation-resize='true']"));
    if (!isHeader && !isResize) return;
    if (!isResize && target?.closest("button, a, input, textarea, select")) return;
    const layer = layerRef.current;
    const current = geometryRef.current[id] ?? measuredGeometry(id);
    if (!layer || !current) return;
    if (order[order.length - 1] !== id) focus(id);
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    const deltaX = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const deltaY = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    updateGeometry(
      id,
      isResize
        ? resizeConversationGeometry(current, deltaX, deltaY, layer.clientWidth, layer.clientHeight)
        : moveConversationGeometry(current, deltaX, deltaY, layer.clientWidth, layer.clientHeight),
    );
  };

  return (
    <WorldConversationLayoutContext.Provider value={{ rects }}>
      <div ref={layerRef} className="world-theme-layer">
        {children}
        {panels.map((panel) => {
          const panelGeometry = geometry[panel.id];
          const orderIndex = order.indexOf(panel.id);
          const panelInteraction = interaction?.id === panel.id ? interaction.mode : undefined;
          return (
            <div
              key={panel.id}
              ref={(element) => {
                if (element) panelRefs.current[panel.id] = element;
                else delete panelRefs.current[panel.id];
              }}
              className={activeThemeId === "graph"
                ? "world-conversation-slot graph-conversation-slot"
                : "world-conversation-slot"}
              data-window-id={panel.id}
              data-positioned={panelGeometry ? "true" : "false"}
              data-active={orderIndex === order.length - 1 ? "true" : undefined}
              data-interaction={panelInteraction}
              aria-busy={panelInteraction !== undefined}
              style={panelGeometry && !compact ? {
                left: `${panelGeometry.left}px`,
                top: `${panelGeometry.top}px`,
                width: `${panelGeometry.width}px`,
                height: `${panelGeometry.height}px`,
                zIndex: 20 + Math.max(0, orderIndex),
              } : undefined}
              onPointerDown={(event) => {
                focus(panel.id);
                beginInteraction(panel.id, event);
              }}
              onPointerMove={moveInteraction}
              onPointerUp={endInteraction}
              onPointerCancel={endInteraction}
              onKeyDown={(event) => moveWithKeyboard(panel.id, event)}
            >
              {panel.content}
              {!compact ? (
                <button
                  type="button"
                  className="world-conversation-resize"
                  data-world-conversation-resize="true"
                  aria-label="Resize agent conversation"
                  title="Resize conversation"
                  onPointerDown={(event) => beginInteraction(panel.id, event)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </WorldConversationLayoutContext.Provider>
  );
}
