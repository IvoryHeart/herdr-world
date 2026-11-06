import type { TownCamera } from "./townCamera";
import { TOWN_FACADE, TOWN_TILE as T, type TownLayout } from "./townLayout";

export function findCell(layout: TownLayout, deskKey: string) {
  const at = layout.deskCells.get(deskKey);
  if (!at) return null;
  for (const building of layout.buildings)
    for (const room of building.rooms)
      if (room.key === at.roomKey) return room.cells[at.cellIndex] ?? null;
  return null;
}

type TownCameraHandle = TownCamera;

export function roomZoom(
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

export function buildingZoom(
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
