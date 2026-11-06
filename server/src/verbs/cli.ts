import { Type } from "typebox";
import {
  declare,
  object,
  optionalText,
  policies,
  result,
  text,
} from "./declaration";
import type { Acknowledgement, Recovery } from "./types";

const target = { target: text, connection: optionalText };
const transfer = {
  field: "confirmed",
  flag: "--replace --yes",
  when: "replace",
};
const cliPolicy = policies({ cli_verified: "allow", cli_unverified: "allow" });
const ackPolicy = policies({
  cli_verified: "acknowledge",
  cli_unverified: "acknowledge",
});
const outputs = {
  whoami: object({ label: Type.String(), verified: Type.Boolean() }),
  ls: Type.Array(object()),
  history: Type.Array(object()),
  "result ls": Type.Array(object()),
  "group list": Type.Array(object()),
  result: object({ id: text, task: text, summary: text, status: text }),
};
const cli = (
  name: string,
  fields: Parameters<typeof object>[0],
  recovery: Recovery = "reconcilable",
  acknowledgements: readonly Acknowledgement[] = [],
  verified = false,
) =>
  declare(
    "cli",
    name,
    object(fields),
    outputs[name as keyof typeof outputs] ?? result,
    recovery,
    verified
      ? policies({ cli_verified: "allow" })
      : acknowledgements.length
        ? ackPolicy
        : cliPolicy,
    ["world"],
    ["current target and ownership checks in command owner"],
    acknowledgements,
  );

export const cliVerbs = [
  cli("whoami", {}, "read"),
  cli("ls", {}, "read"),
  cli("history", {}, "read"),
  cli("undo", { id: text }),
  cli("board card move", { ...target, x: Type.Number(), y: Type.Number() }),
  cli("board card pin", { ...target, x: Type.Number(), y: Type.Number() }),
  cli("board card unpin", target),
  cli("board card group", { ...target, with: text }),
  cli("board card ungroup", target),
  cli("colour set", { ...target, colour: text }),
  cli("colour reset", target),
  cli("town desk move", target, "reconcilable", [
    { field: "herdr", flag: "--herdr" },
  ]),
  cli("ask", { question: text }, "reconcilable"),
  cli("ask get", { id: text }, "read"),
  cli("ask acknowledge", {
    id: text,
    occurrence: text,
    attempt: Type.Integer({ minimum: 0 }),
  }),
  cli("ask answer", { id: text, answer: text }, "reconcilable", [], true),
  cli("ask withdraw", {}, "reconcilable", [], true),
  cli("result", { task: text, summary: text }),
  cli("result ls", {}, "read"),
  cli("spawned-by", { parent: text }, "reconcilable", [], true),
  cli("group create", { kind: text, name: text }),
  cli("group add", { group: text, agent: text }, "reconcilable", [
    transfer,
    { field: "herdr", flag: "--herdr", when: "herdr_target" },
    {
      field: "allow_close_room",
      flag: "--allow-close-room",
      when: "closes_room",
    },
  ]),
  cli("group remove", { group: text, agent: text }, "reconcilable", [transfer]),
  cli("group lead", { group: text, agent: text }, "reconcilable", [transfer]),
  cli(
    "group reviewers",
    { group: text, agents: Type.Array(Type.Unknown()) },
    "reconcilable",
    [transfer],
  ),
  cli(
    "group now",
    { group: text, items: Type.Array(Type.Unknown()) },
    "reconcilable",
    [transfer],
  ),
  cli("group list", {}, "read"),
  cli("group show", { group: text }, "read"),
  cli("group delete", { group: text }, "reconcilable", [
    transfer,
    { field: "confirmed", flag: "--yes" },
  ]),
  cli(
    "group promote",
    { group: text, name: text, mapping: Type.Array(Type.Unknown()) },
    "reconcilable",
    [transfer],
  ),
  cli("group import", {}, "reconcilable", [
    { field: "confirmed", flag: "--yes" },
  ]),
] as const;
