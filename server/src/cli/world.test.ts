import { describe, expect, test } from "bun:test";
import type { CliContext } from "./command";
import { runCli } from "./index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { loadOrCreateSessionSecret } from "../config/session-secret";
import {
  httpTransport,
  parseWorldArgs,
  runWorldCommand,
  WORLD_EXIT,
  type WorldCliTransport,
} from "./world";
import { WORLD_SKILL } from "./world-skill";

function context() {
  const out: string[] = [];
  const err: string[] = [];
  const value = {
    version: "0.0.0-test",
    runtime: {
      platform: "linux",
      arch: "x64",
      homeDir: "/home/example",
      execPath: "/usr/bin/bun",
      argv: [],
      env: { HERDR_PANE_ID: "w1:p1" },
    },
    runCommand: () => 0,
    captureCommand: () => "",
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
  } as unknown as CliContext;
  return { context: value, out, err };
}

describe("parsing", () => {
  test("ask cause keys and withdrawal use the existing ask command", () => {
    expect(
      parseWorldArgs("ask", ["READY?", "--key", "crew:7", "--owner-only"]),
    ).toMatchObject({ command: "ask", params: { key: "crew:7" } });
    expect(
      parseWorldArgs("ask", ["withdraw", "q-example", "--json"]),
    ).toMatchObject({
      command: "ask withdraw",
      params: { id: "q-example" },
      json: true,
    });
  });

  test("each verb becomes one service command", () => {
    expect(
      parseWorldArgs("board", ["card", "pin", "me", "10,20"]),
    ).toMatchObject({
      command: "board card pin",
      params: { target: "me", x: 10, y: 20 },
    });
    expect(
      parseWorldArgs("board", ["card", "move", "tab:w1:t2", "--by=-5,3"]),
    ).toMatchObject({ params: { target: "tab:w1:t2", x: -5, y: 3 } });
    expect(
      parseWorldArgs("board", ["card", "group", "me", "--with", "pane:w1:p3"]),
    ).toMatchObject({
      command: "board card group",
      params: { with: "pane:w1:p3" },
    });
    expect(
      parseWorldArgs("board", ["card", "colour", "me", "default"]).command,
    ).toBe("colour reset");
    expect(
      parseWorldArgs("colour", ["set", "me", "teal", "--json"]),
    ).toMatchObject({
      command: "colour set",
      params: { target: "me", colour: "teal" },
      json: true,
    });
    expect(
      parseWorldArgs("town", ["desk", "move", "me", "--last", "--herdr"]),
    ).toMatchObject({ params: { onto: null, herdr: true } });
    expect(
      parseWorldArgs("ask", ["Ship?", "--options", "yes, no", "--owner-only"]),
    ).toMatchObject({
      command: "ask",
      params: { question: "Ship?", options: ["yes", "no"], owner_only: true },
    });
    expect(
      parseWorldArgs("result", ["--task", "FM-1", "Done", "--pr", "7"]),
    ).toMatchObject({ params: { task: "FM-1", summary: "Done", pr: 7 } });
    expect(parseWorldArgs("spawned-by", ["w1:p3"]).params).toEqual({
      parent: "w1:p3",
    });
  });

  test("withdrawal can recover a cause key without an ask ID", () => {
    expect(
      parseWorldArgs("ask", ["withdraw", "--key", "crew:7", "--json"]),
    ).toMatchObject({
      command: "ask withdraw",
      params: { key: "crew:7" },
      json: true,
    });
    expect(() =>
      parseWorldArgs("ask", ["withdraw", "q-example", "--key", "crew:7"]),
    ).toThrow("either");
  });

  test("bad input is a usage error", () => {
    expect(() => parseWorldArgs("board", ["card", "pin", "me"])).toThrow("X,Y");
    expect(() => parseWorldArgs("town", ["desk", "move", "me"])).toThrow(
      "--onto",
    );
    expect(() =>
      parseWorldArgs("colour", ["set", "host:studio", "red"]),
    ).toThrow("no colour");
    expect(() => parseWorldArgs("result", ["Done"])).toThrow("--task");
  });
});

