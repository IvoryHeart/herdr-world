import {
  MEMORY_ACTIONS,
  MEMORY_LIMITS,
  MEMORY_HARNESSES,
} from "../../../shared/memory";
import { readSync, openSync, closeSync, fstatSync, constants } from "node:fs";
import { parseCommandArgs, UsageError } from "./command";

export const MEMORY_HELP = `herdr-world memory list|search|read|create|update|delete [options]
herdr-world memory demo [--json]  testing-only synthetic files, cleaned up afterwards

Service calls require --connection ID --generation N (from ls --json).
list:   [--workspace ID] [--agent ID] [--harness ${MEMORY_HARNESSES.join("|")}]
search: QUERY [same filters]
read:   --source ID --path RELATIVE.md
create: --source ID --path RELATIVE.md --file INPUT --user-action
update: --source ID --path RELATIVE.md --file INPUT --revision TOKEN --user-action
delete: --source ID --path RELATIVE.md --revision TOKEN --user-action --yes

Returns JSON, including without --json. INPUT must be a regular UTF-8 file,
at most 256 KiB. Edits affect the owning host. Reload in the harness to use them.
Read again after conflict or unknown outcome; never blindly retry a mutation.`;

export function parseMemoryArgs(args: string[]) {
  const action = args[0] ?? "list";
  if (!MEMORY_ACTIONS.includes(action as never))
    throw new UsageError("memory verbs: " + MEMORY_ACTIONS.join(", "));
  const mutation = ["create", "update", "delete"].includes(action);
  const { values, positionals } = parseCommandArgs(
    args.slice(1),
    {
      connection: { type: "string" },
      generation: { type: "string" },
      json: { type: "boolean" },
      ...(action === "list" || action === "search"
        ? ({
            workspace: { type: "string" },
            agent: { type: "string" },
            harness: { type: "string" },
          } as const)
        : ({ source: { type: "string" }, path: { type: "string" } } as const)),
      ...(mutation ? ({ "user-action": { type: "boolean" } } as const) : {}),
      ...(action === "create" || action === "update"
        ? ({ file: { type: "string" } } as const)
        : {}),
      ...(action === "update" || action === "delete"
        ? ({ revision: { type: "string" } } as const)
        : {}),
      ...(action === "delete" ? ({ yes: { type: "boolean" } } as const) : {}),
    },
    action === "search" ? 1 : 0,
  ) as { values: Record<string, unknown>; positionals: string[] };
  const need = (value: unknown, name: string) => {
    if (typeof value !== "string" || !value)
      throw new UsageError(`memory requires ${name}`);
    return value;
  };
  const generation = Number(need(values.generation, "--generation N"));
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw new UsageError("--generation takes a nonnegative integer");
  const params: Record<string, unknown> = {
    connection_id: need(values.connection, "--connection ID"),
    connection_generation: generation,
  };
  for (const [flag, field] of [
    ["workspace", "workspace_id"],
    ["agent", "agent_id"],
    ["harness", "harness"],
    ["source", "source_id"],
    ["path", "path"],
    ["revision", "revision"],
  ]) {
    if (values[flag!] !== undefined) params[field!] = values[flag!];
  }
  if (action === "search") params.query = need(positionals[0], "search QUERY");
  if (!["list", "search"].includes(action)) {
    need(params.source_id, "--source ID");
    need(params.path, "--path RELATIVE.md");
  }
  if (mutation) {
    if (values["user-action"] !== true)
      throw new UsageError("memory writes require --user-action");
    params.user_action = true;
  }
  if (action === "update" || action === "delete")
    need(params.revision, "--revision TOKEN from read");
  if (action === "delete") {
    if (values.yes !== true)
      throw new UsageError("memory delete requires --yes confirmation");
    params.confirmed = true;
  }
  if (action === "create" || action === "update") {
    const file = need(values.file, "--file INPUT");
    const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > MEMORY_LIMITS.file_bytes)
        throw new UsageError("INPUT must be a regular file of at most 256 KiB");
      const buffer = Buffer.alloc(MEMORY_LIMITS.file_bytes + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const length = readSync(fd, buffer, bytes, buffer.length - bytes, null);
        if (!length) break;
        bytes += length;
      }
      if (bytes > MEMORY_LIMITS.file_bytes)
        throw new UsageError("INPUT exceeds 256 KiB");
      const data = buffer.subarray(0, bytes);
      try {
        params.content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        throw new UsageError("INPUT must be UTF-8");
      }
      if ((params.content as string).includes("\0"))
        throw new UsageError("INPUT must not contain NUL");
    } finally {
      closeSync(fd);
    }
  }
  return { command: `memory ${action}`, params, json: true };
}
