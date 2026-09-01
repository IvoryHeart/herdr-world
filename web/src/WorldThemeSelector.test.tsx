// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorldThemeSelector } from "./WorldThemeSelector";
import { worldThemeRegistry } from "./world/worldThemeRegistry";

const roots: Root[] = [];

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

describe("World theme selector", () => {
  it("lists each available theme once and supports keyboard selection and Escape focus return", async () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const office = worldThemeRegistry.get("office");
    if (!office) throw new Error("Office missing");
    await act(async () => {
      root.render(
        <WorldThemeSelector
          themes={worldThemeRegistry.list()}
          activeTheme={office}
          worldActive
          onActivate={onActivate}
          onSelect={onSelect}
        />,
      );
    });

    const active = container.querySelector<HTMLButtonElement>(".world-theme-activate");
    const trigger = container.querySelector<HTMLButtonElement>("[aria-haspopup='menu']");
    expect(active?.textContent).toContain("Office");
    expect(active?.getAttribute("aria-pressed")).toBe("true");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => active?.click());
    expect(onActivate).toHaveBeenCalledOnce();
    expect(container.querySelector("[role='menu']")).toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const items = [...container.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")];
    expect(items.map((item) => item.textContent)).toEqual([expect.stringContaining("Office"), expect.stringContaining("Graph")]);
    expect(container.textContent).not.toContain("Mindcraft");
    expect(document.activeElement).toBe(items[0]);

    await act(async () => {
      items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      items[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("graph");
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector("[role='menu']")).toBeNull();

    await act(async () => trigger?.click());
    await act(async () => {
      container.querySelector<HTMLDivElement>("[role='menu']")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses on outside activation and restores trigger focus", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const office = worldThemeRegistry.get("office");
    if (!office) throw new Error("Office missing");
    await act(async () => root.render(
      <WorldThemeSelector
        themes={worldThemeRegistry.list()}
        activeTheme={office}
        worldActive={false}
        onActivate={() => {}}
        onSelect={() => {}}
      />,
    ));
    expect(container.querySelector(".world-theme-activate")?.getAttribute("aria-pressed"))
      .toBe("false");
    const trigger = container.querySelector<HTMLButtonElement>("[aria-haspopup='menu']");
    await act(async () => trigger?.click());
    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(container.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
