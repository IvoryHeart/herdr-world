import { parse } from "@babel/parser";

/** Executable inline scripts in HTML literals; JSON/data scripts are inert. */
export function inlineBrowserScripts(path: string, source: string): string[] {
  if (!/<script\b/i.test(source)) return [];
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: path.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
  });
  const scripts: string[] = [];
  const visit = (node: any) => {
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
