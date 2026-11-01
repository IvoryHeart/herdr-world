import { ANSWER_DELIVERY_VERB } from "../world/ask-delivery-types";
import { Type } from "typebox";
import { declare, object, policies, text } from "./declaration";

/** Only record deliveries outlive their request; interactive input stays direct. */
export const effectVerbs = [
  declare(
    "effect",
    "notification.show",
    object({ ask_id: text }),
    object(),
    "repeatable",
    policies({
      browser: "allow",
      cli_verified: "allow",
      cli_unverified: "allow",
    }),
    ["runtime"],
    ["the ask is still open", "captured connection is current"],
    [],
    { queueable: true, version: 1 },
  ),
  declare(
    "effect",
    ANSWER_DELIVERY_VERB.name,
    object({ ask_id: text, answer_occurrence: text }),
    object(),
    "opaque",
    policies({ browser: "allow", cli_verified: "allow" }),
    ["runtime"],
    [
      "answer occurrence and original recipient match",
      "answering actor is currently authorized",
    ],
    [],
    ANSWER_DELIVERY_VERB,
  ),
  // The bin's close, recorded once its countdown ends. A queued intent is
  // conditioned on the captured runtime generation and terminal, so a host that
  // returns with another runtime or occupant never gets a late close.
  declare(
    "effect",
    "world.bin.close",
    object({
      bin_id: text,
      workspace_id: text,
      tab_id: text,
      connection_generation: Type.Integer({ minimum: 0 }),
      // The World run that recorded it: generations are per-run counters.
      service_incarnation: text,
    }),
    object(),
    "reconcilable",
    policies({ browser: "allow" }),
    ["runtime"],
    [
      "captured runtime generation is current",
      "the pane still holds the captured terminal",
      "a worktree root closes only as its workspace's last pane",
    ],
    [],
    { queueable: true, version: 1 },
  ),
] as const;