describe("running", () => {
  test("a retained answered cause prints its answer in human output", async () => {
    const { context: ctx, out } = context();
    const transport: WorldCliTransport = async () => ({
      ok: true,
      result: { id: "q-example", answer: { text: "Wait" } },
    });
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--key", "crew:7"],
        ctx,
        transport,
        true,
      ),
    ).toBe(0);
    expect(out).toEqual(["Wait"]);
  });

  test("an answered withdrawal is explicit in human output", async () => {
    const { context: ctx, out } = context();
    const transport: WorldCliTransport = async () => ({
      ok: true,
      result: {
        id: "q-example",
        withdrawn: { at: 1 },
        answer: { text: "Wait" },
      },
    });
    expect(
      await runWorldCommand(
        "ask",
        ["withdraw", "q-example"],
        ctx,
        transport,
        true,
      ),
    ).toBe(0);
    expect(out).toEqual(["q-example withdrawn (answered: Wait)"]);
  });

  test("a withdrawn ask releases --wait without handing an invented answer to the agent", async () => {
    const { context: ctx, out } = context();
    let calls = 0;
    const transport: WorldCliTransport = async () => ({
      ok: true,
      actor: { label: "Example", verified: true },
      result:
        ++calls === 1
          ? { id: "q-example" }
          : { id: "q-example", withdrawn: { at: 1 } },
    });
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--wait", "--json"],
        ctx,
        transport,
      ),
    ).toBe(0);
    expect(calls).toBe(2);
    expect(JSON.parse(out[0]!).result).toEqual({
      id: "q-example",
      withdrawn: { at: 1 },
    });
  });

  test("a dismissed ask releases --wait and says so, without an answer", async () => {
    const { context: ctx, out } = context();
    let calls = 0;
    const transport: WorldCliTransport = async () => ({
      ok: true,
      actor: { label: "Example", verified: true },
      result:
        ++calls === 1
          ? { id: "q-example" }
          : { id: "q-example", dismissed: { at: 1, by: "owner" } },
    });
    expect(
      await runWorldCommand("ask", ["Ship?", "--wait"], ctx, transport, true),
    ).toBe(0);
    expect(calls).toBe(2);
    expect(out).toEqual([
      "q-example dismissed by the owner, without an answer",
    ]);
  });

  test("JSON out when piped, and exit codes from the service's answer", async () => {
    const { context: ctx, out } = context();
    const sent: unknown[] = [];
    const transport: WorldCliTransport = async (command, params) => {
      sent.push({ command, params });
      return command === "whoami"
        ? {
            ok: true,
            actor: { label: "claude in w1:p1", verified: true },
            result: {},
          }
        : { ok: false, code: "refused", error: "add --herdr" };
    };
    expect(await runWorldCommand("whoami", [], ctx, transport, false)).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({ ok: true });
    expect(
      await runWorldCommand(
        "town",
        ["desk", "move", "me", "--last"],
        ctx,
        transport,
        false,
      ),
    ).toBe(WORLD_EXIT.refused);
    expect(sent[1]).toEqual({
      command: "town desk move",
      params: { target: "me", onto: null, herdr: false },
    });
  });

  test("--wait asks again until the question is answered, or times out", async () => {
    const { context: ctx, out } = context();
    let polls = 0;
    const transport: WorldCliTransport = async (command) => {
      if (command === "ask") return { ok: true, result: { id: "q-1" } };
      polls += 1;
      return {
        ok: true,
        result: { id: "q-1", answer: polls >= 2 ? { text: "yes" } : undefined },
      };
    };
    expect(
      await runWorldCommand("ask", ["Ship?", "--wait"], ctx, transport, true),
    ).toBe(0);
    expect(out.at(-1)).toBe("yes");
    const never: WorldCliTransport = async (command) =>
      command === "ask"
        ? { ok: true, result: { id: "q-2" } }
        : { ok: true, result: { id: "q-2" } };
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--wait", "--timeout", "0.001"],
        ctx,
        never,
        false,
      ),
    ).toBe(WORLD_EXIT.timeout);
  });
});

