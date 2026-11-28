import { parse } from "@babel/parser";

/** Measure argument evaluation and the original assertion without changing it. */
export function instrumentAssertions(source: string, path: string): string {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: path.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
  });
  const edits: { at: number; text: string }[] = [];
  const children = (node: any): any[] =>
    Object.entries(node).flatMap(([key, value]) =>
      ["loc", "comments", "tokens"].includes(key)
        ? []
        : (Array.isArray(value) ? value : [value]).filter(
            (child) => child && typeof child === "object" && "type" in child,
          ),
    );
  const suspended = (node: any): boolean =>
    ["AwaitExpression", "YieldExpression"].includes(node.type) ||
    children(node).some(suspended);
  const walk = (node: any) => {
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "check" &&
      !suspended(node)
    ) {
      edits.push(
        {
          at: node.start,
          text: "(globalThis.__herdrTestAssert || (work => work()))(() => ",
        },
        { at: node.end, text: ")" },
      );
    }
    for (const child of children(node)) walk(child);
  };
  walk(ast.program);
  for (const edit of edits.sort((a, b) => b.at - a.at))
    source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
  return source;
}

export const assertionPhases: Bun.BunPlugin = {
  name: "browser-assertion-phases",
  setup(builder) {
    builder.onLoad({ filter: /\.browser\.tsx?$/ }, async (args) => ({
      contents: instrumentAssertions(
        await Bun.file(args.path).text(),
        args.path,
      ),
      loader: args.path.endsWith("x") ? "tsx" : "ts",
    }));
  },
};
