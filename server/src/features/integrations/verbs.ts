import { declare, object, policies, text } from "../../verbs/declaration";
import { rpcInput, rpcOutput } from "../../verbs/rpc-contracts";

// World's skill per harness on the service's host; browser (operator) only.
export const integrationsVerbs = ["install", "list", "uninstall"].map(
  (operation) => {
    const name = `world.integration.${operation}`;
    return declare(
      "rpc",
      name,
      operation === "list" ? rpcInput(name) : object({ harness: text }),
      rpcOutput(name),
      operation === "list" ? "read" : "reconcilable",
      policies({ browser: "allow" }),
      ["world"],
      ["operation owner validation"],
    );
  },
);
