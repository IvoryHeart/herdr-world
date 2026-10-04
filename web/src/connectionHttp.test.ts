import { describe, expect, test } from "bun:test";
import { type ConnectionClient, UncertainRequestError } from "./api";
import { connectionHttpPath, connectionHttpResource } from "./connectionHttp";

const owner: ConnectionClient = {
  connectionId: "alpha",
  generation: 1,
  serverRuntimeGeneration: 7,
  isCurrent: () => true,
  acceptsServerGeneration: (generation) => generation === 7,
  call: async () => undefined,
};

test("retirement after successful mutation decoding remains a stale context error", async () => {
  const previousFetch = globalThis.fetch;
  let current = true;
  globalThis.fetch = (async () =>
    Response.json(
      { completed: true },
      {
        headers: {
          "X-Herdr-Connection-Id": "alpha",
          "X-Herdr-Connection-Generation": "7",
        },
      },
    )) as unknown as typeof fetch;
  try {
    const error = await connectionHttpResource(
      { ...owner, isCurrent: () => current },
      "/file/upload",
      async (response) => {
        const result = await response.json();
        current = false;
        return result;
      },
      { method: "POST" },
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UncertainRequestError);
    expect((error as Error).message).toBe(
      "connection runtime generation is unavailable",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test.each(
  ["POST", "DELETE"].flatMap((method) =>
    [400, 409].map((status) => ({ method, status })),
  ),
)(
  "%j preserves a definite HTTP rejection and its server explanation",
  async ({ method, status }) => {
    const previousFetch = globalThis.fetch;
    let decoded = false;
    globalThis.fetch = (async () =>
      Response.json(
        { error: "Synthetic path is outside the workspace" },
        {
          status,
          headers: {
            "X-Herdr-Connection-Id": "alpha",
            "X-Herdr-Connection-Generation": "7",
          },
        },
      )) as unknown as typeof fetch;
    try {
      const error = await connectionHttpResource(
        owner,
        "/file/delete",
        async () => {
          decoded = true;
        },
        { method },
      ).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UncertainRequestError);
      expect((error as Error).message).toBe(
        "Synthetic path is outside the workspace",
      );
      expect(decoded).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
);

test.each(["GET", "POST"])(
  "%s distinguishes a missing HTTP response from a definite rejection",
  async (method) => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Synthetic network failure");
    }) as unknown as typeof fetch;
    try {
      const error = await connectionHttpResource(
        owner,
        "/file/upload",
        (response) => response.json(),
        { method },
      ).catch((error: unknown) => error);
      if (method === "POST")
        expect(error).toBeInstanceOf(UncertainRequestError);
      else expect(error).not.toBeInstanceOf(UncertainRequestError);
      expect((error as Error).message).toContain("Synthetic network failure");
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
);

test.each(["GET", "POST", "DELETE"])(
  "%s classifies an interrupted successful response body",
  async (method) => {
    const previousFetch = globalThis.fetch;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("Synthetic interrupted body"));
        },
      }),
      {
        headers: {
          "X-Herdr-Connection-Id": "alpha",
          "X-Herdr-Connection-Generation": "7",
        },
      },
    );
    globalThis.fetch = (async () => response) as unknown as typeof fetch;
    try {
      const error = await connectionHttpResource(
        owner,
        "/file/delete",
        (reply) => reply.json(),
        { method },
      ).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      if (method === "GET")
        expect(error).not.toBeInstanceOf(UncertainRequestError);
      else expect(error).toBeInstanceOf(UncertainRequestError);
      expect((error as Error).message).toContain("Synthetic interrupted body");
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
);

test.each(["POST", "DELETE", "GET"])(
  "%s preserves only qualified mutation uncertainty after retirement",
  async (method) => {
    const previousFetch = globalThis.fetch;
    try {
      for (const [id, generation] of [
        ["alpha", "7"],
        ["beta", "7"],
        ["alpha", "8"],
      ]) {
        let current = true;
        globalThis.fetch = (async () => {
          current = false;
          return Response.json(
            { error: "The owning runtime retired" },
            {
              status: 409,
              headers: {
                "X-Herdr-Connection-Id": id!,
                "X-Herdr-Connection-Generation": generation!,
                "X-Herdr-Request-Outcome": "uncertain",
              },
            },
          );
        }) as unknown as typeof fetch;
        const error = await connectionHttpResource(
          { ...owner, isCurrent: () => current },
          "/file/delete",
          (response) => response.json(),
          { method },
        ).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(Error);
        if (method !== "GET" && id === "alpha" && generation === "7") {
          expect(error).toBeInstanceOf(UncertainRequestError);
          expect((error as Error).message).toContain(
            "The owning runtime retired",
          );
        } else expect(error).not.toBeInstanceOf(UncertainRequestError);
      }
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
);

test("retirement during a marked rejection body preserves uncertainty", async () => {
  const previousFetch = globalThis.fetch;
  let current = true;
  const response = Response.json(
    { error: "Synthetic retired mutation" },
    {
      status: 409,
      headers: {
        "X-Herdr-Connection-Id": "alpha",
        "X-Herdr-Connection-Generation": "7",
        "X-Herdr-Request-Outcome": "uncertain",
      },
    },
  );
  const json = response.json.bind(response);
  response.json = async () => {
    current = false;
    return json();
  };
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  try {
    const error = await connectionHttpResource(
      { ...owner, isCurrent: () => current },
      "/file/upload",
      (reply) => reply.json(),
      { method: "POST" },
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(UncertainRequestError);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

describe("connection-scoped HTTP paths", () => {
  test("encodes one valid nontrivial connection path segment", () => {
    expect(connectionHttpPath("alpha:remote-1", "/upload-image")).toBe(
      "/api/connections/alpha%3Aremote-1/upload-image",
    );
    expect(connectionHttpPath("beta", "upload-image")).toBe(
      "/api/connections/beta/upload-image",
    );
  });

  test("builds exact file, session, and server-info endpoints", () => {
    expect(connectionHttpPath("beta", "/file/upload")).toBe(
      "/api/connections/beta/file/upload",
    );
    expect(connectionHttpPath("beta", "/file/delete")).toBe(
      "/api/connections/beta/file/delete",
    );
    expect(connectionHttpPath("beta", "/file/download")).toBe(
      "/api/connections/beta/file/download",
    );
    expect(connectionHttpPath("beta", "/agent-session/download")).toBe(
      "/api/connections/beta/agent-session/download",
    );
    expect(connectionHttpPath("beta", "/agent-session/atif")).toBe(
      "/api/connections/beta/agent-session/atif",
    );
    expect(connectionHttpPath("beta", "/herdr-info")).toBe(
      "/api/connections/beta/herdr-info",
    );
  });

  test("binds resource URLs to the expected runtime generation", () => {
    expect(connectionHttpPath("beta", "/file/download", 17)).toBe(
      "/api/connections/beta/file/download?connection_generation=17",
    );
    expect(() => connectionHttpPath("beta", "/file/download", -1)).toThrow(
      "invalid connection_generation",
    );
  });

  test("rejects a missing connection identity", () => {
    expect(() => connectionHttpPath("", "/upload-image")).toThrow(
      "invalid connection_id",
    );
  });
});
