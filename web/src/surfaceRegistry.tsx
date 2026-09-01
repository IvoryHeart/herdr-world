import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

import { worldSurfaceDefinition } from "./world/worldSurfaceDefinition";

export type SurfaceHostScope = "single-host" | "multi-host";

export type SurfaceSlot = "sidebar" | "stage";

export type SurfaceComponentProps = {
  slot?: SurfaceSlot;
  context?: unknown;
};

export type SurfaceDefinition = {
  id: string;
  label: string;
  route: `/${string}` | "/";
  semanticIcon: string;
  hostScope: SurfaceHostScope;
  requiredCapabilities: readonly string[];
  load: () => Promise<{ default: ComponentType<SurfaceComponentProps> }>;
};

type SurfaceCapabilities = {
  features?: readonly string[];
} | null;

export class SurfaceRegistry {
  readonly #definitions = new Map<string, SurfaceDefinition>();
  readonly #components = new Map<
    string,
    LazyExoticComponent<ComponentType<SurfaceComponentProps>>
  >();

  constructor(definitions: readonly SurfaceDefinition[]) {
    for (const definition of definitions) {
      if (this.#definitions.has(definition.id)) {
        throw new Error(`Duplicate surface ID: ${definition.id}`);
      }
      if (!/^[a-z][a-z0-9-]*$/u.test(definition.id)) {
        throw new Error(`Invalid surface ID: ${definition.id}`);
      }
      if (!definition.route.startsWith("/")) {
        throw new Error(`Invalid surface route: ${definition.route}`);
      }
      this.#definitions.set(definition.id, Object.freeze({ ...definition }));
    }
  }

  list() {
    return [...this.#definitions.values()];
  }

  get(id: string) {
    return this.#definitions.get(id) ?? null;
  }

  resolvePath(pathname: string) {
    const normalizedPath = pathname.length > 1
      ? pathname.replace(/\/+$/u, "")
      : pathname;
    return this.list().find((surface) => surface.route === normalizedPath) ?? null;
  }

  component(id: string) {
    const definition = this.get(id);
    if (!definition) {
      return null;
    }
    let component = this.#components.get(id);
    if (!component) {
      component = lazy(definition.load);
      this.#components.set(id, component);
    }
    return component;
  }

  missingCapabilities(id: string, capabilities: SurfaceCapabilities) {
    const definition = this.get(id);
    if (!definition) {
      return [];
    }
    const available = new Set(capabilities?.features ?? []);
    return definition.requiredCapabilities.filter((capability) => !available.has(capability));
  }

  supports(id: string, capabilities: SurfaceCapabilities) {
    return this.missingCapabilities(id, capabilities).length === 0;
  }
}

export const coreSurfaceRegistry = new SurfaceRegistry([
  {
    id: "spaces",
    label: "Spaces",
    route: "/spaces",
    semanticIcon: "terminal-workspaces",
    hostScope: "multi-host",
    requiredCapabilities: ["snapshot", "terminal_attach"],
    load: () => import("./SpacesSurface"),
  },
  worldSurfaceDefinition,
]);
