import { Type } from "typebox";
import { cliVerbs } from "./cli";
import { declare, object, policies, result, text } from "./declaration";
import { rpcVerbs } from "./rpc";
import type { Verb } from "./types";

const sourceVerbs = (["merge", "close", "ready"] as const).map((action) =>
  declare(
    "source",
    `github.pull-request.${action}`,
    object({ key: text, verb: Type.Literal(action) }),
    result,
    "reconcilable",
    policies({ browser: "confirm" }),
    ["github"],
    [
      "fresh browser confirmation",
      "current forge state and reviewed merge head",
    ],
  ),
);

/** Service-owned registry. Adapters never register or override actor policy. */
export const VERBS: readonly Verb[] = Object.freeze([
  ...rpcVerbs,
  ...cliVerbs,
  ...sourceVerbs,
]);
const index = new Map(
  VERBS.map((verb) => [`${verb.channel}:${verb.name}`, verb]),
);
if (index.size !== VERBS.length) throw new Error("duplicate registered verb");

export const registeredVerb = (channel: Verb["channel"], name: string) =>
  index.get(`${channel}:${name}`);
