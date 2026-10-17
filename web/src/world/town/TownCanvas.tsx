import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EllipsisVertical } from "lucide-react";
import { useMobileControls } from "../../components/MobileControls";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
} from "../herdrOfficeProjection";
import type {
  OfficeCanvasAnchor,
  OfficeCanvasAnchors,
  OfficeCanvasHover,
  OfficeConversationAnchors,
  OfficeConversationAnchorTarget,
} from "../PixelOfficeCanvas";
import {
  formatOfficeCost,
  formatOfficeModelNames,
  formatOfficeUsage,
  type OfficeObservability,
} from "../officeObservability";
import type { TownLevel } from "./townCamera";
import { townHitKey, townHitTest, type TownHit } from "./townHitTest";
import {
  layoutTown,
  TOWN_FACADE,
  TOWN_TILE as T,
  townSeat,
  type TownFormFactor,
  type TownLayout,
  type TownPlacementMemory,
} from "./townLayout";
import {
  townAttention,
  townModelFromProjection,
  townRoomCounts,
  type TownModel,
} from "./townModel";
import { townCarpetFor } from "./townPaint";
import { createTownRenderer, type TownRendererHandle } from "./townRenderer";
import { townPortrait } from "./townSprites";
import { townTargets, type TownTarget } from "./townTargets";
import { yieldWorldTask } from "../worldObject";
import "./town.css";

export type TownRoomActions = {
  showCreateSeat(roomKey: string): boolean;
  canCreateSeat(roomKey: string): boolean;
  createSeatReason(roomKey: string): string | null;
  onCreateSeat(roomKey: string): void;
  showCreateRoom(roomKey: string | null): boolean;
  canCreateRoom(roomKey: string | null): boolean;
  createRoomReason(roomKey: string | null): string | null;
  onCreateRoom(roomKey: string | null): void;
  canRenameRoom(roomKey: string): boolean;
  onRenameRoom(roomKey: string): void;
  canCloseRoom(roomKey: string): boolean;
  onCloseRoom(roomKey: string): void;
};

/** Camera kept across Office visits within one page session. */
const savedCameras = new Map<
  TownFormFactor,
  { x: number; y: number; z: number }
>();

const portrait = townPortrait;

