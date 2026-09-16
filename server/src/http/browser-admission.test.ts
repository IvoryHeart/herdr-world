import { describe, expect, test } from "bun:test";
import { browserWebSocketAdmissionError } from "./browser-admission";

function request(host: string | null, origin?: string) {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("http://internal.invalid/ws", { headers });
}

describe("browser WebSocket admission", () => {
  test("admits the application origin without a configured allow-list", () => {
    expect(
      browserWebSocketAdmissionError(
        request("localhost:8787", "http://localhost:8787"),
        "127.0.0.1",
      ),
    ).toBeNull();
    expect(
      browserWebSocketAdmissionError(
        request("world.example", "https://world.example"),
        "0.0.0.0",
      ),
    ).toBeNull();
    expect(
      browserWebSocketAdmissionError(
        request("[::1]:8787", "http://[::1]:8787"),
        "::1",
      ),
    ).toBeNull();
  });

  test("rejects cross-origin and DNS-rebound loopback requests", () => {
    expect(
      browserWebSocketAdmissionError(
        request("localhost:8787", "https://hostile.example"),
        "127.0.0.1",
      )?.status,
    ).toBe(403);
    expect(
      browserWebSocketAdmissionError(
        request("hostile.example", "https://hostile.example"),
        "127.0.0.1",
      )?.status,
    ).toBe(403);
  });

  test("rejects malformed browser authority but permits originless native clients", () => {
    expect(
      browserWebSocketAdmissionError(
        request(null, "http://localhost:8787"),
        "127.0.0.1",
      )?.status,
    ).toBe(400);
    expect(
      browserWebSocketAdmissionError(request("localhost:8787"), "127.0.0.1"),
    ).toBeNull();
  });
});
