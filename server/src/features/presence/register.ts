import { defineFeature, featureKey } from "../contract";
import { declare, object, policies, result } from "../../verbs/declaration";
import { ownerPresence } from "./clock";

export const feature = defineFeature({
  id: featureKey<void>("presence"),
  capability: "world-surfaces/desk-attention",
  requires: [],
  verbs: [
    declare(
      "rpc",
      "world.presence.seen",
      object(),
      result,
      "reconcilable",
      policies({ browser: "allow" }),
      ["world"],
      ["operation owner validation"],
    ),
  ],
  create: () => ({
    api: undefined,
    rpc: {
      "world.presence.seen": ({ id, method, sendReply }) => {
        sendReply({ id, result: ownerPresence.seen() }, method);
      },
    },
  }),
});
