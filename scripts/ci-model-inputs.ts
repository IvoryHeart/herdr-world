import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { buildGraph } from "./affected";
import { contentInputs } from "./ci-content-key";
import { verificationModels } from "../quint/models";

/** The shared dispatchers select one adapter at runtime. Keep shared code and
 * its dependencies, but do not traverse other models' unselected branches.
 * Mutants read production files by name, so literal source paths are inputs too.
 */
export function modelInputs(root: string, files: string[], model: string) {
  assert(
    verificationModels.includes(model as (typeof verificationModels)[number]),
    "Unknown model key",
  );
  const graph = buildGraph(root, files);
  const aliases: Record<string, string> = {
    "herdr-core-verification": "herdr-core-runtime",
    "connection-registry-verification": "connection-registry",
    "claude-tap-lock-verification": "claude-tap-lock",
    "observation-traces": "observation-base",
    "observation-subjects": "observation-base",
    "effect-subjects": "effect-recovery",
    "creation-fixture": "creation-flow",
    "creation-subjects": "creation-flow",
    "bridge-fixture": "chunk-assembly",
    "runtime-start-control": "runtime-leases",
  };
  const owner = (path: string) => {
    if (!path.startsWith("quint/")) return undefined;
    const name = path.slice(6).replace(/\.[^.]+$/, "");
    return (
      aliases[name] ??
      verificationModels.find(
        (candidate) => name === candidate || name.startsWith(`${candidate}-`),
      ) ??
      (name.startsWith("herdr-core-") ? "herdr-core-runtime" : undefined)
    );
  };
  const roots = files.filter(
    (path) =>
      /^(?:package\.json|bun\.lock|bunfig\.toml|(?:web|server)\/package\.json|.*tsconfig[^/]*\.json)$/.test(
        path,
      ) ||
      (path.startsWith("tools/quint/") && !path.endsWith("README.md")) ||
      (/^scripts\/(?:verification[^/]*|ci-model[^/]*|ci-verification)\.ts$/.test(
        path,
      ) &&
        !path.endsWith(".test.ts")) ||
      (path.startsWith("quint/") &&
        /\.(?:ts|qnt|json)$/.test(path) &&
        !path.endsWith(".test.ts") &&
        (!owner(path) || owner(path) === model)),
  );
  assert(
    roots.includes(`quint/${model}.qnt`) && roots.includes("quint/run.ts"),
    "Missing model input root",
  );
  const dispatchers = new Set([
    "quint/run.ts",
    "quint/traces.ts",
    "quint/replay.ts",
    "quint/composed-cases.ts",
    "scripts/verification-replay.ts",
  ]);
  for (const path of files) {
    if (!/\.(?:qnt|[cm]?[jt]sx?)$/.test(path)) continue;
    const source = readFileSync(resolve(root, path), "utf8");
    const deps = graph.deps.get(path) ?? new Set<string>();
    // Quint imports are not JavaScript imports and need their own resolver.
    const imports =
      /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
    for (const match of source.matchAll(imports)) {
      const target = relative(
        root,
        resolve(root, dirname(path), match[1]!.split("?")[0]!),
      );
      const dependency = [
        "",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".qnt",
        "/index.ts",
        "/index.tsx",
      ]
        .map((suffix) => target + suffix)
        .find((candidate) => graph.files.has(candidate));
      if (dependency) deps.add(dependency);
      else deps.add("__unresolved_model_input__");
    }
    if (
      (path.startsWith("quint/") &&
        path !== "quint/implementationMutation.ts") ||
      path.startsWith("scripts/verification")
    ) {
      for (const match of source.matchAll(
        /["'`]((?:server|web)\/[^"'`$]+\.[cm]?[jt]sx?)["'`]/g,
      ))
        if (graph.files.has(match[1]!)) deps.add(match[1]!);
    }
    // Actual Quint module imports always remain, including cross-model modules.
    graph.deps.set(
      path,
      new Set(
        [...deps].filter(
          (dep) =>
            !dispatchers.has(path) || !owner(dep) || owner(dep) === model,
        ),
      ),
    );
  }
  // Missing imports fail closed rather than minting incomplete reusable evidence.
  return contentInputs(graph, roots);
}
