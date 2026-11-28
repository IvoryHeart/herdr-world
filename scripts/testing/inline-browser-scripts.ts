import { parse } from "@babel/parser";

/** Executable HTML scripts and CDP evaluate literals; JSON/data scripts are inert. */
export function inlineBrowserScripts(path: string, source: string): string[] {
  if (!/<script\b|\bevaluat(?:e|ion)\b|Runtime\.evaluate/i.test(source))
    return [];
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: path.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
  });
  const scripts: string[] = [];
  const literal = (node: any): string | undefined =>
    node?.type === "StringLiteral"
      ? node.value
      : node?.type === "TemplateLiteral"
        ? node.quasis
            .map((part: any) => part.value.cooked ?? part.value.raw)
            .join("__herdrTemplateValue")
        : undefined;
  const visit = (node: any) => {
    if (node.type === "CallExpression") {
      const callee = node.callee;
      const name =
        callee.type === "Identifier" ? callee.name : callee.property?.name;
      if (name === "evaluate") {
        const script = literal(node.arguments[0]);
        if (script !== undefined) scripts.push(script);
      }
      if (literal(node.arguments[0]) === "Runtime.evaluate") {
        const expression = node.arguments[1]?.properties?.find(
          (property: any) =>
            (property.key?.name ?? property.key?.value) === "expression",
        );
        const script = literal(expression?.value);
        if (script !== undefined) scripts.push(script);
      }
    }
    const html =
      node.type === "StringLiteral"
        ? node.value
        : node.type === "TemplateLiteral"
          ? node.quasis
              .map((part: any) => part.value.cooked ?? part.value.raw)
              .join("__herdrTemplateValue")
          : undefined;
    if (typeof html === "string" && /<script\b/i.test(html)) {
      for (const match of html.matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
      )) {
        const type = /\btype\s*=\s*["']?([^\s"'>]+)/i
          .exec(match[1])?.[1]
          ?.toLowerCase();
        if (
          type &&
          !["module", "text/javascript", "application/javascript"].includes(
            type,
          )
        )
          continue;
        if (match[2]!.trim()) scripts.push(match[2]!);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "tokens", "comments"].includes(key)) continue;
      for (const child of Array.isArray(value) ? value : [value])
        if (child && typeof child === "object" && "type" in child) visit(child);
    }
  };
  visit(ast);
  return scripts;
}
