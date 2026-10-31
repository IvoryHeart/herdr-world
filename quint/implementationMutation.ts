import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Model } from "./traces";
import { removeRuntimeStartGuard } from "./runtime-start-control";

export type ImplementationFault =
  | "binding-duplicate"
  | "binding-listing-move"
  | "binding-absence"
  | "binding-partial"
  | "binding-authority"
  | "primary"
  | "background-guard"
  | "catalogue"
  | "retired-owner"
  | "selected-hint"
  | "credit-index"
  | "qualified-generation"
  | "chunk-index"
  | "admission-fence"
  | "incarnation-reset";
export async function mutateImplementation(
  name: Model,
  fault: ImplementationFault,
  { root, output }: { root: string; output: string },
) {
  const allowed: Partial<Record<Model, readonly ImplementationFault[]>> = {
    "binding-resolution": [
      "primary",
      "binding-duplicate",
      "binding-listing-move",
      "binding-absence",
      "binding-partial",
      "binding-authority",
    ],
    "observation-base": ["primary", "incarnation-reset"],
    "runtime-drain": ["primary", "background-guard"],
    "creation-flow": ["primary", "admission-fence"],
    "browser-refresh": ["primary", "catalogue"],
    "browser-preparation": [
      "primary",
      "retired-owner",
      "selected-hint",
      "qualified-generation",
    ],
    "chunk-credits": ["primary", "credit-index"],
    "chunk-assembly": ["primary", "chunk-index"],
  };
  assert(
    (allowed[name] ?? ["primary"]).includes(fault),
    "Unsupported model/fault combination",
  );
  const owners: Record<Model, string> = {
    "binding-resolution": "server/src/world/binding-resolution.ts",
    "observation-base": "server/src/world/observation-v1.ts",
    "runtime-leases": "server/src/connections/manager.ts",
    "runtime-control": "server/src/connections/manager.ts",
    "runtime-drain": "server/src/connections/manager.ts",
    "browser-refresh": "web/src/world/runtimeStore.ts",
    "browser-preparation": "web/src/world/runtimeStore.ts",
    "space-admission": "web/src/world/spaceAdmission.ts",
    "chunk-credits": "server/src/bridge/world-snapshot-admission.ts",
    "chunk-assembly": "web/src/api.ts",
    "creation-flow": "web/src/creationRequests.ts",
    "ranger-authority": "server/src/assistant/actions.ts",
    "ranger-recovery": "server/src/assistant/task-storage.ts",
  };
  const owner =
    name === "observation-base" && fault === "incarnation-reset"
      ? "web/src/world/observationBase.ts"
      : name === "creation-flow" && fault === "admission-fence"
        ? "web/src/world/createdTerminalAdmission.ts"
        : owners[name];
  const original = await readFile(resolve(root, owner), "utf8");
  let contents: string;
  if (name === "binding-resolution") {
    const mutations = {
      primary: [
        /evidence\.terminals\.some\(\(id\) =>\s*entity\.terminals\.includes\(id\)\)/,
        "true",
      ],
      "binding-duplicate": [/if \(duplicate\)/, "if (false && duplicate)"],
      "binding-listing-move": [
        /policy\.listingMove && witnessed\.length === 1/,
        "witnessed.length === 1",
      ],
      "binding-absence": [/bindingPolicies\[policy\]\.listingAbsence/, "true"],
      "binding-partial": [
        /if \(!event\.complete\)\s*return finish\("unresolved"\);/,
        'if (!event.complete) { binding.native_id = "unverified"; return finish("unresolved"); }',
      ],
      "binding-authority": [/state === "attached"/, "true"],
    } as const;
    const [guard, replacement] = mutations[fault as keyof typeof mutations];
    assert(guard.test(original), "binding mutation guard changed");
    contents = original.replace(guard, replacement);
  } else if (name === "observation-base") {
    if (fault === "incarnation-reset") {
      const guard = /const held =\s*state.serviceIncarnation === incarnation/;
      assert.match(original, guard);
      contents = original.replace(guard, "const held = true");
    } else {
      const guard =
        "previous.generation === connection.generation &&\n          previous.generation === connection.snapshot_generation";
      assert.equal(original.split(guard).length, 2);
      contents = original.replace(guard, "true");
    }
  } else if (name === "ranger-recovery") {
    const guard =
      "const save = db.transaction((state: SavedTaskState) =>\n      write(validate(state)),\n    );";
    assert.equal(
      original.split(guard).length,
      2,
      "Ranger transaction boundary changed",
    );
    contents = original.replace(
      guard,
      "const save = { immediate: (state: SavedTaskState) => write(validate(state)) };",
    );
  } else if (name === "ranger-authority") {
    const guard = "lease.isCurrent() && (!authorized || authorized())";
    assert.equal(
      original.split(guard).length,
      2,
      "Ranger live authorization changed",
    );
    contents = original.replace(guard, "lease.isCurrent()");
  } else if (name === "creation-flow") {
    if (fault === "admission-fence") {
      const guard =
        "if (state.invalidReason) return finish(new Error(state.invalidReason));";
      assert.equal(
        original.split(guard).length,
        2,
        "created admission fence changed",
      );
      contents = original.replace(
        guard,
        "if (false) return finish(new Error(state.invalidReason));",
      );
    } else {
      const guard = "owner.connectionId,\n    owner.runtimeGeneration,";
      assert.equal(
        original.split(guard).length,
        2,
        "creation owner key changed",
      );
      contents = original.replace(
        guard,
        '"synthetic-shared-owner",\n    owner.runtimeGeneration,',
      );
    }
  } else if (name === "chunk-assembly") {
    if (fault === "chunk-index") {
      const guard = "chunk.index !== (pending.chunks?.parts.length ?? 0)";
      assert.equal(
        original.split(guard).length,
        2,
        "assembly index guard changed",
      );
      contents = original.replace(guard, "false");
    } else {
      const guard =
        "ws.onmessage = (ev) => {\n      if (this.ws !== ws) return;";
      assert.equal(
        original.split(guard).length,
        2,
        "old-socket receive guard changed",
      );
      contents = original.replace(guard, "ws.onmessage = (ev) => {");
    }
  } else if (name === "chunk-credits") {
    if (fault === "credit-index") {
      const guard = "if (waiting && waiting.index === admitted.index) {";
      assert.equal(
        original.split(guard).length,
        2,
        "credit index guard changed",
      );
      contents = original.replace(guard, "if (waiting) {");
    } else {
      const storage = "new WeakMap<object, Map<string, Transfer>>()";
      const guard = "this.sockets.get(socket)?.get(admitted.id)";
      assert.equal(original.split(storage).length, 2);
      assert.equal(original.split(guard).length, 2);
      contents = original
        .replace(storage, "new Map<object, Map<string, Transfer>>()")
        .replace(
          guard,
          "[...this.sockets.values()].map(transfers => transfers.get(admitted.id)).find(transfer => transfer?.waiting?.index === admitted.index)",
        );
    }
  } else if (name === "runtime-drain") {
    contents = removeRuntimeStartGuard(
      original,
      fault === "background-guard" ? "background" : "transport",
    );
  } else if (name === "runtime-leases" || name === "runtime-control") {
    const guard =
      'entry.state === "ready" && this.isCurrent(entry, generation, runtime)';
    assert.equal(
      original.split(guard).length,
      2,
      "lease mutation target changed",
    );
    contents = original.replace(guard, 'entry.state === "ready"');
  } else if (name === "browser-refresh" || name === "browser-preparation") {
    if (fault === "qualified-generation") {
      const guard =
        ".connection(connection.connectionId, connection.generation)";
      assert.equal(
        original.split(guard).length,
        2,
        "qualified generation target changed",
      );
      contents = original.replace(
        guard,
        ".connection(connection.connectionId)",
      );
    } else if (fault === "selected-hint") {
      const guard = "selected_connection_id: this.selectedConnectionId";
      assert.equal(
        original.split(guard).length,
        2,
        "selected hint target changed",
      );
      contents = original.replace(
        guard,
        'selected_connection_id: "synthetic-unowned"',
      );
    } else if (fault === "retired-owner") {
      const guard =
        "this.client\n              .connection(connection.connectionId, connection.generation)\n              .isCurrent()";
      assert.equal(
        original.split(guard).length,
        2,
        "owner revalidation target changed",
      );
      contents = original.replace(guard, "true");
    } else if (fault === "catalogue") {
      const getter = "get = () => this.state;";
      assert.equal(
        original.split(getter).length,
        2,
        "catalogue mutation target changed",
      );
      contents = original.replace(
        getter,
        "get = () => ({ ...this.state, connections: [] });",
      );
    } else {
      assert(original.includes("observationEpoch !== this.observationEpoch"));
      assert(original.includes("observationEpoch === this.observationEpoch"));
      contents = original
        .replaceAll("observationEpoch !== this.observationEpoch", "false")
        .replaceAll("observationEpoch === this.observationEpoch", "true")
        .replaceAll("epoch !== this.observationEpoch", "false")
        .replaceAll("epoch === this.observationEpoch", "true");
    }
  } else {
    const guard = "const admitted = ordered.filter(relevant).slice(0, bound);";
    assert.equal(
      original.split(guard).length,
      2,
      "allocator mutation target changed",
    );
    contents = original.replace(
      guard,
      `return ordered.slice(0, bound);\n${guard}`,
    );
  }
  // Substitute exactly one source module in an ignored bundle. Never mutate the
  // checkout or put faulty code in the application dependency graph.
  let substituted = false;
  const bundle = await Bun.build({
    entrypoints: [
      resolve(
        root,
        name === "creation-flow"
          ? "quint/creation-subjects.ts"
          : name === "observation-base"
            ? "quint/observation-subjects.ts"
            : owner,
      ),
    ],
    target: "bun",
    plugins: [
      {
        name: "quint-negative-control",
        setup(build) {
          build.onLoad({ filter: /\.ts$/ }, (args) => {
            if (args.path !== resolve(root, owner)) return;
            substituted = true;
            return { contents, loader: "ts" };
          });
        },
      },
    ],
  });
  assert(
    bundle.success && substituted,
    "implementation mutation bundle failed",
  );
  const path = resolve(output, `${name}-${fault}-implementation-mutant.mjs`);
  await writeFile(path, await bundle.outputs[0]!.text());
  return path;
}
