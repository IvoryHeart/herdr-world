import { expect, test } from "bun:test";
import { Type } from "typebox";
import { admitVerb, checkVerbResult } from "./admission";
import { registeredVerb } from "./registry";
import type { Admission, Verb } from "./types";

const admitted = (): Admission => ({
  actor: "cli_verified",
  authorized: () => true,
  capabilities: () => new Set(["world"]),
  preconditions: () => true,
});
const move = registeredVerb("cli", "town desk move")!;

test("unknown verbs and denied actors cannot dispatch", () => {
  expect(() => admitVerb(undefined, {}, admitted())).toThrow("unregistered");
  expect(() =>
    admitVerb(
      move,
      { target: "tab:t", herdr: true },
      {
        ...admitted(),
        actor: "assistant",
      },
    ),
  ).toThrow("denied");
});

test("TypeBox rejects invalid inputs and outputs at the service boundary", () => {
  expect(() => admitVerb(move, { target: 7, herdr: true }, admitted())).toThrow(
    "invalid parameters",
  );
  const verb: Verb = { ...move, output: Type.Object({ ok: Type.Boolean() }) };
  expect(() => checkVerbResult(verb, { ok: "yes" })).toThrow("invalid result");
  checkVerbResult(verb, { ok: true });
  expect(() =>
    admitVerb(
      registeredVerb("rpc", "pane.send_keys"),
      { keys: 7 },
      {
        ...admitted(),
        actor: "browser",
        capabilities: () => new Set(["runtime"]),
      },
    ),
  ).toThrow("invalid parameters");
  expect(() =>
    checkVerbResult(registeredVerb("rpc", "workspace.list")!, {
      workspaces: 7,
    }),
  ).toThrow("invalid result");
});

test("acknowledgements stay explicit, including conditional role replacement", () => {
  expect(() => admitVerb(move, { target: "tab:t" }, admitted())).toThrow(
    "--herdr",
  );
  admitVerb(move, { target: "tab:t", herdr: true }, admitted());
  const add = registeredVerb("cli", "group add")!;
  admitVerb(add, { group: "team", agent: "agent" }, admitted());
  expect(() =>
    admitVerb(
      add,
      { group: "team", agent: "agent", replace: true },
      admitted(),
    ),
  ).toThrow("--replace --yes");
  admitVerb(
    add,
    { group: "team", agent: "agent", replace: true, confirmed: true },
    admitted(),
  );
  expect(() =>
    admitVerb(
      add,
      { group: "room", agent: "agent", herdr_target: true },
      admitted(),
    ),
  ).toThrow("--herdr");
  expect(() =>
    admitVerb(
      add,
      { group: "room", agent: "agent", herdr: true, closes_room: true },
      admitted(),
    ),
  ).toThrow("--allow-close-room");
  admitVerb(
    add,
    {
      group: "room",
      agent: "agent",
      herdr: true,
      closes_room: true,
      allow_close_room: true,
    },
    admitted(),
  );
  for (const name of ["group delete", "group import"])
    expect(() =>
      admitVerb(registeredVerb("cli", name), { group: "team" }, admitted()),
    ).toThrow("--yes");
});

test("only an owner browser may supply confirmation", () => {
  const verb = registeredVerb("source", "github.pull-request.merge")!;
  const params = { key: "github:pr:example/project#1", verb: "merge" };
  const browser = {
    ...admitted(),
    actor: "browser" as const,
    capabilities: () => new Set(["github"]),
  };
  expect(() => admitVerb(verb, params, browser)).toThrow("confirmation");
  admitVerb(verb, params, { ...browser, browserConfirmed: true });
  for (const actor of ["cli_verified", "cli_unverified"] as const)
    expect(() =>
      admitVerb(verb, params, { ...browser, actor, browserConfirmed: true }),
    ).toThrow("denied");
});

test("dispatch rechecks current authorization, capabilities and preconditions", () => {
  let authorized = true;
  let available = true;
  let current = true;
  const admission: Admission = {
    actor: "cli_verified",
    authorized: () => authorized,
    capabilities: () => new Set(available ? ["world"] : []),
    preconditions: () => current,
  };
  const params = { target: "tab:t", herdr: true };
  admitVerb(move, params, admission);
  authorized = false;
  expect(() => admitVerb(move, params, admission)).toThrow("revoked");
  authorized = true;
  available = false;
  expect(() => admitVerb(move, params, admission)).toThrow("capability");
  available = true;
  current = false;
  expect(() => admitVerb(move, params, admission)).toThrow("precondition");
});
