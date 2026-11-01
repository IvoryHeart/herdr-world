import { randomUUID } from "node:crypto";
import { admitVerb } from "../verbs/admission";
import { registeredVerb } from "../verbs/registry";
import { parsePodMarkdown } from "../../../shared/groupMarkdown";
import {
  agentAddress,
  groupRefKey,
  groupText,
  parseAgentAddress,
  parseGroupRef,
  parseGroupRoles,
  resolveGroupRef,
  type Group,
  type GroupRef,
} from "../../../shared/groups";
import {
  buildGroupViews,
  type GroupView,
  type GroupConnectionObservation,
} from "../../../shared/groupViews";
import type { WorkItem, WorkLink } from "../../../shared/worldSources";
import type { BoardDocument } from "./board-store";
import type { GroupOp } from "./board-groups";
import { groupSnapshotObservations } from "./group-observations";
import { CliError } from "./world-cli-errors";
import type { CliActor } from "./world-ledger";
import type { WorldCliDeps, CliHost } from "./world-cli";

export const GROUP_CLI_COMMANDS = [
  "group create",
  "group add",
  "group remove",
  "group lead",
  "group reviewers",
  "group now",
  "group list",
  "group show",
  "group delete",
  "group promote",
  "group import",
] as const;
export type GroupMoveRequest = {
  connection_id: string;
  generation: number;
  kind: "room" | "desk";
  destination_id: string;
  destination_workspace_id: string;
  pane_id: string;
  terminal_id: string;
  tab_id: string;
  allow_close_room: boolean;
  preview: boolean;
  expected_plan?: string;
};
type Context = {
  deps: WorldCliDeps;
  actor: CliActor;
  host?: CliHost;
  patch(ops: GroupOp[]): BoardDocument | Promise<BoardDocument>;
};
const fail = (
  code: "usage" | "refused" | "not_found" | "unavailable",
  message: string,
): never => {
  throw new CliError(code, message);
};
function text(value: unknown, what: string, max = 2048) {
  try {
    return groupText(value, what, max);
  } catch {
    return fail("usage", `give ${what} (at most ${max} characters)`);
  }
}
function transfer(params: Record<string, unknown>): boolean {
  if (params.replace !== undefined && typeof params.replace !== "boolean")
    fail("usage", "--replace must be a boolean");
  if (params.replace === true && params.confirmed !== true)
    fail("refused", "an exclusive role transfer needs --replace --yes");
  return params.replace === true;
}
function chooseGroup(
  views: readonly GroupView[],
  params: Record<string, unknown>,
): GroupView {
  const wanted = text(params.group, "a group ID or name");
  const eligible = views.filter(
    (view) =>
      (params.kind === undefined || view.kind === params.kind) &&
      (!view.projected ||
        params.connection === undefined ||
        view.projected.connectionId === params.connection),
  );
  const exact = eligible.filter(
    (view) => view.key === wanted || view.id === wanted,
  );
  const matches = exact.length
    ? exact
    : eligible.filter(
        (view) =>
          view.name === wanted ||
          (params.kind !== undefined && view.projected?.nativeId === wanted),
      );
  if (matches.length === 0) return fail("not_found", `no group ${wanted}`);
  if (matches.length !== 1)
    return fail(
      "refused",
      `${wanted} names several groups; use a qualified group ID`,
    );
  return matches[0]!;
}

