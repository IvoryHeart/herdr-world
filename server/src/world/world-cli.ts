import { randomUUID } from "node:crypto";
import { stampSpawn } from "../herdr/spawn-stamp";
import {
  terminalKey,
  type RelationGroup,
  type TerminalRef,
} from "../../../shared/relations";
import { deskReorderIndex } from "../../../shared/tabOrder";
import {
  cardKey,
  tabCardKey,
  TERMINAL_COLOR_NAMES,
} from "../../../shared/terminalColor";
import type { BoardDocument, BoardOp, BoardPoint } from "./board-store";
import { runsInPane, type CallerProcess } from "./caller-identity";
import type { WorldSnapshotResult } from "./snapshot";
import {
  LEDGER_LIMITS,
  RESULT_STATUSES,
  type CliActor,
  type LedgerChange,
  type ResultStatus,
  type WorldLedger,
} from "./world-ledger";

/**
 * The World service's side of the `herdr-world` agent CLI (cli/world.ts).
 * Agents change World objects themselves: Board cards and colours, desk order
 * in Town, spawn claims, questions for the owner and task results. Every
 * change is recorded with its actor and time; World-side changes can be
 * undone. Herdr changes need `herdr: true` and cannot be undone by World.
 * Nothing here merges, deletes Herdr objects or reaches outside World.
 */

/** A ready, current Herdr runtime the service can call. */
export type CliHost = {
  connection_id: string;
  generation: number;
  /** The Herdr runs on this machine, so its processes can be checked. */
  local: boolean;
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
};

export type WorldCliDeps = {
  board: {
    get(): BoardDocument;
    patch(ops: readonly BoardOp[]): BoardDocument;
  };
  ledger: WorldLedger;
  hosts(): CliHost[];
  defaultConnectionId(): string | null;
  snapshot(): Promise<WorldSnapshotResult>;
  publishBoard(revision: number): void;
  publishLedger(revision: number): void;
  now?: () => number;
};

export type WorldCliRequest = {
  command: string;
  params?: Record<string, unknown>;
  /** What the caller claims: its HERDR_PANE_ID. */
  caller?: { pane_id?: unknown };
};

export type CliErrorCode = "usage" | "refused" | "not_found" | "unavailable";

export type WorldCliResponse =
  | { ok: true; actor: CliActor; result: unknown }
  | { ok: false; code: CliErrorCode; error: string; actor?: CliActor };

export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const usage = (message: string): never => {
  throw new CliError("usage", message);
};
const refused = (message: string): never => {
  throw new CliError("refused", message);
};
const notFound = (message: string): never => {
  throw new CliError("not_found", message);
};

/** The commands the endpoint accepts, as the CLI spells them. */
export const WORLD_CLI_COMMANDS = [
  "whoami",
  "ls",
  "history",
  "undo",
  "board card move",
  "board card pin",
  "board card unpin",
  "board card group",
  "board card ungroup",
  "colour set",
  "colour reset",
  "town desk move",
  "ask",
  "ask get",
  "ask answer",
  "result",
  "result ls",
  "spawned-by",
] as const;
export type WorldCliCommand = (typeof WORLD_CLI_COMMANDS)[number];

/* ---------- Identity ---------- */

export const OWNER_TERMINAL = "owner's terminal";

/**
 * Who is calling. Without HERDR_PANE_ID the caller is a plain shell, shown as
 * the owner's terminal. With one, the claim is verified only when the calling
 * process runs in that pane of a local Herdr; otherwise it is labelled
 * unverified and acts on the default host.
 */
