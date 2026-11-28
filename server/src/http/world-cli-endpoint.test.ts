import { describe, expect, test } from "bun:test";
import { worldCliToken } from "../config/session-secret";
import { createAuthHandlers } from "./auth";
import { handleWorldCliEndpoint } from "./world-cli-endpoint";
import { identifyCaller, type CliHost } from "../world/world-cli-actor";

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
    processLookup: (
      _peer: unknown,
      _port: number,
      roots?: readonly number[],
    ) => (roots?.includes(8) ? [{ pid: 9, ppid: 8, pgrp: 9 }] : null),
  };
}

describe("the agent CLI endpoint", () => {
  for (const platform of ["linux", "darwin", "win32"])
    for (const runtime of ["tui", "core"])
      for (const ancestry of ["matching", "foreign", "unknown"]) {
        test(`${platform}/${runtime}/${ancestry} preserves pane authority`, async () => {
          const host: CliHost = {
            connection_id: "synthetic-tui",
            generation: 1,
            local: true,
            call: async (method) =>
              method === "pane.process_info"
                ? { process_info: { shell_pid: 8 } }
                : {
                    pane: { pane_id: "w1:p1", terminal_id: "terminal-example" },
                  },
          };
          const core = {
            terminal: "t1",
            source: {
              has: () => true,
              hosts: () => [
                {
                  connection_id: "synthetic-core",
                  generation: 1,
                  local: true,
                  isCurrent: () => true,
                  coreId: () => "synthetic-core",
                  occupant: () => ({
                    coreId: "synthetic-core",
                    pid: 8,
                    foregroundPid: null,
                    fingerprint: "example",
                  }),
                  describe: async () => null,
                },
              ],
            },
          };
          let lookups = 0;
          const response = await handleWorldCliEndpoint(
            request({}, JSON.stringify({ command: "ask" })),
            local,
            {
              ...deps(),
              platform,
              processLookup: (seenPeer, port, roots) => {
                lookups++;
                expect(seenPeer).toEqual(local);
                expect(port).toBe(8790);
                expect(roots).toEqual([8]);
                return ancestry === "unknown"
                  ? null
                  : [
                      {
                        pid: 9,
                        ppid: ancestry === "matching" ? 8 : 600,
                        pgrp: 9,
                      },
                      {
                        pid: ancestry === "matching" ? 8 : 600,
                        ppid: 1,
                        pgrp: 8,
                      },
                    ];
              },
              handle: async (_body, locate) => {
                const { actor } = await identifyCaller(
                  runtime === "tui" ? [host] : [],
                  runtime === "tui" ? "w1:p1" : undefined,
                  locate,
                  runtime === "core" ? core : undefined,
                );
                return actor.verified
                  ? { ok: true, actor, result: null }
                  : {
                      ok: false,
                      actor,
                      code: "refused",
                      error: "cause keys require a verified asking pane",
                      recorded: false,
                      notified: null,
                    };
              },
            },
          );
          const verified = platform !== "win32" && ancestry === "matching";
          expect(response.status).toBe(verified ? 200 : 403);
          const reply = await response.json();
          expect(reply.actor.verified).toBe(verified);
          expect(lookups).toBe(platform === "win32" ? 0 : 1);
          if (verified)
            expect(reply.actor.connection_id).toBe(`synthetic-${runtime}`);
          if (platform === "win32")
            expect(reply.error).toContain(
              "caller verification is unavailable on this platform",
            );
        });
      }

  for (const platform of ["linux", "darwin", "win32"]) {
    test(`${platform} uses only a supported process lookup`, async () => {
      const seen: unknown[] = [];
      let lookups = 0;
      const injected = deps(seen);
      const response = await handleWorldCliEndpoint(request(), local, {
        ...injected,
        platform,
        processLookup: (...args) => {
          lookups++;
          return injected.processLookup(...args);
        },
      });
      expect(response.status).toBe(200);
      expect(lookups).toBe(platform === "win32" ? 0 : 1);
      expect(seen).toEqual([
        {
          body: {},
          chain: platform === "win32" ? null : [{ pid: 9, ppid: 8, pgrp: 9 }],
        },
      ]);
    });
  }

  test("an unsupported platform explains a refused ask", async () => {
    const response = await handleWorldCliEndpoint(
      request(
        {},
        JSON.stringify({
          command: "ask",
          params: { question: "Continue?", key: "example" },
        }),
      ),
      local,
      {
        ...deps(),
        platform: "win32",
        handle: async () => ({
          ok: false,
          code: "refused",
          error: "cause keys require a verified asking pane",
          recorded: false,
          notified: null,
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "refused",
      recorded: false,
      notified: null,
      error: expect.stringContaining(
        "caller verification is unavailable on this platform",
      ),
    });
  });

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

test("question-cap refusals retain their typed wait response over HTTP", async () => {
  const response = await handleWorldCliEndpoint(request(), local, {
    ...deps(),
    handle: async () => ({
      ok: false as const,
      code: "question_cap" as const,
      error: "wait until a question closes before asking again",
    }),
  });
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    code: "question_cap",
    error: expect.stringContaining("wait"),
  });
});
