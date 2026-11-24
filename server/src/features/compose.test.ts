import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeFeatures } from "./compose";
import { serverFeatures } from "./catalog";
import {
  defineFeature,
  featureKey,
  type Feature,
  type FeatureKernel,
  type FeatureRpcHandler,
} from "./contract";
import { declare, object, policies, result } from "../verbs/declaration";
import type { ConnectionStatus } from "../connections/types";
import { rpcInput, rpcOutput } from "../verbs/rpc-contracts";
import { registeredVerb } from "../verbs/registry";

import { testFeatureKernel } from "../testing/features";
import { usageKey } from "./usage/register";
import { apartmentsKey } from "./apartments/register";
const kernel = testFeatureKernel();
const verb = (name: string) =>
  declare(
    "rpc",
    name,
    object(),
    result,
    "read",
    policies({ browser: "allow" }),
    ["world"],
    [],
  );
const noop = () => {};
function fixture(
  id: string,
  requires: string[] = [],
  created: string[] = [],
): Feature {
  return defineFeature({
    id: featureKey(id),
    capability: "test",
    requires: requires.map((id) => featureKey(id)),
    verbs: [],
    create: () => {
      created.push(id);
      return { api: id, rpc: {} };
    },
  });
}

test("composition exhausts input permutations; dependencies precede consumers, ties use id", () => {
  const permutations = <T>(values: T[]): T[][] =>
    values.length
      ? values.flatMap((v, i) =>
          permutations(values.filter((_, j) => j !== i)).map((tail) => [
            v,
            ...tail,
          ]),
        )
      : [[]];
  const created: string[] = [];
  const entries = [
    fixture("z", [], created),
    fixture("a", ["z"], created),
    fixture("b", [], created),
  ];
  for (const order of permutations(entries)) {
    created.length = 0;
    composeFeatures(kernel, order);
    expect(created).toEqual(["b", "z", "a"]);
  }
});

test("invalid graphs and duplicate methods fail before any factory runs", () => {
  const created: string[] = [];
  for (const [entries, error] of [
    [
      [fixture("a", [], created), fixture("a", [], created)],
      "Duplicate feature",
    ],
    [[fixture("a", ["missing"], created)], "Missing feature"],
    [[fixture("a", ["b"], created), fixture("b", ["a"], created)], "cycle"],
    [[fixture("a", ["a"], created)], "cycle"],
    [
      [
        ...["a", "b"].map((id) => ({
          ...fixture(id, [], created),
          verbs: [verb("world.test")],
        })),
      ],
      "Duplicate feature method",
    ],
  ] as const) {
    expect(() => composeFeatures(kernel, entries)).toThrow(error);
    expect(created).toEqual([]);
  }
});

test("typed dependency keys expose only declared, already created APIs", () => {
  const key = featureKey<{ answer: number }>("provider");
  const provider = defineFeature({
    ...fixture(key),
    id: key,
    create: () => ({ api: { answer: 42 }, rpc: {} }),
  });
  let answer = 0;
  const consumer = {
    ...fixture("consumer", [key]),
    create: (_: FeatureKernel, get: Parameters<Feature["create"]>[1]) => {
      answer = get(key).answer;
      return { api: undefined, rpc: {} };
    },
  };
  composeFeatures(kernel, [consumer, provider]);
  expect(answer).toBe(42);
  expect(() =>
    composeFeatures(kernel, [{ ...consumer, requires: [] }, provider]),
  ).toThrow("Undeclared");
});