function resolveRef(
  value: unknown,
  group: Group | undefined,
  observations: readonly GroupConnectionObservation[],
  params: Record<string, unknown>,
  context: Context,
  existing = false,
  seat = false,
): GroupRef {
  const target = text(value, "an agent name, address, pane or terminal");
  if (target.startsWith("agent://")) {
    let address: string;
    try {
      address = parseGroupRef(target) as string;
    } catch {
      return fail("usage", "invalid agent:// address");
    }
    const parsed = parseAgentAddress(address);
    if (
      typeof params.connection === "string" &&
      params.connection !== parsed.connection_id
    )
      return fail("refused", "the agent address and --connection disagree");
    if (group?.kind !== "team" && !seat) return address;
    const matches = observations
      .filter(
        (connection) =>
          connection.current &&
          connection.connectionId === parsed.connection_id,
      )
      .flatMap((connection) =>
        connection.terminals
          .filter((terminal) => terminal.name === parsed.name)
          .map((terminal) => ({
            connection_id: connection.connectionId,
            terminal_id: terminal.terminalId,
          })),
      );
    if (matches.length !== 1)
      return fail(
        "refused",
        "a Team needs one current unambiguous terminal for that address",
      );
    return matches[0]!;
  }
  if (existing && group?.kind !== "team") {
    const matches =
      group?.members.flatMap((member) => {
        if (typeof member.ref !== "string") return [];
        const address = parseAgentAddress(member.ref);
        return address.name === target &&
          (params.connection === undefined ||
            params.connection === address.connection_id)
          ? [member.ref]
          : [];
      }) ?? [];
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1)
      return fail(
        "refused",
        "several members have that name; use agent:// with its connection",
      );
  }
  const connectionId =
    typeof params.connection === "string"
      ? params.connection
      : (context.host?.connection_id ?? context.deps.defaultConnectionId());
  if (!connectionId)
    return fail(
      "refused",
      "choose --connection or use a qualified agent:// address",
    );
  const connection = observations.find(
    (connection) =>
      connection.connectionId === connectionId && connection.current,
  );
  if (!connection)
    return fail(
      "unavailable",
      `connection ${connectionId} has no current topology`,
    );
  const terminals = connection.terminals.filter((terminal) =>
    target === "me"
      ? context.actor.verified &&
        context.actor.connection_id === connectionId &&
        context.actor.terminal_id === terminal.terminalId
      : target.startsWith("pane:")
        ? terminal.paneId === target.slice(5)
        : target.startsWith("terminal:")
          ? terminal.terminalId === target.slice(9)
          : terminal.name === target,
  );
  if (terminals.length !== 1)
    return fail(
      "refused",
      "choose one current agent with a qualified address, pane or terminal; no match is guessed",
    );
  const terminal = terminals[0]!;
  if (group?.kind === "team" || seat)
    return { connection_id: connectionId, terminal_id: terminal.terminalId };
  if (!terminal.name)
    return fail(
      "refused",
      "this terminal has no actual Herdr agent name; give an explicit agent:// address",
    );
  if (
    connection.terminals.filter((entry) => entry.name === terminal.name)
      .length !== 1
  )
    return fail(
      "refused",
      "several current agents have that Herdr name; rename the agent or give an explicit agent:// address",
    );
  return agentAddress(connectionId, terminal.name);
}

