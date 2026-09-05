import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allAvailableBridgeIds,
  buildHttpUrl,
  buildWsUrl,
  capabilityProbeFailure,
  capabilityProbeSuccess,
  capabilityRetryDelayMs,
  configuredBridgeConnectionKey,
  duplicateBackend,
  loadBackendStore,
  normalizeBridgeBaseUrl,
  normalizeBackendColor,
  parseBackendStore,
  parseCapabilities,
  probeBridgeBaseUrl,
  removeNoteDraftsForBridgeConnection,
  SAME_ORIGIN_BRIDGE_ID,
  sameOriginHostLabel,
} from "./bridge";
import { BridgeDiagnosticError } from "./bridgeApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bridge URL normalization", () => {
  it("normalizes origin-only bridge URLs", () => {
    expect(normalizeBridgeBaseUrl("192.0.2.20:4000")).toBe("http://192.0.2.20:4000");
    expect(normalizeBridgeBaseUrl(" http://herdr-host.local:4000/ ")).toBe(
      "http://herdr-host.local:4000",
    );
    expect(normalizeBridgeBaseUrl("https://herdr-host.local:443")).toBe(
      "https://herdr-host.local",
    );
    expect(normalizeBridgeBaseUrl("http://192.0.2.20:80")).toBe("http://192.0.2.20");
    expect(normalizeBridgeBaseUrl("http://[2001:db8::1234]:4000")).toBe(
      "http://[2001:db8::1234]:4000",
    );
    expect(normalizeBridgeBaseUrl("http://100.64.0.1:4000")).toBe("http://100.64.0.1:4000");
    expect(normalizeBridgeBaseUrl("http://8.8.8.8:4000")).toBe("http://8.8.8.8:4000");
  });

  it("rejects unsupported URL shapes", () => {
    expect(() => normalizeBridgeBaseUrl("ftp://192.0.2.20:4000")).toThrow(/http or https/iu);
    expect(() => normalizeBridgeBaseUrl("http://user@192.0.2.20:4000")).toThrow(
      /credentials/iu,
    );
    expect(() => normalizeBridgeBaseUrl("http://192.0.2.20:4000/api")).toThrow(
      /path/iu,
    );
  });
});

describe("backend colors", () => {
  it("normalizes six-digit hex colors", () => {
    expect(normalizeBackendColor("#A1b2C3")).toBe("#a1b2c3");
    expect(normalizeBackendColor(" #89B4FA ")).toBe("#89b4fa");
    expect(normalizeBackendColor("#fff")).toBeNull();
    expect(normalizeBackendColor("red")).toBeNull();
  });
});

describe("bridge URL builders", () => {
  it("builds same-origin HTTP and WebSocket URLs", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "app.local:8787" });

    expect(buildHttpUrl(null, "/api/snapshot")).toBe("/api/snapshot");
    expect(buildWsUrl(null, "/ws/events")).toBe("wss://app.local:8787/ws/events");

    vi.unstubAllGlobals();
  });

  it("builds configured HTTP and WebSocket URLs", () => {
    const query = new URLSearchParams({ terminal_id: "term-1" });

    expect(buildHttpUrl("http://192.0.2.20:4000", "/api/snapshot")).toBe(
      "http://192.0.2.20:4000/api/snapshot",
    );
    expect(buildWsUrl("http://192.0.2.20:4000", "/ws/terminal", query)).toBe(
      "ws://192.0.2.20:4000/ws/terminal?terminal_id=term-1",
    );
  });
});

describe("same-origin bridge label", () => {
  it("uses localhost for loopback browser hosts", () => {
    vi.stubGlobal("location", { hostname: "127.0.0.1" });
    expect(sameOriginHostLabel()).toBe("localhost");
  });

  it("uses the browser hostname for named hosts", () => {
    vi.stubGlobal("location", { hostname: "host01" });
    expect(sameOriginHostLabel()).toBe("host01");
  });
});

