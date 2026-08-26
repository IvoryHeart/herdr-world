import type { SurfaceDefinition } from "../surfaceRegistry";

export const worldSurfaceDefinition = {
  id: "world",
  label: "Office",
  route: "/world",
  semanticIcon: "pixel-office",
  hostScope: "multi-host",
  requiredCapabilities: ["snapshot"],
  load: () => import("./WorldSurface"),
} satisfies SurfaceDefinition;
