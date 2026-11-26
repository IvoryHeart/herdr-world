import { Type } from "typebox";
import { declare, object, policies, text } from "../../verbs/declaration";
import { rpcInput, rpcOutput } from "../../verbs/rpc-contracts";
import type { Recovery } from "../../verbs/types";

const rpc = (name: string, recovery: Recovery, input = rpcInput(name)) =>
  declare(
    "rpc",
    name,
    input,
    rpcOutput(name),
    recovery,
    policies({ browser: "allow" }),
    ["world"],
    ["operation owner validation"],
  );

export const apartmentsVerbs = [
  // Apartments: finished agents' records. Evict names explicit residents.
  rpc(
    "world.apartments.evict",
    "reconcilable",
    object({ ids: Type.Array(text, { minItems: 1, maxItems: 500 }) }),
  ),
  rpc("world.apartments.history", "read", object({ id: text })),
  rpc("world.apartments.list", "read"),
];