test("--skill prints the agent guide", async () => {
  const { context: ctx, out } = context();
  expect(await runCli(["--skill"], ctx)).toBe(0);
  expect(out[0]).toBe(WORLD_SKILL);
  expect(WORLD_SKILL).toMatchSnapshot();
});

describe("service owner alert", () => {
  test("uses the service outcome without starting a CLI-side Herdr send", async () => {
    const { context: ctx, out } = context();
    ctx.captureCommand = () => {
      throw new Error("CLI must not send notifications");
    };
    const transport: WorldCliTransport = async () => ({
      ok: true,
      recorded: true,
      notified: { shown: true, reason: "shown" },
      result: { id: "q-1", created: true },
    });
    expect(
      await runWorldCommand("ask", ["Ship?", "--json"], ctx, transport, false),
    ).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({
      recorded: true,
      notified: { shown: true },
    });
  });
  test("a stored question with no confirmed alert exits not_delivered without waiting", async () => {
    const { context: ctx, err } = context();
    let calls = 0;
    const transport: WorldCliTransport = async () => {
      calls++;
      return {
        ok: true,
        recorded: true,
        notified: { shown: false, reason: "pending" },
        result: { id: "q-1", created: true },
      };
    };
    expect(
      await runWorldCommand("ask", ["Ship?", "--wait"], ctx, transport, true),
    ).toBe(WORLD_EXIT.not_delivered);
    expect(calls).toBe(1);
    expect(err).toEqual([
      "herdr-world ask: recorded q-1, but Herdr showed the owner no alert: pending",
    ]);
  });
  test("failed recording retains the single CLI fallback and exits unavailable", async () => {
    const { context: ctx, out } = context();
    const alerts: string[] = [];
    const transport: WorldCliTransport = async () => ({
      ok: false,
      code: "refused",
      recorded: false,
      notified: null,
      error: "wrong World CLI token",
    });
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--json"],
        ctx,
        transport,
        false,
        (_title, body) => {
          alerts.push(body);
          return { shown: true, reason: "shown" };
        },
      ),
    ).toBe(WORLD_EXIT.failure);
    expect(alerts).toEqual([
      "Ship? (not recorded in World: wrong World CLI token)",
    ]);
    expect(JSON.parse(out[0]!)).toMatchObject({
      recorded: false,
      notified: { shown: true },
      code: "unavailable",
    });
  });
  test("an unknown recording outcome can alert once but a confirmed stored ask never falls back", async () => {
    const { context: ctx } = context();
    let alerts = 0;
    const fallback = () => {
      alerts++;
      return { shown: true, reason: "shown" };
    };
    await runWorldCommand(
      "ask",
      ["Lost reply", "--json"],
      ctx,
      async () => ({ ok: false, code: "unavailable", error: "reply lost" }),
      false,
      fallback,
    );
    expect(alerts).toBe(1);
    await runWorldCommand(
      "ask",
      ["Stored", "--json"],
      ctx,
      async () => ({
        ok: false,
        code: "not_delivered",
        recorded: true,
        notified: { shown: false, reason: "busy" },
        result: { id: "q-stored" },
      }),
      false,
      fallback,
    );
    expect(alerts).toBe(1);
  });
  test("default fallback uses the asking pane's Herdr command and reports the recording failure", async () => {
    const { context: ctx, out } = context();
    const calls: string[][] = [];
    ctx.runtime.env.HERDR_BIN_PATH = "herdr-fixture";
    ctx.captureCommand = (argv) => {
      calls.push(argv);
      return {
        code: 0,
        stdout: JSON.stringify({ result: { shown: true, reason: "shown" } }),
      };
    };
    expect(
      await runWorldCommand(
        "ask",
        ["Reach the owner?", "--json"],
        ctx,
        async () => ({
          ok: false,
          code: "unavailable",
          recorded: false,
          error: "service is stopped",
        }),
        false,
      ),
    ).toBe(WORLD_EXIT.failure);
    expect(calls[0]).toEqual([
      "herdr-fixture",
      "notification",
      "show",
      "pane w1:p1 asks",
      "--body",
      "Reach the owner? (not recorded in World: service is stopped)",
      "--sound",
      "request",
    ]);
    expect(JSON.parse(out[0]!)).toMatchObject({
      recorded: false,
      notified: { shown: true },
    });
  });
  test("temporary service alert failure preserves its retrying evidence without a CLI duplicate", async () => {
    const { context: ctx, out } = context();
    expect(
      await runWorldCommand(
        "ask",
        ["Deferred?", "--json"],
        ctx,
        async () => ({
          ok: true,
          recorded: true,
          retrying: true,
          notified: { shown: false, reason: "busy" },
          result: { id: "q-deferred" },
        }),
        false,
        () => {
          throw new Error("A stored ask must use its service intent");
        },
      ),
    ).toBe(WORLD_EXIT.not_delivered);
    expect(JSON.parse(out[0]!)).toMatchObject({
      recorded: true,
      retrying: true,
      code: "not_delivered",
    });
  });
  test("a repeated cause uses its retained service record", async () => {
    const { context: ctx, out } = context();
    const transport: WorldCliTransport = async () => ({
      ok: true,
      recorded: true,
      notified: null,
      result: { id: "q-1", question: "Ship?", at: 1 },
    });
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--key", "fixture", "--json"],
        ctx,
        transport,
        false,
      ),
    ).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({
      recorded: true,
      notified: null,
    });
  });
  test("--wait retains the service's stored and notified outcomes", async () => {
    const { context: ctx, out } = context();
    const transport: WorldCliTransport = async (command) =>
      command === "ask"
        ? {
            ok: true,
            recorded: true,
            notified: { shown: true, reason: "shown" },
            result: { id: "q-1", created: true },
          }
        : { ok: true, result: { id: "q-1", answer: { text: "Yes" } } };
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--json", "--wait"],
        ctx,
        transport,
        false,
      ),
    ).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({
      recorded: true,
      notified: { shown: true },
      result: { answer: { text: "Yes" } },
    });
  });
});

