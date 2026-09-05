import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBridgeSession, setBridgePasswordPromptHandler } from "./bridgeApi";
import { fetchWithTimeout } from "./fetchWithTimeout";

afterEach(() => {
  clearBridgeSession("http://localhost");
  setBridgePasswordPromptHandler(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("aborts a fetch after the timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchWithTimeout("/api/snapshot", { timeoutMs: 25 });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("respects caller abort signals", async () => {
    vi.useFakeTimers();
    const callerController = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchWithTimeout("/api/snapshot", {
      signal: callerController.signal,
      timeoutMs: 5000,
    });
    const rejection = expect(pending).rejects.toBe("cancelled by caller");
    callerController.abort("cancelled by caller");

    await rejection;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not spend the network timeout while waiting for a password prompt", async () => {
    let authenticated = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        authenticated = true;
        return new Response(JSON.stringify({ token: "t".repeat(64) }), { status: 200 });
      }
      return new Response(null, { status: authenticated ? 200 : 401 });
    }));
    setBridgePasswordPromptHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "synthetic-password";
    });

    await expect(fetchWithTimeout("http://localhost/api/snapshot", { timeoutMs: 5 }))
      .resolves.toHaveProperty("status", 200);
  });
});
