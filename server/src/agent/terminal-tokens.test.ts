import { expect, test } from "bun:test";
import {
  profileTokens,
  readTerminalSettings,
  masterWinner,
  writeTerminalTokens,
  terminalSettingsMoveCall,
  type PaneRow,
} from "./terminal-tokens";

test("settings require the current terminal witness and valid tokens", () => {
  const pane = {
    terminal_id: "term_a",
    tokens: {
      world_terminal: "term_a",
      world_profile: "builder",
      world_profile_name: "Builder",
      world_master: "12",
    },
  };
  expect(readTerminalSettings(pane)).toEqual({
    profile_id: "builder",
    profile_name: "Builder",
    master: 12,
  });
  expect(readTerminalSettings({ ...pane, terminal_id: "term_b" })).toEqual({});
  expect(
    readTerminalSettings({
      ...pane,
      tokens: { ...pane.tokens, world_master: "NaN" },
    }).master,
  ).toBeUndefined();
});

test("profile names are cleaned at character boundaries before Herdr sees them", () => {
  expect(
    profileTokens("term_a", "builder", "  A\u0000" + "🐏".repeat(90) + "  ")
      .world_profile_name,
  ).toBe("A" + "🐏".repeat(79));
  expect(() => profileTokens("term_a", "BAD ID", "Builder")).toThrow();
  expect(() => profileTokens("term_a", "builder", "\n ")).toThrow();
});

test("metadata failures, invalid values and retired leases cannot report a save", async () => {
  let current = true;
  const writes: unknown[] = [];
  const lease = {
    generation: 3,
    isCurrent: () => current,
    runtime: {
      herdr: {
        call: async (method: string, params: unknown) => {
          if (method === "pane.get")
            return { pane: { pane_id: "w1:p1", terminal_id: "term_a" } };
          writes.push(params);
          throw new Error("metadata_token_limit");
        },
      },
    },
  };
  await expect(
    writeTerminalTokens(lease, "w1:p1", "term_a", {
      world_profile_name: "bad\nname",
    }),
  ).rejects.toThrow();
  expect(writes).toHaveLength(0);
  for (const value of ["", "x".repeat(81), " padded "])
    await expect(
      writeTerminalTokens(lease, "w1:p1", "term_a", {
        world_profile_name: value,
      }),
    ).rejects.toThrow();
  expect(writes).toHaveLength(0);
  await expect(
    writeTerminalTokens(lease, "w1:p1", "term_b", { world_master: "12" }),
  ).rejects.toThrow(/terminal/);
  expect(writes).toHaveLength(0);
  await expect(
    writeTerminalTokens(lease, "w1:p1", "term_a", { world_master: "12" }),
  ).rejects.toThrow(/metadata_token_limit/);
  current = false;
  await expect(
    writeTerminalTokens(lease, "w1:p1", "term_a", { world_master: "12" }),
  ).rejects.toThrow(/runtime/);
});

test("a lease retired during dispatch cannot publish a saved result", async () => {
  let current = true;
  await expect(
    writeTerminalTokens(
      {
        generation: 1,
        isCurrent: () => current,
        runtime: {
          herdr: {
            call: async (method) => {
              if (method === "pane.get")
                return { pane: { pane_id: "w1:p1", terminal_id: "term_a" } };
              current = false;
              return {};
            },
          },
        },
      },
      "w1:p1",
      "term_a",
      { world_master: "12" },
    ),
  ).rejects.toThrow(/runtime changed during write/);
});

for (const drops of [false, true])
  test(`move settings follow the terminal, restoring dropped tokens only: drops=${drops}`, async () => {
    let pane: PaneRow = {
      pane_id: "w1:p1",
      terminal_id: "term_a",
      tokens: {
        ...profileTokens("term_a", "builder", "Builder"),
        world_master: "10",
      },
    };
    const writes: Record<string, unknown>[] = [];
    const call = terminalSettingsMoveCall(
      async (method, params) => {
        if (method === "pane.list") return { panes: [structuredClone(pane)] };
        if (method === "pane.move") {
          pane = {
            ...pane,
            pane_id: "w2:p1",
            tokens: drops ? {} : pane.tokens,
          };
          return { move_result: { pane } };
        }
        if (method === "pane.get") return { pane: structuredClone(pane) };
        if (method === "pane.report_metadata") {
          writes.push(params);
          pane.tokens = {
            ...(pane.tokens as object),
            ...(params.tokens as object),
          };
          return {};
        }
        throw new Error(method);
      },
      () => true,
    );
    await call("pane.list", {});
    await call("pane.move", { pane_id: "w1:p1" });
    expect(readTerminalSettings(pane)).toMatchObject({
      profile_id: "builder",
      master: 10,
    });
    expect(writes).toHaveLength(drops ? 1 : 0);
  });

test("master ordering compares revision then terminal ID, independently of connection IDs", () => {
  const a = { connection_id: "z", terminal_id: "term_a", revision: 7 };
  const b = { connection_id: "a", terminal_id: "term_b", revision: 7 };
  expect(masterWinner([a, b])).toEqual(b);
  expect(masterWinner([b, { ...a, revision: 8 }])).toEqual({
    ...a,
    revision: 8,
  });
});

test("superseded-claim cleanup cannot erase a newer revision observed at dispatch", async () => {
  const calls: string[] = [];
  const result = await writeTerminalTokens(
    {
      generation: 1,
      isCurrent: () => true,
      runtime: {
        herdr: {
          call: async (method) => {
            calls.push(method);
            return {
              pane: {
                pane_id: "w1:p1",
                terminal_id: "term_a",
                tokens: { world_terminal: "term_a", world_master: "13" },
              },
            };
          },
        },
      },
    },
    "w1:p1",
    "term_a",
    { world_master: null },
    12,
  );
  expect(result).toBeNull();
  expect(calls).toEqual(["pane.get"]);
});