function ago(since: number, now: number) {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

export function TownCanvas({
  projection,
  selectedKey,
  completionSeenKeys,
  conversationTargets,
  onSelect,
  onActivateAgent,
  onActivateRoom,
  onHover,
  onAnchorChange,
  onSelectedAnchorChange,
  roomActions,
  selectedRoomKey,
  observability,
  calm = false,
  chrome = NO_CHROME,
}: {
  observability: OfficeObservability;
  calm?: boolean;
  /** Screen pixels covered by panels on wide screens (rail, chat dock). */
  chrome?: { left: number; right: number };
  projection: HerdrOfficeProjection;
  selectedKey: string | null;
  completionSeenKeys: ReadonlySet<string>;
  conversationTargets: readonly OfficeConversationAnchorTarget[];
  onSelect: (key: string) => void;
  onActivateAgent: (key: string) => void;
  onActivateRoom: (key: string) => void;
  onHover?: (hover: OfficeCanvasHover | null) => void;
  onAnchorChange?: (anchors: OfficeConversationAnchors | null) => void;
  onSelectedAnchorChange?: (anchor: OfficeCanvasAnchor | null) => void;
  roomActions: TownRoomActions;
  selectedRoomKey: string | null;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<TownRendererHandle | null>(null);
  const [failure, setFailure] = useState(false);
  const [ready, setReady] = useState(false);
  const [formFactor, setFormFactor] = useState<TownFormFactor>(() =>
    typeof window !== "undefined" && window.innerWidth < 640
      ? "narrow"
      : "wide",
  );
  const memoryRef = useRef<{
    formFactor: TownFormFactor;
    memory: TownPlacementMemory;
  }>({
    formFactor,
    memory: new Map(),
  });
  const model = useMemo(
    () => townModelFromProjection(projection),
    [projection],
  );
  const layout = useMemo(() => {
    const previous =
      memoryRef.current.formFactor === formFactor
        ? memoryRef.current.memory
        : new Map();
    const result = layoutTown(model.input, formFactor, previous);
    memoryRef.current = { formFactor, memory: result.memory };
    return result.layout;
    // Placement depends only on topology, not on agent status.
  }, [model.input, formFactor]);
  const blockedSince = useRef(new Map<string, number>());
  const [hover, setHover] = useState<string | null>(null);
  const latest = useRef({
    chrome,
    model,
    layout,
    selectedKey,
    hover,
    calm,
    completionSeenKeys,
    conversationTargets,
    onSelect,
    onActivateAgent,
    onActivateRoom,
    onHover,
    onAnchorChange,
    onSelectedAnchorChange,
  });
  latest.current = {
    chrome,
    calm,
    model,
    layout,
    selectedKey,
    hover,
    completionSeenKeys,
    conversationTargets,
    onSelect,
    onActivateAgent,
    onActivateRoom,
    onHover,
    onAnchorChange,
    onSelectedAnchorChange,
  };

  // Track when agents became blocked so reception and the rail share age order.
  const now = Date.now();
  for (const agent of model.agents.values()) {
    if (agent.semanticStatus === "blocked") {
      if (!blockedSince.current.has(agent.key))
        blockedSince.current.set(agent.key, now);
    } else blockedSince.current.delete(agent.key);
  }

  const anchorFrame = useRef<number | null>(null);
  const reportAnchors = () => {
    const { onAnchorChange: report, onSelectedAnchorChange: reportSelected } =
      latest.current;
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if ((!report && !reportSelected) || !renderer || !host) return;
    const rect = host.getBoundingClientRect();
    const camera = renderer.camera;
    const toAnchor = (
      world: { x: number; y: number } | null,
    ): OfficeCanvasAnchor | null => {
      if (!world) return null;
      const screen = camera.toScreen(world.x, world.y);
      const x = rect.left + screen.x;
      const y = rect.top + screen.y;
      const visible =
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      const edge: OfficeCanvasAnchor["edge"] = visible
        ? null
        : x < rect.left
          ? "left"
          : x > rect.right
            ? "right"
            : y < rect.top
              ? "top"
              : "bottom";
      return {
        x: Math.min(rect.right - 10, Math.max(rect.left + 10, x)),
        y: Math.min(rect.bottom - 10, Math.max(rect.top + 10, y)),
        visible,
        edge,
      };
    };
    const worldAnchor = (key: string | null): OfficeCanvasAnchors => {
      if (!key) return { agent: null, workbench: null };
      const { model: m, layout: l } = latest.current;
      const position = renderer.actorPosition(key);
      let agent: { x: number; y: number } | null = null;
      if (position) {
        if (position.seated) {
          const seat = m.agentSeats.get(key);
          const cell = seat && findCell(l, seat.deskKey);
          if (seat && cell) {
            const geometry = townSeat(cell, seat.seat);
            agent = {
              x: geometry.cx,
              y: geometry.top ? geometry.tableY + 6 : geometry.tableY + 40,
            };
          }
        } else agent = { x: position.x, y: position.y - 12 };
      }
      const deskKey = m.desks.has(key)
        ? key
        : (m.agentSeats.get(key)?.deskKey ?? m.devices.get(key)?.deskKey);
      const cell = deskKey ? findCell(l, deskKey) : null;
      const workbench = cell
        ? { x: (cell.x + 3) * T, y: cell.y * T + 28 }
        : null;
      return { agent: toAnchor(agent), workbench: toAnchor(workbench) };
    };
    if (report) {
      const anchors: OfficeConversationAnchors = {};
      for (const target of latest.current.conversationTargets)
        anchors[target.id] = worldAnchor(target.targetKey);
      report(anchors);
    }
    if (reportSelected) {
      const selected = worldAnchor(latest.current.selectedKey);
      reportSelected(selected.agent ?? selected.workbench);
    }
  };
  const reportRef = useRef(reportAnchors);
  reportRef.current = reportAnchors;
  const scheduleAnchors = () => {
    if (anchorFrame.current !== null) return;
    anchorFrame.current = requestAnimationFrame(() => {
      anchorFrame.current = null;
      reportRef.current();
    });
  };

  const levelRef = useRef<TownLevel>("overview");
  const signs = useRef(new Map<string, HTMLElement>());
  const signsFor = useRef<TownLayout | null>(null);
  const lastCamera = useRef("");
  const hoverEntry = useCallback(
    (key: string | null, rect?: DOMRect) =>
      latest.current.onHover?.(
        key && rect
          ? {
              key,
              clientX: rect.right,
              clientY: rect.top + rect.height / 2,
            }
          : null,
      ),
    [],
  );
  // Only on-screen buildings keep DOM cards, plaques and receptions.
  const [visible, setVisible] = useState<TownVisible>(NOTHING_VISIBLE);
  const visibleKey = useRef(NOTHING_VISIBLE.key);
  const onFrame = (camera: TownRendererHandle["camera"], level: TownLevel) => {
    const layer = worldRef.current;
    const nextVisible = townVisibleHosts(camera, latest.current.layout, level);
    if (nextVisible.key !== visibleKey.current) {
      visibleKey.current = nextVisible.key;
      setVisible(nextVisible);
    }
    if (layer) {
      const tx = camera.viewport.width / 2 - camera.x * camera.z;
      const ty = camera.viewport.height / 2 - camera.y * camera.z;
      layer.style.transform = `translate(${tx}px, ${ty}px) scale(${camera.z})`;
      layer.style.setProperty("--z", String(camera.z));
      layer.style.setProperty("--iz", String(1 / camera.z));
      if (levelRef.current !== level) {
        levelRef.current = level;
        layer.dataset.level = level;
      }
      const renderer = rendererRef.current;
      if (renderer) {
        if (signsFor.current !== latest.current.layout) {
          signsFor.current = latest.current.layout;
          signs.current = new Map(
            [
              ...layer.querySelectorAll<HTMLElement>("[data-building-sign]"),
            ].map((sign) => [sign.dataset.buildingSign!, sign]),
          );
        }
        for (const [hostKey, sign] of signs.current) {
          const opacity = String(
            Math.round(renderer.roofAlpha(hostKey) * 100) / 100,
          );
          if (sign.style.opacity !== opacity) sign.style.opacity = opacity;
        }
      }
    }
    const signature = `${camera.x.toFixed(1)},${camera.y.toFixed(1)},${camera.z.toFixed(4)}`;
    if (signature !== lastCamera.current) {
      lastCamera.current = signature;
      savedCameras.set(latest.current.layout.formFactor, {
        x: camera.x,
        y: camera.y,
        z: camera.z,
      });
      scheduleAnchors();
    }
  };
  const onFrameRef = useRef(onFrame);

  onFrameRef.current = onFrame;

  const viewport = () => {
    const host = hostRef.current!;
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    const narrow = width < 640;
    // Phones frame the first building below any floating notices.
    let covered = 0;
    if (narrow) {
      const top = host.getBoundingClientRect().top;
      for (const overlay of host
        .closest(".world-office-shell")
        ?.querySelectorAll<HTMLElement>(".world-completion-notices") ?? [])
        covered = Math.max(
          covered,
          overlay.getBoundingClientRect().bottom - top,
        );
    }
    return {
      width,
      height,
      inset: {
        top: narrow ? Math.max(12, Math.min(height / 3, covered + 8)) : 16,
        right: narrow ? 12 : Math.max(72, latest.current.chrome.right),
        bottom: narrow ? 12 : 16,
        left: narrow ? 12 : Math.max(16, latest.current.chrome.left),
      },
    };
  };

  const frameHome = (
    renderer: TownRendererHandle,
    l: TownLayout,
    animate: boolean,
  ) => {
    const limits = renderer.camera.limits;
    if (!limits) return;
    const record = () => {
      const target = renderer.camera.flying ? null : renderer.camera;
      homePose.current = target
        ? { x: target.x, y: target.y, z: target.z }
        : null;
    };
    if (l.formFactor === "narrow") {
      const first = l.buildings[0];
      const x = (l.width * T) / 2;
      const focus = renderer.camera.focusPoint();
      const y = first
        ? first.y * T - 24 + (focus.y - viewport().inset.top) / limits.home
        : (l.height * T) / 2;
      if (animate) renderer.camera.flyTo(x, y, limits.home);
      else renderer.camera.jumpTo(x, y, limits.home);
    } else if (animate)
      renderer.camera.flyTo((l.width * T) / 2, (l.height * T) / 2, limits.home);
    else
      renderer.camera.jumpTo(
        (l.width * T) / 2,
        (l.height * T) / 2,
        limits.home,
      );
    if (!animate) record();
    else homePose.current = null;
    renderer.invalidate();
  };
  const homePose = useRef<{ x: number; y: number; z: number } | null>(null);
  const atHome = (renderer: TownRendererHandle) => {
    const home = homePose.current;
    const camera = renderer.camera;
    return (
      home !== null &&
      Math.abs(camera.z - home.z) < home.z * 0.01 &&
      Math.hypot(camera.x - home.x, camera.y - home.y) * camera.z < 4
    );
  };

  // Panels opening or closing re-frame the town only if it is still at home.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !hostRef.current) return;
    const wasHome = atHome(renderer);
    renderer.setViewport(viewport());
    if (wasHome) frameHome(renderer, latest.current.layout, false);
    // viewport() reads the latest chrome.
  }, [chrome.left, chrome.right]);

  const sceneState = () => ({
    selectedKey: latest.current.selectedKey,
    hoverKey: latest.current.hover,
    completionSeenKeys: latest.current.completionSeenKeys,
    openHostKey: null,
    calm: latest.current.calm,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const abort = new AbortController();
    void createTownRenderer(
      host,
      (camera, level) => onFrameRef.current(camera, level),
      abort.signal,
    )
      .then((renderer) => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.setViewport(viewport());
        const { model: m, layout: l } = latest.current;
        renderer.setScene(m, l, sceneState());
        renderer.camera.configure(l, viewport());
        const saved = savedCameras.get(l.formFactor);
        if (saved) {
          renderer.camera.x = saved.x;
          renderer.camera.y = saved.y;
          renderer.camera.setZoom(
            saved.z,
            renderer.camera.viewport.width / 2,
            renderer.camera.viewport.height / 2,
          );
        } else frameHome(renderer, l, false);
        renderer.invalidate();
        setReady(true);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        if (window.__HERDR_TOWN_RENDERER__)
          window.__HERDR_TOWN_RENDERER__.lastError =
            error instanceof Error
              ? error.message.slice(0, 160)
              : "renderer failed";
        setFailure(true);
      });
    const observer = new ResizeObserver(() => {
      const renderer = rendererRef.current;
      if (!renderer || !hostRef.current) return;
      const next = viewport();
      setFormFactor(next.width < 640 ? "narrow" : "wide");
      renderer.setViewport(next);
    });
    observer.observe(host);
    return () => {
      disposed = true;
      abort.abort();
      observer.disconnect();
      if (anchorFrame.current !== null)
        cancelAnimationFrame(anchorFrame.current);
      latest.current.onAnchorChange?.(null);
      latest.current.onSelectedAnchorChange?.(null);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const formFactorChanged =
      renderer.camera.limits !== null &&
      layout.formFactor !== lastFormFactor.current;
    renderer.setScene(model, layout, sceneState());
    renderer.camera.configure(layout, viewport());
    if (formFactorChanged) {
      const saved = savedCameras.get(layout.formFactor);
      if (saved) renderer.camera.jumpTo(saved.x, saved.y, saved.z);
      else frameHome(renderer, layout, false);
    }
    lastFormFactor.current = layout.formFactor;
    scheduleAnchors();
  }, [model, layout]);
  const lastFormFactor = useRef<TownFormFactor>(layout.formFactor);

  useEffect(() => {
    rendererRef.current?.setState(sceneState());
    scheduleAnchors();
  }, [selectedKey, hover, completionSeenKeys, calm]);

  useEffect(() => {
    scheduleAnchors();
  }, [conversationTargets]);

  /* ---------- pointer input ---------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: null | {
      id: number;
      sx: number;
      sy: number;
      lx: number;
      ly: number;
      lt: number;
      vx: number;
      vy: number;
      moved: boolean;
      hit: TownHit | null;
    } = null;
    let pinch: null | {
      distance: number;
      z: number;
      world: { x: number; y: number };
    } = null;
    let lastTap: null | {
      t: number;
      x: number;
      y: number;
      key: string | null;
    } = null;
    const local = (event: { clientX: number; clientY: number }) => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const hitAt = (x: number, y: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return null;
      const { layout: l, model: m } = latest.current;
      const world = renderer.camera.toWorld(x, y);
      return townHitTest(
        {
          layout: l,
          model: m,
          level: renderer.level,
          zoom: renderer.camera.z,
          roofAlpha: (hostKey) => renderer.roofAlpha(hostKey),
          standing: function* () {
            for (const agent of m.agents.values()) {
              const position = renderer.actorPosition(agent.key);
              if (position && !position.seated)
                yield { key: agent.key, hostKey: agent.hostKey, ...position };
            }
          },
        },
        world.x,
        world.y,
      );
    };
    const down = (event: PointerEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      host.setPointerCapture(event.pointerId);
      const point = local(event);
      pointers.set(event.pointerId, point);
      renderer.camera.stop();
      if (pointers.size === 2) {
        gesture = null;
        const [a, b] = [...pointers.values()];
        pinch = {
          distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          z: renderer.camera.z,
          world: renderer.camera.toWorld((a!.x + b!.x) / 2, (a!.y + b!.y) / 2),
        };
        return;
      }
      gesture = {
        id: event.pointerId,
        sx: point.x,
        sy: point.y,
        lx: point.x,
        ly: point.y,
        lt: performance.now(),
        vx: 0,
        vy: 0,
        moved: false,
        hit: hitAt(point.x, point.y),
      };
    };
    const move = (event: PointerEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const point = local(event);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const mx = (a!.x + b!.x) / 2;
        const my = (a!.y + b!.y) / 2;
        const camera = renderer.camera;
        const z = camera.clampZoom((pinch.z * distance) / pinch.distance);
        camera.setZoom(z, mx, my);
        camera.x = pinch.world.x - (mx - camera.viewport.width / 2) / z;
        camera.y = pinch.world.y - (my - camera.viewport.height / 2) / z;
        renderer.invalidate();
        return;
      }
      if (!gesture) {
        if (event.pointerType !== "mouse") return;
        const hit = hitAt(point.x, point.y);
        const key =
          hit?.kind === "building" ? `building:${hit.key}` : townHitKey(hit);
        if (key !== latest.current.hover) setHover(key);
        host.style.cursor = hit && hit.kind !== "building" ? "pointer" : "";
        const hoverKey = townHitKey(hit);
        latest.current.onHover?.(
          hoverKey
            ? { key: hoverKey, clientX: event.clientX, clientY: event.clientY }
            : null,
        );
        return;
      }
      if (event.pointerId !== gesture.id) return;
      const dx = point.x - gesture.lx;
      const dy = point.y - gesture.ly;
      if (
        !gesture.moved &&
        Math.hypot(point.x - gesture.sx, point.y - gesture.sy) > 6
      ) {
        gesture.moved = true;
        latest.current.onHover?.(null);
      }
      if (gesture.moved) {
        renderer.camera.panBy(dx, dy);
        const now = performance.now();
        const elapsed = Math.max(1, now - gesture.lt);
        gesture.vx = gesture.vx * 0.65 + (dx / elapsed) * 1000 * 0.35;
        gesture.vy = gesture.vy * 0.65 + (dy / elapsed) * 1000 * 0.35;
        gesture.lt = now;
        renderer.invalidate();
      }
      gesture.lx = point.x;
      gesture.ly = point.y;
    };
    const up = (event: PointerEvent) => {
      const renderer = rendererRef.current;
      pointers.delete(event.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        gesture = null;
        return;
      }
      if (!renderer || !gesture || event.pointerId !== gesture.id) return;
      const finished = gesture;
      gesture = null;
      if (finished.moved) {
        if (performance.now() - finished.lt < 80)
          renderer.camera.release(finished.vx, finished.vy);
        renderer.invalidate();
        return;
      }
      if (event.type === "pointercancel") return;
      const point = local(event);
      const hit = finished.hit;
      const key = townHitKey(hit);
      const now = performance.now();
      const double =
        lastTap &&
        now - lastTap.t < 320 &&
        Math.hypot(lastTap.x - point.x, lastTap.y - point.y) < 30;
      if (double) {
        lastTap = null;
        if (
          hit &&
          (hit.kind === "agent" ||
            hit.kind === "desk" ||
            hit.kind === "pane") &&
          key
        ) {
          latest.current.onActivateAgent(key);
        } else {
          renderer.camera.zoomAt(2, point.x, point.y);
          renderer.invalidate();
        }
        return;
      }
      lastTap = { t: now, x: point.x, y: point.y, key };
      if (!hit) return;
      if (hit.kind === "building") {
        const building = latest.current.layout.buildings.find(
          (b) => b.hostKey === hit.key,
        );
        if (building && renderer.roofAlpha(building.hostKey) > 0.5) {
          zoomToBuilding(renderer, latest.current.layout, building.hostKey);
        }
        return;
      }
      if (hit.kind === "room" || hit.kind === "cell") {
        const roomKey = hit.kind === "room" ? hit.key : hit.roomKey;
        latest.current.onActivateRoom(roomKey);
        if (renderer.level !== "desk")
          zoomToRoom(renderer, latest.current.layout, roomKey);
        return;
      }
      if (key) latest.current.onSelect(key);
    };
    const leave = () => {
      if (!gesture) {
        setHover(null);
        latest.current.onHover?.(null);
      }
    };
    const wheel = (event: WheelEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      event.preventDefault();
      const point = local(event);
      renderer.camera.zoomAt(
        Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018)),
        point.x,
        point.y,
      );
      renderer.invalidate();
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("wheel", wheel);
    };
  }, []);

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current;
    if (!renderer || event.target !== event.currentTarget) return;
    const step = 60;
    const camera = renderer.camera;
    if (event.key === "ArrowLeft") camera.panBy(step, 0);
    else if (event.key === "ArrowRight") camera.panBy(-step, 0);
    else if (event.key === "ArrowUp") camera.panBy(0, step);
    else if (event.key === "ArrowDown") camera.panBy(0, -step);
    else if (event.key === "+" || event.key === "=")
      camera.zoomAt(1.3, camera.viewport.width / 2, camera.viewport.height / 2);
    else if (event.key === "-")
      camera.zoomAt(
        1 / 1.3,
        camera.viewport.width / 2,
        camera.viewport.height / 2,
      );
    else return;
    event.preventDefault();
    renderer.invalidate();
  };

  const zoomBy = (factor: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.camera.zoomAt(
      factor,
      renderer.camera.viewport.width / 2,
      renderer.camera.viewport.height / 2,
    );
    renderer.invalidate();
  };

  /**
   * The zoom buttons step between whole town, one building, one room and one
   * desk, choosing whatever is nearest the centre of the screen. The current
   * step is read from the zoom, so pinching and wheel zoom mix freely.
   */
  const shellControls = useMobileControls();
  const ownsShellControls = shellControls !== null;
  useEffect(() => {
    if (!ownsShellControls) return;
    document.documentElement.dataset.townControls = "";
    return () => {
      delete document.documentElement.dataset.townControls;
    };
  }, [ownsShellControls]);
  const stepZoom = (direction: 1 | -1) => {
    const renderer = rendererRef.current;
    const camera = renderer?.camera;
    if (!renderer || !camera?.limits) return;
    const limits = camera.limits;
    const l = latest.current.layout;
    const focus = camera.focusPoint();
    const at = camera.toWorld(focus.x, focus.y);
    const distance = (x: number, y: number, w: number, h: number) =>
      Math.hypot(
        Math.max(x * T - at.x, 0, at.x - (x + w) * T),
        Math.max(y * T - at.y, 0, at.y - (y + h) * T),
      );
    const building = [...l.buildings].sort(
      (a, b) =>
        distance(a.x, a.y, a.w, a.h + TOWN_FACADE) -
        distance(b.x, b.y, b.w, b.h + TOWN_FACADE),
    )[0];
    if (!building) return;
    const room = [...building.rooms].sort(
      (a, b) => distance(a.x, a.y, a.w, a.h) - distance(b.x, b.y, b.w, b.h),
    )[0];
    const cell = room
      ? [...room.cells]
          .filter((candidate) => candidate.deskKey)
          .sort(
            (a, b) => distance(a.x, a.y, 6, 4) - distance(b.x, b.y, 6, 4),
          )[0]
      : undefined;
    const zooms = [
      limits.home,
      buildingZoom(camera, building),
      room ? roomZoom(camera, room) : 0,
      Math.max(limits.desk * 1.2, limits.desk + 0.2),
    ];
    for (let i = 1; i < zooms.length; i += 1)
      zooms[i] = Math.min(limits.max, Math.max(zooms[i]!, zooms[i - 1]! * 1.2));
    let step = 0;
    zooms.forEach((z, index) => {
      if (camera.z >= z * 0.93) step = index;
    });
    const next = step + direction;
    if (next < 0) {
      frameHome(renderer, l, true);
      return;
    }
    if (next >= zooms.length) {
      zoomBy(1.4);
      return;
    }
    if (next === 0) frameHome(renderer, l, true);
    else if (next === 1)
      camera.flyTo(
        (building.x + building.w / 2) * T,
        (building.y + (building.h + TOWN_FACADE) / 2) * T,
        zooms[1]!,
        0.7,
      );
    else if (next === 2 && room)
      camera.flyTo(
        (room.x + room.w / 2) * T,
        (room.y + room.h / 2) * T,
        zooms[2]!,
        0.6,
      );
    else if (cell)
      camera.flyTo((cell.x + 3) * T, (cell.y + 2) * T, zooms[3]!, 0.6);
    else zoomBy(1.4);
    renderer.invalidate();
  };

  const focusTarget = (target: TownTarget) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const camera = renderer.camera;
    const centre = camera.toScreen(
      target.rect.x + target.rect.width / 2,
      target.rect.y + target.rect.height / 2,
    );
    const { width, height } = camera.viewport;
    if (
      centre.x < 40 ||
      centre.y < 40 ||
      centre.x > width - 40 ||
      centre.y > height - 40 ||
      renderer.level === "town"
    ) {
      const z = Math.max(camera.z, camera.limits?.card ?? camera.z);
      camera.flyTo(
        target.rect.x + target.rect.width / 2,
        target.rect.y + target.rect.height / 2,
        z,
        0.4,
      );
      renderer.invalidate();
    }
  };

  const zoomToRoomKey = (roomKey: string) => {
    const renderer = rendererRef.current;
    if (renderer) zoomToRoom(renderer, latest.current.layout, roomKey);
  };

  return (
    <div className="town-shell" ref={shellRef}>
      {failure ? (
        <div className="world-renderer-fallback" role="status">
          <strong>Visual scene unavailable</strong>
          <span>The complete roster and inspector remain available.</span>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="town-canvas-host"
        data-renderer={failure ? "unavailable" : "pixi"}
        hidden={failure}
        tabIndex={0}
        role="application"
        aria-label="Office town. Arrow keys pan, plus and minus zoom."
        onKeyDown={keyboard}
      />
      <div
        className="town-world"
        ref={worldRef}
        data-level="overview"
        aria-hidden={!ready}
      >
        <TownWorldLayer
          model={model}
          layout={layout}
          visible={visible}
          onHoverEntry={hoverEntry}
          selectedKey={selectedKey}
          blockedSince={blockedSince.current}
          roomActions={roomActions}
          selectedRoomKey={selectedRoomKey}
          onSelect={onSelect}
          onActivate={onActivateAgent}
          onActivateRoom={(key) => {
            onActivateRoom(key);
            zoomToRoomKey(key);
          }}
          onFocusTarget={focusTarget}
        />
      </div>
      <TownBoard model={model} observability={observability} />
      <div className="town-zoom" role="group" aria-label="Camera">
        <button type="button" aria-label="Zoom in" onClick={() => stepZoom(1)}>
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => stepZoom(-1)}
        >
          −
        </button>
        <button
          type="button"
          className="town-zoom-all"
          aria-label="Show the whole town"
          onClick={() => {
            const renderer = rendererRef.current;
            if (!renderer?.camera.limits) return;
            const l = latest.current.layout;
            renderer.camera.flyTo(
              (l.width * T) / 2,
              (l.height * T) / 2,
              renderer.camera.limits.all,
            );
            renderer.invalidate();
          }}
        >
          ALL
        </button>
        {shellControls ? (
          // The shell's More menu joins the camera group on the phone, so
          // Town has one set of floating controls.
          <button
            type="button"
            className="town-zoom-more"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={shellControls.moreOpen}
            onClick={shellControls.toggleMore}
          >
            <EllipsisVertical size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function findCell(layout: TownLayout, deskKey: string) {
  const at = layout.deskCells.get(deskKey);
  if (!at) return null;
  for (const building of layout.buildings)
    for (const room of building.rooms)
      if (room.key === at.roomKey) return room.cells[at.cellIndex] ?? null;
  return null;
}

function zoomToRoom(
  renderer: TownRendererHandle,
  layout: TownLayout,
  roomKey: string,
) {
  const room = layout.buildings
    .flatMap((b) => b.rooms)
    .find((r) => r.key === roomKey);
  if (!room) return;
  const camera = renderer.camera;
  const z = roomZoom(camera, room);
  camera.flyTo((room.x + room.w / 2) * T, (room.y + room.h / 2) * T, z, 0.6);
  renderer.invalidate();
}

function zoomToBuilding(
  renderer: TownRendererHandle,
  layout: TownLayout,
  hostKey: string,
) {
  const building = layout.buildings.find((b) => b.hostKey === hostKey);
  if (!building) return;
  const camera = renderer.camera;
  const z = buildingZoom(camera, building);
  camera.flyTo(
    (building.x + building.w / 2) * T,
    (building.y + (building.h + TOWN_FACADE) / 2) * T,
    z,
    0.8,
  );
  renderer.invalidate();
}

type TownCameraHandle = TownRendererHandle["camera"];

function roomZoom(
  camera: TownCameraHandle,
  room: TownLayout["buildings"][number]["rooms"][number],
) {
  const { width, height, inset } = camera.viewport;
  const fit = Math.min(
    (width - inset.left - inset.right - 60) / (room.w * T + 40),
    (height - inset.top - inset.bottom - 20) / (room.h * T + 40),
  );
  const limits = camera.limits;
  return Math.max(Math.min(fit, 3), limits ? limits.card * 1.05 : 0.7);
}

function buildingZoom(
  camera: TownCameraHandle,
  building: TownLayout["buildings"][number],
) {
  const { width, height, inset } = camera.viewport;
  const usableWidth = width - inset.left - inset.right - 40;
  const widthFit = usableWidth / (building.w * T + 40);
  const fit = Math.min(
    widthFit,
    (height - inset.top - inset.bottom - 10) /
      ((building.h + TOWN_FACADE) * T + 30),
  );
  // Phones already open at a building's width; a building step fills the width.
  const z = width < 640 ? widthFit : fit;
  return Math.max(z, (camera.limits?.roof ?? 0) * 1.06);
}

const NO_CHROME = { left: 0, right: 0 };

/* ---------- DOM world layer ---------- */

type TownVisible = {
  key: string;
  hosts: ReadonlySet<string>;
  /** Room cards are drawn only from the overview level up to the room level. */
  cards: boolean;
};

const NOTHING_VISIBLE: TownVisible = {
  key: "",
  hosts: new Set(),
  cards: false,
};

/** Buildings within half a viewport of the screen, plus whether cards show. */
function townVisibleHosts(
  camera: TownRendererHandle["camera"],
  layout: TownLayout,
  level: TownLevel,
): TownVisible {
  const { width, height } = camera.viewport;
  const left = camera.toWorld(-width / 2, -height / 2);
  const right = camera.toWorld(width * 1.5, height * 1.5);
  const hosts: string[] = [];
  for (const b of layout.buildings)
    if (
      b.x * T < right.x &&
      (b.x + b.w) * T > left.x &&
      (b.y - 2) * T < right.y &&
      (b.y + b.h + TOWN_FACADE + 8) * T > left.y
    )
      hosts.push(b.hostKey);
  const cards = level === "overview" || level === "room";
  return {
    key: `${cards ? 1 : 0}:${hosts.join("\u0000")}`,
    hosts: new Set(hosts),
    cards,
  };
}

const TownWorldLayer = memo(function TownWorldLayer({
  model,
  layout,
  selectedKey,
  blockedSince,
  roomActions,
  selectedRoomKey,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
  visible,
  onHoverEntry,
}: {
  model: TownModel;
  layout: TownLayout;
  visible: TownVisible;
  onHoverEntry(key: string | null, rect?: DOMRect): void;
  selectedKey: string | null;
  blockedSince: ReadonlyMap<string, number>;
  roomActions: TownRoomActions;
  selectedRoomKey: string | null;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
}) {
  const targets = useMemo(() => townTargets(model, layout), [model, layout]);
  const attention = townAttention(model, blockedSince);
  const now = Date.now();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!attention.length) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [attention.length]);
  const selectedHost = selectedRoomKey
    ? model.rooms.get(selectedRoomKey)?.hostKey
    : undefined;
  const newRoomBuilding =
    layout.buildings.find((b) => b.hostKey === selectedHost) ??
    layout.buildings[0];
  return (
    <>
      {layout.buildings.map((building) => {
        if (!visible.hosts.has(building.hostKey)) return null;
        const host = model.hosts.get(building.hostKey);
        const queue = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            agent.semanticStatus === "blocked",
        );
        // Finished agents wait at reception too, after those who need you.
        const visitors = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            (agent.semanticStatus === "blocked" ||
              agent.semanticStatus === "done"),
        );
        const shown = visitors.slice(0, 6);
        const counts = building.rooms.reduce(
          (sum, placed) => {
            const room = model.rooms.get(placed.key);
            if (!room) return sum;
            const c = townRoomCounts(model, room);
            return {
              rooms: sum.rooms + 1,
              desks: sum.desks + c.desks,
              working: sum.working + c.working,
            };
          },
          { rooms: 0, desks: 0, working: 0 },
        );
        return (
          <div key={building.hostKey} className="town-building-layer">
            <div
              className="town-building-sign"
              data-building-sign={building.hostKey}
              style={{
                left: (building.x + building.w / 2) * T,
                top: (building.y + building.h * 0.38) * T,
              }}
            >
              <strong>{host?.displayLabel ?? building.hostKey}</strong>
              <span>
                {host?.stale
                  ? "Offline · last known state"
                  : `${counts.rooms} rooms · ${counts.desks} desks · ${counts.working} working`}
              </span>
              {queue.length ? (
                <em aria-label={`${queue.length} need you`}>!{queue.length}</em>
              ) : null}
            </div>
            <div
              className={`town-reception${queue.length ? " town-reception-busy" : ""}`}
              style={{
                left: building.doorX * T,
                top: (building.y + building.h + TOWN_FACADE) * T + 6,
              }}
              role="group"
              aria-label={`${host?.displayLabel ?? "Host"} reception, ${queue.length} waiting`}
            >
              <div className="town-reception-title">
                <span>
                  {(host?.displayLabel ?? "").toUpperCase()} RECEPTION
                </span>
                {queue.length ? <b>{queue.length}</b> : null}
              </div>
              {visitors.length ? (
                <div className="town-reception-queue">
                  {shown.map((agent) => (
                    <ReceptionEntry
                      key={agent.key}
                      agent={agent}
                      since={blockedSince.get(agent.key) ?? now}
                      now={now}
                      selected={selectedKey === agent.key}
                      onSelect={onSelect}
                      onActivate={onActivate}
                      onHoverEntry={onHoverEntry}
                    />
                  ))}
                  {visitors.length > shown.length ? (
                    <span className="town-reception-more">
                      +{visitors.length - shown.length}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="town-reception-empty">Nobody waiting</div>
              )}
            </div>
            {building.rooms.map((placed) => {
              const room = model.rooms.get(placed.key);
              if (!room) return null;
              const c = townRoomCounts(model, room);
              const label = room.accessibleLabel ?? room.displayLabel;
              const total = Math.max(1, c.agents);
              const freeCell = placed.cells.find((cell) => !cell.deskKey);
              const overflow =
                room.omittedDeskCount + placed.overflowDeskKeys.length;
              const reason = roomActions.createSeatReason(room.key);
              return (
                <div
                  key={room.key}
                  className="town-room"
                  style={{
                    left: placed.x * T,
                    top: placed.y * T,
                    width: placed.w * T,
                    height: placed.h * T,
                  }}
                >
                  {visible.cards ? (
                    <button
                      type="button"
                      className={`town-room-card${c.blocked ? " town-room-card-waiting" : ""}${selectedKey === room.key ? " town-selected" : ""}`}
                      style={
                        {
                          "--room-w": `${placed.w * T}px`,
                          "--carpet": townCarpetFor(room.key),
                        } as React.CSSProperties
                      }
                      aria-label={`${label}: ${c.desks} desks, ${c.working} working${c.blocked ? `, ${c.blocked} need you` : ""}${c.done ? `, ${c.done} done` : ""}. Zoom in.`}
                      onClick={() => onActivateRoom(room.key)}
                      tabIndex={-1}
                    >
                      <span className="town-room-card-name">{label}</span>
                      {c.blocked ? (
                        <span className="town-room-card-badge">
                          !{c.blocked}
                        </span>
                      ) : null}
                      <span className="town-room-card-meta">
                        {c.desks} desks · {c.working} working
                        {overflow ? ` · +${overflow} more` : ""}
                      </span>
                      <span className="town-room-card-bar" aria-hidden="true">
                        {(["working", "blocked", "done", "idle"] as const).map(
                          (status) =>
                            c[status] ? (
                              <i
                                key={status}
                                data-status={status}
                                style={{ flexGrow: c[status] / total }}
                              />
                            ) : null,
                        )}
                      </span>
                    </button>
                  ) : null}
                  <div className="town-room-plaque">
                    <span className="town-room-plaque-name">
                      {label} <small>{c.desks}</small>
                    </span>
                    {c.blocked ? (
                      <span className="town-room-plaque-badge">
                        !{c.blocked}
                      </span>
                    ) : null}
                    <button
                      className="world-room-overlay-action world-room-overlay-action-rename town-plaque-action"
                      type="button"
                      aria-label={`Rename room ${label}`}
                      title={`Rename ${label}`}
                      disabled={!roomActions.canRenameRoom(room.key)}
                      onClick={() => roomActions.onRenameRoom(room.key)}
                    >
                      <Pencil size={11} aria-hidden="true" />
                    </button>
                    <button
                      className="world-room-overlay-action world-room-overlay-action-danger town-plaque-action"
                      type="button"
                      aria-label={`Close room ${label}`}
                      title={`Close ${label}`}
                      disabled={!roomActions.canCloseRoom(room.key)}
                      onClick={() => roomActions.onCloseRoom(room.key)}
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </button>
                  </div>
                  {roomActions.showCreateSeat(room.key) && freeCell ? (
                    <>
                      <button
                        className="world-new-seat-canvas-action town-new-seat"
                        type="button"
                        aria-label={`New seat in ${label}`}
                        title={reason ?? `Start a new seat in ${label}`}
                        disabled={!roomActions.canCreateSeat(room.key)}
                        style={{
                          left: (freeCell.x - placed.x + 1) * T,
                          top: (freeCell.y - placed.y) * T + 4,
                        }}
                        onClick={() => roomActions.onCreateSeat(room.key)}
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                      {reason ? (
                        <span
                          className="world-creation-reason town-creation-reason"
                          role="status"
                          style={{
                            left: (freeCell.x - placed.x + 1) * T,
                            top: (freeCell.y - placed.y) * T + 60,
                          }}
                        >
                          {reason}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {roomActions.showCreateRoom(selectedRoomKey) && newRoomBuilding ? (
        <div
          className="town-new-room-wrap"
          style={{
            left: (newRoomBuilding.x + 18) * T,
            top: (newRoomBuilding.y + 3) * T,
          }}
        >
          <button
            className="world-new-room-canvas-action town-new-room"
            type="button"
            aria-label="New room"
            title={
              roomActions.createRoomReason(selectedRoomKey) ??
              "Create a new Herdr workspace"
            }
            disabled={!roomActions.canCreateRoom(selectedRoomKey)}
            onClick={() => roomActions.onCreateRoom(selectedRoomKey)}
          >
            <Plus size={16} strokeWidth={3} aria-hidden="true" />
            <span>New room</span>
          </button>
          {roomActions.createRoomReason(selectedRoomKey) ? (
            <span className="world-creation-reason" role="status">
              {roomActions.createRoomReason(selectedRoomKey)}
            </span>
          ) : null}
        </div>
      ) : null}
      <TownTargets
        targets={targets}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onActivate={onActivate}
        onActivateRoom={onActivateRoom}
        onFocusTarget={onFocusTarget}
      />
    </>
  );
});

const TARGET_BATCH = 16;

/** Accessible targets, admitted in batches so dense scenes keep input responsive. */
function TownTargets({
  targets,
  selectedKey,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
}: {
  targets: readonly TownTarget[];
  selectedKey: string | null;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
}) {
  const identity = useMemo(
    () => targets.map(({ kind, key }) => `${kind}:${key}`).join("|"),
    [targets],
  );
  const [progress, setProgress] = useState<{
    identity: string;
    limit: number;
  } | null>(null);
  const limit = progress?.identity === identity ? progress.limit : TARGET_BATCH;
  const admitted = useRef(new Set<string>());
  const rendered = targets.filter(
    (target, index) =>
      index < limit ||
      target.key === selectedKey ||
      admitted.current.has(`${target.kind}:${target.key}`),
  );
  useLayoutEffect(() => {
    admitted.current = new Set(
      rendered.map(({ kind, key }) => `${kind}:${key}`),
    );
  });
  const pending = targets.length - rendered.length;
  useEffect(() => {
    if (!pending) return;
    let current = true;
    void yieldWorldTask().then(() => {
      if (current) setProgress({ identity, limit: limit + TARGET_BATCH });
    });
    return () => {
      current = false;
    };
  }, [identity, limit, pending]);
  return (
    <div
      className="world-semantic-targets-overlay town-targets"
      aria-label="Office scene targets"
      aria-busy={pending > 0}
    >
      {pending ? (
        <span className="town-visually-hidden" role="status">
          Rendering {pending} more observed targets
        </span>
      ) : null}
      {rendered.map((target) => (
        <TownTargetButton
          key={`${target.kind}:${target.key}`}
          target={target}
          selected={selectedKey === target.key}
          onSelect={onSelect}
          onActivate={onActivate}
          onActivateRoom={onActivateRoom}
          onFocusTarget={onFocusTarget}
        />
      ))}
    </div>
  );
}

const TownTargetButton = memo(function TownTargetButton({
  target,
  selected,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
}: {
  target: TownTarget;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
}) {
  return (
    <button
      className="world-semantic-target"
      type="button"
      data-kind={target.kind}
      data-target-key={target.key}
      aria-label={target.label}
      aria-pressed={selected}
      title={target.label}
      style={{
        left: target.rect.x,
        top: target.rect.y,
        width: target.rect.width,
        height: target.rect.height,
      }}
      onFocus={() => onFocusTarget(target)}
      onClick={() =>
        target.kind === "room"
          ? onActivateRoom(target.key)
          : onSelect(target.key)
      }
      onDoubleClick={() => {
        if (target.canActivate && target.kind !== "room")
          onActivate(target.key);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.shiftKey &&
          target.canActivate &&
          target.kind !== "room"
        ) {
          event.preventDefault();
          onActivate(target.key);
        }
      }}
    />
  );
}, sameTargetButton);

type TownTargetButtonProps = {
  target: TownTarget;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
};

function sameTargetButton(
  previous: TownTargetButtonProps,
  next: TownTargetButtonProps,
) {
  const a = previous.target;
  const b = next.target;
  return (
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.onActivate === next.onActivate &&
    previous.onActivateRoom === next.onActivateRoom &&
    previous.onFocusTarget === next.onFocusTarget &&
    a.key === b.key &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.canActivate === b.canActivate &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}

function ReceptionEntry({
  agent,
  since,
  now,
  selected,
  onSelect,
  onActivate,
  onHoverEntry,
}: {
  agent: OfficeAgent;
  since: number;
  now: number;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onHoverEntry(key: string | null, rect?: DOMRect): void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (selected) ref.current?.setAttribute("data-selected", "true");
    else ref.current?.removeAttribute("data-selected");
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      className={`town-reception-entry${agent.semanticStatus === "done" ? " town-reception-done" : ""}`}
      aria-label={
        agent.semanticStatus === "done"
          ? `${agent.displayLabel}, finished`
          : `${agent.displayLabel}, needs input for ${ago(since, now)}`
      }
      title={agent.taskSummary ?? agent.displayLabel}
      onClick={() => onSelect(agent.key)}
      onDoubleClick={() => onActivate(agent.key)}
      onMouseEnter={(event) =>
        onHoverEntry(agent.key, event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => onHoverEntry(null)}
    >
      <img src={portrait(agent.key)} alt="" width={28} height={40} />
      <span>{agent.displayLabel}</span>
      <small>
        {agent.semanticStatus === "done" ? "done ✓" : ago(since, now)}
      </small>
    </button>
  );
}

function TownBoard({
  model,
  observability,
}: {
  model: TownModel;
  observability: OfficeObservability;
}) {
  const counts = { working: 0, blocked: 0, done: 0, idle: 0, unknown: 0 };
  for (const agent of model.agents.values()) counts[agent.semanticStatus] += 1;
  const available =
    observability.health !== "unavailable" && observability.sourceCount > 0;
  return (
    <div className="town-board" role="group" aria-label="Town board">
      <div className="town-board-title">TOWN BOARD</div>
      <dl>
        <div>
          <dt>Working</dt>
          <dd>{counts.working}</dd>
        </div>
        <div>
          <dt>Need you</dt>
          <dd>{counts.blocked}</dd>
        </div>
        <div>
          <dt>Done</dt>
          <dd>{counts.done}</dd>
        </div>
      </dl>
      <div className="town-board-economy">
        <span>ECONOMY</span>
        {available ? (
          <>
            <b>{formatOfficeCost(observability.totalCostUsd)}</b>
            <small>
              {formatOfficeUsage(observability.totalUsage)} tokens
              {observability.models.length
                ? ` · ${formatOfficeModelNames(observability.models)}`
                : ""}
            </small>
          </>
        ) : (
          <small>No cost data. Configure a metrics provider in settings.</small>
        )}
      </div>
    </div>
  );
}
