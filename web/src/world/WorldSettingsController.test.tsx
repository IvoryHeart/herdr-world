// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BridgeRuntime } from "../bridge";
import {
  useWorldSettingsController,
  type WorldSettingsController,
} from "./WorldSettingsController";
import { writeWorldSettings } from "./worldSettings";

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("World settings controller", () => {
  it("owns the settings overlay state and runs the shared-dialog handoff", async () => {
    const onBeforeOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ControllerProbe runtimes={[]} active={false} onBeforeOpen={onBeforeOpen} />,
      );
    });
    const button = container.querySelector("button");
    expect(button?.dataset.open).toBe("false");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onBeforeOpen).toHaveBeenCalledOnce();
    expect(button?.dataset.open).toBe("true");

    await act(async () => root.unmount());
  });

  it("applies stored observability settings through the qualified runtime", async () => {
    writeWorldSettings("host-a", { prometheusUrl: "http://127.0.0.1:9101/" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        provider_id: "prometheus.otel",
        configured: true,
        endpoint: "http://127.0.0.1:9101/",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const runtime = testRuntime();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ControllerProbe runtimes={[runtime]} active={false} />);
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://host-a.test/api/extensions/observability/config");
    expect(init).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ prometheus_url: "http://127.0.0.1:9101/" }),
    });

    await act(async () => root.unmount());
  });
});

function ControllerProbe({
  runtimes,
  active,
  onBeforeOpen,
}: {
  runtimes: readonly BridgeRuntime[];
  active: boolean;
  onBeforeOpen?: () => void;
}) {
  const controller: WorldSettingsController = useWorldSettingsController({
    runtimes,
    active,
    onBeforeOpen,
  });
  return (
    <button type="button" data-open={String(controller.isOpen)} onClick={controller.open}>
      Open settings
    </button>
  );
}

function testRuntime(): BridgeRuntime {
  return {
    id: "host-a",
    mode: "configured",
    label: "Host A",
    color: "#89b4fa",
    backend: null,
    connectionKey: "connection-a",
    capabilityGeneration: 1,
    generationKey: "connection-a:1",
    resumeToken: 0,
    capabilities: { commands: [] },
    capabilityState: "ready",
    capabilityError: null,
    canConnect: true,
    httpUrl: (path) => `http://host-a.test${path}`,
    wsUrl: (path) => `ws://host-a.test${path}`,
  };
}
