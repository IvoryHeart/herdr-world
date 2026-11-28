import { parse } from "@babel/parser";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inlineBrowserScripts } from "./testing/inline-browser-scripts";

const ALLOWLIST = "scripts/clock-ports-allowlist.json";
const PORTS = new Set([
  "web/src/clock.ts",
  "server/src/service/clock.ts",
  "server/src/service/scheduler.ts",
]);
type Node = {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: any;
};
type Counts = Record<string, number>;
type Entries = Record<string, { counts: Counts; reason: string }>;

/** @internal Native readers/schedulers, including callbacks and imported aliases. */
export function directTimeCalls(
  path: string,
  source: string,
  inline = true,
): Counts {
  const counts: Counts = {};
  if (PORTS.has(path)) return counts;
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: path.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
  });
  const globals = new Set(["window", "globalThis", "self"]);
  const timerObjects = new Set(globals),
    perfObjects = new Set<string>();
  const timers = new Map(
    ["setTimeout", "setInterval", "requestAnimationFrame"].map((name) => [
      name,
      name,
    ]),
  );
  const readers = new Map([
    ["Date", "Date"],
    ["performance", "performance"],
  ]);
  for (const declaration of ast.program.body) {
    if (declaration.type !== "ImportDeclaration") continue;
    const timerModule = /^(?:node:)?timers(?:\/promises)?$/.test(
      declaration.source.value,
    );
    const perfModule = /^(?:node:)?perf_hooks$/.test(declaration.source.value);
    if (!timerModule && !perfModule) continue;
    for (const item of declaration.specifiers) {
      if (item.type === "ImportSpecifier") {
        const name =
          item.imported.type === "Identifier"
            ? item.imported.name
            : item.imported.value;
        if (timerModule && timers.has(name)) timers.set(item.local.name, name);
        if (perfModule && name === "performance")
          readers.set(item.local.name, "performance");
      } else if (timerModule) timerObjects.add(item.local.name);
      else perfObjects.add(item.local.name);
    }
  }
  const property = (node: Node) =>
    node.computed ? node.property?.value : node.property?.name;
  const member = (node: Node) =>
    ["MemberExpression", "OptionalMemberExpression"].includes(node.type);
  const reader = (node: Node): string | undefined => {
    if (node.type === "Identifier") return readers.get(node.name);
    if (
      member(node) &&
      (globals.has(node.object?.name) || perfObjects.has(node.object?.name))
    ) {
      const name = property(node);
      if (
        name === "performance" ||
        (name === "Date" && globals.has(node.object?.name))
      )
        return name;
    }
  };
  const bindings = new WeakSet<object>();
  const references = new Set([
    "callee",
    "init",
    "right",
    "argument",
    "arguments",
    "elements",
    "value",
    "consequent",
    "alternate",
    "expression",
    "object",
  ]);
  const visit = (node: Node, parent?: Node, slot?: string) => {
    let operation: string | undefined;
    if (node.type === "ObjectPattern")
      for (const item of node.properties) bindings.add(item);
    if (member(node)) {
      const owner = reader(node.object),
        name = property(node);
      if (owner && name === "now") operation = owner + ".now";
      else if (timerObjects.has(node.object?.name) && timers.has(name))
        operation = timers.get(name);
    } else if (
      node.type === "Identifier" &&
      timers.has(node.name) &&
      references.has(slot || "") &&
      !["TSQualifiedName", "TSTypeQuery"].includes(parent?.type || "") &&
      !bindings.has(parent!)
    ) {
      operation = timers.get(node.name);
    } else if (
      (node.type === "NewExpression" || node.type === "CallExpression") &&
      reader(node.callee) === "Date" &&
      (node.type === "CallExpression" || !node.arguments.length)
    )
      operation = node.type === "NewExpression" ? "new Date" : "Date()";
    if (operation) counts[operation] = (counts[operation] ?? 0) + 1;
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "tokens", "comments"].includes(key)) continue;
      for (const child of Array.isArray(value) ? value : [value])
        if (child && typeof child === "object" && "type" in child)
          visit(child as Node, node, key);
    }
  };
  visit(ast as unknown as Node);
  if (inline)
    for (const script of inlineBrowserScripts(path, source)) {
      for (const [operation, count] of Object.entries(
        directTimeCalls("inline.js", script, false),
      ))
        counts[operation] = (counts[operation] ?? 0) + count;
    }
  return counts;
}

