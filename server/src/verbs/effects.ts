import { ANSWER_DELIVERY_VERB } from "../world/ask-delivery-types";
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
] as const;
