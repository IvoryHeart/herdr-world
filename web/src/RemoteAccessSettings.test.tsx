/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteAccessSettings } from "./RemoteAccessSettings";

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("RemoteAccessSettings", () => {
  it("supports unchecked suggestions, a draft, and password apply actions", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ url: String(input), init });
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ state: "applying", reason: "restarting", restored: null }), { status: 202 });
      }
      return new Response(JSON.stringify({
        remote_access: {
          enabled: false,
          accepted_hosts: [],
          allowed_page_origins: ["http://world.example.test"],
          allowed_bridge_origins: [],
          password_configured: false,
        },
        port: 4000,
        suggestions: ["bridge.example.test"],
        mutation_allowed: true,
        apply: { state: "ready", reason: null, restored: null },
      }), { status: 200 });
    });

    const { container } = await render(
      <RemoteAccessSettings
        httpUrl={(path) => path}
        backends={[{ id: "bridge", name: "Bridge", baseUrl: "http://bridge.example.test:4000" }]}
      />,
    );
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Direct network access");
    const suggestion = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(suggestion?.checked).toBe(false);
    await act(async () => suggestion?.click());
    const password = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(password).not.toBeNull();
    await act(async () => {
      if (password) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(password, "synthetic-password");
        password.dispatchEvent(new Event("input", { bubbles: true }));
        password.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const apply = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Apply"));
    await act(async () => apply?.click());
    const request = requests.find(({ init }) => init?.method === "POST");
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      password_action: "set",
      password: "synthetic-password",
    });
  });

  it("supports changing a password without persisting it in the draft", async () => {
    const requests: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        requests.push(init);
        return new Response(JSON.stringify({ state: "applying", reason: "restarting", restored: null }), { status: 202 });
      }
      return new Response(JSON.stringify(remoteAccessStatus(true)), { status: 200 });
    });

    const { container } = await render(
      <RemoteAccessSettings httpUrl={(path) => path} backends={[]} />,
    );
    await act(async () => Promise.resolve());
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Change bridge password"]');
    expect(password).not.toBeNull();
    await act(async () => {
      if (password) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(password, "replacement-password");
        password.dispatchEvent(new Event("input", { bubbles: true }));
        password.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => container.querySelector<HTMLButtonElement>('button[type="button"].btn-primary')?.click());
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      password_action: "set",
      password: "replacement-password",
    });
  });

  it("supports removing password protection", async () => {
    const requests: RequestInit[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        requests.push(init);
        return new Response(JSON.stringify({ state: "applying", reason: "restarting", restored: null }), { status: 202 });
      }
      return new Response(JSON.stringify(remoteAccessStatus(true)), { status: 200 });
    });

    const { container } = await render(
      <RemoteAccessSettings httpUrl={(path) => path} backends={[]} />,
    );
    await act(async () => Promise.resolve());
    await act(async () => container.querySelector<HTMLButtonElement>('button.btn-danger')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[type="button"].btn-primary')?.click());
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      password_action: "remove",
    });
    expect(JSON.parse(String(requests[0]?.body))).not.toHaveProperty("password");
  });
});

function remoteAccessStatus(passwordConfigured: boolean) {
  return {
    remote_access: {
      enabled: false,
      accepted_hosts: [],
      allowed_page_origins: ["http://world.example.test"],
      allowed_bridge_origins: [],
      password_configured: passwordConfigured,
    },
    port: 4000,
    suggestions: [],
    mutation_allowed: true,
    apply: { state: "ready", reason: null, restored: null },
  };
}

async function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return { container };
}
