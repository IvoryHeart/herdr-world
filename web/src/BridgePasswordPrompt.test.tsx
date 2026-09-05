/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgePasswordPrompt } from "./bridge";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BridgePasswordPrompt", () => {
  it("clears and refocuses the password when the queued Herdr changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    await act(async () => root.render(
      <BridgePasswordPrompt
        name="First Herdr"
        origin="http://first.example:8787"
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    ));
    expect(container.textContent).toContain("First Herdr");
    expect(container.textContent).toContain("first.example:8787");
    const firstInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(firstInput).toBe(document.activeElement);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(firstInput, "first-password");
      firstInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);

    await act(async () => root.render(
      <BridgePasswordPrompt
        name="Second Herdr"
        origin="http://second.example:8787"
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    ));
    const secondInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(container.textContent).toContain("Second Herdr");
    expect(container.textContent).toContain("second.example:8787");
    expect(secondInput?.value).toBe("");
    expect(secondInput).toBe(document.activeElement);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);

    await act(async () => root.unmount());
  });
});
