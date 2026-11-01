import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import type { BindingOperation } from "./world-bindings";
import type {
  BindingEvent,
  BindingResolution,
  SourceBinding,
} from "../world/binding-types";

test("exhaustive record-edit/read orderings never apply an observation or decision to a newer binding revision", () => {
  const root = mkdtempSync(join(tmpdir(), "binding-order-"));
  const writer = openWorldWriter(
    join(root, "world.sqlite"),
    join(root, "legacy.json"),
    1000,
  );
  const call = <T>(operation: BindingOperation): T => {
    const reply = writer.batch(
      [{ ticket: 1, request: { type: "binding", operation } }],
      1000,
    )[0]!;
    if (reply.error) throw new Error(reply.error);
    return reply.result as T;
  };
  const fence = {
    adapter: "synthetic",
    instance: "studio",
    service_incarnation: "service-a",
    generation: 1,
  };
  try {
    for (const policy of [
      "board-string",
      "appearance",
      "tab-colour",
      "interest",
    ] as const)
      for (const observationFirst of [false, true])
        for (const absent of [false, true]) {
          const saved = call<SourceBinding>({
            type: "create",
            input: {
              record_id: `fixture-${policy}-${observationFirst}-${absent}`,
              slot: "to",
              policy,
              adapter: "synthetic",
              instance: "studio",
              kind: "pane",
              native_id: "entity-a",
              evidence: { terminals: ["terminal-a"] },
            },
          });
          const observation: BindingEvent = {
            type: "listing",
            fence,
            complete: true,
            entities: absent
              ? []
              : [{ native_id: "entity-a", terminals: ["terminal-a"] }],
          };
          const decision: BindingEvent = {
            type: "user-keep",
            target: {
              adapter: "synthetic",
              instance: "studio",
              kind: "pane",
              native_id: "entity-b",
              evidence: { terminals: ["terminal-b"] },
            },
          };
          const first = call<BindingResolution>({
            type: "resolve",
            id: saved.id,
            current: fence,
            expectedRevision: saved.revision,
            event: observationFirst ? observation : decision,
          });
          const rejected = call<BindingResolution>({
            type: "resolve",
            id: saved.id,
            current: fence,
            expectedRevision: saved.revision,
            event: observationFirst ? decision : observation,
          });
          expect(rejected.target).toBeNull();
          const current = call<SourceBinding>({ type: "get", id: saved.id });
          expect(current.native_id).toBe(first.binding.native_id);
          expect(current.evidence).toEqual(first.binding.evidence);
          expect(current.revision).toBe(first.binding.revision);
          expect(current.revision).toBe(saved.revision + 1);
        }
  } finally {
    writer.close();
    rmSync(root, { recursive: true, force: true });
  }
});
