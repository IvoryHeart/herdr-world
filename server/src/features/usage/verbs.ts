import { Type } from "typebox";
import { USAGE_ANALYTICS_GROUPS } from "../../../../shared/usageAnalytics";
import { declare, object, policies, text } from "../../verbs/declaration";
import { rpcOutput } from "../../verbs/rpc-contracts";

const window = Type.Optional(
  Type.Union([Type.Literal("today"), Type.Literal("7d")]),
);
export const usageVerbs = Object.entries({
  "world.usage.analytics": object({
    window,
    // The API, CLI and screens share every admitted grouping.
    group_by: Type.Optional(
      Type.Union(USAGE_ANALYTICS_GROUPS.map((group) => Type.Literal(group))),
    ),
    connection_id: Type.Optional(text),
    connection_generation: Type.Optional(Type.Integer({ minimum: 0 })),
    pane_id: Type.Optional(text),
    workspace_id: Type.Optional(text),
    project_id: Type.Optional(text),
  }),
  "world.usage.get": object({ window }),
}).map(([name, input]) =>
  declare(
    "rpc",
    name,
    input,
    rpcOutput(name),
    "read",
    policies({ browser: "allow" }),
    ["world"],
    ["operation owner validation"],
  ),
);
