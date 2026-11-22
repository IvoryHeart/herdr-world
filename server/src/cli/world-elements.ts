import {
  parseBoardElement,
  type BoardElementInput,
} from "../../../shared/boardElements";
import { parseCommandArgs, UsageError } from "./command";

/** Explicit selectors only: no pane/current host inference for saved sources. */
export function parseBoardElementArgs(args: string[]) {
  const action = args[0] ?? "list";
  if (!["types", "list", "put", "delete", "read"].includes(action))
    throw new UsageError("use board element types|list|put|delete|read");
  const options: Record<string, { type: "string" | "boolean" }> = {
    json: { type: "boolean" },
  };
  for (const key of action === "put"
    ? [
        "title",
        "at",
        "text",
        "url",
        "connection",
        "workspace",
        "path",
        "agent-ref",
        "apartment",
        "memory-source",
        "rev",
      ]
    : action === "delete"
      ? ["rev"]
      : action === "read"
        ? ["generation", "path"]
        : [])
    options[key] = { type: "string" };
  const { values, positionals } = parseCommandArgs(
    args.slice(1),
    options,
    action === "put" ? 2 : ["read", "delete"].includes(action) ? 1 : 0,
  );
  const required = (value: unknown, name: string) => {
    if (typeof value !== "string" || !value)
      throw new UsageError(`missing ${name}`);
    return value;
  };
  const number = (value: unknown, name: string) => {
    if (
      typeof value !== "string" ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw new UsageError(`invalid ${name}`);
    return Number(value);
  };
  const params: Record<string, unknown> = {};
  if (action === "put") {
    const kind = required(positionals[0], "kind"),
      id = required(positionals[1], "element ID");
    const point = (values.at ?? "0,0").toString().split(",");
    if (
      point.length !== 2 ||
      point.some((value) => !value.trim() || !Number.isFinite(Number(value)))
    )
      throw new UsageError("--at takes X,Y");
    if (
      values.text !== undefined &&
      (kind !== "document" ||
        values.connection !== undefined ||
        values.workspace !== undefined ||
        values.path !== undefined)
    )
      throw new UsageError("--text is only for an inline document");
    if (values["memory-source"] !== undefined && kind !== "memory")
      throw new UsageError("--memory-source is only for a memory");
    if (values.apartment !== undefined && kind !== "log")
      throw new UsageError("--apartment is only for an agent log");
    const source =
      kind === "link"
        ? { url: required(values.url, "--url") }
        : kind === "document" && values.text !== undefined
          ? { text: values.text }
          : values["memory-source"] !== undefined
            ? {
                connection_id: required(values.connection, "--connection"),
                ...(values.workspace === undefined
                  ? {}
                  : { workspace_id: values.workspace }),
                memory_source_id: values["memory-source"],
                path: required(values.path, "--path"),
              }
            : {
                connection_id: required(values.connection, "--connection"),
                workspace_id: required(values.workspace, "--workspace"),
                ...(values.path === undefined && kind === "memory"
                  ? {}
                  : { path: required(values.path, "--path") }),
                ...(values["agent-ref"] === undefined
                  ? {}
                  : { agent_ref: values["agent-ref"] }),
                ...(values.apartment === undefined
                  ? {}
                  : { apartment_id: values.apartment }),
              };
    try {
      const element: BoardElementInput & { rev?: number } = parseBoardElement(
        {
          id,
          kind,
          title: required(values.title, "--title"),
          x: Number(point[0]),
          y: Number(point[1]),
          source,
        },
        1,
      );
      delete element.rev;
      params.element = element;
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
  } else if (["read", "delete"].includes(action))
    params.id = required(positionals[0], "element ID");
  if (values.rev !== undefined) params.rev = number(values.rev, "--rev");
  if (action === "delete" && params.rev === undefined)
    throw new UsageError("delete requires --rev");
  if (values.generation !== undefined)
    params.connection_generation = number(values.generation, "--generation");
  if (action === "read" && values.path !== undefined) params.path = values.path;
  return {
    command: `board element ${action}`,
    params,
    json: values.json === true,
  };
}
