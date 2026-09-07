// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import type { BridgeRuntime } from "./bridge";
import { SidebarToolbar } from "./SidebarToolbar";

const roots: Root[] = [];

function runtime(id: string, label: string): BridgeRuntime {
  return {
    id,
    mode: "configured",
    label,
    color: "#89b4fa",
    backend: null,
    connectionKey: `${id}:connection`,
    capabilityGeneration: 1,
    generationKey: `${id}:generation`,
    resumeToken: 0,
    capabilities: null,
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => path,
    wsUrl: (path) => path,
  };
}

async function renderToolbar(
  overrides: Partial<ComponentProps<typeof SidebarToolbar>> = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onView = vi.fn();
  const onHostScope = vi.fn();
  const onScope = vi.fn();
  const onSidebarView = vi.fn();
  const onSelectBridge = vi.fn();
  const onAddHost = vi.fn();
  const props: ComponentProps<typeof SidebarToolbar> = {
    bridgeViews: [
      {
        runtime: runtime("host-a", "Host A"),
        connectionState: "compatible",
      },
      {
        runtime: runtime("host-b", "Host B"),
        connectionState: "offline",
      },
    ],
    primaryView: "world",
    activeWorldTheme: { id: "office" },
    scope: "space",
    sidebarView: "agents",
    notesEnabled: true,
    selectedBridgeId: "host-a",
    hostScope: "selected",
    onPrimaryView: onView,
    onHostScope,
    onScope,
    onSidebarView,
    onSelectBridge,
    onAddHost,
    ...overrides,
  };
  await act(async () => {
    root.render(<SidebarToolbar {...props} />);
  });
  return { container, onView, onHostScope, onScope, onSidebarView, onSelectBridge, onAddHost };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("SidebarToolbar", () => {
  it("exposes the three View destinations and keeps Space scope separate", async () => {
    const rendered = await renderToolbar();
    const view = rendered.container.querySelector<HTMLSelectElement>("[aria-label='View']");
    const scope = rendered.container.querySelector<HTMLSelectElement>("[aria-label='Space scope']");
    expect([...view!.options].map((option) => option.textContent)).toEqual([
      "Office",
      "Graph",
      "Spaces",
    ]);
    expect([...scope!.options].map((option) => option.textContent)).toEqual([
      "Current space",
      "All spaces",
    ]);

    await act(async () => {
      view!.value = "graph";
      view!.dispatchEvent(new Event("change", { bubbles: true }));
      scope!.value = "all";
      scope!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rendered.onView).toHaveBeenCalledWith("graph");
    expect(rendered.onScope).toHaveBeenCalledWith("all");
  });

  it("orders host choices before Add Host and supports keyboard cancellation", async () => {
    const rendered = await renderToolbar();
    const trigger = rendered.container.querySelector<HTMLButtonElement>(".host-picker-trigger");
    expect(trigger?.getAttribute("aria-label")).toBe("Hosts: Host A, compatible");
    expect(rendered.container.querySelector(".host-picker-summary")?.textContent).toContain(
      "1 host needs attention",
    );

    await act(async () => {
      trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const menu = rendered.container.querySelector<HTMLElement>("[role='menu']");
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll("button")].map((button) => button.textContent?.trim())).toEqual([
      "All hosts",
      "Host Acompatible✓",
      "Host Boffline",
      "Add Host",
    ]);
    expect(menu!.querySelector("[data-add-host='true']")).toBe(
      menu!.querySelectorAll("button").item(3),
    );

    await act(async () => {
      menu!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(rendered.container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Add Host reachable with no enabled hosts and hands off the durable trigger", async () => {
    const rendered = await renderToolbar({
      bridgeViews: [],
      selectedBridgeId: null,
    });
    const trigger = rendered.container.querySelector<HTMLButtonElement>(".host-picker-trigger");
    expect(trigger?.getAttribute("aria-label")).toBe("Hosts: No enabled hosts");
    await act(async () => trigger!.click());
    const addHost = rendered.container.querySelector<HTMLButtonElement>("[data-add-host='true']");
    expect(addHost).toBeTruthy();
    expect(addHost).toBe(
      rendered.container.querySelectorAll("[role='menu'] > button").item(1),
    );
    expect(rendered.container.querySelector<HTMLButtonElement>("[data-host-choice='all']")?.disabled)
      .toBe(true);

    await act(async () => addHost!.click());
    expect(rendered.onAddHost).toHaveBeenCalledWith(trigger);
  });
  it("keeps duplicate host names identifiable and dispatches the qualified ID", async () => {
    const a = runtime("host-a", "Duplicate");
    const b = { ...runtime("host-b", "Duplicate"), backend: { id: "host-b", name: "Duplicate", baseUrl: "http://host-b.test" } };
    const rendered = await renderToolbar({ bridgeViews: [
      { runtime: a, connectionState: "compatible" },
      { runtime: b, connectionState: "compatible" },
    ] });
    const trigger = rendered.container.querySelector<HTMLButtonElement>(".host-picker-trigger")!;
    await act(async () => trigger.click());
    const choices = [...rendered.container.querySelectorAll<HTMLButtonElement>("[data-host-id]")];
    expect(choices.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Duplicate (This Herdr), compatible", "Duplicate (http://host-b.test), compatible",
    ]);
    await act(async () => choices[1].click());
    expect(rendered.onSelectBridge).toHaveBeenCalledExactlyOnceWith("host-b");
    expect(document.activeElement).toBe(trigger);
  });

  it("derives the current View, ignores a same-value change, and hides disabled Notes", async () => {
    const rendered = await renderToolbar({ primaryView: "spaces", activeWorldTheme: { id: "graph" }, notesEnabled: false });
    const view = rendered.container.querySelector<HTMLSelectElement>("[aria-label='View']")!;
    expect(view.value).toBe("spaces");
    await act(async () => view.dispatchEvent(new Event("change", { bubbles: true })));
    expect(rendered.onView).not.toHaveBeenCalled();
    const buttons = [...rendered.container.querySelectorAll<HTMLButtonElement>(".sidebar-mode button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Agents", "Tabs"]);
    await act(async () => buttons[1].click());
    expect(rendered.onSidebarView).toHaveBeenCalledExactlyOnceWith("tabs");
  });

  it("dismisses outside without stealing focus from the activated control", async () => {
    const rendered = await renderToolbar();
    const trigger = rendered.container.querySelector<HTMLButtonElement>(".host-picker-trigger")!;
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => trigger.click());
    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      outside.focus();
    });
    expect(rendered.container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

});
