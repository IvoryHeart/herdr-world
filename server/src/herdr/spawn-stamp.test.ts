import { describe, expect, test } from "bun:test";
import { runSpawnStampCommand, SPAWN_STAMP_SOURCE } from "./spawn-stamp";

const config = () =>
  ({
    socketPath: "/tmp/synthetic-herdr.sock",
    clientSocketPath: "/tmp/synthetic-herdr-client.sock",
  }) as never;

function herdr(panes: Record<string, string>) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  return {
    calls,
    createClient: () => ({
      call: async (method: string, params: Record<string, unknown> = {}) => {
        calls.push({ method, params });
        if (method === "pane.get") {
          const id = params.pane_id as string;
          if (!panes[id]) throw new Error("pane not found");
          return { pane: { pane_id: id, terminal_id: panes[id] } };
        }
        return { type: "ok" };
      },
    }),
  };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (message: string) => out.push(message),
    error: (message: string) => err.push(message),
  };
}

describe("stamp", () => {
  test("records the parent pane and its terminal on the child, with no TTL", async () => {
    const fake = herdr({ "w1:p2": "term_child", "w1:p1": "term_parent" });
    const io = capture();
    const code = await runSpawnStampCommand(["stamp", "w1:p2", "w1:p1"], "0", {
      loadConfig: config,
      createClient: fake.createClient as never,
      createTunnel: () => null,
      ...io,
    });
    expect(code).toBe(0);
    const report = fake.calls.find(
      (call) => call.method === "pane.report_metadata",
    );
    expect(report?.params).toEqual({
      pane_id: "w1:p2",
      source: SPAWN_STAMP_SOURCE,
      tokens: { spawned_by: "w1:p1", spawned_by_terminal: "term_parent" },
    });
    expect(JSON.parse(io.out[0]!)).toEqual({
      pane_id: "w1:p2",
      spawned_by: "w1:p1",
      status: "stamped",
    });
  });

  test("refuses a missing pane or a self-stamp without reporting", async () => {
    for (const args of [
      ["stamp", "w1:p2", "w1:p9"],
      ["stamp", "w1:p2", "w1:p2"],
    ]) {
      const fake = herdr({ "w1:p2": "term_child" });
      const io = capture();
      const code = await runSpawnStampCommand(args, "0", {
        loadConfig: config,
        createClient: fake.createClient as never,
        createTunnel: () => null,
        ...io,
      });
      expect(code).toBe(1);
      expect(
        fake.calls.some((call) => call.method === "pane.report_metadata"),
      ).toBe(false);
    }
  });

  test("usage errors and help never open a transport", async () => {
    const io = capture();
    const unused = () => {
      throw new Error("no transport expected");
    };
    expect(
      await runSpawnStampCommand(["stamp", "w1:p2"], "0", {
        loadConfig: unused,
        ...io,
      }),
    ).toBe(2);
    expect(
      await runSpawnStampCommand(["stamp", "--help"], "0", {
        loadConfig: unused,
        ...io,
      }),
    ).toBe(0);
    expect(io.out.join("\n")).toContain("herdr-world stamp CHILD_PANE");
    expect(await runSpawnStampCommand(["serve"], "0")).toBeNull();
  });
});
