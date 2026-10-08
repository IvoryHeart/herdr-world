/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

import { Text, TextStyle } from "pixi.js";
import type { OfficeHost } from "./herdrOfficeProjection";
import { OFFICE_GEOMETRY } from "./officeGeometry";
import type { OfficeLongRoomTitleMode } from "./officeGeometry";
import {
  minimumRoomWidthForTitleBox,
  officeHeaderLabels,
} from "./officeLayout";

export const OFFICE_HEADING_TEXT_SIZE = 13;

export const THEMES = Object.freeze([
  { floorA: 0x0c1620, floorB: 0x0a121c, wall: 0x1e3050, accent: 0x4aa3d8 },
  { floorA: 0x120c20, floorB: 0x100a1e, wall: 0x34215a, accent: 0x9a6bd1 },
  { floorA: 0x18140c, floorB: 0x16120a, wall: 0x463522, accent: 0xd69540 },
  { floorA: 0x0c1a18, floorB: 0x0a1614, wall: 0x20503d, accent: 0x51b677 },
  { floorA: 0x1a0c10, floorB: 0x180a0e, wall: 0x51232b, accent: 0xd45d70 },
  { floorA: 0x18100c, floorB: 0x160e0a, wall: 0x482d22, accent: 0xcf7944 },
]);

export const STATUS_CUES = Object.freeze({
  working: { label: "WORKING", color: 0x67d6c0 },
  idle: { label: "IDLE", color: 0x8d9aae },
  blocked: { label: "NEEDS INPUT", color: 0xec8799 },
  done: { label: "DONE", color: 0xf0c878 },
  unknown: { label: "UNKNOWN", color: 0xc29add },
});

export function label(
  value: string,
  options: {
    size?: number;
    color?: number;
    anchor?: number | { x: number; y: number };
    weight?: "600" | "700";
  } = {},
) {
  const text = new Text({
    text: value,
    style: new TextStyle({
      fontSize: options.size ?? 9,
      fill: options.color ?? 0xffffff,
      fontWeight: options.weight ?? "600",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      dropShadow: { alpha: 0.24, distance: 1, color: 0x000000 },
    }),
  });
  if (typeof options.anchor === "number") {
    text.anchor.set(options.anchor);
  } else if (options.anchor) {
    text.anchor.set(options.anchor.x, options.anchor.y);
  }
  return text;
}

export function officeFontReady() {
  const fonts = document.fonts;
  return (
    !fonts ||
    (fonts.status === "loaded" &&
      fonts.check(`600 ${OFFICE_HEADING_TEXT_SIZE}px Inter`))
  );
}

export function measureOfficeRoomHeader(
  title: string,
  hostTitle: string,
  titleMode: OfficeLongRoomTitleMode,
) {
  const labels = officeHeaderLabels(title, hostTitle, titleMode);
  const hyphenWidth = measureOfficeHeadingText("-");
  const fixedWidth = 10 + 16 + hyphenWidth + 12 + 20 + hyphenWidth + 10;
  const maximumTitleBoxWidth = Math.max(
    0,
    OFFICE_GEOMETRY.maxExpandedRoomWidth -
      2 * OFFICE_GEOMETRY.roomHeaderSafeInset -
      2 *
        (OFFICE_GEOMETRY.roomHeaderActionWidth +
          OFFICE_GEOMETRY.roomHeaderActionGap +
          OFFICE_GEOMETRY.roomHeaderActionWidth +
          OFFICE_GEOMETRY.roomHeaderCloseGap),
  );
  let workspace = labels.workspace;
  let host = labels.host;
  if (
    fixedWidth +
      measureOfficeHeadingText(workspace) +
      measureOfficeHeadingText(host) >
    maximumTitleBoxWidth
  ) {
    const available = Math.max(0, maximumTitleBoxWidth - fixedWidth);
    const workspaceBudget = Math.floor(available * 0.52);
    workspace = fitOfficeLabelForCanvas(workspace, workspaceBudget);
    host = fitOfficeLabelForCanvas(
      host,
      Math.max(0, available - workspaceBudget),
    );
  }
  const titleBoxWidth = Math.ceil(
    fixedWidth +
      measureOfficeHeadingText(workspace) +
      measureOfficeHeadingText(host),
  );
  return {
    titleBoxWidth,
    roomWidth: minimumRoomWidthForTitleBox(titleBoxWidth),
    workspace,
    host,
  };
}

export const headingWidths = new Map<string, number>();

function measureOfficeHeadingText(value: string) {
  const key = value.toUpperCase();
  const previous = headingWidths.get(key);
  if (previous !== undefined) return previous;
  const text = new Text({
    text: key,
    style: new TextStyle({
      fontSize: OFFICE_HEADING_TEXT_SIZE,
      fill: 0xffffff,
      fontWeight: "600",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      dropShadow: { alpha: 0.24, distance: 1, color: 0x000000 },
    }),
  });
  const width = text.width;
  text.destroy();
  if (headingWidths.size >= 4096)
    headingWidths.delete(headingWidths.keys().next().value!);
  headingWidths.set(key, width);
  return width;
}

function fitOfficeLabelForCanvas(value: string, maximumWidth: number) {
  if (maximumWidth <= 0) {
    return "";
  }
  if (measureOfficeHeadingText(value) <= maximumWidth) {
    return value;
  }
  const ellipsis = "…";
  if (measureOfficeHeadingText(ellipsis) > maximumWidth) {
    return "";
  }
  const points = [...value];
  let end = points.length;
  while (
    end > 0 &&
    measureOfficeHeadingText(`${points.slice(0, end).join("")}${ellipsis}`) >
      maximumWidth
  ) {
    end -= 1;
  }
  return end > 0 ? `${points.slice(0, end).join("")}${ellipsis}` : ellipsis;
}

export function shortLabel(value: string, limit: number) {
  const points = [...value];
  return points.length <= limit
    ? value
    : `${points.slice(0, Math.max(1, limit - 1)).join("")}…`;
}

export function hostColor(host: OfficeHost) {
  return THEMES[host.deterministicSkin.themeIndex % THEMES.length].accent;
}

export function blendColor(from: number, to: number, amount: number) {
  const ratio = Math.max(0, Math.min(1, amount));
  const fromRed = (from >> 16) & 0xff;
  const fromGreen = (from >> 8) & 0xff;
  const fromBlue = from & 0xff;
  const toRed = (to >> 16) & 0xff;
  const toGreen = (to >> 8) & 0xff;
  const toBlue = to & 0xff;
  return (
    (Math.round(fromRed + (toRed - fromRed) * ratio) << 16) |
    (Math.round(fromGreen + (toGreen - fromGreen) * ratio) << 8) |
    Math.round(fromBlue + (toBlue - fromBlue) * ratio)
  );
}
