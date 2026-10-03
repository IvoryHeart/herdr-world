import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionClient } from "./api";
import { uploadTerminalImage } from "./terminalImageUpload";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const client = {
  connectionId: "conn-a",
  generation: 1,
  serverRuntimeGeneration: 3,
  call: async () => undefined,
  isCurrent: () => true,
  acceptsServerGeneration: () => true,
} satisfies ConnectionClient;
const image = new File(["image"], "image.png", { type: "image/png" });

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://studio.example" } },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
});

describe("terminal image upload responses", () => {
  test("a sibling host's successful upload reply cannot provide a path to this terminal", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { path: "/synthetic/beta-image.png" },
        {
          headers: {
            "X-Herdr-Connection-Id": "conn-b",
            "X-Herdr-Connection-Generation": "3",
          },
        },
      )) as unknown as typeof fetch;
    await expect(uploadTerminalImage(client, image)).rejects.toThrow();
  });

  test("runtime retirement during delayed JSON decoding rejects the uploaded path", async () => {
    let current = true;
    const body = Promise.withResolvers<unknown>();
    const decoding = Promise.withResolvers<void>();
    const response = Response.json(
      {},
      {
        headers: {
          "X-Herdr-Connection-Id": "conn-a",
          "X-Herdr-Connection-Generation": "3",
        },
      },
    );
    response.json = () => {
      decoding.resolve();
      return body.promise;
    };
    globalThis.fetch = (async () => response) as unknown as typeof fetch;
    const pending = uploadTerminalImage(
      { ...client, isCurrent: () => current },
      image,
    );
    await decoding.promise;
    current = false;
    body.resolve({ path: "/synthetic/retired.png" });
    await expect(pending).rejects.toThrow("connection changed during upload");
  });
  test("returns a validated path", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { path: "/tmp/image.png" },
        {
          headers: {
            "X-Herdr-Connection-Id": "conn-a",
            "X-Herdr-Connection-Generation": "3",
          },
        },
      )) as unknown as typeof fetch;

    await expect(uploadTerminalImage(client, image)).resolves.toBe(
      "/tmp/image.png",
    );
  });

  test("rejects malformed JSON instead of silently continuing", async () => {
    globalThis.fetch = (async () =>
      new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(uploadTerminalImage(client, image)).rejects.toThrow();
  });

  test("surfaces non-JSON HTTP error bodies", async () => {
    globalThis.fetch = (async () =>
      new Response("proxy authentication required", {
        status: 407,
        statusText: "Proxy Authentication Required",
      })) as unknown as typeof fetch;

    await expect(uploadTerminalImage(client, image)).rejects.toThrow(
      "proxy authentication required",
    );
  });

  test("uses structured errors from failed JSON responses", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: "image is too large" },
        { status: 413, statusText: "Payload Too Large" },
      )) as unknown as typeof fetch;

    await expect(uploadTerminalImage(client, image)).rejects.toThrow(
      "image is too large",
    );
  });

  test("rejects successful responses without a path", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        {},
        {
          headers: {
            "X-Herdr-Connection-Id": "conn-a",
            "X-Herdr-Connection-Generation": "3",
          },
        },
      )) as unknown as typeof fetch;

    await expect(uploadTerminalImage(client, image)).rejects.toThrow(
      "image upload response did not include a path",
    );
  });
});
