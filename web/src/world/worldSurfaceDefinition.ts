import type { SurfaceDefinition } from "../surfaceRegistry";

export const worldSurfaceDefinition = {
  id: "world",
  label: "World",
  route: "/",
  semanticIcon: "world-themes",
  hostScope: "multi-host",
  requiredCapabilities: ["snapshot"],
  load: () => import("./WorldThemeStage"),
} satisfies SurfaceDefinition;
