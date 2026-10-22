import { useEffect, useRef } from "react";
import { useSystemBack } from "./systemBack";

/**
 * One LIFO stack for transient layers: menus, popovers, pickers and sheets.
 *
 * Escape, a press outside and the phone's Back close only the top layer. The
 * stack listens in the capture phase on window, before the terminal or any
 * component: xterm consumes keys in its textarea and the terminal cancels the
 * compatibility click after a touch, so per-menu listeners on document or the
 * click never fire over a terminal. A press outside also reaches its target,
 * so pressing the terminal closes the top layer and focuses the terminal.
 *
 * Closing by Escape, Back or by choosing an item returns focus to what had it
 * before the layer opened: the trigger when opened by keyboard, or the
 * terminal when the trigger was pressed while the terminal had focus.
 */
export type LayerCloseReason = "escape" | "outside" | "back";

type Layer = {
  element: () => Element | null;
  anchors: () => Iterable<Element | null>;
  close: (reason: LayerCloseReason) => void;
  restore: HTMLElement | null;
  closedBy?: LayerCloseReason;
};

const stack: Layer[] = [];

// Focus as it was just before the latest press, so a layer opened by that
// press can return focus past its own trigger. A key leaves focus where it
// was, so a layer opened by a key reads it when it opens.
let inputFocus: { element: Element | null; at: number } | null = null;
const INPUT_FOCUS_MS = 1_000;

// Modals outside the stack (most dialogs) own their keys and presses while
// they sit above the top layer.
const MODAL = '.modal-backdrop, [aria-modal="true"]';

// An on-screen Back closes the top layer itself (closeTopLayer), so pressing
// it is not a press outside.
const BACK_CONTROL = "[data-layer-back]";

function contains(layer: Layer, target: Node) {
  if (layer.element()?.contains(target)) return true;
  if (target instanceof Element && target.closest(BACK_CONTROL)) return true;
  for (const anchor of layer.anchors())
    if (anchor?.contains(target)) return true;
  return false;
}

function belowUnstackedModal(layer: Layer, target: EventTarget | null) {
  if (!(target instanceof Element) || contains(layer, target)) return false;
  const modal = target.closest(MODAL);
  if (!modal) return false;
  // The layer opened from inside this modal, so it is above the modal.
  if (layer.restore && modal.contains(layer.restore)) return false;
  for (const anchor of layer.anchors())
    if (anchor && modal.contains(anchor)) return false;
  return true;
}

function closeTop(reason: LayerCloseReason) {
  const top = stack[stack.length - 1];
  if (!top) return;
  top.closedBy = reason;
  top.close(reason);
}

function rememberInputFocus() {
  inputFocus = { element: document.activeElement, at: performance.now() };
}

// Installed from useLayer, so they exist before any trigger is pressed, once
// per window (tests swap windows).
const listening = new WeakSet<Window>();
function listen() {
  if (typeof window === "undefined" || listening.has(window)) return;
  listening.add(window);
  window.addEventListener(
    "pointerdown",
    (event) => {
      const top = stack[stack.length - 1];
      if (
        top &&
        event.target instanceof Node &&
        !contains(top, event.target) &&
        !belowUnstackedModal(top, event.target)
      )
        closeTop("outside");
      rememberInputFocus();
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      const top = stack[stack.length - 1];
      if (
        top &&
        event.key === "Escape" &&
        !event.isComposing &&
        !belowUnstackedModal(top, event.target)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeTop("escape");
      }
    },
    true,
  );
}

function focusTarget(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement) || element === document.body)
    return null;
  return element;
}

/**
 * The on-screen Back's first step: closes the top layer, as the phone's Back
 * would, and returns whether there was one. Mark the control
 * `data-layer-back` so pressing it does not already close the layer.
 */
export function closeTopLayer(): boolean {
  if (!stack.length) return false;
  closeTop("back");
  return true;
}

/** Number of open layers; for tests and for code that defers to them. */
export function openLayerCount() {
  return stack.length;
}

/**
 * Keeps a transient layer on the stack while `open`. `element` is the layer's
 * content; presses inside it or on an anchor (its trigger) are not outside.
 * `close` must close the layer; the reason says why.
 */
export function useLayer(
  open: boolean,
  close: (reason: LayerCloseReason) => void,
  {
    element,
    anchors = () => [],
  }: {
    element: () => Element | null;
    anchors?: () => Iterable<Element | null>;
  },
) {
  listen();
  const latest = useRef({ close, element, anchors });
  latest.current = { close, element, anchors };
  const current = useRef<Layer | null>(null);
  // What had focus when the layer opened, read while rendering the opening:
  // the layer's own effects (Radix's autofocus) move focus before ours run.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    const recent =
      inputFocus && performance.now() - inputFocus.at < INPUT_FOCUS_MS
        ? focusTarget(inputFocus.element)
        : null;
    opener.current = recent ?? focusTarget(document.activeElement);
  }
  wasOpen.current = open;
  useSystemBack(
    open,
    () => {
      const layer = current.current;
      if (!layer) return;
      layer.closedBy = "back";
      layer.close("back");
    },
    "popup",
  );
  useEffect(() => {
    if (!open) return;
    const layer: Layer = {
      element: () => latest.current.element(),
      anchors: () => latest.current.anchors(),
      close: (reason) => latest.current.close(reason),
      restore: opener.current,
    };
    stack.push(layer);
    current.current = layer;
    return () => {
      if (current.current === layer) current.current = null;
      const index = stack.indexOf(layer);
      if (index >= 0) stack.splice(index, 1);
      // A press outside hands focus to what was pressed.
      if (layer.closedBy === "outside") return;
      const active = document.activeElement;
      const element = layer.element();
      const lost =
        !active ||
        active === document.body ||
        !active.isConnected ||
        Boolean(element?.contains(active));
      if (!lost) return;
      // Without an opener (nothing had focus), the trigger takes it.
      let target = layer.restore?.isConnected ? layer.restore : null;
      if (!target)
        for (const anchor of layer.anchors())
          if (anchor instanceof HTMLElement && anchor.isConnected) {
            target = anchor;
            break;
          }
      target?.focus({ preventScroll: true });
    };
  }, [open]);
}
