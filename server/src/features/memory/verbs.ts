import { Type } from "typebox";
import { MEMORY_ACTIONS } from "../../../../shared/memory";
import {
  declare,
  object,
  policies,
  result,
  text,
} from "../../verbs/declaration";

/** Explicit mutation acknowledgement is independent of delete confirmation. */
export const memoryVerbs = MEMORY_ACTIONS.flatMap((action) => {
  const mutation =
    action === "create" || action === "update" || action === "delete";
  const fields = {
    connection_id: text,
    connection_generation: Type.Integer({ minimum: 0 }),
    ...(action === "list"
      ? {}
      : action === "search"
        ? { query: text }
        : { source_id: text, path: text }),
    ...(action === "update" || action === "delete" ? { revision: text } : {}),
    ...(action === "create" || action === "update"
      ? { content: Type.String() }
      : {}),
  };
  const acknowledgements = [
    ...(mutation ? [{ field: "user_action", flag: "--user-action" }] : []),
    ...(action === "delete" ? [{ field: "confirmed", flag: "--yes" }] : []),
  ];
  return [
    declare(
      "rpc",
      `world.memory.${action}`,
      object(fields),
      result,
      mutation ? "reconcilable" : "read",
      policies({ browser: mutation ? "acknowledge" : "allow" }),
      ["world"],
      ["exact current connection generation", "discovered memory source"],
      acknowledgements,
    ),
    declare(
      "cli",
      `memory ${action}`,
      object(fields),
      result,
      mutation ? "reconcilable" : "read",
      policies({
        cli_verified: mutation ? "acknowledge" : "allow",
        cli_unverified: mutation ? "acknowledge" : "allow",
      }),
      ["world"],
      ["exact current connection generation", "discovered memory source"],
      acknowledgements,
    ),
  ];
});