export async function runGroupCommand(
  command: string,
  params: Record<string, unknown>,
  context: Context,
): Promise<unknown> {
  const { deps } = context;
  const snapshot = await deps.snapshot();
  const observations = groupSnapshotObservations(snapshot.connections);
  const sources =
    command === "group list" || command === "group show"
      ? ((await deps.sources?.()) ?? {
          items: [] as WorkItem[],
          links: [] as WorkLink[],
        })
      : { items: [], links: [] };
  // Everything after the asynchronous observations is a synchronous Board edit.
  const before = deps.board.get();
  const views = buildGroupViews(before.relations.groups, observations, sources);
  if (command === "group list")
    return views.filter(
      (view) =>
        (params.kind === undefined || params.kind === view.kind) &&
        (!view.projected ||
          params.connection === undefined ||
          view.projected.connectionId === params.connection),
    );
  if (command === "group create") {
    if (params.kind === "room" || params.kind === "desk")
      return fail(
        "refused",
        "Rooms and desks are Herdr workspaces and tabs: use herdr workspace|tab",
      );
    if (params.kind !== "pod" && params.kind !== "team")
      return fail(
        "usage",
        "create takes --kind pod|team (or a pod/team alias)",
      );
    const id = randomUUID();
    const name = text(params.name, "a group name", 240);
    const attrs =
      params.open_pr_limit === undefined
        ? undefined
        : { open_pr_limit: params.open_pr_limit as number };
    const document = await context.patch([
      {
        op: "group.create",
        id,
        kind: params.kind,
        name,
        ...(attrs ? { attrs } : {}),
      },
    ]);
    return {
      revision: document.revision,
      group: document.relations.groups.find((group) => group.id === id),
    };
  }
  if (command === "group import") {
    if (params.confirmed !== true)
      return fail(
        "refused",
        "one-time Pod import needs --yes; this never synchronizes the file",
      );
    if (params.kind !== undefined && params.kind !== "pod")
      return fail("refused", "Markdown import creates Pods only");
    let rows: ReturnType<typeof parsePodMarkdown>;
    try {
      rows = parsePodMarkdown(
        typeof params.markdown === "string" ? params.markdown : "",
      );
    } catch (error) {
      return fail(
        "usage",
        error instanceof Error ? error.message : "invalid Pod table",
      );
    }
    const mapping = params.mapping ?? {};
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
      return fail(
        "usage",
        "import --mapping is a JSON object from table names to explicit agent:// addresses",
      );
    const ops: GroupOp[] = [];
    const ids: string[] = [];
    for (const row of rows) {
      if (
        before.relations.groups.some(
          (group) => group.kind === "pod" && group.name === row.name,
        )
      )
        return fail(
          "refused",
          `Pod ${row.name} already exists; import never overwrites or resynchronizes it`,
        );
      const id = randomUUID();
      ids.push(id);
      const members = new Map<string, { ref: GroupRef; roles: string[] }>();
      for (const [role, targets] of [
        ["lead", row.lead],
        ["builder", row.builders],
        ["reviewer", row.reviewers],
      ] as const) {
        for (const target of targets) {
          const mapped = Object.hasOwn(mapping, target);
          const explicit = mapped
            ? (mapping as Record<string, unknown>)[target]
            : target;
          if (
            mapped &&
            (typeof explicit !== "string" || !explicit.startsWith("agent://"))
          )
            return fail(
              "usage",
              `mapping for ${target} needs an explicit agent:// address`,
            );
          const ref = resolveRef(
            explicit,
            undefined,
            observations,
            params,
            context,
          );
          const key = groupRefKey(ref);
          const member = members.get(key) ?? { ref, roles: [] };
          if (!member.roles.includes(role)) member.roles.push(role);
          members.set(key, member);
        }
      }
      ops.push({
        op: "group.create",
        id,
        kind: "pod",
        name: row.name,
        attrs: { queue: row.now },
        members: [...members.values()],
      });
    }
    const document = await context.patch(ops);
    return {
      revision: document.revision,
      imported: document.relations.groups.filter((group) =>
        ids.includes(group.id),
      ),
    };
  }
  const view = chooseGroup(views, params);
  if (command === "group show")
    return {
      ...view,
      changes:
        before.relations.group_changes?.filter(
          (change) => change.group_id === view.id,
        ) ?? [],
    };
  if (view.owner === "herdr") {
    if (command !== "group add")
      return fail(
        "refused",
        "Rooms and desks are Herdr workspaces and tabs: use herdr workspace|tab; join by adding to a destination with --herdr",
      );
    if (params.herdr !== true)
      return fail("refused", "add --herdr to move the agent in Herdr");
    // The target owner comes from the resolved view, never the caller's claim.
    try {
      admitVerb(
        registeredVerb("cli", command),
        { ...params, herdr_target: true },
        {
          actor: context.actor.verified ? "cli_verified" : "cli_unverified",
          authorized: () => !deps.signal?.aborted,
          capabilities: () => new Set(["world"]),
          preconditions: () => Boolean(view.current && view.projected),
        },
      );
    } catch (error) {
      return fail("refused", (error as Error).message);
    }
    if (params.role !== undefined || params.replace === true)
      return fail(
        "refused",
        "Herdr room/desk membership has no World roles or role transfers",
      );
    if (!view.current || !view.projected)
      return fail(
        "unavailable",
        "the destination has no current Herdr topology",
      );
    const ref = resolveRef(
      params.agent,
      undefined,
      observations,
      params,
      context,
      false,
      true,
    );
    const resolved = resolveGroupRef(
      ref,
      observations.flatMap((connection) =>
        connection.terminals.map((terminal) => ({
          connection_id: connection.connectionId,
          terminal_id: terminal.terminalId,
          name: terminal.name ?? "",
          current: connection.current,
        })),
      ),
    );
    if (resolved.state !== "present")
      return fail(
        "refused",
        "choose one current unambiguous agent before moving it",
      );
    const connectionId = resolved.terminal.connection_id;
    if (connectionId !== view.projected.connectionId)
      return fail("refused", "Herdr membership moves stay on one connection");
    const connection = observations.find(
      (connection) => connection.connectionId === connectionId,
    )!;
    const terminal = connection.terminals.find(
      (terminal) => terminal.terminalId === resolved.terminal.terminal_id,
    )!;
    const workspace =
      view.kind === "room"
        ? view.projected.nativeId
        : connection.desks.find((desk) => desk.id === view.projected!.nativeId)
            ?.roomId;
    if (!workspace)
      return fail("refused", "the destination desk changed; read Groups again");
    if (!deps.groupMove)
      return fail(
        "unavailable",
        "Herdr group moves are unavailable in this service",
      );
    return deps.groupMove({
      connection_id: connectionId,
      generation: connection.generation,
      kind: view.kind as "room" | "desk",
      destination_id: view.projected.nativeId,
      destination_workspace_id: workspace,
      pane_id: terminal.paneId,
      terminal_id: terminal.terminalId,
      tab_id: terminal.deskId,
      allow_close_room: params.allow_close_room === true,
      preview: params.preview === true,
      ...(typeof params.expected_plan === "string"
        ? { expected_plan: params.expected_plan }
        : {}),
    });
  }
  if (params.herdr === true)
    return fail("refused", "--herdr only applies to projected Room/Desk moves");
  const group = view.stored!;
  const replace = transfer(params);
  const ops: GroupOp[] = [];
  if (command === "group delete") {
    if (params.confirmed !== true)
      return fail(
        "refused",
        "delete needs --yes; this removes the group, never its agents",
      );
    ops.push({ op: "group.delete", id: group.id });
  } else if (command === "group now") {
    if (!Array.isArray(params.items))
      return fail("usage", "Now takes an ordered list of items");
    ops.push({
      op: "group.set_attrs",
      id: group.id,
      attrs: { queue: params.items as string[] },
    });
  } else if (command === "group promote") {
    if (group.kind !== "team")
      return fail("refused", "only a Team can be explicitly promoted to Pod");
    if (!Array.isArray(params.mapping))
      return fail(
        "usage",
        "promotion needs a complete explicit --mapping JSON array",
      );
    ops.push({
      op: "group.promote",
      id: group.id,
      name: text(params.name, "the Pod name", 240),
      mapping: params.mapping as Extract<
        GroupOp,
        { op: "group.promote" }
      >["mapping"],
      replace,
    });
  } else if (command === "group add" || command === "group remove") {
    const ref = resolveRef(
      params.agent,
      group,
      observations,
      params,
      context,
      command === "group remove",
    );
    if (command === "group remove")
      ops.push({ op: "group.leave", id: group.id, refs: [ref] });
    else {
      if (group.kind === "team" && params.role !== undefined)
        return fail(
          "refused",
          "Teams have no group roles; explicitly promote to Pod first",
        );
      let roles: string[];
      try {
        roles =
          group.kind === "team"
            ? []
            : parseGroupRoles(
                text(params.role ?? "builder", "a role", 1024).split(","),
              );
      } catch (error) {
        return fail(
          "usage",
          error instanceof Error ? error.message : "invalid roles",
        );
      }
      ops.push({ op: "group.join", id: group.id, refs: [ref], roles, replace });
    }
  } else if (command === "group lead" || command === "group reviewers") {
    if (group.kind !== "pod")
      return fail(
        "refused",
        "Lead/Reviewer edits need a Pod; promote a Team explicitly first",
      );
    const role = command === "group lead" ? "lead" : "reviewer";
    const agents = command === "group lead" ? [params.agent] : params.agents;
    if (!Array.isArray(agents) || agents.length > 32)
      return fail("usage", "give at most 32 agents");
    const refs = agents.map((agent) =>
      resolveRef(agent, group, observations, params, context, true),
    );
    const wanted = new Set(refs.map(groupRefKey));
    if (wanted.size !== refs.length)
      return fail("usage", "duplicate agent refs");
    for (const member of group.members) {
      if (member.roles.includes(role) && !wanted.has(groupRefKey(member.ref)))
        ops.push({
          op: "group.set_roles",
          id: group.id,
          refs: [member.ref],
          roles: member.roles.filter((entry) => entry !== role),
        });
    }
    for (const ref of refs)
      ops.push({
        op: "group.join",
        id: group.id,
        refs: [ref],
        roles: [role],
        replace,
      });
  } else return fail("usage", "unknown group command");
  const document = await context.patch(ops);
  const updated = document.relations.groups.find(
    (entry) => entry.id === group.id,
  );
  return {
    revision: document.revision,
    ...(updated ? { group: updated } : { deleted: group.id }),
  };
}