/** @internal Adoption snapshot; later changes can only lower each operation. */
export function clockEntries(files: Map<string, string>): Entries {
  return Object.fromEntries(
    [...files]
      .filter(([path]) => /^(?:web|server|shared)\//.test(path))
      .flatMap(([path, source]) => {
        const counts = directTimeCalls(path, source);
        return Object.keys(counts).length
          ? [
              [
                path,
                {
                  counts,
                  reason:
                    "Legacy native time; migrate this owner to the injected clock/scheduler port.",
                },
              ],
            ]
          : [];
      })
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}

/** @internal Exact per-operation ratchet, including the committed baseline. */
export function compareClocks(
  current: Entries,
  allowed: Entries,
  base?: Entries,
): string[] {
  const problems: string[] = [];
  for (const path of new Set([
    ...Object.keys(current),
    ...Object.keys(allowed),
  ])) {
    const entry = allowed[path];
    if (entry && (!entry.reason?.trim() || /\n/.test(entry.reason)))
      problems.push(`${path}: clock allowlist needs a one-line reason`);
    for (const operation of new Set([
      ...Object.keys(current[path]?.counts ?? {}),
      ...Object.keys(entry?.counts ?? {}),
    ])) {
      const count = current[path]?.counts[operation] ?? 0;
      const limit = entry?.counts[operation] ?? 0;
      if (!Number.isSafeInteger(limit) || limit < 0 || count !== limit)
        problems.push(
          `${path}: ${operation} ${count}, allowlist ${limit}; inject time or lower the allowlist`,
        );
      if (base && limit > (base[path]?.counts[operation] ?? 0))
        problems.push(`${path}: ${operation} allowlist may only shrink`);
    }
  }
  return problems;
}

export function checkClockPorts(
  root: string,
  files: Map<string, string>,
  update: boolean,
  baseRef?: string,
) {
  const current = clockEntries(files);
  const allowed = JSON.parse(readFileSync(join(root, ALLOWLIST), "utf8"))
    .files as Entries;
  let base: Entries | undefined;
  if (baseRef) {
    const old = Bun.spawnSync(["git", "show", `${baseRef}:${ALLOWLIST}`], {
      cwd: root,
    });
    if (old.exitCode === 0) base = JSON.parse(old.stdout.toString()).files;
    else {
      // First adoption may list only uses already present at the immutable base.
      const previous = new Map<string, string>();
      for (const path of Object.keys(current)) {
        const source = Bun.spawnSync(["git", "show", baseRef + ":" + path], {
          cwd: root,
        });
        if (source.exitCode === 0) previous.set(path, source.stdout.toString());
      }
      base = clockEntries(previous);
    }
  }
  if (update) {
    const lowered = Object.fromEntries(
      Object.entries(allowed).flatMap(([path, entry]) => {
        const counts = Object.fromEntries(
          Object.entries(entry.counts).flatMap(([op, count]) =>
            current[path]?.counts[op]
              ? [[op, Math.min(count, current[path]!.counts[op]!)]]
              : [],
          ),
        );
        return Object.keys(counts).length ? [[path, { ...entry, counts }]] : [];
      }),
    );
    writeFileSync(
      join(root, ALLOWLIST),
      JSON.stringify({ version: 1, files: lowered }, null, 2) + "\n",
    );
    return [];
  }
  if (!existsSync(join(root, ALLOWLIST)))
    throw new Error("Missing clock port allowlist");
  return compareClocks(current, allowed, base);
}
