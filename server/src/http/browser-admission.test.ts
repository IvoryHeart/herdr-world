import { describe, expect, test } from "bun:test";
import {
  browserRequestAdmissionError,
  normalizePublicOrigin,
} from "./browser-admission";

function request(host: string | null, origin?: string) {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("http://internal.invalid/ws", { headers });
}

describe("privileged browser request admission", () => {
  test("normalizes one exact HTTP(S) proxy origin", () => {
    expect(normalizePublicOrigin(" https://world.example/ ")).toBe(
      "https://world.example",
    );
    expect(normalizePublicOrigin(undefined)).toBeUndefined();
    expect(() => normalizePublicOrigin("https://world.example/path")).toThrow(
      "public origin must be an HTTP(S) origin without a path",
    );
  });

  test("admits the application origin without a configured allow-list", () => {
    expect(
      browserRequestAdmissionError(
        request("localhost:8787", "http://localhost:8787"),
        "127.0.0.1",
      ),
    ).toBeNull();
    expect(
      browserRequestAdmissionError(
        request("world.example", "https://world.example"),
        "0.0.0.0",
      ),
    ).toBeNull();
    expect(
      browserRequestAdmissionError(
        request("[::1]:8787", "http://[::1]:8787"),
        "::1",
      ),
    ).toBeNull();
  });

  test("rejects cross-origin and DNS-rebound loopback requests", () => {
    expect(
      browserRequestAdmissionError(
        request("localhost:8787", "https://hostile.example"),
        "127.0.0.1",
      )?.status,
    ).toBe(403);
    expect(
      browserRequestAdmissionError(
        request("hostile.example", "https://hostile.example"),
        "127.0.0.1",
      )?.status,
    ).toBe(403);
  });

  test("admits only the exact configured public origin through a loopback proxy", () => {
    expect(
      browserRequestAdmissionError(
        request("world.example", "https://world.example"),
        "127.0.0.1",
        "https://world.example",
      ),
    ).toBeNull();
    expect(
      browserRequestAdmissionError(
        request("world.example", "http://world.example"),
        "127.0.0.1",
        "https://world.example",
      )?.status,
    ).toBe(403);
    expect(
      browserRequestAdmissionError(
        request("other.example", "https://other.example"),
        "127.0.0.1",
        "https://world.example",
      )?.status,
    ).toBe(403);
  });

  test("rejects malformed browser authority but permits originless native clients", () => {
    expect(
      browserRequestAdmissionError(
        request(null, "http://localhost:8787"),
        "127.0.0.1",
      )?.status,
    ).toBe(400);
    expect(
      browserRequestAdmissionError(request("localhost:8787"), "127.0.0.1"),
    ).toBeNull();
  });
});
