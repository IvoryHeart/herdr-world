import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedFetch,
  bridgeWebSocketProtocols,
  clearBridgeSession,
  refreshBridgeAuthentication,
  setBridgePasswordPromptHandler,
} from "./bridgeApi";

const bridgeUrl = "http://192.0.2.20:4000";

afterEach(() => {
  clearBridgeSession(bridgeUrl);
  setBridgePasswordPromptHandler(null);
  vi.restoreAllMocks();
});

describe("authenticated bridge requests", () => {
  it("prompts once, keeps the session in memory, and retries a protected request", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/api/auth/session")) {
        return new Response(JSON.stringify({ token: "a".repeat(64) }), { status: 200 });
      }
      if (!new Headers(init?.headers).has("authorization")) {
        return new Response(JSON.stringify({ error: "password required" }), { status: 401 });
      }
      return new Response(JSON.stringify({ panes: [] }), { status: 200 });
    });
    const prompt = vi.fn(async () => "synthetic-password");
    setBridgePasswordPromptHandler(prompt);

    await expect(authenticatedFetch(`${bridgeUrl}/api/snapshot`)).resolves.toHaveProperty("status", 200);
    expect(prompt).toHaveBeenCalledOnce();
    expect(calls.map(({ url }) => url)).toEqual([
      `${bridgeUrl}/api/snapshot`,
      `${bridgeUrl}/api/auth/session`,
      `${bridgeUrl}/api/snapshot`,
    ]);
    expect(calls[1].init?.credentials).toBeUndefined();
    expect(bridgeWebSocketProtocols(`${bridgeUrl}/ws/events`)).toEqual([
      `herdr-world-auth.${"a".repeat(64)}`,
    ]);
    expect(bridgeWebSocketProtocols("ws://192.0.2.20:4000/ws/events")).toEqual([
      `herdr-world-auth.${"a".repeat(64)}`,
    ]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("clears an invalidated session and prompts again instead of staying offline", async () => {
    let snapshotRequests = 0;
    let sessions = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        sessions += 1;
        return new Response(JSON.stringify({ token: `token-${sessions}`.padEnd(32, "x") }), { status: 200 });
      }
      snapshotRequests += 1;
      if (snapshotRequests === 1 || snapshotRequests === 3) {
        return new Response(null, { status: 401 });
      }
      return new Response("{}", { status: 200 });
    });
    const prompt = vi.fn()
      .mockResolvedValueOnce("first-password")
      .mockResolvedValueOnce("second-password");
    setBridgePasswordPromptHandler(prompt);

    await authenticatedFetch(`${bridgeUrl}/api/snapshot`);
    await authenticatedFetch(`${bridgeUrl}/api/snapshot`);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(sessions).toBe(2);
  });

  it("reauthenticates after a WebSocket session expires", async () => {
    let sessionCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        sessionCount += 1;
        return new Response(JSON.stringify({ token: `token-${sessionCount}`.padEnd(32, "x") }), {
          status: 200,
        });
      }
      if (url.endsWith("/api/auth/status")) {
        return new Response(JSON.stringify({ required: true, authenticated: false }), { status: 200 });
      }
      return new Response(null, {
        status: new Headers(init?.headers).has("authorization") ? 200 : 401,
      });
    });
    const prompt = vi.fn()
      .mockResolvedValueOnce("first-password")
      .mockResolvedValueOnce("second-password");
    setBridgePasswordPromptHandler(prompt);

    await authenticatedFetch(`${bridgeUrl}/api/snapshot`);
    await expect(refreshBridgeAuthentication("ws://192.0.2.20:4000/ws/events")).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(bridgeWebSocketProtocols("ws://192.0.2.20:4000/ws/events")).toEqual([
      `herdr-world-auth.${"token-2".padEnd(32, "x")}`,
    ]);
    expect(fetchMock).toHaveBeenCalled();
  });
});
