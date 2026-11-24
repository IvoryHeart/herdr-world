import { Type } from "typebox";
import {
  declare,
  object,
  policies,
  result,
  text,
} from "../../verbs/declaration";

/** The Library's "Made by agents" shelf: a read of one host, references only. */
export const artefactsVerbs = [
  declare(
    "rpc",
    "world.artefacts.list",
    object({
      connection_id: text,
      connection_generation: Type.Integer({ minimum: 0 }),
    }),
    result,
    "read",
    policies({ browser: "allow" }),
    ["world"],
    ["exact current connection generation"],
  ),
];
