import { expect, test } from "bun:test";
import { resolveBinding } from "./binding-resolution";
import {
  type BindingFence,
  type BindingPolicy,
  type SourceBinding,
} from "./binding-types";

const policies = [
  "board-string",
  "appearance",
  "tab-colour",
  "interest",
] as const;
export const fence: BindingFence = {
  adapter: "synthetic",
  instance: "studio",
  service_incarnation: "service-a",
  generation: 1,
};
export const binding = (
  policy: BindingPolicy = "board-string",
): SourceBinding => ({
  id: "b-fixture",
  record_id: "n-fixture",
  slot: "to",
  policy,
  adapter: "synthetic",
  instance: "studio",
  kind: "pane",
  native_id: "pane-a",
  evidence: { terminals: ["terminal-a"] },
  state: "unresolved",
  checked_at: null,
});
const listing = (
  entities: { native_id: string; terminals: string[]; session?: string }[],
  complete = true,
) => ({ type: "listing" as const, fence, complete, entities });

test("per-kind exhaustive observation table refuses reuse, ambiguity, partial and foreign fences", () => {
  for (const policy of policies)
    for (const complete of [false, true])
      for (const native of ["pane-a", "pane-b"])
        for (const terminal of ["terminal-a", "terminal-b"])
          for (const duplicate of [false, true])
            for (const fresh of [false, true]) {
              const saved = binding(policy);
              const entity = { native_id: native, terminals: [terminal] };
              const event = listing(
                duplicate ? [entity, entity] : [entity],
                complete,
              );
              const result = resolveBinding(
                saved,
                event,
                fresh ? fence : { ...fence, service_incarnation: "service-b" },
                1000,
              );
              const attached =
                complete &&
                fresh &&
                terminal === "terminal-a" &&
                !duplicate &&
                (native === "pane-a" || policy !== "board-string");
              expect(result.binding.state === "attached").toBe(attached);
              expect(result.target !== null).toBe(attached);
              if (
                !complete ||
                !fresh ||
                (duplicate &&
                  (native === "pane-a" || terminal === "terminal-a"))
              ) {
                expect(result.binding.state).toBe("unresolved");
                expect(result.binding.native_id).toBe(saved.native_id);
                expect(result.binding.evidence).toEqual(saved.evidence);
              }
            }
});

test("authoritative absence is declared per kind and must name the current target", () => {
  for (const policy of policies)
    for (const via of ["close", "not-found"] as const)
      for (const native_id of ["pane-a", "pane-b"])
        for (const fresh of [false, true]) {
          const saved = binding(policy);
          const result = resolveBinding(
            saved,
            { type: "absence", via, native_id, fence },
            fresh ? fence : { ...fence, generation: 2 },
            1000,
          );
          expect(result.binding.state === "ended").toBe(
            fresh &&
              native_id === "pane-a" &&
              (via === "close"
                ? ["board-string", "tab-colour"].includes(policy)
                : policy === "board-string"),
          );
          expect(result.target).toBeNull();
        }
  for (const policy of policies)
    expect(
      resolveBinding(binding(policy), listing([]), fence, 1000).binding
        .state === "ended",
    ).toBe(policy !== "board-string");
});

test("World moves preserve witnesses; outside and lost-reply moves obey each kind's policy", () => {
  const target = { native_id: "pane-b", terminals: ["terminal-a"] };
  for (const policy of ["board-string", "appearance"] as const) {
    const moved = resolveBinding(
      binding(policy),
      { type: "world-move", fence, from: "pane-a", target },
      fence,
      1000,
    );
    expect(moved.binding.native_id).toBe("pane-b");
    expect(moved.target?.native_id).toBe("pane-b");
    const observed = resolveBinding(
      binding(policy),
      listing([target]),
      fence,
      1000,
    );
    expect(observed.binding.state).toBe(
      policy === "appearance" ? "attached" : "unresolved",
    );
    expect(observed.binding.native_id).toBe(
      policy === "appearance" ? "pane-b" : "pane-a",
    );
    expect(
      resolveBinding(
        binding(policy),
        {
          type: "world-move",
          fence,
          from: "pane-a",
          target: { ...target, terminals: ["terminal-b"] },
        },
        fence,
        1000,
      ).target,
    ).toBeNull();
  }
});

test("sessions, unknown identity, weak anchors, ended lifetimes and explicit decisions", () => {
  const saved = binding();
  saved.evidence.session = "session-a";
  expect(
    resolveBinding(
      saved,
      listing([
        {
          native_id: "pane-a",
          terminals: ["terminal-a"],
          session: "session-b",
        },
      ]),
      fence,
      1000,
    ).binding.state,
  ).toBe("unconfirmed");
  delete saved.evidence.session; // Explicit unknown session binds only to its terminal.
  expect(
    resolveBinding(
      saved,
      listing([{ native_id: "pane-a", terminals: ["terminal-b"] }]),
      fence,
      1000,
    ).binding.state,
  ).toBe("unconfirmed");
  expect(
    resolveBinding(
      saved,
      listing([{ native_id: "pane-a", terminals: ["terminal-a"] }]),
      fence,
      1000,
    ).target,
  ).not.toBeNull();
  const weak = {
    ...saved,
    kind: "workspace" as const,
    evidence: { terminals: [] },
  };
  const result = resolveBinding(
    weak,
    listing([{ native_id: "pane-a", terminals: [] }]),
    fence,
    1000,
  );
  expect(result.binding.state).toBe("attached");
  expect(result.target).toBeNull();
  saved.state = "ended";
  expect(
    resolveBinding(
      saved,
      listing([{ native_id: "pane-a", terminals: ["terminal-a"] }]),
      fence,
      1000,
    ).binding.state,
  ).toBe("ended");
  expect(
    resolveBinding(saved, { type: "user-keep", target: saved }, fence, 1000)
      .binding.state,
  ).toBe("unresolved");
});
