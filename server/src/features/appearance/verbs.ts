import { declare, policies } from "../../verbs/declaration";
import { rpcInput, rpcOutput } from "../../verbs/rpc-contracts";

export const appearanceVerbs = [
  "world.appearance.patch",
  "world.appearance.rename",
].map((name) =>
  declare(
    "rpc",
    name,
    rpcInput(name),
    rpcOutput(name),
    "reconcilable",
    policies({ browser: "allow" }),
    ["world"],
    ["operation owner validation"],
  ),
);
