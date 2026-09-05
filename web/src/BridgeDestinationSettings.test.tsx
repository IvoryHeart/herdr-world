/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeDestinationSettings } from "./BridgeDestinationSettings";

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("BridgeDestinationSettings", () => {
  it("allows saved Herdr addresses and reloads after the local service is ready", async () => {
    const requests: RequestInit[] = [];
    const reloadPage = vi.fn();
    let allowedBridgeOrigins: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        requests.push(init);
        const body = JSON.parse(String(init.body));
        allowedBridgeOrigins = body.remote_access.allowed_bridge_origins;
        return new Response(JSON.stringify({ state: "applying", reason: "restarting" }), {
          status: 202,
        });
      }
      return new Response(JSON.stringify(remoteAccessStatus(allowedBridgeOrigins)), { status: 200 });
    });

    const { container } = await render(
      <BridgeDestinationSettings
        httpUrl={(path) => path}
        backends={[{
          id: "remote-b",
          name: "Remote B",
          baseUrl: "http://bridge.example.test:8787",
        }]}
        reloadPage={reloadPage}
      />,
    );
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("Connection permission needed");
    const allow = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Allow saved connections"),
    );
    await act(async () => {
      allow?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      password_action: "keep",
      remote_access: {
        enabled: false,
        allowed_bridge_origins: ["http://bridge.example.test:8787"],
      },
    });
    expect(reloadPage).toHaveBeenCalledOnce();
  });
});

function remoteAccessStatus(allowedBridgeOrigins: string[]) {
  return {
    remote_access: {
      enabled: false,
      accepted_hosts: [],
      allowed_page_origins: [],
      allowed_bridge_origins: allowedBridgeOrigins,
      password_configured: true,
    },
    port: 8791,
    suggestions: ["192.0.2.20"],
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
