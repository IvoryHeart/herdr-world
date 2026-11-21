import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { buildGraph, type Graph } from "./affected";
import { fingerprintInputs } from "./verification-evidence";

export type ContentKind = "models" | "installer";

/** The shared runner imports all adapters, so retain that conservative closure.
 * Named data, shell build inputs and tool configuration are explicit roots;
 * newly added files in those inventories enter the key without a mapping edit.
 */
export function contentInputs(
  graph: Graph,
  roots: readonly string[],
): string[] {
  assert(
    roots.length && roots.every((path) => graph.files.has(path)),
    "Missing cache input root",
  );
  const seen = new Set(roots);
  const queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i]!;
    assert(!graph.gone.has(path), "Deleted cache input");
    for (const dependency of graph.deps.get(path) ?? []) {
      assert(graph.files.has(dependency), "Unresolved cache dependency");
      if (!seen.has(dependency)) {
        seen.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return [...seen].sort();
}

export function cacheRoots(
  files: readonly string[],
  kind: ContentKind,
): string[] {
  return files.filter(
    (path) =>
      /^(?:package\.json|bun\.lock|bunfig\.toml|(?:web|server)\/package\.json|.*tsconfig[^/]*\.json)$/.test(
        path,
      ) ||
      path.startsWith(".github/workflows/") ||
      path === "scripts/ci-content-key.ts" ||
      (kind === "models"
        ? /^(?:quint\/|tools\/quint\/|verification\/|scripts\/(?:verification[^/]*|ci-verification[^/]*|ci-model-cache[^/]*|balance-shards\.ts))/.test(
            path,
          )
        : /^(?:web\/(?:index\.html$|vite\.config\.ts$|src\/main\.tsx$|public\/|src\/assets\/)|server\/src\/(?:index\.ts$|storage\/world-worker\.ts$)|LICENSE|.*NOTICES\.md$|DEPENDENCY_LICENSES\.md$|UPSTREAM\.md$|herdr-plugin\.toml$|scripts\/(?:build-version\.ts|package-release\.sh|world-plugin\.ts|check-web-assets\.mjs))/.test(
            path,
          ) && !/\.test\.[cm]?[jt]sx?$/.test(path)),
  );
}

export async function contentKey(
  root: string,
  kind: ContentKind,
  variant: string,
  tools: string,
) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString()
    .split("\0")
    .filter(Boolean);
  const graph = buildGraph(root, files);
  // Unknown relative module resolution must never produce reusable evidence.
  // The ordinary graph resolves source imports; inspect unresolved imports here.
  const scan = contentInputs(graph, cacheRoots(files, kind));
  for (let index = 0; index < scan.length; index++) {
    const path = scan[index]!;
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const source = readFileSync(`${root}/${path}`, "utf8");
    for (const match of source.matchAll(
      /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      // buildGraph's resolver is conservative. A missing local import widens
      // the key to every tracked byte instead of guessing an exclusion.
      const target = relative(
        root,
        resolve(root, path, "..", match[1]!.split("?")[0]!),
      );
      const dependency = [
        "",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        "/index.ts",
        "/index.tsx",
      ]
        .map((suffix) => target + suffix)
        .find((candidate) => graph.files.has(candidate));
      if (!dependency) {
        graph.deps.set(path, new Set(files));
      } else {
        const deps = graph.deps.get(path) ?? new Set();
        deps.add(dependency);
        graph.deps.set(path, deps);
        for (const reachable of contentInputs(graph, [dependency]))
          if (!scan.includes(reachable)) scan.push(reachable);
      }
    }
  }
  const inputs = await fingerprintInputs(
    root,
    contentInputs(graph, cacheRoots(files, kind)),
  );
  const hash = createHash("sha256")
    .update(JSON.stringify({ schema: 1, kind, variant, tools, inputs }))
    .digest("hex");
  return { hash, inputs };
}

if (import.meta.main) {
  const [kind, variant = "", tools = process.versions.bun] =
    process.argv.slice(2);
  assert(
    kind === "models" || kind === "installer",
    "Expected models or installer",
  );
  const key = await contentKey(process.cwd(), kind, variant, tools!);
  console.info(`${kind} ${variant}: ${key.hash} (${key.inputs.length} inputs)`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `hash=${key.hash}\n`);
}
