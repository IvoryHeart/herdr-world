import { describe, expect, test } from "bun:test";
import { worldCliToken } from "../config/session-secret";
import { createAuthHandlers } from "./auth";
import { handleWorldCliEndpoint } from "./world-cli-endpoint";

const PASSWORD = "synthetic-generated-token-0123456789abcdef";
const SESSION_SECRET = "ab".repeat(32);
const SECRET = worldCliToken(SESSION_SECRET);
const auth = () =>
  createAuthHandlers({
    authRequired: true,
    password: PASSWORD,
    sessionSecret: SESSION_SECRET,
  } as never);

const request = (headers: Record<string, string> = {}, body = "{}") =>
  new Request("http://127.0.0.1:8790/api/world/cli", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
      ...headers,
    },
    body,
  });

const local = { address: "127.0.0.1", port: 51000 };

function deps(seen: unknown[] = []) {
  const handlers = auth();
  return {
    serverPort: 8790,
    bearerAuth: handlers.bearerAuth,
    handle: async (
      body: unknown,
      locate: ((roots: readonly number[]) => unknown) | null,
    ) => {
      // The caller is searched for only when the service asks, under roots.
      seen.push({ body, chain: locate?.([8]) ?? null });
      return {
        ok: true as const,
        actor: { label: "x", verified: false },
        result: null,
      };
    },
    platform: "linux",
    callerChain: (
      _peer: unknown,
      _port: number,
      _fs?: unknown,
      roots?: readonly number[],
    ) => (roots?.includes(8) ? [{ pid: 9, ppid: 8, pgrp: 9 }] : null),
  };
}

describe("the agent CLI endpoint", () => {
  test("takes a local bearer call and hands over the caller's processes", async () => {
    const seen: unknown[] = [];
    const response = await handleWorldCliEndpoint(
      request({}, JSON.stringify({ command: "whoami" })),
      local,
      deps(seen),
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      { body: { command: "whoami" }, chain: [{ pid: 9, ppid: 8, pgrp: 9 }] },
    ]);
  });

  test("refuses other machines, browsers and wrong or missing tokens", async () => {
    const remote = await handleWorldCliEndpoint(
      request(),
      { address: "192.0.2.10", port: 51000 },
      deps(),
    );
    expect(remote.status).toBe(403);
    const browser = await handleWorldCliEndpoint(
      request({ origin: "http://127.0.0.1:8790" }),
      local,
      deps(),
    );
    expect(browser.status).toBe(403);
    const wrong = await handleWorldCliEndpoint(
      request({ authorization: "Bearer nope" }),
      local,
      deps(),
    );
    expect(wrong.status).toBe(401);
    // The login credential is not the CLI token: it cannot be used here.
    const login = await handleWorldCliEndpoint(
      request({ authorization: `Bearer ${PASSWORD}` }),
      local,
      deps(),
    );
    expect(login.status).toBe(401);
    const missing = await handleWorldCliEndpoint(
      request({ authorization: "" }),
      local,
      deps(),
    );
    expect(missing.status).toBe(401);
  });

  test("repeated wrong tokens are throttled like failed logins", async () => {
    const shared = deps();
    let last = 0;
    for (let attempt = 0; attempt < 12; attempt += 1)
      last = (
        await handleWorldCliEndpoint(
          request({ authorization: "Bearer nope" }),
          local,
          shared,
        )
      ).status;
    expect(last).toBe(429);
    // Even the right token waits out the cooldown.
    expect(
      (await handleWorldCliEndpoint(request(), local, shared)).status,
    ).toBe(429);
  });

  test("CLI failures never lock the owner out of the login page", async () => {
    const handlers = auth();
    const shared = { ...deps(), bearerAuth: handlers.bearerAuth };
    for (let attempt = 0; attempt < 12; attempt += 1)
      await handleWorldCliEndpoint(
        request({ authorization: "Bearer nope" }),
        local,
        shared,
      );
    const login = await handlers.handleLogin(
      new Request("http://127.0.0.1:8790/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      "127.0.0.1",
    );
    expect(login.status).toBe(200);
  });
});

test("refusals answer in the CLI's shape", async () => {
  const response = await handleWorldCliEndpoint(
    request({ authorization: "Bearer nope" }),
    local,
    deps(),
  );
  expect(await response.json()).toEqual({
    ok: false,
    code: "refused",
    error: "wrong World CLI token",
  });
});