export async function identifyCaller(
  hosts: readonly CliHost[],
  paneId: string | undefined,
  chain: readonly CallerProcess[] | null,
): Promise<{ actor: CliActor; host?: CliHost }> {
  if (!paneId) return { actor: { label: OWNER_TERMINAL, verified: false } };
  if (chain?.length)
    for (const host of hosts) {
      if (!host.local) continue;
      const info = (await host
        .call("pane.process_info", { pane_id: paneId })
        .catch(() => null)) as { process_info?: unknown } | null;
      if (!runsInPane(chain, info?.process_info as never)) continue;
      const pane = (
        (await host
          .call("pane.get", { pane_id: paneId })
          .catch(() => null)) as {
          pane?: Record<string, unknown>;
        } | null
      )?.pane;
      const agent = typeof pane?.agent === "string" ? pane.agent : undefined;
      return {
        actor: {
          label: `${agent ?? "terminal"} in ${paneId}`,
          verified: true,
          connection_id: host.connection_id,
          pane_id: paneId,
          ...(typeof pane?.terminal_id === "string"
            ? { terminal_id: pane.terminal_id }
            : {}),
          ...(agent ? { agent } : {}),
        },
        host,
      };
    }
  return {
    actor: { label: `unverified ${paneId}`, verified: false, pane_id: paneId },
  };
}

/* ---------- Targets ---------- */

type Topology = {
  host: CliHost;
  workspaces: Record<string, unknown>[];
  tabs: Record<string, unknown>[];
  panes: Record<string, unknown>[];
};

type Target =
  | { kind: "workspace"; id: string }
  | { kind: "tab"; id: string; workspace_id: string }
  | {
      kind: "pane";
      id: string;
      tab_id: string;
      workspace_id: string;
      terminal_id: string;
    };

const str = (value: unknown) => (typeof value === "string" ? value : "");

function resolveTarget(
  spec: unknown,
  topology: Topology,
  actor: CliActor,
): Target {
  if (typeof spec !== "string" || !spec) usage("name a target");
  const target = spec as string;
  if (target === "me") {
    if (!actor.verified || !actor.pane_id)
      refused("`me` needs a verified pane; run this inside a Herdr pane");
    return resolveTarget(`pane:${actor.pane_id}`, topology, actor);
  }
  const at = target.indexOf(":");
  const kind = target.slice(0, at);
  const id = target.slice(at + 1);
  if (at < 0 || !id)
    usage(`target ${target}: use me, pane:ID, tab:ID or workspace:ID`);
  if (kind === "workspace") {
    if (!topology.workspaces.some((entry) => entry.workspace_id === id))
      notFound(`no workspace ${id}`);
    return { kind, id };
  }
  if (kind === "tab") {
    const tab = topology.tabs.find((entry) => entry.tab_id === id);
    if (!tab) notFound(`no tab ${id}`);
    return { kind, id, workspace_id: str(tab!.workspace_id) };
  }
  if (kind === "pane") {
    const pane = topology.panes.find((entry) => entry.pane_id === id);
    if (!pane) notFound(`no pane ${id}`);
    return {
      kind,
      id,
      tab_id: str(pane!.tab_id),
      workspace_id: str(pane!.workspace_id),
      terminal_id: str(pane!.terminal_id),
    };
  }
  return usage(`target ${target}: use me, pane:ID, tab:ID or workspace:ID`);
}

/** The Board card (and colour) key of a target: a pane means its tab. */
function cardKeyOf(target: Target, topology: Topology) {
  const connection = topology.host.connection_id;
  if (target.kind === "workspace") return cardKey(connection, target.id);
  const workspaceIds = new Set(
    topology.workspaces.map((entry) => str(entry.workspace_id)),
  );
  return tabCardKey(
    connection,
    target.kind === "tab" ? target.id : target.tab_id,
    workspaceIds,
  );
}

/** The terminal a target groups by: a pane's, or a tab's agent first. */
function terminalOf(target: Target, topology: Topology): TerminalRef {
  const connection_id = topology.host.connection_id;
  if (target.kind === "pane")
    return { connection_id, terminal_id: target.terminal_id };
  if (target.kind === "workspace")
    return refused("group panes or tabs, not workspaces");
  const panes = topology.panes
    .filter((pane) => pane.tab_id === target.id)
    .sort((a, b) => Number(Boolean(b.agent)) - Number(Boolean(a.agent)));
  if (!panes[0]?.terminal_id) notFound(`tab ${target.id} has no terminal`);
  return { connection_id, terminal_id: str(panes[0]!.terminal_id) };
}

/* ---------- Board changes and their undo ---------- */

