import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

import type { SurfaceComponentProps } from "../surfaceRegistry";

export type WorldThemeId = "office" | "graph" | "mindcraft";

export type WorldThemeComponent = ComponentType<SurfaceComponentProps>;

export type WorldThemeDefinition = {
  id: WorldThemeId;
  label: string;
  semanticIcon: string;
  load: () => Promise<{ default: WorldThemeComponent }>;
};

export class WorldThemeRegistry {
  readonly #definitions = new Map<WorldThemeId, WorldThemeDefinition>();
  readonly #components = new Map<WorldThemeId, LazyExoticComponent<WorldThemeComponent>>();

  constructor(definitions: readonly WorldThemeDefinition[]) {
    for (const definition of definitions) {
      if (this.#definitions.has(definition.id)) {
        throw new Error(`Duplicate World theme ID: ${definition.id}`);
      }
      if (!/^[a-z][a-z0-9-]*$/u.test(definition.id)) {
        throw new Error(`Invalid World theme ID: ${definition.id}`);
      }
      this.#definitions.set(definition.id, Object.freeze({ ...definition }));
    }
    if (!this.#definitions.has("office")) {
      throw new Error("The Office World theme must be available");
    }
  }

  list() {
    return [...this.#definitions.values()];
  }

  get(id: string) {
    return this.#definitions.get(id as WorldThemeId) ?? null;
  }

  component(id: string) {
    const definition = this.get(id);
    if (!definition) {
      return null;
    }
    let component = this.#components.get(definition.id);
    if (!component) {
      component = lazy(definition.load);
      this.#components.set(definition.id, component);
    }
    return component;
  }
}

export const worldThemeRegistry = new WorldThemeRegistry([
  {
    id: "office",
    label: "Office",
    semanticIcon: "pixel-office",
    load: () => import("./WorldSurface"),
  },
  {
    id: "graph",
    label: "Graph",
    semanticIcon: "project-graph",
    load: () => import("./graph/GraphTheme"),
  },
]);
