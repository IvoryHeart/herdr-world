import { describe, expect, test } from "bun:test";
import type { CliContext } from "./command";
import { runCli } from "./index";
import {
  herdrAlert,
  type OwnerAlert,
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

describe("owner alert", () => {
  const alerts: [string, string][] = [];
  const shown =
    (value: boolean, reason = value ? "shown" : "disabled"): OwnerAlert =>
    (title, body) => {
      alerts.push([title, body]);
      return { shown: value, reason };
    };
  const asked: WorldCliTransport = async () => ({
    ok: true,
    actor: { label: "claude in w1:p1", verified: true },
    result: { id: "q-1", created: true },
  });

  test("a new question alerts the owner through Herdr once", async () => {
    alerts.length = 0;
    const { context: ctx, out } = context();
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--json"],
        ctx,
        asked,
        false,
        shown(true),
      ),
    ).toBe(0);
    expect(alerts).toEqual([["claude in w1:p1 asks", "Ship? (q-1)"]]);
    expect(JSON.parse(out[0]!)).toMatchObject({
      ok: true,
      result: { id: "q-1" },
      notified: { shown: true, reason: "shown" },
    });
  });

  test("a known cause is not alerted again", async () => {
    alerts.length = 0;
    const { context: ctx } = context();
    const known: WorldCliTransport = async () => ({
      ok: true,
      result: { id: "q-1", question: "Ship?", at: 1 },
    });
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--key", "crew:7"],
        ctx,
        known,
        true,
        shown(true),
      ),
    ).toBe(0);
    expect(alerts).toEqual([]);
  });

  test("an alert nobody saw fails loudly, keeps the record and does not wait", async () => {
    alerts.length = 0;
    const { context: ctx, err } = context();
    let calls = 0;
    const transport: WorldCliTransport = async (...args) => {
      calls += 1;
      return asked(...args);
    };
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--wait"],
        ctx,
        transport,
        true,
        shown(false),
      ),
    ).toBe(WORLD_EXIT.not_delivered);
    expect(calls).toBe(1);
    expect(err).toEqual([
      "herdr-world ask: recorded q-1, but Herdr showed the owner no alert: disabled",
    ]);
  });

  test("a question World could not record still reaches the owner", async () => {
    alerts.length = 0;
    const { context: ctx, out } = context();
    const down: WorldCliTransport = async () => ({
      ok: false,
      code: "refused",
      error: "wrong World CLI token",
    });
    expect(
      await runWorldCommand(
        "ask",
        ["Ship?", "--json"],
        ctx,
        down,
        false,
        shown(true),
      ),
    ).toBe(WORLD_EXIT.refused);
    expect(alerts).toEqual([
      [
        "pane w1:p1 asks",
        "Ship? (not recorded in World: wrong World CLI token)",
      ],
    ]);
    expect(JSON.parse(out[0]!).error).toBe(
      "wrong World CLI token; the owner was alerted through Herdr",
    );
  });

  test("reads Herdr's notification reply and its failures", () => {
    const { context: ctx } = context();
    const argv: string[][] = [];
    const reply = (code: number, stdout: string) => {
      ctx.captureCommand = (command: string[]) => {
        argv.push(command);
        return { code, stdout };
      };
      return herdrAlert(ctx)("claude asks", "Ship? (q-1)");
    };
    expect(
      reply(
        0,
        '{"id":"cli:notification:show","result":{"type":"notification_show","shown":true,"reason":"shown"}}',
      ),
    ).toEqual({ shown: true, reason: "shown" });
    expect(argv[0]).toEqual([
      "herdr",
      "notification",
      "show",
      "claude asks",
      "--body",
      "Ship? (q-1)",
      "--sound",
      "request",
    ]);
    expect(
      reply(
        1,
        '{"id":"cli:notification:show","error":{"code":"server_not_running","message":"no herdr server is running"}}',
      ),
    ).toEqual({ shown: false, reason: "no herdr server is running" });
    expect(reply(127, "")).toEqual({
      shown: false,
      reason: "herdr notification show exited 127",
    });
    ctx.captureCommand = () => {
      throw new Error("ENOENT");
    };
    expect(herdrAlert(ctx)("t", "b")).toEqual({
      shown: false,
      reason: "could not run herdr: ENOENT",
    });
  });
});