function point(params: Record<string, unknown>, name = "point"): BoardPoint {
  const x = Number(params.x);
  const y = Number(params.y);
  if (!Number.isFinite(x) || !Number.isFinite(y))
    usage(`${name} needs numbers x and y`);
  return { x, y };
}

function groupOf(groups: readonly RelationGroup[], ref: TerminalRef) {
  return groups.find((group) =>
    group.members.some((member) => terminalKey(member) === terminalKey(ref)),
  );
}

/** Ops that put `ref` back where it was among `before`'s groups. */
function restoreGroup(
  before: readonly RelationGroup[],
  ref: TerminalRef,
): BoardOp[] {
  const ops: BoardOp[] = [{ op: "group.leave", members: [ref] }];
  const previous = groupOf(before, ref);
  const mate = previous?.members.find(
    (member) => terminalKey(member) !== terminalKey(ref),
  );
  if (previous && mate)
    ops.push({
      op: "group.join",
      id: `g-${randomUUID()}`,
      members: [ref],
      target: [mate],
    });
  return ops;
}

type Planned = { ops: BoardOp[]; undo: BoardOp[]; summary: string };

function planBoard(
  command: WorldCliCommand,
  params: Record<string, unknown>,
  document: BoardDocument,
  topology: Topology,
  actor: CliActor,
): Planned {
  const target = resolveTarget(params.target, topology, actor);
  const key = cardKeyOf(target, topology);
  const pinned = document.layout.pinned[key];
  switch (command) {
    case "board card pin": {
      const at = point(params);
      return {
        ops: [{ op: "layout.set", pinned: { [key]: at } }],
        undo: pinned
          ? [{ op: "layout.set", pinned: { [key]: pinned } }]
          : [{ op: "layout.set", unpinned: [key] }],
        summary: `pinned ${key} at ${at.x},${at.y}`,
      };
    }
    case "board card unpin":
      if (!pinned) refused(`${key} is not pinned`);
      return {
        ops: [{ op: "layout.set", unpinned: [key] }],
        undo: [{ op: "layout.set", pinned: { [key]: pinned! } }],
        summary: `unpinned ${key}`,
      };
    case "board card move": {
      const by = point(params, "move --by");
      if (pinned) {
        const at = { x: pinned.x + by.x, y: pinned.y + by.y };
        return {
          ops: [{ op: "layout.set", pinned: { [key]: at } }],
          undo: [{ op: "layout.set", pinned: { [key]: pinned } }],
          summary: `moved pinned ${key} to ${at.x},${at.y}`,
        };
      }
      const offset = document.layout.offsets[key] ?? { x: 0, y: 0 };
      return {
        ops: [
          {
            op: "layout.set",
            offsets: { [key]: { x: offset.x + by.x, y: offset.y + by.y } },
          },
        ],
        undo: [{ op: "layout.set", offsets: { [key]: offset } }],
        summary: `moved ${key} by ${by.x},${by.y}`,
      };
    }
    case "colour set":
    case "colour reset": {
      const colour = command === "colour set" ? params.colour : null;
      if (colour !== null && !TERMINAL_COLOR_NAMES.includes(colour as never))
        usage(`colour: one of ${TERMINAL_COLOR_NAMES.join(", ")}`);
      const before = document.layout.colors[key] ?? null;
      return {
        ops: [{ op: "card.color", key, color: colour as never }],
        undo: [{ op: "card.color", key, color: before }],
        summary: colour ? `coloured ${key} ${colour}` : `reset ${key}'s colour`,
      };
    }
    case "board card group": {
      const ref = terminalOf(target, topology);
      const mate = terminalOf(
        resolveTarget(params.with, topology, actor),
        topology,
      );
      if (terminalKey(ref) === terminalKey(mate))
        refused("a card cannot group with itself");
      return {
        ops: [
          {
            op: "group.join",
            id: `g-${randomUUID()}`,
            members: [ref],
            target: [mate],
          },
        ],
        undo: restoreGroup(document.relations.groups, ref),
        summary: `grouped ${key} with ${String(params.with)}`,
      };
    }
    case "board card ungroup": {
      const ref = terminalOf(target, topology);
      if (!groupOf(document.relations.groups, ref))
        refused(`${key} is in no group`);
      const previous = groupOf(document.relations.groups, ref)!;
      const mate = previous.members.find(
        (member) => terminalKey(member) !== terminalKey(ref),
      )!;
      return {
        ops: [{ op: "group.leave", members: [ref] }],
        undo: [
          {
            op: "group.join",
            id: `g-${randomUUID()}`,
            members: [ref],
            target: [mate],
          },
        ],
        summary: `ungrouped ${key}`,
      };
    }
    default:
      return usage(`unknown command ${command}`);
  }
}

