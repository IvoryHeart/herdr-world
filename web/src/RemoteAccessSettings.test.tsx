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
  it("turns a detected address into a simple allow-connections draft", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const reloadPage = vi.fn();
    let currentStatus = remoteAccessStatus(false, ["bridge.example.test"]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ url: String(input), init });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        currentStatus = {
          ...currentStatus,
          remote_access: {
            ...body.remote_access,
            password_configured: body.password_action === "set",
          },
        };
        return new Response(JSON.stringify({ state: "applying", reason: "restarting", restored: null }), { status: 202 });
      }
      return new Response(JSON.stringify(currentStatus), { status: 200 });
    });

    const { container } = await render(
      <RemoteAccessSettings
        httpUrl={(path) => path}
        reloadPage={reloadPage}
      />,
    );
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("Allow connections");
    expect(container.textContent).toContain("They are not a list of connecting devices");
    const suggestion = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(suggestion?.checked).toBe(false);
    const share = container.querySelector<HTMLButtonElement>('[role="switch"]');
    await act(async () => share?.click());
    const password = container.querySelector<HTMLInputElement>(
      'input[aria-label="Set connection password"]',
    );
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
    await act(async () => {
      apply?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const request = requests.find(({ init }) => init?.method === "POST");
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      password_action: "set",
      password: "synthetic-password",
      remote_access: {
        enabled: true,
        accepted_hosts: ["bridge.example.test"],
      },
    });
    expect(reloadPage).toHaveBeenCalledOnce();
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
      <RemoteAccessSettings httpUrl={(path) => path} reloadPage={() => {}} />,
    );
    await act(async () => Promise.resolve());
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Change connection password"]');
    expect(password).not.toBeNull();
    await act(async () => {
      if (password) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(password, "replacement-password");
        password.dispatchEvent(new Event("input", { bubbles: true }));
        password.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="button"].btn-primary')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      password_action: "set",
      password: "replacement-password",
    });
  });

  it("supports removing password protection", async () => {
    const requests: RequestInit[] = [];
    let passwordConfigured = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        requests.push(init);
        passwordConfigured = false;
        return new Response(JSON.stringify({ state: "applying", reason: "restarting", restored: null }), { status: 202 });
      }
      return new Response(JSON.stringify(remoteAccessStatus(passwordConfigured)), { status: 200 });
    });

    const { container } = await render(
      <RemoteAccessSettings httpUrl={(path) => path} reloadPage={() => {}} />,
    );
    await act(async () => Promise.resolve());
    await act(async () => container.querySelector<HTMLButtonElement>('button.btn-danger')?.click());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[type="button"].btn-primary')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      password_action: "remove",
    });
    expect(JSON.parse(String(requests[0]?.body))).not.toHaveProperty("password");
  });

  it("allows the directly served page without requiring extra page origins", async () => {
    const requests: RequestInit[] = [];
    const status = remoteAccessStatus(false, ["bridge.example.test"], true);
    status.remote_access.allowed_page_origins = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        requests.push(init);
        return new Response(JSON.stringify({ state: "applying", reason: "restarting", restored: null }), { status: 202 });
      }
      return new Response(JSON.stringify(status), { status: 200 });
    });

    const { container } = await render(
      <RemoteAccessSettings httpUrl={(path) => path} reloadPage={() => {}} />,
    );
    await act(async () => Promise.resolve());
    const apply = container.querySelector<HTMLButtonElement>('button[type="button"].btn-primary');
    expect(apply?.disabled).toBe(false);
    await act(async () => {
      apply?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      remote_access: { enabled: true, allowed_page_origins: [] },
    });
  });
});

function remoteAccessStatus(
  passwordConfigured: boolean,
  suggestions: string[] = [],
  enabled = passwordConfigured,
) {
  return {
    remote_access: {
      enabled,
      accepted_hosts: enabled ? ["bridge.example.test"] : [],
      allowed_page_origins: ["http://world.example.test"],
      allowed_bridge_origins: [],
      password_configured: passwordConfigured,
    },
    port: 4000,
    suggestions,
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
