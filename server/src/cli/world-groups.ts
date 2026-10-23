import { parseCommandArgs, UsageError } from "./command";
import type { GroupView } from "../../../shared/groupViews";
import type { Group, GroupChange } from "../../../shared/groups";

export const GROUP_ACTIONS = [
  "create",
  "add",
  "remove",
  "lead",
  "reviewers",
  "now",
  "list",
  "show",
  "delete",
  "promote",
];
const BASE = {
  json: { type: "boolean" },
  connection: { type: "string" },
  kind: { type: "string" },
} as const;
type Option = { type: "boolean" | "string" };
const required = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value)
    throw new UsageError(`missing ${name}`);
  return value;
};

export function parseGroupArgs(word: string, args: string[]) {
  const verb = args[0] ?? "list";
  const tail = args.slice(1);
  let extra: Record<string, Option> = {};
  let maximum = 1;
  switch (verb) {
    case "create":
      extra = { "open-pr-limit": { type: "string" } };
      break;
    case "add":
      extra = {
        role: { type: "string" },
        replace: { type: "boolean" },
        yes: { type: "boolean" },
        herdr: { type: "boolean" },
        "allow-close-room": { type: "boolean" },
      };
      maximum = 2;
      break;
    case "remove":
      maximum = 2;
      break;
    case "lead":
      extra = { replace: { type: "boolean" }, yes: { type: "boolean" } };
      maximum = 2;
      break;
    case "reviewers":
      maximum = 33;
      break;
    case "now":
      maximum = 33;
      break;
    case "list":
      maximum = 0;
      break;
    case "show":
      break;
    case "delete":
      extra = { yes: { type: "boolean" } };
      break;
    case "promote":
      extra = {
        name: { type: "string" },
        mapping: { type: "string" },
        replace: { type: "boolean" },
        yes: { type: "boolean" },
      };
      break;
    default:
      throw new UsageError(`group verbs: ${GROUP_ACTIONS.join(", ")}`);
  }
  const { values, positionals } = parseCommandArgs(
    tail,
    { ...BASE, ...extra },
    maximum,
  ) as { values: Record<string, unknown>; positionals: string[] };
  const alias = word === "pod" || word === "team" ? word : undefined;
  if (alias && values.kind !== undefined && values.kind !== alias)
    throw new UsageError(`${word} alias conflicts with --kind ${values.kind}`);
  const kind = alias ?? values.kind;
  if (verb === "create" && kind === undefined)
    throw new UsageError("create needs --kind pod|team or a pod/team alias");
  if (values.replace === true && values.yes !== true)
    throw new UsageError("an exclusive role transfer needs --replace --yes");
  const params: Record<string, unknown> = {
    ...(kind !== undefined ? { kind } : {}),
    ...(values.connection !== undefined
      ? { connection: values.connection }
      : {}),
    ...(values.yes === true ? { confirmed: true } : {}),
    ...(values.replace === true ? { replace: true } : {}),
  };
  if (verb === "create") {
    params.name = required(positionals[0], "group name");
    if (values["open-pr-limit"] !== undefined) {
      const limit = Number(values["open-pr-limit"]);
      if (!Number.isSafeInteger(limit) || limit < 0)
        throw new UsageError("--open-pr-limit takes a nonnegative integer");
      params.open_pr_limit = limit;
    }
  } else if (verb !== "list")
    params.group = required(positionals[0], "group ID or name");
  if (verb === "add" || verb === "remove" || verb === "lead")
    params.agent = required(
      positionals[1],
      "agent name, address, pane or terminal",
    );
  if (verb === "reviewers") params.agents = positionals.slice(1);
  if (verb === "now") params.items = positionals.slice(1);
  if (verb === "add") {
    if (values.role !== undefined) params.role = values.role;
    if (values.herdr === true) params.herdr = true;
    if (values["allow-close-room"] === true) params.allow_close_room = true;
  }
  if (verb === "promote") {
    params.name = required(values.name, "--name POD_NAME");
    try {
      params.mapping = JSON.parse(required(values.mapping, "--mapping JSON"));
    } catch {
      throw new UsageError(
        "--mapping takes a complete JSON array of explicit from/to refs",
      );
    }
    if (!Array.isArray(params.mapping))
      throw new UsageError("--mapping takes a JSON array");
  }
  return { command: `group ${verb}`, params, json: values.json === true };
}

const title = (group: { kind: string; name?: string; id: string }) =>
  `${group.kind[0]?.toUpperCase() ?? ""}${group.kind.slice(1)} · ${group.name ?? group.id}`;

/** Keep the existing CLI JSON envelope; TTY output uses the shared vocabulary. */
export function groupHuman(result: unknown): string {
  if (Array.isArray(result))
    return (
      result
        .map(
          (row: GroupView) =>
            `${title(row)} [${row.id}] · ${row.members.length} members${row.current ? "" : " · stale"}${row.now[0] ? ` · ${row.now[0]}` : ""}`,
        )
        .join("\n") || "(none)"
    );
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const value = result as {
    group?: Group;
    deleted?: string;
    changes?: GroupChange[];
    summary?: string;
  } & Partial<GroupView>;
  if (value.summary) return value.summary;
  if (value.group) return `${title(value.group)} [${value.group.id}]`;
  if (value.deleted) return `Deleted group ${value.deleted}`;
  if (!value.id || !value.kind) return JSON.stringify(result);
  const rows = [title(value as GroupView)];
  for (const member of value.members ?? [])
    rows.push(
      `  ${member.label} · ${member.roles.join(", ") || "Member"} · ${member.resolution}`,
    );
  for (const [index, item] of (value.now ?? []).entries())
    rows.push(`  ${index + 1}. ${item}`);
  for (const change of value.changes?.slice(-5).reverse() ?? []) {
    const sender =
      change.sender.basis === "unknown"
        ? "unknown sender"
        : `${change.sender.label} (${change.sender.basis})`;
    rows.push(
      `  ${change.op.replace("group.", "").replaceAll("_", " ")} by ${sender} · ${new Date(change.at).toLocaleTimeString()}`,
    );
  }
  return rows.join("\n");
}
