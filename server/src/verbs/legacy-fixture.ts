import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentAddress } from "../../../shared/groups";
import { BoardStore } from "../world/board-store";
import { WorldLedger } from "../world/world-ledger";
import {
  createWorldCli,
  WORLD_CLI_COMMANDS,
  type WorldCliCommand,
  type CliHost,
} from "../world/world-cli";
import type { WorldSnapshotResult } from "../world/snapshot";

const panes = [1, 2].map((id) => ({
  pane_id: `w1:p${id}`,
  terminal_id: `term${id}`,
  tab_id: `w1:t${id}`,
  workspace_id: "w1",
  agent: "codex",
  name: id === 1 ? "one" : "two",
}));
const tabs = panes.map((pane) => ({ tab_id: pane.tab_id, workspace_id: "w1" }));
const address = agentAddress("example", "one");
const parameters: Partial<Record<WorldCliCommand, Record<string, unknown>>> = {
  undo: { id: "missing" },
  "board card move": { target: "tab:w1:t1", x: 3, y: 4 },
  "board card pin": { target: "tab:w1:t1", x: 3, y: 4 },
  "board card unpin": { target: "tab:w1:t1" },
  "board card group": { target: "tab:w1:t1", with: "tab:w1:t2" },
  "board card ungroup": { target: "tab:w1:t1" },
  "colour set": { target: "tab:w1:t1", colour: "blue" },
  "colour reset": { target: "tab:w1:t1" },
  "town desk move": { target: "tab:w1:t1", herdr: true },
  ask: { question: "Example question?" },
  "ask get": { id: "missing" },
  "ask acknowledge": { id: "missing", occurrence: "example", attempt: 0 },
  "ask answer": { id: "missing", answer: "Example" },
  "ask withdraw": { id: "missing" },
  result: { task: "example", summary: "Example result" },
  "spawned-by": { parent: "w1:p2" },
  "group create": { kind: "pod", name: "New pod" },
  "group add": { group: "pod", agent: address },
  "group remove": { group: "pod", agent: address },
  "group lead": { group: "pod", agent: address },
  "group reviewers": { group: "pod", agents: [address] },
  "group now": { group: "pod", items: ["Example"] },
  "group show": { group: "pod" },
  "group delete": { group: "pod", confirmed: true },
  "group promote": { group: "team", name: "Promoted", mapping: [] },
  "group import": {
    confirmed: true,
    markdown:
      "| Pod | Lead | Builders | Reviewers | Now |\n| --- | --- | --- | --- | --- |\n",
  },
};

/** Outcomes recorded from the pre-registry implementation, not from policy metadata. */
export async function legacyOutcomes(factory = createWorldCli) {
  const outcomes: {
    command: string;
    verified: boolean;
    ok: boolean;
    code?: string;
    effects: string[];
  }[] = [];
  for (const verified of [true, false])
    for (const command of WORLD_CLI_COMMANDS) {
      const root = mkdtempSync(join(tmpdir(), "verb-compatibility-"));
      try {
        const effects: string[] = [];
        const board = new BoardStore(join(root, "board.json"));
        board.patch([
          {
            op: "group.create",
            id: "pod",
            kind: "pod",
            name: "Example pod",
            members: [{ ref: address, roles: ["builder"] }],
          },
          {
            op: "group.create",
            id: "team",
            kind: "team",
            name: "Example team",
          },
        ]);
        const host: CliHost = {
          connection_id: "example",
          generation: 1,
          local: true,
          call: async (method, params) => {
            if (method === "pane.process_info")
              return { process_info: { shell_pid: 100 } };
            if (method === "pane.get")
              return {
                pane: panes.find((pane) => pane.pane_id === params.pane_id),
              };
            if (method === "tab.list") return { tabs };
            effects.push(method);
            return { ok: true };
          },
        };
        const cli = factory({
          board,
          ledger: new WorldLedger(join(root, "ledger.json"), {
            persist: false,
          }),
          hosts: () => [host],
          defaultConnectionId: () => "example",
          snapshot: async () =>
            ({
              connections: [
                {
                  connection_id: "example",
                  generation: 1,
                  snapshot_generation: 1,
                  actionable: true,
                  stale: false,
                  state: "ready",
                  snapshot: {
                    workspaces: [{ workspace_id: "w1" }],
                    tabs,
                    panes,
                    agents: panes,
                  },
                },
              ],
            }) as unknown as WorldSnapshotResult,
          publishBoard: () => {},
          publishLedger: () => {},
          acknowledgeAnswer: async () => ({ acknowledged: true }),
        });
        const locate = () => [
          { pid: 200, ppid: 100, pgrp: 100 },
          { pid: 100, ppid: 1, pgrp: 100 },
        ];
        let params = parameters[command] ?? {};
        if (
          ["undo", "board card unpin", "board card ungroup"].includes(command)
        ) {
          const previous = await cli.handle(
            {
              command:
                command === "board card ungroup"
                  ? "board card group"
                  : "board card pin",
              params:
                command === "board card ungroup"
                  ? parameters["board card group"]
                  : parameters["board card pin"],
            },
            null,
          );
          if (!previous.ok)
            throw new Error("invalid compatibility precondition");
          if (command === "undo")
            params = { id: (previous.result as { id: string }).id };
        }
        if (["ask get", "ask withdraw", "ask answer"].includes(command)) {
          const previous = await cli.handle(
            {
              command: "ask",
              params: { question: "Example?" },
              caller: { pane_id: command === "ask answer" ? "w1:p2" : "w1:p1" },
            },
            locate,
          );
          if (!previous.ok) throw new Error("invalid compatibility question");
          params = { ...params, id: (previous.result as { id: string }).id };
        }
        effects.length = 0;
        const reply = await cli.handle(
          {
            command,
            params,
            ...(verified ? { caller: { pane_id: "w1:p1" } } : {}),
          },
          verified ? locate : null,
        );
        outcomes.push({
          command,
          verified,
          ok: reply.ok,
          ...(!reply.ok ? { code: reply.code } : {}),
          effects,
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  return outcomes;
}
