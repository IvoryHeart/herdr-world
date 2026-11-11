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
  // The bin's close, recorded once its bus leaves the map. A queued intent is
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
      // A pinned tab: the close never takes the tab's last pane.
      preserve_tab: Type.Optional(Type.Boolean()),
    }),
    object(),
    "reconcilable",
    policies({ browser: "allow" }),
    ["runtime"],
    [
      "captured runtime generation is current",
      "the pane still holds the captured terminal",
      "a worktree root closes only as its workspace's last pane",
      "a pinned tab keeps its last pane",
    ],
    [],
    { queueable: true, version: 1 },
  ),
  // The bin's close of a herdr-core terminal: a native kill (world/
  // bin-close-core.ts). It carries the confirmation of every terminal that
  // ends with it and is refused if more would end, or another program runs.
  declare(
    "effect",
    "world.bin.close_core",
    object({
      bin_id: text,
      connection_generation: Type.Integer({ minimum: 0 }),
      service_incarnation: text,
      confirmation: object({
        core_id: text,
        terminals: Type.Array(
          object({
            address: text,
            pid: Type.Union([Type.Integer(), Type.Null()]),
            occupant: Type.Optional(
              Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
            ),
            remote: Type.Optional(Type.Boolean()),
          }),
          { minItems: 1, maxItems: 256 },
        ),
      }),
    }),
    object(),
    "reconcilable",
    policies({ browser: "allow" }),
    ["runtime"],
    [
      "captured runtime generation is current",
      "the terminal still runs the confirmed program",
      "nothing beyond the confirmed terminals would end",
    ],
    [],
    { queueable: true, version: 1 },
  ),
] as const;
