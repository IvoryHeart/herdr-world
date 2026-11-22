/** Static inventory: never import browser modules or start their stores. */
import { parse } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, normalize } from "node:path";

export function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory())
      return entry.name === "testing" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(path) &&
      !/\.(test|browser|live|fixture|browserMock)\./.test(path) &&
      !path.endsWith("/browserAcceptanceFixture.ts")
      ? [path]
      : [];
  });
}

type Node = { type?: string; [key: string]: unknown };
const child = (node: Node, key: string) => node[key] as Node | undefined;
const list = (node: Node, key: string) => (node[key] ?? []) as Node[];
function walk(value: unknown, visit: (node: Node) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const node = value as Node;
  visit(node);
  for (const [key, next] of Object.entries(node))
    if (!["loc", "comments", "tokens"].includes(key)) walk(next, visit);
}
function tree(path: string) {
  return parse(readFileSync(path, "utf8"), {
    sourceType: "module",
    plugins: path.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }).program;
}

/** Follow lexical bindings and imports; key families retain dynamic wildcards. */
export function browserKeys(
  files = sourceFiles("web/src"),
  unresolved: string[] = [],
): string[] {
  const modules = new Map(
    files.map((path) => [path, tree(path) as unknown as Node]),
  );
  const parents = new Map<Node, Node>();
  const paths = new Map<Node, string>();
  const bindings = new Map<Node, Map<string, Node>>();
  const calls: Node[] = [];
  const isFunction = (node: Node) =>
    /Function|Method/.test(node.type ?? "") && Array.isArray(node.params);
  const scope = (node: Node): Node => {
    const parent = parents.get(node);
    return !parent ||
      parent.type === "Program" ||
      parent.type === "BlockStatement" ||
      isFunction(parent)
      ? (parent ?? node)
      : scope(parent);
  };
  const bind = (at: Node, name: string, value: Node) => {
    const names = bindings.get(at) ?? new Map<string, Node>();
    names.set(name, value);
    bindings.set(at, names);
  };
  for (const [path, ast] of modules) {
    const index = (node: Node) => {
      paths.set(node, path);
      for (const [key, value] of Object.entries(node)) {
        if (["loc", "comments", "tokens"].includes(key)) continue;
        for (const next of Array.isArray(value) ? value : [value])
          if (next && typeof next === "object" && "type" in next) {
            parents.set(next as Node, node);
            index(next as Node);
          }
      }
    };
    index(ast);
    walk(ast, (node) => {
      if (
        node.type === "VariableDeclarator" &&
        child(node, "id")?.type === "Identifier"
      ) {
        const loop = parents.get(parents.get(node)!);
        bind(
          scope(node),
          child(node, "id")!.name as string,
          child(node, "init") ??
            (loop?.type === "ForOfStatement" ? child(loop, "right")! : node),
        );
      }
      if (node.type === "FunctionDeclaration")
        bind(scope(node), child(node, "id")!.name as string, node);
      if (isFunction(node))
        for (const param of list(node, "params")) {
          const id =
            param.type === "AssignmentPattern" ? child(param, "left")! : param;
          if (id.type === "Identifier") bind(node, id.name as string, param);
        }
      if (node.type === "ImportDeclaration")
        for (const spec of list(node, "specifiers"))
          bind(ast, child(spec, "local")!.name as string, {
            type: "Import",
            imported: child(spec, "imported")?.name,
            source: child(node, "source")!.value,
            path,
          });
      if (
        node.type === "CallExpression" ||
        node.type === "OptionalCallExpression"
      )
        calls.push(node);
    });
  }
  function lookup(node: Node): Node | undefined {
    let at: Node | undefined = node;
    while (at) {
      const value = bindings.get(at)?.get(node.name as string);
      if (value) {
        if (value.type !== "Import") return value;
        const base = normalize(
          join(dirname(value.path as string), value.source as string),
        );
        const target = modules.get(base + ".ts") ?? modules.get(base + ".tsx");
        return target && bindings.get(target)?.get(value.imported as string);
      }
      at = parents.get(at);
    }
    return undefined;
  }
  const methodName = (node: Node): unknown =>
    node.name ??
    child(node, "id")?.name ??
    child(node, "property")?.name ??
    child(child(node, "property") ?? {}, "id")?.name;
  function values(node: Node | undefined, seen = new Set<Node>()): string[] {
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    const read = (next: Node | undefined) => values(next, seen);
    const parent = parents.get(node);
    if (parent && isFunction(parent) && list(parent, "params").includes(node)) {
      const name =
        methodName(child(parent, "key") ?? child(parent, "id") ?? {}) ??
        child(parents.get(parent) ?? {}, "id")?.name;
      return calls
        .flatMap((call) => {
          const callee = child(call, "callee")!;
          return (
            callee.type === "Identifier"
              ? lookup(callee) === parent
              : methodName(callee) === name &&
                paths.get(call) === paths.get(parent)
          )
            ? read(
                list(call, "arguments")[list(parent, "params").indexOf(node)],
              )
            : [];
        })
        .concat(read(child(node, "right")));
    }
    if (node.type === "StringLiteral") return [node.value as string];
    if (node.type === "Identifier") return read(lookup(node));
    if (node.type === "TemplateLiteral") {
      let result = [""];
      const expressions = list(node, "expressions");
      list(node, "quasis").forEach((part, index) => {
        result = result.map(
          (key) => key + (part.value as { cooked: string }).cooked,
        );
        if (expressions[index]) {
          const next = read(expressions[index]);
          result = result.flatMap((key) =>
            (next.length ? next : ["*"]).map((suffix) => key + suffix),
          );
        }
      });
      return result;
    }
    if (node.type === "BinaryExpression" && node.operator === "+")
      return read(child(node, "left")).flatMap((key) => {
        const right = read(child(node, "right"));
        return (right.length ? right : ["*"]).map((suffix) => key + suffix);
      });
    if (node.type === "ConditionalExpression")
      return [
        ...read(child(node, "consequent")),
        ...read(child(node, "alternate")),
      ];
    if (node.type === "TSAsExpression") return read(child(node, "expression"));
    if (node.type === "ArrayExpression")
      return list(node, "elements").flatMap(read);
    if (node.type === "NewExpression" && child(node, "callee")?.name === "Set")
      return list(node, "arguments").flatMap(read);
    if (
      node.type === "MemberExpression" &&
      child(node, "property")?.name === "current"
    )
      return read(child(node, "object"));
    if (node.type === "CallExpression") {
      const callee = child(node, "callee")!;
      if (callee.name === "connectionStorageKey")
        return read(list(node, "arguments")[1]);
      if (callee.name === "useRef") return read(list(node, "arguments")[0]);
      if (
        callee.type === "MemberExpression" &&
        child(callee, "property")?.name === "key"
      ) {
        const prefixes: string[] = [];
        walk(scope(node), (candidate) => {
          const method = child(candidate, "callee");
          const object = method && child(method, "object");
          if (
            (candidate.type === "CallExpression" ||
              candidate.type === "OptionalCallExpression") &&
            method &&
            child(method, "property")?.name === "startsWith" &&
            object?.type === "Identifier" &&
            lookup(object) === node
          )
            prefixes.push(
              ...read(list(candidate, "arguments")[0]).map(
                (prefix) => prefix + "*",
              ),
            );
        });
        return prefixes;
      }
      return read(callee);
    }
    if (isFunction(node)) {
      const body = child(node, "body");
      if (body?.type !== "BlockStatement") return read(body);
      const result: string[] = [];
      const returns = (next: Node) => {
        if (next.type === "ReturnStatement")
          result.push(...read(child(next, "argument")));
        else
          for (const value of Object.values(next))
            for (const nested of Array.isArray(value) ? value : [value])
              if (
                nested &&
                typeof nested === "object" &&
                "type" in nested &&
                !isFunction(nested as Node)
              )
                returns(nested as Node);
      };
      returns(body!);
      return result;
    }
    return [];
  }
  return [
    ...new Set(
      calls
        .flatMap((call) => {
          if (paths.get(call)?.endsWith("/browserStorage.ts")) return [];
          const callee = child(call, "callee")!;
          if (
            !/MemberExpression$/.test(callee.type ?? "") ||
            !/^(get|set|remove)Item$/.test(methodName(callee) as string)
          )
            return [];
          const keys = values(list(call, "arguments")[0]);
          if (!keys.length)
            unresolved.push(
              `${paths.get(call)}:${(call.loc as { start: { line: number } }).start.line}`,
            );
          return keys;
        })
        .map((key) => key.replace(/\*+/g, "*")),
    ),
  ].sort();
}

