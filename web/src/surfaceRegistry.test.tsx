// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CoreNavigationProvider, CoreSurfaceOutlet } from "./CoreNavigation";
import { SurfaceRegistry, coreSurfaceRegistry } from "./surfaceRegistry";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("internal surface registry", () => {
  it("describes the statically bundled multi-host core surface", () => {
    expect(coreSurfaceRegistry.get("spaces")).toMatchObject({
      id: "spaces",
      label: "Spaces",
      route: "/spaces",
      semanticIcon: "terminal-workspaces",
      hostScope: "multi-host",
      requiredCapabilities: ["snapshot", "terminal_attach"],
    });
    expect(coreSurfaceRegistry.get("world")).toMatchObject({
      id: "world",
      label: "World",
      route: "/",
      semanticIcon: "world-themes",
      hostScope: "multi-host",
      requiredCapabilities: ["snapshot"],
    });
    expect(coreSurfaceRegistry.resolvePath("/")?.id).toBe("world");
    expect(coreSurfaceRegistry.resolvePath("/spaces/")?.id).toBe("spaces");
    expect(
      coreSurfaceRegistry.supports("spaces", {
        features: ["snapshot", "terminal_attach"],
      }),
    ).toBe(true);
    expect(
      coreSurfaceRegistry.missingCapabilities("spaces", { features: ["snapshot"] }),
    ).toEqual(["terminal_attach"]);
    expect(
      coreSurfaceRegistry.supports("world", { features: ["snapshot"] }),
    ).toBe(true);
  });

  it("mounts a core surface lazily through navigation and the registry", async () => {
    const registry = new SurfaceRegistry([
      {
        id: "spaces",
        label: "Spaces",
        route: "/",
        semanticIcon: "terminal-workspaces",
        hostScope: "multi-host",
        requiredCapabilities: [],
        load: async () => ({ default: () => <main>Mounted Spaces surface</main> }),
      },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <CoreNavigationProvider registry={registry}>
          <CoreSurfaceOutlet registry={registry} />
        </CoreNavigationProvider>,
      );
    });

    expect(container.textContent).toContain("Mounted Spaces surface");
    await act(async () => root.unmount());
  });

  it("rejects duplicate or malformed registrations", () => {
    const definition = {
      id: "spaces",
      label: "Spaces",
      route: "/" as const,
      semanticIcon: "terminal-workspaces",
      hostScope: "multi-host" as const,
      requiredCapabilities: [],
      load: async () => ({ default: () => null }),
    };
    expect(() => new SurfaceRegistry([definition, definition])).toThrow(/duplicate/iu);
    expect(() => new SurfaceRegistry([{ ...definition, id: "World SDK" }])).toThrow(/invalid/iu);
  });
});
