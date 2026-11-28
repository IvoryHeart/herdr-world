import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import baseline from "./policy-baseline.json";
import { ACTORS } from "./types";
import { registeredVerb, VERBS } from "./registry";
import { WORLD_CLI_COMMANDS } from "../world/world-cli";

test("P4: the hand-recorded policy table stays sorted by verb key", () => {
  expect(Object.keys(baseline)).toEqual(Object.keys(baseline).sort());
});

test("P4: every legacy verb × actor equals the independently recorded policy table", () => {
  expect(VERBS.map((verb) => `${verb.channel}:${verb.name}`).sort()).toEqual(
    Object.keys(baseline).sort(),
  );
  for (const verb of VERBS) {
    const key = `${verb.channel}:${verb.name}` as keyof typeof baseline;
    expect(ACTORS.map((actor) => verb.policy[actor]).join(" ")).toBe(
      baseline[key],
    );
    expect(verb.queueable).toBe(verb.channel === "effect");
  }
  expect(
    VERBS.filter((verb) => verb.channel === "cli")
      .map((verb) => verb.name)
      .sort(),
  ).toEqual([...WORLD_CLI_COMMANDS].sort());
  for (const method of [
    "pane.send_text",
    "pane.send_keys",
    "terminal.input",
    "agent_conversation.send",
    "agent_conversation.answer",
    "agent_conversation.press",
    "agent_conversation.trust",
  ])
    expect(registeredVerb("rpc", method)!.recovery).toBe("opaque");
});

// A CallExpression's `call` identifier must appear literally or use a Unicode
// escape. Keep escape-bearing sources on the parser path, including escaped
// property identifiers and RPC string literals. This avoids parsing unrelated
// UI files during the five-second inventory check on parallel CI runners.
function browserRPCCalls(source: string, tsx = false): string[] {
  if (!source.includes("call") && !source.includes("\\")) return [];
  const calls: string[] = [];
  const ast = parse(source, {
    sourceType: "module",
    attachComment: false,
    plugins: tsx ? ["typescript", "jsx"] : ["typescript"],
  });
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as {
      type?: string;
      callee?: { type?: string; property?: { name?: string } };
      arguments?: { type?: string; value?: unknown }[];
    };
    // Locations and parser metadata cannot contain call expressions.
    if (!node.type) return;
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      node.callee.property?.name === "call"
    ) {
      const name = node.arguments?.[0];
      if (
        name?.type === "StringLiteral" &&
        typeof name.value === "string" &&
        /^[a-z_]+\.[a-z_.]+$/.test(name.value)
      )
        calls.push(name.value);
    }
    for (const child of Object.values(value))
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
  };
  walk(ast);
  return calls;
}

test.each([
  ['rpc.call("world.read")', ["world.read"]],
  ['rpc /* gap */ . call ("world.read")', ["world.read"]],
  [String.raw`rpc.c\u0061ll("world.read")`, ["world.read"]],
  [String.raw`rpc.\u{63}all("world.read")`, ["world.read"]],
  [String.raw`rpc.c\u0061ll("world.\u0072ead")`, ["world.read"]],
  ['const node = <div>{rpc.call("world.read")}</div>', ["world.read"]],
  [
    'rpc.call("world.read"); rpc.call("world.read")',
    ["world.read", "world.read"],
  ],
  [
    `// rpc.call("unknown.method")\nconst message = 'rpc.call("unknown.method")'`,
    [],
  ],
  ['rpc.call(dynamic); rpc.call("shortcut"); rpc.other("unknown.method")', []],
  ["export const unrelated = <div>Read the world</div>", []],
])(
  "P4: browser RPC inventory keeps syntax and escapes: %s",
  (source, expected) => {
    expect(browserRPCCalls(source, true)).toEqual(expected);
  },
);

// Read call expressions, rather than arbitrary string literals (which include
// notifications, shortcuts and Board op names). Dynamic assistant names are
// separately enumerated in the baseline and exercised by its existing suites.
test("P4: every literal browser RPC call is registered", () => {
  const root = join(import.meta.dir, "../../..", "web/src");
  let calls = 0;
  for (const relative of readdirSync(root, { recursive: true }) as string[]) {
    if (
      !/\.(?:ts|tsx)$/.test(relative) ||
      /(?:\.test\.|testing\/)/.test(relative)
    )
      continue;
    for (const name of browserRPCCalls(
      readFileSync(join(root, relative), "utf8"),
      relative.endsWith(".tsx"),
    )) {
      expect(registeredVerb("rpc", name), `${relative}: ${name}`).toBeDefined();
      calls++;
    }
  }
  expect(calls).toBeGreaterThan(100);
});