/** Stateful domain classes and named functional stores, discovered independently.
 * New function stores use the Store/Cache/Registry naming convention; the
 * explicit catalog also names composition roots and hook-owned page state.
 */
export function memorySources(
  files = [
    "server/src/world",
    "server/src/features",
    "server/src/shipyard",
    "web/src/world",
  ].flatMap(sourceFiles),
): string[] {
  return files
    .flatMap((path) => {
      const found: string[] = [];
      walk(tree(path), (node) => {
        if (node.type === "ExportNamedDeclaration") {
          const decl = child(node, "declaration");
          const name = decl && (child(decl, "id")?.name as string | undefined);
          if (
            decl?.type === "FunctionDeclaration" &&
            name &&
            /(?:Store|Cache|Registry)$/.test(name) &&
            !/^(use|shared)/.test(name)
          )
            found.push(`${path}#${name}`);
        }
        if (node.type !== "ClassDeclaration") return;
        const name = child(node, "id")?.name as string | undefined;
        if (!name) return;
        if (/Error|Refused|Conflict/.test(name)) return;
        if (
          list(child(node, "body")!, "body").some(
            (member) => /Property$/.test(member.type ?? "") && member.value,
          )
        )
          found.push(`${path}#${name}`);
      });
      return found;
    })
    .sort();
}