describe("endpoint diagnostics", () => {
  test("every token or endpoint error names the service and the token's source", async () => {
    const home = mkdtempSync(join(tmpdir(), "world-cli-endpoint-"));
    const data = join(home, "data");
    const secret = join(data, "session-secret.json");
    const transport = (url: string) => {
      const { context: ctx } = context();
      ctx.runtime.homeDir = home;
      ctx.runtime.env = { HERDR_WORLD_URL: url, HERDR_WORLD_DATA_DIR: data };
      return httpTransport(ctx);
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("not json", { status: 500 }),
    });
    const answering = `http://127.0.0.1:${server.port}`;
    try {
      const missing = await transport(answering)("whoami", {});
      expect(missing.error).toContain(secret);
      expect(missing.error).toContain(answering);
      loadOrCreateSessionSecret(["synthetic-credential"], secret);
      const garbled = await transport(answering)("whoami", {});
      expect(garbled.error).toBe(
        `World service at ${answering} (token from ${secret}) answered 500 without JSON`,
      );
      // Unreachable by construction: the test keeps this port bound for its
      // whole life and closes every connection before any reply. A freed port
      // could be bound again by another process before the request.
      const refusing = createServer((socket) => socket.destroy());
      await new Promise<void>((resolve) =>
        refusing.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = refusing.address();
        if (!address || typeof address === "string")
          throw new Error("missing refusing listener port");
        const gone = `http://127.0.0.1:${address.port}`;
        const unreachable = await transport(gone)("whoami", {});
        expect(unreachable.error).toStartWith(
          `World service not reachable at ${gone} (token from ${secret}): `,
        );
      } finally {
        await new Promise((resolve) => refusing.close(resolve));
      }
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
