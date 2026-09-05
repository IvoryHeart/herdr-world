import { describe, expect, it, vi } from "vitest";
import {
  bridgeAddress,
  parseRemoteAccessStatus,
  type RemoteAccessStatus,
  waitForRemoteAccessReady,
} from "./remoteAccess";

describe("remote access response handling", () => {
  it("keeps host policies directional and formats IPv6 addresses safely", () => {
    const status = parseRemoteAccessStatus({
      remote_access: {
        enabled: true,
        accepted_hosts: ["[2001:db8::20]"],
        allowed_page_origins: ["https://world.example.test"],
        allowed_bridge_origins: ["http://bridge.example.test:4000"],
        password_configured: true,
      },
      port: 4000,
      suggestions: ["2001:db8::20"],
      mutation_allowed: true,
      apply: { id: null, state: "ready", reason: "bridge ready", restored: false },
    });

    expect(status.remote_access.accepted_hosts).toEqual(["[2001:db8::20]"]);
    expect(status.remote_access.allowed_page_origins).toEqual(["https://world.example.test"]);
    expect(status.remote_access.allowed_bridge_origins).toEqual(["http://bridge.example.test:4000"]);
    expect(bridgeAddress("2001:db8::20", 4000)).toBe("http://[2001:db8::20]:4000");
  });

  it("rejects malformed or unbounded controller responses", () => {
    expect(() => parseRemoteAccessStatus({})).toThrow(/malformed/iu);
    expect(() => parseRemoteAccessStatus({
      remote_access: {
        enabled: false,
        accepted_hosts: ["x".repeat(513)],
        allowed_page_origins: [],
        allowed_bridge_origins: [],
        password_configured: false,
      },
      port: 4000,
      suggestions: [],
      apply: { id: null, state: "ready" },
    })).toThrow(/malformed/iu);
  });

  it("does not accept a stale ready status before the requested policy appears", async () => {
    let allowedBridgeOrigins: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = statusResponse(allowedBridgeOrigins);
      allowedBridgeOrigins = ["http://bridge.example.test:4000"];
      return new Response(JSON.stringify(response), { status: 200 });
    });

    const status = await waitForRemoteAccessReady(
      (path) => path,
      "requested-apply",
      (next) => next.remote_access.allowed_bridge_origins.length === 1,
      100,
      0,
    );

    expect(status.remote_access.allowed_bridge_origins).toEqual([
      "http://bridge.example.test:4000",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("waits for the requested password-only apply instead of accepting an older ready state", async () => {
    const statuses = [
      statusResponse([], { id: "older-apply", state: "ready" }),
      statusResponse([], { id: "requested-apply", state: "applying" }),
      statusResponse([], { id: "requested-apply", state: "ready" }),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(JSON.stringify(statuses.shift()), { status: 200 })
    ));

    await expect(waitForRemoteAccessReady(
      (path) => path,
      "requested-apply",
      () => true,
      100,
      0,
    )).resolves.toMatchObject({ apply: { id: "requested-apply", state: "ready" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ignores an earlier failed apply while waiting for a retry", async () => {
    const statuses = [
      statusResponse([], { id: "failed-apply", state: "failed", reason: "old failure" }),
      statusResponse([], { id: "retry-apply", state: "ready" }),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(JSON.stringify(statuses.shift()), { status: 200 })
    ));

    await expect(waitForRemoteAccessReady(
      (path) => path,
      "retry-apply",
      () => true,
      100,
      0,
    )).resolves.toMatchObject({ apply: { id: "retry-apply", state: "ready" } });
  });
});

function statusResponse(
  allowedBridgeOrigins: string[],
  apply: RemoteAccessStatus["apply"] = {
    id: "requested-apply",
    state: "ready",
    reason: null,
  },
) {
  return {
    remote_access: {
      enabled: false,
      accepted_hosts: [],
      allowed_page_origins: [],
      allowed_bridge_origins: allowedBridgeOrigins,
      password_configured: false,
    },
    port: 4000,
    suggestions: [],
    mutation_allowed: true,
    apply,
  };
}
