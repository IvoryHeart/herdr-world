import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import baseline from "./policy-baseline.json";
import { ACTORS } from "./types";
import { registeredVerb, VERBS } from "./registry";
import { WORLD_CLI_COMMANDS } from "../world/world-cli";

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
  ])
    expect(registeredVerb("rpc", method)!.recovery).toBe("opaque");
});

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
    const ast = parse(readFileSync(join(root, relative), "utf8"), {
      sourceType: "module",
      plugins: relative.endsWith(".tsx")
        ? ["typescript", "jsx"]
        : ["typescript"],
    });
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as {
        type?: string;
        callee?: { type?: string; property?: { name?: string } };
        arguments?: { type?: string; value?: unknown }[];
      };
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
        ) {
          expect(
            registeredVerb("rpc", name.value),
            `${relative}: ${name.value}`,
          ).toBeDefined();
          calls++;
        }
      }
      for (const child of Object.values(value))
        if (Array.isArray(child)) child.forEach(walk);
        else if (child && typeof child === "object") walk(child);
    };
    walk(ast);
  }
  expect(calls).toBeGreaterThan(100);
});
