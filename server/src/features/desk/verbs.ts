import { declare, policies } from "../../verbs/declaration";
import { rpcInput, rpcOutput } from "../../verbs/rpc-contracts";
import type { Recovery } from "../../verbs/types";

const rpc = (name: string, recovery: Recovery) =>
  declare(
    "rpc",
    name,
    rpcInput(name),
    rpcOutput(name),
    recovery,
    policies({ browser: "allow" }),
    ["world"],
    ["operation owner validation"],
  );

export const deskVerbs = [
  rpc("world.desk.get", "read"),
  rpc("world.desk.observe", "reconcilable"),
  rpc("world.desk.open", "reconcilable"),
  rpc("world.desk.review", "reconcilable"),
];
