import { expect, test } from "bun:test";
import { resolveBinding } from "./binding-resolution";
import type {
  BindingFence,
  BindingPolicy,
  SourceBinding,
} from "./binding-types";
const fence: BindingFence = {
  adapter: "synthetic",
  instance: "studio",
  service_incarnation: "service-a",
  generation: 1,
};
const binding = (policy: BindingPolicy): SourceBinding => ({
  id: "b-fixture",
  record_id: "d-fixture",
  slot: "target",
  revision: 0,
  state: "unresolved",
  checked_at: null,
  policy,
  adapter: "synthetic",
  instance: "studio",
  kind: "pane",
  native_id: "pane-a",
  evidence: { terminals: ["terminal-a"] },
});

test("terminal-mark declarations exhaust complete/fence/ambiguity/session/absence combinations", () => {
  for (const policy of ["desk", "watchlist", "completion-seen"] as const)
    for (const knownSession of [false, true])
      for (const complete of [false, true])
        for (const fresh of [false, true])
          for (const duplicate of [false, true])
            for (const present of [false, true])
              for (const sameSession of [false, true]) {
                const saved = {
                  ...binding(policy),
                  evidence: {
                    terminals: ["terminal-a"],
                    ...(knownSession && policy !== "watchlist"
                      ? { session: "session-a" }
                      : {}),
                  },
                };
                const entity = {
                  native_id: "moved-pane",
                  terminals: ["terminal-a"],
                  session: sameSession ? "session-a" : "session-b",
                };
                const entities = present ? [entity] : [];
                if (duplicate)
                  entities.push(
                    {
                      native_id: "other-pane",
                      terminals: ["other-terminal"],
                      session: entity.session,
                    },
                    {
                      native_id: "another-pane",
                      terminals: ["another-terminal"],
                      session: entity.session,
                    },
                  );
                const result = resolveBinding(
                  saved,
                  { type: "listing", fence, complete, entities },
                  fresh ? fence : { ...fence, generation: 2 },
                  1000,
                );
                const authoritative = complete && fresh && !duplicate;
                const sessionMatches = !saved.evidence.session || sameSession;
                expect(result.target !== null).toBe(
                  authoritative && present && sessionMatches,
                );
                expect(result.binding.state === "ended").toBe(
                  authoritative && (!present || !sessionMatches),
                );
                if (!authoritative)
                  expect(result.binding.evidence).toEqual(saved.evidence);
              }
});
