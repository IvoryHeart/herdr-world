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
import {
  paneRoots,
  runsInPane,
  type CallerLocator,
  type PaneProcessInfo,
} from "./caller-identity";
import type { WorldSnapshotResult } from "./snapshot";
import {
  LEDGER_LIMITS,
  RESULT_STATUSES,
  type CliActor,
  type LedgerChange,
  type LedgerProbe,
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
  /** Tell World's pages; `asks` when a question was asked or answered. */
  publishLedger(revision: number, asks?: boolean): void;
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

/**
 * A caller that named no pane. Any process can leave HERDR_PANE_ID unset, so
 * this is not the owner, only a terminal that did not say where it runs.
 */
export const NO_PANE = "terminal with no pane";

/** Herdr pane IDs, such as "w1:p2"; anything else is refused before use. */
const PANE_ID = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}$/;

/**
 * Who is calling. Without HERDR_PANE_ID the caller is unverified with no
 * pane. With one, the claim is verified only when the calling process runs
 * in that pane of a local Herdr (searched for among the pane's own
 * processes); otherwise it is labelled unverified and acts on the default host.
 */
export async function identifyCaller(
  hosts: readonly CliHost[],
  paneId: string | undefined,
  locate: CallerLocator | null,
): Promise<{ actor: CliActor; host?: CliHost }> {
  if (!paneId) return { actor: { label: NO_PANE, verified: false } };
  if (locate)
    for (const host of hosts) {
      if (!host.local) continue;
      const info = (
        (await host
          .call("pane.process_info", { pane_id: paneId })
          .catch(() => null)) as { process_info?: PaneProcessInfo } | null
      )?.process_info;
      const roots = paneRoots(info);
      const chain = roots.length ? locate(roots) : null;
      if (!chain || !runsInPane(chain, info)) continue;
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
    // Pane IDs repeat across hosts: `me` is only ever the caller's own host.
    if (topology.host.connection_id !== actor.connection_id)
      refused("`me` is on your own host; drop --connection or name a pane");
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
  const { x, y } = params;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    usage(`${name} needs numbers x and y`);
  return { x: x as number, y: y as number };
}

function groupOf(groups: readonly RelationGroup[], ref: TerminalRef) {
  return groups.find((group) =>
    group.members.some((member) => terminalKey(member) === terminalKey(ref)),
  );
}

/** The current value of what a change touched, to compare before an undo. */
export function probeValue(document: BoardDocument, probe: LedgerProbe) {
  switch (probe.aspect) {
    case "pinned":
      return JSON.stringify(document.layout.pinned[probe.key] ?? null);
    case "offset":
      return JSON.stringify(document.layout.offsets[probe.key] ?? null);
    case "colour":
      return JSON.stringify(document.layout.colors[probe.key] ?? null);
    case "group": {
      const group = probe.ref
        ? groupOf(document.relations.groups, probe.ref)
        : undefined;
      return JSON.stringify(
        group
          ? group.members.map((member) => terminalKey(member)).sort()
          : null,
      );
    }
  }
}

/** Undo a group change: leave, then rejoin whoever is left of the old group. */
function regroupOps(
  document: BoardDocument,
  regroup: NonNullable<LedgerChange["regroup"]>,
): BoardOp[] {
  const ops: BoardOp[] = [{ op: "group.leave", members: [regroup.ref] }];
  const others = (regroup.members ?? []).filter(
    (member) => terminalKey(member) !== terminalKey(regroup.ref),
  );
  // Prefer a former teammate still in a group, so the old group is rejoined.
  const mate =
    others.find((member) => groupOf(document.relations.groups, member)) ??
    others[0];
  if (mate)
    ops.push({
      op: "group.join",
      id: `g-${randomUUID()}`,
      members: [regroup.ref],
      target: [mate],
    });
  return ops;
}

type Planned = {
  ops: BoardOp[];
  undo: BoardOp[];
  summary: string;
  probe: LedgerProbe;
  regroup?: LedgerChange["regroup"];
};

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
        probe: { aspect: "pinned", key },
      };
    }
    case "board card unpin":
      if (!pinned) refused(`${key} is not pinned`);
      return {
        ops: [{ op: "layout.set", unpinned: [key] }],
        undo: [{ op: "layout.set", pinned: { [key]: pinned! } }],
        summary: `unpinned ${key}`,
        probe: { aspect: "pinned", key },
      };
    case "board card move": {
      const by = point(params, "move --by");
      if (pinned) {
        const at = { x: pinned.x + by.x, y: pinned.y + by.y };
        return {
          ops: [{ op: "layout.set", pinned: { [key]: at } }],
          undo: [{ op: "layout.set", pinned: { [key]: pinned } }],
          summary: `moved pinned ${key} to ${at.x},${at.y}`,
          probe: { aspect: "pinned", key },
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
        probe: { aspect: "offset", key },
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
        probe: { aspect: "colour", key },
      };
    }
    case "board card group":
    case "board card ungroup": {
      const ref = terminalOf(target, topology);
      const previous = groupOf(document.relations.groups, ref);
      const regroup = { ref, members: previous?.members ?? null };
      const probe: LedgerProbe = { aspect: "group", key, ref };
      if (command === "board card ungroup") {
        if (!previous) refused(`${key} is in no group`);
        return {
          ops: [{ op: "group.leave", members: [ref] }],
          undo: [],
          summary: `ungrouped ${key}`,
          probe,
          regroup,
        };
      }
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
        undo: [],
        summary: `grouped ${key} with ${String(params.with)}`,
        probe,
        regroup,
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

/** How long one `ask get` call may hold; the CLI's --wait asks again. */
export const ASK_WAIT_MAX_MS = 20_000;

export function createWorldCli(deps: WorldCliDeps) {
  const now = deps.now ?? Date.now;

  const record = (
    actor: CliActor,
    command: string,
    summary: string,
    undo: BoardOp[] | null,
    extra: Partial<LedgerChange> = {},
  ) => {
    const id = deps.ledger.nextId("c");
    const change: LedgerChange = {
      id,
      at: now(),
      actor,
      command,
      summary,
      undo,
      ...extra,
    };
    deps.publishLedger(
      deps.ledger.update((document) => document.changes.push(change)),
    );
    return change;
  };

  const patchBoard = (ops: BoardOp[]) => {
    const document = deps.board.patch(ops);
    deps.publishBoard(document.revision);
    return document;
  };

  /**
   * Change the Board, then record it. The two files cannot change together,
   * so a change that cannot be recorded is taken back.
   */
  const changeBoard = (
    ops: BoardOp[],
    revert: BoardOp[],
    write: (document: BoardDocument) => LedgerChange,
  ) => {
    const document = patchBoard(ops);
    try {
      return write(document);
    } catch (error) {
      try {
        patchBoard(revert);
      } catch {
        // The original error says more.
      }
      throw error;
    }
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
      const revert = plan.regroup
        ? regroupOps(deps.board.get(), plan.regroup)
        : plan.undo;
      return changeBoard(plan.ops, revert, (document) =>
        record(actor, command, plan.summary, plan.undo, {
          expect: {
            probe: plan.probe,
            value: probeValue(document, plan.probe),
          },
          redo: plan.ops,
          ...(plan.regroup ? { regroup: plan.regroup } : {}),
        }),
      );
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
        const change = deps.ledger.change(id);
        if (!change) notFound(`no change ${id}`);
        if (change!.undone_by)
          refused(`${id} was already undone by ${change!.undone_by}`);
        if (!change!.undo)
          refused(
            `${id} changed Herdr, which World cannot take back; make the opposite change instead`,
          );
        const current = deps.board.get();
        if (
          change!.expect &&
          probeValue(current, change!.expect.probe) !== change!.expect.value
        )
          refused(
            `${change!.expect.probe.key} changed after ${id}; undo the later change first, or set it again`,
          );
        const ops = change!.regroup
          ? regroupOps(current, change!.regroup)
          : change!.undo!;
        return changeBoard(ops, change!.redo ?? [], () => {
          const undone: LedgerChange = {
            id: deps.ledger.nextId("c"),
            at: now(),
            actor,
            command: "undo",
            summary: `undid ${id}`,
            undo: null,
          };
          // One write records the undo and marks what it undid.
          deps.publishLedger(
            deps.ledger.update((document) => {
              document.changes.push(undone);
              const entry = document.changes.find((c) => c.id === id);
              if (entry) entry.undone_by = undone.id;
            }),
          );
          return undone;
        });
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
        const open = deps.ledger.openAsks().asks;
        if (open.length >= LEDGER_LIMITS.asks)
          refused("too many open questions; wait for answers");
        // Verified panes each have their own allowance; unverified callers,
        // whatever they claim, share one.
        const bucket = (entry: CliActor) =>
          entry.verified
            ? `${entry.connection_id}\u0000${entry.pane_id}`
            : "unverified";
        if (
          open.filter((entry) => bucket(entry.actor) === bucket(actor))
            .length >= LEDGER_LIMITS.asksPerActor
        )
          refused(
            `you have ${LEDGER_LIMITS.asksPerActor} open questions; wait for answers`,
          );
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
          true,
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
        let ask = deps.ledger.ask(id);
        // Hold the call a while (the CLI's --wait asks again), not forever.
        while (ask && !ask.answer && now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          ask = deps.ledger.ask(id);
        }
        return ask ?? notFound(`no question ${id}`);
      }
      case "ask answer": {
        const id = text(params.id, "the question ID");
        const answer = text(params.answer, "the answer");
        const ask = deps.ledger.ask(id);
        if (!ask) notFound(`no question ${id}`);
        if (ask!.owner_only) refused("only the owner answers this, in World");
        // An answer from an agent must come from a pane World has placed,
        // and never from the agent that asked.
        if (!actor.verified)
          refused("only the owner or a verified agent answers questions");
        if (
          ask!.actor.connection_id === actor.connection_id &&
          ask!.actor.pane_id === actor.pane_id
        )
          refused("an agent cannot answer its own question");
        if (ask!.answer) refused(`${id} is already answered`);
        deps.publishLedger(
          answerAsk(deps.ledger, id, answer, actor.label, now()),
          true,
        );
        return deps.ledger.ask(id);
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
    /** Handle one CLI request; `locate` finds the caller among a pane's processes (null off Linux). */
    async handle(
      request: WorldCliRequest,
      locate: CallerLocator | null,
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
        // The claim becomes a label in the ledger and in World: bound it.
        if (paneId !== undefined && !PANE_ID.test(paneId))
          usage("HERDR_PANE_ID is not a Herdr pane ID");
        const identity = await identifyCaller(deps.hosts(), paneId, locate);
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
        const message = error instanceof Error ? error.message : String(error);
        // Board validation is the caller's to fix; anything else is Herdr or
        // the service failing.
        return message.startsWith("invalid board")
          ? { ok: false, code: "refused", error: message, actor }
          : {
              ok: false,
              code: "unavailable",
              error: "Herdr or the World service could not do that; try again",
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
