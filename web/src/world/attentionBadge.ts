import { useEffect, useRef, useSyncExternalStore } from "react";
import { worldLocalStorage } from "../browserStorage";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
} from "./officePreferences";

/**
 * The tab title, tab icon and installed app icon carry the Needs you count
 * while World is behind another window: `(3) Herdr World`, a small badge on
 * the icon, and the Badging API's number on the dock or home screen. The
 * count is the top bar's Needs you counter; this module only shows it.
 */

const TITLE_COUNT = /^\((\d+)\)(?: |$)/;

/** The title without a count prefix. */
export const plainTitle = (title: string) => title.replace(TITLE_COUNT, "");

/** The count a title carries, 0 without a prefix. */
export const titleCount = (title: string) =>
  Number(TITLE_COUNT.exec(title)?.[1] ?? 0);

/** `(N) <title>` while anything waits; the plain title at 0. */
export function countedTitle(title: string, count: number) {
  const plain = plainTitle(title);
  return count > 0 ? `(${count}) ${plain}`.trim() : plain;
}

/** The icon badge's text: the number up to 9, then `9+`; none at 0. */
export const badgeText = (count: number) =>
  count <= 0 ? "" : count > 9 ? "9+" : String(Math.floor(count));

/** The Badging API, where the browser has it. */
type BadgeNavigator = {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export type AttentionBadgeTarget = {
  document: Document;
  navigator: BadgeNavigator;
  /** The normal icon with a badge, as an image URL; null if it cannot draw. */
  drawIcon(text: string): Promise<string | null>;
};

const BADGE_LINK = "data-attention-badge";

/**
 * Shows a count on one page's title, icon and app badge, and restores the
 * plain ones at 0. Badged, the page's own icon links step aside for one
 * badged link (browsers pick among several icons unpredictably); at 0 they
 * return in their order.
 */
export function createAttentionBadge(target: AttentionBadgeTarget) {
  const { document, navigator } = target;
  let shown = 0;
  let iconText = "";
  let plainIcons: HTMLLinkElement[] = [];
  const drawn = new Map<string, Promise<string | null>>();

  const appBadge = (count: number) => {
    try {
      const done =
        count > 0
          ? navigator.setAppBadge?.(count)
          : navigator.clearAppBadge?.();
      // Browsers reject outside an installed app; that is not an error here.
      done?.catch(() => {});
    } catch {
      // No Badging API, or one that throws: the title and icon still show.
    }
  };

  const restoreIcons = () => {
    document.head.querySelector(`link[${BADGE_LINK}]`)?.remove();
    for (const link of plainIcons) document.head.append(link);
    plainIcons = [];
  };

  const badgeIcon = (url: string) => {
    if (!plainIcons.length)
      plainIcons = [
        ...document.head.querySelectorAll<HTMLLinkElement>(
          `link[rel~="icon"]:not([${BADGE_LINK}])`,
        ),
      ];
    for (const link of plainIcons) link.remove();
    let link = document.head.querySelector<HTMLLinkElement>(
      `link[${BADGE_LINK}]`,
    );
    if (!link) {
      link = document.createElement("link");
      link.setAttribute(BADGE_LINK, "");
      link.rel = "icon";
      link.type = "image/png";
      document.head.append(link);
    }
    link.href = url;
  };

  const showIcon = (text: string) => {
    iconText = text;
    if (!text) {
      restoreIcons();
      return;
    }
    let pending = drawn.get(text);
    if (!pending) {
      pending = target.drawIcon(text).catch(() => null);
      drawn.set(text, pending);
    }
    void pending.then((url) => {
      // Drawing again next time, e.g. after the icon failed to load offline.
      if (!url) drawn.delete(text);
      // A later count may have replaced this one while it drew.
      if (iconText !== text) return;
      if (url) badgeIcon(url);
      else restoreIcons();
    });
  };

  return {
    show(count: number) {
      const next = Math.max(0, Math.floor(count));
      if (document.title !== countedTitle(document.title, next))
        document.title = countedTitle(document.title, next);
      const text = badgeText(next);
      if (text !== iconText) showIcon(text);
      if (next !== shown) appBadge(next);
      shown = next;
    },
  };
}

/** World's attention yellow (`--yellow`, the Needs you state colour). */
const BADGE_FILL = "#f0c453";
/** Dark text and a dark ring, readable on light and dark tab strips. */
const BADGE_INK = "#1a1b26";
const ICON_SRC = "/herdr-world-icon-192.png";

/** The normal app icon at 64 px with the badge at its top right. */
async function drawBadgedIcon(text: string): Promise<string | null> {
  const image = new Image();
  image.src = ICON_SRC;
  await image.decode();
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  const height = 40;
  const font = text.length > 1 ? 28 : 32;
  context.font = `700 ${font}px system-ui, sans-serif`;
  const width = Math.max(
    height,
    Math.ceil(context.measureText(text).width) + 14,
  );
  const x = size - width;
  context.beginPath();
  context.roundRect(x, 0, width, height, height / 2);
  context.lineWidth = 4;
  context.strokeStyle = BADGE_INK;
  context.stroke();
  context.fillStyle = BADGE_FILL;
  context.fill();
  context.fillStyle = BADGE_INK;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + width / 2, height / 2 + 2);
  return canvas.toDataURL("image/png");
}

let shared: ReturnType<typeof createAttentionBadge> | null = null;
const sharedBadge = () =>
  (shared ??= createAttentionBadge({
    document,
    navigator: navigator as BadgeNavigator,
    drawIcon: drawBadgedIcon,
  }));

const readEnabled = () => readOfficePreferences(worldLocalStorage).tabBadge;

const subscribePreferences = (listener: () => void) => {
  window.addEventListener(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, listener);
  return () =>
    window.removeEventListener(
      WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
      listener,
    );
};

/**
 * Mounted once for the whole shell: shows `count` on the tab and app icon
 * unless Menu's switch is off. Leaving the page restores the plain title,
 * icon and app badge; coming back from the back/forward cache shows the
 * count again.
 */
export function useAttentionBadge(count: number) {
  const enabled = useSyncExternalStore(
    subscribePreferences,
    readEnabled,
    readEnabled,
  );
  const shownCount = enabled ? count : 0;
  const latest = useRef(shownCount);
  useEffect(() => {
    latest.current = shownCount;
    sharedBadge().show(shownCount);
  }, [shownCount]);
  useEffect(() => {
    const badge = sharedBadge();
    const hide = () => badge.show(0);
    const reshow = () => badge.show(latest.current);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", reshow);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", reshow);
      hide();
    };
  }, []);
}