test("hooks run forward; each stop phase awaits dependents before providers", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entries = ["provider", "consumer"].map((id) => ({
    ...fixture(id, id === "consumer" ? ["provider"] : []),
    create: () => ({
      api: undefined,
      rpc: {},
      listening: (port: number) => {
        calls.push(`${id}:${port}`);
      },
      connectionStatus: (status: ConnectionStatus) => {
        calls.push(`${id}:${status.id}:${status.generation}`);
      },
      stop: Object.fromEntries(
        ["quiesce", "drain", "close"].map((phase) => [
          phase,
          async () => {
            calls.push(`${id}:${phase}`);
            if (id === "consumer" && phase === "drain") await blocked;
          },
        ]),
      ),
    }),
  }));
  const composed = composeFeatures(kernel, entries);
  expect(composed.hasStop("drain")).toBe(true);
  composed.listening(1234);
  composed.connectionStatus({
    id: "example",
    generation: 7,
  } as ConnectionStatus);
  await composed.stop("quiesce");
  const drain = composed.stop("drain");
  expect(calls.at(-1)).toBe("consumer:drain");
  expect(calls).not.toContain("provider:drain");
  release();
  await drain;
  await composed.stop("close");
  expect(calls).toEqual([
    "provider:1234",
    "consumer:1234",
    "provider:example:7",
    "consumer:example:7",
    "consumer:quiesce",
    "provider:quiesce",
    "consumer:drain",
    "provider:drain",
    "consumer:close",
    "provider:close",
  ]);
});

test("missing and extra RPC handlers are refused", () => {
  const cases: Record<string, FeatureRpcHandler>[] = [
    {},
    { "world.test": noop, "world.extra": noop },
  ];
  for (const rpc of cases)
    expect(() =>
      composeFeatures(kernel, [
        {
          ...fixture("bad"),
          verbs: [verb("world.test")],
          create: () => ({ api: undefined, rpc }),
        },
      ]),
    ).toThrow("declarations differ");
});

test("every discovered feature implements exactly its registered RPC declarations", async () => {
  expect(serverFeatures.map((f) => String(f.id))).toEqual([
    "apartments",
    "appearance",
    "artefacts",
    "desk",
    "integrations",
    "memory",
    "presence",
    "usage",
  ]);
  const composed = composeFeatures(kernel);
  expect(composed.hasStop("quiesce")).toBe(true);
  expect(composed.hasStop("drain")).toBe(false);
  expect(composed.hasStop("close")).toBe(true);
  const usage = composed.get(usageKey),
    calls: string[] = [];
  usage.connectionStatus = (status) => {
    calls.push(status.id);
  };
  usage.close = async () => {
    calls.push("close");
  };
  composed.connectionStatus({ id: "host-a" } as ConnectionStatus);
  const stopping = composed.stop("quiesce");
  expect(calls).toEqual(["host-a", "close"]);
  await stopping;
  const apartments = composed.get(apartmentsKey);
  apartments.stop = async () => {
    calls.push("apartments:stop");
  };
  apartments.apartments.connectionStatus = (status) => {
    calls.push(`apartments:${status.id}`);
  };
  composed.connectionStatus({ id: "host-b" } as ConnectionStatus);
  expect(calls).toContain("apartments:host-b");
  await composed.stop("close");
  expect(calls.at(-1)).toBe("apartments:stop");
  expect([...composed.rpc.keys()].sort()).toEqual(
    serverFeatures
      .flatMap((f) =>
        f.verbs.filter((v) => v.channel === "rpc").map((v) => v.name),
      )
      .sort(),
  );
  for (const feature of serverFeatures)
    for (const verb of feature.verbs)
      expect(registeredVerb(verb.channel, verb.name)).toBe(verb);
  const presence = registeredVerb("rpc", "world.presence.seen")!;
  expect(presence.input).toEqual(rpcInput(presence.name));
  expect(presence.output).toEqual(rpcOutput(presence.name));
  expect(presence.recovery).toBe("reconcilable");
  expect(presence.capabilities).toEqual(["world"]);
  expect(presence.preconditions).toEqual(["operation owner validation"]);
});

test("feature sources never call the default runtime helper", () => {
  const forbidden = "default" + "ReadyRuntime";
  for (const path of new Bun.Glob("**/*.ts").scanSync(import.meta.dir))
    expect(
      readFileSync(join(import.meta.dir, path), "utf8"),
      path,
    ).not.toContain(forbidden);
});
