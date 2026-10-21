import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionClient } from "./api";
import { uploadTerminalFile, uploadTerminalImage } from "./terminalImageUpload";

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

  test("runtime retirement during delayed JSON decoding returns the qualified path for caller recovery", async () => {
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
    await expect(pending).resolves.toBe("/synthetic/retired.png");
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
      "upload response did not include a path",
    );
  });
});

describe("native file upload connection lifetime", () => {
  test("does not upload through an already stale client", async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return Response.json({ text: "/tmp/file.txt" });
    }) as unknown as typeof fetch;
    await expect(
      uploadTerminalFile({ ...client, isCurrent: () => false }, image),
    ).rejects.toThrow("connection changed during upload");
    expect(fetched).toBe(false);
  });

  test.each([200, 409])(
    "retains successful paths but rejects stale failures (HTTP %s)",
    async (status) => {
      let current = true;
      globalThis.fetch = (async () => {
        current = false;
        return Response.json(
          status === 200
            ? { text: "/tmp/old-host.txt" }
            : { error: "old error" },
          {
            status,
            headers: {
              "X-Herdr-Connection-Id": "conn-a",
              "X-Herdr-Connection-Generation": "3",
            },
          },
        );
      }) as unknown as typeof fetch;
      const result = uploadTerminalFile(
        { ...client, isCurrent: () => current },
        image,
      );
      if (status === 200)
        await expect(result).resolves.toBe("/tmp/old-host.txt");
      else
        await expect(result).rejects.toThrow(
          "connection changed during upload",
        );
    },
  );

  test("returns a successful path for caller recovery if connection changes while decoding", async () => {
    let current = true;
    globalThis.fetch = (async () => ({
      ok: true,
      headers: new Headers({
        "X-Herdr-Connection-Id": "conn-a",
        "X-Herdr-Connection-Generation": "3",
      }),
      json: async () => {
        current = false;
        return { text: "/tmp/old-host.txt" };
      },
    })) as unknown as typeof fetch;
    await expect(
      uploadTerminalFile({ ...client, isCurrent: () => current }, image),
    ).resolves.toBe("/tmp/old-host.txt");
  });
});
