import { useMemo, type ReactNode } from "react";
import type { TownBuildingSigns } from "./townBuildingSigns";

export function TownBuildingSign({
  hostKey,
  signs,
  left,
  top,
  children,
}: {
  hostKey: string;
  signs: TownBuildingSigns;
  left: number;
  top: number;
  children: ReactNode;
}) {
  // Status and label renders retain the same ref; only commits attach nodes.
  const ref = useMemo(() => signs.ref(hostKey), [signs, hostKey]);
  return (
    <div
      ref={ref}
      className="town-building-sign"
      data-building-sign={hostKey}
      style={{ left, top }}
    >
      {children}
    </div>
  );
}