describe("backend store parsing", () => {
  it("migrates valid v1 profiles and clears invalid active ids", () => {
    expect(
      parseBackendStore({
        version: 1,
        activeBackendId: "missing",
        backends: [
          { id: "one", name: "Home", baseUrl: "http://192.0.2.20:4000" },
          { id: "bad", name: "Bad", baseUrl: "http://192.0.2.20:4000/api" },
        ],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: [SAME_ORIGIN_BRIDGE_ID],
      lastSelectedBridgeId: SAME_ORIGIN_BRIDGE_ID,
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.0.2.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
  });

  it("migrates a v1 active backend into the enabled bridge list", () => {
    expect(
      parseBackendStore({
        version: 1,
        activeBackendId: "one",
        backends: [{ id: "one", name: "Home", baseUrl: "http://192.0.2.20:4000" }],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: ["one"],
      lastSelectedBridgeId: "one",
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.0.2.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
  });

  it("keeps valid v2 enabled bridge ids only", () => {
    expect(
      parseBackendStore({
        version: 2,
        enabledBridgeIds: ["one", "missing", "one", SAME_ORIGIN_BRIDGE_ID],
        lastSelectedBridgeId: "missing",
        backends: [{ id: "one", name: "Home", baseUrl: "http://192.0.2.20:4000" }],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: ["one", SAME_ORIGIN_BRIDGE_ID],
      lastSelectedBridgeId: "one",
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.0.2.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
  });

  it("keeps valid backend colors and drops invalid colors", () => {
    expect(
      parseBackendStore({
        version: 2,
        enabledBridgeIds: ["one", "two"],
        lastSelectedBridgeId: "one",
        backends: [
          {
            id: "one",
            name: "Home",
            baseUrl: "http://192.0.2.20:4000",
            color: "#A1b2C3",
          },
          {
            id: "two",
            name: "Work",
            baseUrl: "http://192.0.2.21:4000",
            color: "red",
          },
        ],
      }).backends,
    ).toEqual([
      {
        id: "one",
        name: "Home",
        baseUrl: "http://192.0.2.20:4000",
        color: "#a1b2c3",
        lastConnectedAt: undefined,
      },
      {
        id: "two",
        name: "Work",
        baseUrl: "http://192.0.2.21:4000",
        lastConnectedAt: undefined,
      },
    ]);
  });

  it("drops saved backend profiles that use the reserved same-origin id", () => {
    expect(
      parseBackendStore({
        version: 2,
        enabledBridgeIds: [SAME_ORIGIN_BRIDGE_ID],
        lastSelectedBridgeId: SAME_ORIGIN_BRIDGE_ID,
        backends: [
          {
            id: SAME_ORIGIN_BRIDGE_ID,
            name: "Impostor",
            baseUrl: "http://192.0.2.20:4000",
          },
        ],
      }),
    ).toEqual({
      version: 2,
      enabledBridgeIds: [SAME_ORIGIN_BRIDGE_ID],
      lastSelectedBridgeId: SAME_ORIGIN_BRIDGE_ID,
      backends: [],
    });
  });

  it("migrates the legacy browser store into the v2 browser key", async () => {
    const legacyStore = {
      version: 1,
      activeBackendId: "one",
      backends: [{ id: "one", name: "Home", baseUrl: "http://192.0.2.20:4000" }],
    };
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) =>
        key === "herdrWeb.bridgeBackends.v1" ? JSON.stringify(legacyStore) : null,
      ),
      setItem,
      removeItem,
    });

    const migrated = await loadBackendStore();

    expect(migrated).toEqual({
      version: 2,
      enabledBridgeIds: ["one"],
      lastSelectedBridgeId: "one",
      backends: [
        {
          id: "one",
          name: "Home",
          baseUrl: "http://192.0.2.20:4000",
          lastConnectedAt: undefined,
        },
      ],
    });
    expect(setItem).toHaveBeenCalledWith("herdrWeb.bridgeBackends.v2", JSON.stringify(migrated));
    expect(removeItem).toHaveBeenCalledWith("herdrWeb.bridgeBackends.v1");

    vi.unstubAllGlobals();
  });

  it("detects duplicate normalized backend URLs", () => {
    const backends = [{ id: "one", name: "Home", baseUrl: "http://192.0.2.20:4000" }];

    expect(duplicateBackend(backends, "192.0.2.20:4000")?.id).toBe("one");
    expect(duplicateBackend(backends, "192.0.2.20:4000", "one")).toBeNull();
  });

  it("removes note drafts scoped to a retired backend connection", () => {
    const retained = "herdr-web:note-draft:v1:two:configured%3Atwo%3Ahttp%3A%2F%2Fold:store:session:note";
    const removed = `herdr-web:note-draft:v1:${encodeURIComponent("one")}:${encodeURIComponent(
      configuredBridgeConnectionKey("one", "http://old"),
    )}:store:session:note`;
    const storage = new Map([
      [retained, "{}"],
      [removed, "{}"],
    ]);
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });

    removeNoteDraftsForBridgeConnection("one", configuredBridgeConnectionKey("one", "http://old"));

    expect(storage.has(removed)).toBe(false);
    expect(storage.has(retained)).toBe(true);
  });
});

describe("bridge fleet coordination", () => {
  it("orders the same-origin bridge before configured bridges when enabling the fleet", () => {
    const backends = [
      { id: "office-a", name: "Office A", baseUrl: "http://office-a:4000" },
      { id: "office-b", name: "Office B", baseUrl: "http://office-b:4000" },
    ];

    expect(allAvailableBridgeIds(backends, true)).toEqual([
      SAME_ORIGIN_BRIDGE_ID,
      "office-a",
      "office-b",
    ]);
    expect(allAvailableBridgeIds(backends, false)).toEqual(["office-a", "office-b"]);
  });
});

describe("capabilities", () => {
  it("maps capability probe outcomes to connection blocking state", () => {
    const capabilities = compatibleCapabilities({ commands: ["pane.split"] });
    expect(capabilityProbeSuccess(capabilities)).toEqual({
      blocked: false,
      state: "ready",
      capabilities,
      error: null,
      retry: false,
    });
    expect(capabilityProbeSuccess(compatibleCapabilities({ web_compat: 0 }))).toEqual({
      blocked: true,
      state: "incompatible",
      capabilities: null,
      error: "This Herdr is not compatible with this web app",
      retry: false,
    });
    expect(capabilityProbeFailure(new Error("network down"))).toEqual({
      blocked: true,
      state: "offline",
      capabilities: null,
      error: "Connection unavailable",
      retry: true,
    });
  });

  it("backs off capability retry delays", () => {
    expect(capabilityRetryDelayMs(0)).toBe(1000);
    expect(capabilityRetryDelayMs(1)).toBe(2000);
    expect(capabilityRetryDelayMs(3)).toBe(8000);
    expect(capabilityRetryDelayMs(10)).toBe(10000);
  });

  it("retains bounded policy and API diagnostics for the bridge test flow", () => {
    expect(capabilityProbeFailure(new BridgeDiagnosticError("Host or Origin policy rejected the request"))).toEqual({
      blocked: true,
      state: "offline",
      capabilities: null,
      error: "Host or Origin policy rejected the request",
      retry: true,
    });
  });

  it("parses optional compatibility fields", () => {
    expect(
      parseCapabilities({
        bridge_api_version: 1,
        commands: ["pane.split", 42],
        bridge_version: "1.2.3",
        herdr_version: "0.8.2",
        terminal_protocol: 20,
        configured_label: "Build host",
        features: ["snapshot", "terminal_attach", 42],
        web_compat: 1,
        min_android_app_compat: 2,
        agent_activity: { version: 1 },
        agent_pins: { version: 1 },
        notes: { version: 1 },
      }),
    ).toEqual({
      bridge_api_version: 1,
      commands: ["pane.split"],
      bridge_version: "1.2.3",
      herdr_version: "0.8.2",
      terminal_protocol: 20,
      configured_label: "Build host",
      features: ["snapshot", "terminal_attach"],
      web_compat: 1,
      min_android_app_compat: 2,
      agent_activity: { version: 1 },
      agent_pins: { version: 1 },
      notes: { version: 1 },
    });
  });

  it("admits observability as an optional capability with its own contract version", () => {
    expect(
      parseCapabilities({
        ...compatibleCapabilities(),
        features: ["snapshot", "observability_extension"],
        observability: {
          version: 1,
          contract_version: { major: 1, minor: 0 },
          health: "unavailable",
        },
      }).observability,
    ).toEqual({
      version: 1,
      contract_version: { major: 1, minor: 0 },
      health: "unavailable",
    });
  });

  it("blocks malformed observability capability versions without blocking legacy parsing", () => {
    expect(() =>
      parseCapabilities({
        ...compatibleCapabilities(),
        observability: {
          version: 2,
          contract_version: { major: 1, minor: 0 },
          health: "available",
        },
      }),
    ).toThrow("Bridge observability capability is malformed");
  });

  it("rejects capabilities that omit the feature contract", () => {
    const missingFeatures = compatibleCapabilities();
    Reflect.deleteProperty(missingFeatures, "features");
    expect(() => parseCapabilities(missingFeatures)).toThrow(
      "Bridge capability response is malformed",
    );
  });

  it("probes configured bridge capabilities", async () => {
    const response = compatibleCapabilities({ commands: ["pane.move"] });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return new Response(
        url.endsWith("/api/capabilities")
          ? JSON.stringify(response)
          : JSON.stringify({ panes: [{ terminal_id: "terminal-test" }] }),
        { status: 200 },
      );
    });
    const sockets: string[] = [];
    vi.stubGlobal(
      "WebSocket",
      class ProbeWebSocket {
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: (() => void) | null = null;

        constructor(url: string) {
          sockets.push(url);
          queueMicrotask(() => {
            this.onopen?.();
            if (url.includes("/ws/terminal")) {
              this.onmessage?.({ data: JSON.stringify({ type: "attach_ready" }) });
            }
          });
        }

        close() {
          this.onclose?.();
        }
      },
    );

    await expect(probeBridgeBaseUrl("192.0.2.20:4000")).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.0.2.20:4000/api/capabilities",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sockets).toEqual([
      "ws://192.0.2.20:4000/ws/events",
      "ws://192.0.2.20:4000/ws/terminal?terminal_id=terminal-test&takeover=false&probe=true",
    ]);

    fetchMock.mockRestore();
  });

  it("reports terminal attach failure frames instead of treating them as ready", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return new Response(
        url.endsWith("/api/capabilities")
          ? JSON.stringify(compatibleCapabilities())
          : JSON.stringify({ panes: [{ terminal_id: "terminal-test" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal(
      "WebSocket",
      class ClosedTerminalWebSocket {
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: (() => void) | null = null;

        constructor(url: string) {
          queueMicrotask(() => {
            this.onopen?.();
            if (url.includes("/ws/terminal")) {
              this.onmessage?.({
                data: JSON.stringify({ type: "closed", reason: "terminal attach failed: terminal missing" }),
              });
            }
          });
        }

        close() {}
      },
    );

    await expect(probeBridgeBaseUrl("192.0.2.20:4000")).rejects.toThrow(
      /Connection terminal attach failed: terminal attach failed: terminal missing/iu,
    );
    fetchMock.mockRestore();
  });

  it("identifies the exact client page origin when target policy rejects it", async () => {
    vi.stubGlobal("location", { origin: "http://192.0.2.30:8791" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => (
      new Response(
        String(input).endsWith("/api/capabilities")
          ? JSON.stringify(compatibleCapabilities())
          : JSON.stringify({ error: "cross-origin requests are not allowed" }),
        { status: String(input).endsWith("/api/capabilities") ? 200 : 403 },
      )
    ));

    await expect(probeBridgeBaseUrl("192.0.2.20:4000")).rejects.toThrow(
      /Network → Allow connections → Advanced network permissions/iu,
    );
    fetchMock.mockRestore();
  });

  it("reports a WebSocket upgrade failure separately from HTTP reachability", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return new Response(
        url.endsWith("/api/capabilities")
          ? JSON.stringify(compatibleCapabilities())
          : JSON.stringify({ panes: [] }),
        { status: 200 },
      );
    });
    vi.stubGlobal(
      "WebSocket",
      class FailingWebSocket {
        onopen: (() => void) | null = null;
        onmessage: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: (() => void) | null = null;

        constructor() {
          queueMicrotask(() => this.onerror?.());
        }

        close() {}
      },
    );

    await expect(probeBridgeBaseUrl("192.0.2.20:4000")).rejects.toThrow(
      /WebSocket upgrade failed/iu,
    );
    fetchMock.mockRestore();
  });

  it("rejects incompatible configured bridge capabilities", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(compatibleCapabilities({ terminal_protocol: 16 })), {
        status: 200,
      }),
    );

    await expect(probeBridgeBaseUrl("192.0.2.20:4000")).rejects.toThrow(/protocol 16/iu);

    fetchMock.mockRestore();
  });

  it.each([19, 21])("rejects terminal protocol %s before use", async (terminalProtocol) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(compatibleCapabilities({ terminal_protocol: terminalProtocol })), {
        status: 200,
      }),
    );

    await expect(probeBridgeBaseUrl("192.0.2.20:4000")).rejects.toThrow(
      new RegExp(`protocol ${terminalProtocol}`),
    );

    fetchMock.mockRestore();
  });

  it("rejects a Herdr version below the protocol-20 floor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(compatibleCapabilities({ herdr_version: "0.8.1" })), {
        status: 200,
      }),
    );

    await expect(probeBridgeBaseUrl("192.0.2.20:4000")).rejects.toThrow(/0\.8\.2/iu);

    fetchMock.mockRestore();
  });
});

function compatibleCapabilities(overrides: Record<string, unknown> = {}) {
  return {
    bridge_api_version: 1,
    bridge_version: "0.1.0",
    herdr_version: "0.8.2",
    terminal_protocol: 20,
    features: ["snapshot", "terminal_attach"],
    commands: [],
    web_compat: 1,
    ...overrides,
  };
}
