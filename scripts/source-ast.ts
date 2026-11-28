/** Babel AST helpers shared by the source checks. */

/** @internal Test code: tests, fixtures, cases, browser mocks and testing/ helpers. */
export const TEST_FILE =
  /(?:\.(?:test|browser)\.[cm]?[jt]sx?|\.(?:fixture|cases|browserMock)\.[cm]?[jt]sx?|\/testing\/[^/]+\.[cm]?[jt]sx?)$/;

export type Node = {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
};

/** A node's child nodes, without locations and comments. */
export function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "extra" ||
      key.endsWith("Comments")
    )
      continue;
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === "object" && "type" in item)
          out.push(item as Node);
    } else if (value && typeof value === "object" && "type" in value)
      out.push(value as Node);
  }
  return out;
}

export const isIdentifier = (node: unknown, name?: string | RegExp): boolean =>
  !!node &&
  (node as Node).type === "Identifier" &&
  (name === undefined ||
    (typeof name === "string"
      ? (node as Node).name === name
      : name.test((node as Node).name as string)));
