// GNU coreutils tolerate renamed applets; uutils (on CI images) may reject
// them as a security violation. Keep process-name fixtures on a shell or a
// purpose-built probe, and preserve the basename when linking system tools.
import { parse } from "@babel/parser";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const coreutils = new Set(
  "arch base32 base64 basename cat chgrp chmod chown chroot cksum comm cp csplit cut date dd df dir dircolors dirname du echo env expand expr factor false fmt fold groups head hostid id install join kill link ln logname ls md5sum mkdir mkfifo mknod mktemp mv nice nl nohup nproc numfmt od paste pathchk pinky pr printenv printf ptx pwd readlink realpath rm rmdir runcon seq sha1sum sha224sum sha256sum sha384sum sha512sum shred shuf sleep sort split stat stdbuf stty sum sync tac tail tee test timeout touch tr true truncate tsort tty uname unexpand uniq unlink uptime users vdir wc who whoami yes".split(
    " ",
  ),
);
type Node = { type?: string; [key: string]: unknown };

export function portabilityProblems(source: string): string[] {
  // Most tests do not create executable aliases. Avoid parsing their ASTs on
  // every commit/push; this filter cannot exclude a checked API name.
  if (!/\b(?:symlink|link|copyFile)(?:Sync)?\b/.test(source)) return [];
  let tree;
  try {
    tree = parse(source, { sourceType: "module", plugins: ["typescript"] });
  } catch {
    tree = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
  }
  const bindings = new Map<string, Node>();
  const calls: Node[] = [];
  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const node = value as Node;
    if (node.type === "VariableDeclarator") {
      const id = node.id as Node;
      if (id.type === "Identifier" && node.init)
        bindings.set(id.name as string, node.init as Node);
    }
    if (node.type === "CallExpression") calls.push(node);
    for (const [key, child] of Object.entries(node))
      if (!["loc", "start", "end", "comments", "tokens"].includes(key))
        walk(child);
  }
  walk(tree);
  function unwrap(node: Node, seen = new Set<string>()): Node {
    if (
      [
        "TSNonNullExpression",
        "TSAsExpression",
        "ParenthesizedExpression",
        "AwaitExpression",
      ].includes(node.type || "")
    )
      return unwrap((node.expression || node.argument) as Node, seen);
    if (
      node.type === "Identifier" &&
      bindings.has(node.name as string) &&
      !seen.has(node.name as string)
    ) {
      seen.add(node.name as string);
      return unwrap(bindings.get(node.name as string)!, seen);
    }
    return node;
  }
  const name = (node: Node) =>
    node.type === "MemberExpression" ? (node.property as Node).name : node.name;
  function pathName(value: Node): string | undefined {
    const node = unwrap(value);
    if (node.type === "StringLiteral") return basename(node.value as string);
    if (
      node.type === "CallExpression" &&
      ["which", "join", "resolve"].includes(name(node.callee as Node) as string)
    ) {
      const args = node.arguments as Node[];
      return pathName(
        args[name(node.callee as Node) === "which" ? 0 : args.length - 1]!,
      );
    }
    return undefined;
  }
  const problems: string[] = [];
  for (const call of calls) {
    if (
      !/^(?:symlink|link|copyFile)(?:Sync)?$/.test(
        name(call.callee as Node) as string,
      )
    )
      continue;
    const args = call.arguments as Node[];
    if (args.length < 2) continue;
    const from = pathName(args[0]!);
    if (from && coreutils.has(from) && pathName(args[1]!) !== from)
      problems.push(
        `line ${(call.loc as { start: { line: number } }).start.line}: renamed coreutils '${from}' fixture; preserve its basename or use sh/a purpose-built probe (uutils rejects renamed applets)`,
      );
  }
  return problems;
}

if (import.meta.main) {
  const files = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
    { stdout: "pipe" },
  )
    .stdout.toString()
    .split("\n");
  const problems = [...new Set(files)]
    .filter((path) => /\.test\.[cm]?[jt]sx?$/.test(path))
    .flatMap((path) =>
      portabilityProblems(readFileSync(path, "utf8")).map(
        (problem) => `${path}:${problem}`,
      ),
    );
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exitCode = 1;
}