/* ---------- The endpoint ---------- */

const BOARD_COMMANDS = new Set<WorldCliCommand>([
  "board card move",
  "board card pin",
  "board card unpin",
  "board card group",
  "board card ungroup",
  "colour set",
  "colour reset",
]);

const ASK_WAIT_MAX_MS = 25_000;

export function createWorldCli(deps: WorldCliDeps) {
  const now = deps.now ?? Date.now;

  const record = (
    actor: CliActor,
    command: string,
    summary: string,
    undo: BoardOp[] | null,
  ) => {
    const id = deps.ledger.nextId("c");
    const change: LedgerChange = {
      id,
      at: now(),
      actor,
      command,
      summary,
      undo,
    };
    deps.publishLedger(
      deps.ledger.update((document) => document.changes.push(change)),
    );
    return change;
  };

  const patchBoard = (ops: BoardOp[]) => {
    const document = deps.board.patch(ops);
    deps.publishBoard(document.revision);
  };

  /** The host a command acts on, with its live topology. */
  const topologyFor = async (
    host: CliHost | undefined,
    params: Record<string, unknown>,
  ): Promise<Topology> => {
    const hosts = deps.hosts();
    const wanted =
      typeof params.connection === "string" && params.connection
        ? params.connection
        : (host?.connection_id ?? deps.defaultConnectionId());
    const chosen = hosts.find((entry) => entry.connection_id === wanted);
    if (!chosen)
      throw new CliError(
        "unavailable",
        `host ${wanted ?? "(none)"} is not connected`,
      );
    const snapshot = (await deps.snapshot()).connections.find(
      (entry) => entry.connection_id === chosen.connection_id,
    );
    if (
      !snapshot?.snapshot ||
      snapshot.stale ||
      !snapshot.actionable ||
      snapshot.snapshot_generation !== chosen.generation
    )
      throw new CliError(
        "unavailable",
        `host ${chosen.connection_id} has no current topology`,
      );
    return {
      host: chosen,
      workspaces: snapshot.snapshot.workspaces,
      tabs: snapshot.snapshot.tabs,
      panes: snapshot.snapshot.panes,
    };
  };

  async function run(
    command: WorldCliCommand,
    params: Record<string, unknown>,
    actor: CliActor,
    host: CliHost | undefined,
  ): Promise<unknown> {
    if (BOARD_COMMANDS.has(command)) {
      const topology = await topologyFor(host, params);
      const plan = planBoard(
        command,
        params,
        deps.board.get(),
        topology,
        actor,
      );
      patchBoard(plan.ops);
      return record(actor, command, plan.summary, plan.undo);
    }
    switch (command) {
      case "whoami":
        return actor;
      case "ls": {
        const snapshot = await deps.snapshot();
        return snapshot.connections.map((connection) => ({
          connection_id: connection.connection_id,
          label: connection.label,
          current: connection.actionable && !connection.stale,
          workspaces: (connection.snapshot?.workspaces ?? []).map((ws) => ({
            workspace_id: ws.workspace_id,
            label: ws.label,
            tabs: (connection.snapshot?.tabs ?? [])
              .filter((tab) => tab.workspace_id === ws.workspace_id)
              .map((tab) => ({
                tab_id: tab.tab_id,
                label: tab.label,
                panes: (connection.snapshot?.panes ?? [])
                  .filter((pane) => pane.tab_id === tab.tab_id)
                  .map((pane) => ({
                    pane_id: pane.pane_id,
                    ...(pane.agent ? { agent: pane.agent } : {}),
                    status: pane.agent_status,
                  })),
              })),
          })),
        }));
      }
      case "history": {
        const by = typeof params.actor === "string" ? params.actor : "";
        const limit = Math.min(500, Math.max(1, Number(params.limit) || 50));
        return deps.ledger
          .get()
          .changes.filter(
            (change) =>
              !by ||
              change.actor.label === by ||
              change.actor.pane_id === by ||
              change.actor.agent === by,
          )
          .slice(-limit);
      }
      case "undo": {
        const id = typeof params.id === "string" ? params.id : usage("undo ID");
        const change = deps.ledger.get().changes.find((c) => c.id === id);
        if (!change) notFound(`no change ${id}`);
        if (change!.undone_by)
          refused(`${id} was already undone by ${change!.undone_by}`);
        if (!change!.undo)
          refused(
            `${id} changed Herdr, which World cannot take back; make the opposite change instead`,
          );
        patchBoard(change!.undo!);
        const undone = record(actor, "undo", `undid ${id}`, null);
        deps.publishLedger(
          deps.ledger.update((document) => {
            const entry = document.changes.find((c) => c.id === id);
            if (entry) entry.undone_by = undone.id;
          }),
        );
        return undone;
      }
      case "town desk move": {
        if (params.herdr !== true)
          refused("moving a desk changes Herdr's tab order; add --herdr");
        const topology = await topologyFor(host, params);
        const target = resolveTarget(params.target, topology, actor);
        if (target.kind === "workspace")
          return usage("move a tab or a pane's tab");
        const tabId = target.kind === "tab" ? target.id : target.tab_id;
        const onto =
          params.onto === undefined || params.onto === null
            ? null
            : resolveTarget(params.onto, topology, actor);
        const ontoTab =
          onto === null
            ? null
            : onto.kind === "tab"
              ? onto.id
              : onto.kind === "pane"
                ? onto.tab_id
                : usage("--onto a tab or pane");
        const listed = (await topology.host.call("tab.list", {})) as {
          tabs?: { tab_id: string; workspace_id: string }[];
        };
        const tabs = listed?.tabs ?? [];
        const workspace = tabs.find(
          (tab) => tab.tab_id === tabId,
        )?.workspace_id;
        const order = tabs
          .filter((tab) => tab.workspace_id === workspace)
          .map((tab) => tab.tab_id);
        if (ontoTab !== null && !order.includes(ontoTab))
          refused("desks reorder only within one room");
        const insert = deskReorderIndex(order, tabId, ontoTab);
        if (insert === undefined) notFound(`tab ${tabId} changed; try again`);
        if (insert !== null)
          await topology.host.call("tab.move", {
            tab_id: tabId,
            insert_index: insert,
          });
        return record(
          actor,
          command,
          insert === null
            ? `left ${tabId} in place`
            : `moved ${tabId} ${ontoTab ? `into ${ontoTab}'s place` : "last"} (Herdr)`,
          null,
        );
      }
      case "ask": {
        const question = text(params.question, "the question");
        const options = Array.isArray(params.options)
          ? params.options.map((option) =>
              text(option, "an option", LEDGER_LIMITS.option),
            )
          : [];
        if (options.length > LEDGER_LIMITS.options)
          usage(`at most ${LEDGER_LIMITS.options} options`);
        const id = deps.ledger.nextId("q");
        deps.publishLedger(
          deps.ledger.update((document) =>
            document.asks.push({
              id,
              at: now(),
              actor,
              question,
              options,
              owner_only: params.owner_only === true,
            }),
          ),
        );
        return { id };
      }
      case "ask get": {
        const id = text(params.id, "the question ID");
        const wait = Math.min(
          ASK_WAIT_MAX_MS,
          Math.max(0, Number(params.wait_ms) || 0),
        );
        const until = now() + wait;
        let ask = deps.ledger.get().asks.find((entry) => entry.id === id);
        // Hold the call a while (the CLI's --wait asks again), not forever.
        while (ask && !ask.answer && now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          ask = deps.ledger.get().asks.find((entry) => entry.id === id);
        }
        return ask ?? notFound(`no question ${id}`);
      }
      case "ask answer": {
        const id = text(params.id, "the question ID");
        const answer = text(params.answer, "the answer");
        const ask = deps.ledger.get().asks.find((entry) => entry.id === id);
        if (!ask) notFound(`no question ${id}`);
        if (ask!.owner_only) refused("only the owner answers this, in World");
        if (ask!.answer) refused(`${id} is already answered`);
        deps.publishLedger(
          answerAsk(deps.ledger, id, answer, actor.label, now()),
        );
        return deps.ledger.get().asks.find((entry) => entry.id === id);
      }
      case "result": {
        const status = (params.status ?? "done") as ResultStatus;
        if (!RESULT_STATUSES.includes(status))
          usage(`status: one of ${RESULT_STATUSES.join(", ")}`);
        const pr =
          params.pr === undefined
            ? undefined
            : Number.isInteger(params.pr) && (params.pr as number) > 0
              ? (params.pr as number)
              : usage("--pr takes a pull request number");
        const id = deps.ledger.nextId("r");
        const entry = {
          id,
          at: now(),
          actor,
          task: text(params.task, "--task", LEDGER_LIMITS.task),
          summary: text(params.summary, "the summary"),
          status,
          ...(pr ? { pr } : {}),
        };
        deps.publishLedger(
          deps.ledger.update((document) => document.results.push(entry)),
        );
        return entry;
      }
      case "result ls": {
        const task = typeof params.task === "string" ? params.task : "";
        return deps.ledger
          .get()
          .results.filter((entry) => !task || entry.task === task);
      }
      case "spawned-by": {
        if (!actor.verified || !host || !actor.pane_id)
          refused(
            "a spawn claim needs a verified pane; run it inside the child's Herdr pane",
          );
        const parent = text(params.parent, "the parent pane");
        try {
          await stampSpawn(
            (method, p) => host!.call(method, p),
            actor.pane_id!,
            parent,
          );
        } catch (error) {
          refused((error as Error).message);
        }
        return record(
          actor,
          command,
          `${actor.pane_id} spawned by ${parent} (Herdr metadata)`,
          null,
        );
      }
      default:
        return usage(`unknown command ${command}`);
    }
  }

  return {
    /** Handle one CLI request from a caller whose process chain is known (or null). */
    async handle(
      request: WorldCliRequest,
      chain: readonly CallerProcess[] | null,
    ): Promise<WorldCliResponse> {
      let actor: CliActor | undefined;
      try {
        const command = request?.command;
        if (!WORLD_CLI_COMMANDS.includes(command as WorldCliCommand))
          usage(`unknown command ${String(command)}`);
        const params =
          request.params && typeof request.params === "object"
            ? request.params
            : {};
        const paneId =
          typeof request.caller?.pane_id === "string" &&
          request.caller.pane_id.trim()
            ? request.caller.pane_id.trim()
            : undefined;
        const identity = await identifyCaller(deps.hosts(), paneId, chain);
        actor = identity.actor;
        const result = await run(
          command as WorldCliCommand,
          params,
          actor,
          identity.host,
        );
        return { ok: true, actor, result };
      } catch (error) {
        if (error instanceof CliError)
          return { ok: false, code: error.code, error: error.message, actor };
        // Board validation and Herdr refusals are the caller's to fix.
        return {
          ok: false,
          code: "refused",
          error: (error as Error).message,
          actor,
        };
      }
    },
  };
}

function text(value: unknown, what: string, max = LEDGER_LIMITS.text): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    usage(`${what} must be text of at most ${max} characters`);
  return (value as string).trim();
}

/** Record an answer; returns the ledger revision. Used by the CLI and by World. */
export function answerAsk(
  ledger: WorldLedger,
  id: string,
  answer: string,
  by: string,
  at: number,
) {
  return ledger.update((document) => {
    const ask = document.asks.find((entry) => entry.id === id);
    if (!ask) throw new CliError("not_found", `no question ${id}`);
    if (ask.answer) throw new CliError("refused", `${id} is already answered`);
    ask.answer = { text: answer, at, by };
  });
}
