import { describe, expect, it } from "vitest";
import { bridgeAddress, parseRemoteAccessStatus } from "./remoteAccess";

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
      apply: { state: "ready", reason: "bridge ready", restored: false },
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
      apply: { state: "ready" },
    })).toThrow(/malformed/iu);
  });
});
